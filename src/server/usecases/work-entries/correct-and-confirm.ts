/**
 * correctAndConfirmWorkEntry — T4.3, `POST /api/v1/work-entries/:id/correct-and-confirm`.
 *
 * Tek BEGIN IMMEDIATE transaction; sıra: makbuz (replay ÖNCE) → kapsamlı kayıt
 * araması (404) → sürüm (409 VERSION_CONFLICT) → onay gerekmiyor (422
 * CONFIRMATION_NOT_REQUIRED) → onaysız (409 ENTRY_NOT_CONFIRMED) → alan
 * doğrulaması (tür/kişi/tutar/saat/`receivedCents`, 422) → "değişiklik yok"
 * (422 `change`) → koşullu UPDATE (`version` + `status = 'confirmed'` +
 * `work_kind = 'driver'`) + revizyon (`correct_and_confirm`) +
 * `cash_confirmations` (revizyona FK) + (yalnız ekip) `admin_audit` + makbuz.
 * Hepsi birlikte commit olur ya da hiçbiri.
 *
 * Eski revizyon ve onay satırlarına ASLA dokunulmaz: yeni sürüm yeni satır
 * ekler; güncel görünüm yalnız güncel sürümün onayını bağlar. Kayıt türü (K4) ve
 * durum DEĞİŞMEZ; pay/kalan `figures` ile KAYDIN türüne göre yeniden hesaplanır.
 * `receivedCents` AÇIK ve zorunludur; sunucu onu yeni kalandan doldurmaz.
 *
 * Parse/doğrulama/hash kilit DIŞINDA; transaction gövdesi senkrondur.
 */
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { DRIVER_FIELD_MESSAGES, WORK_ENTRY_MESSAGES as TEXT } from "../../../lib/messages";
import type { Scope } from "../../auth/scope";
import { systemClock, type Clock } from "../../auth/session";
import { withImmediateTransaction, type AppDatabase } from "../../data/db";
import { adminAudit, cashConfirmations, workEntries, workEntryRevisions } from "../../data/schema";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { findSelectableDriver } from "../drivers/queries";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import type { SessionContext } from "../session/types";
import { receivedCentsSchema } from "./confirm";
import {
  WorkEntryConfirmationNotRequiredError,
  WorkEntryNotConfirmedError,
  WorkEntryNotFoundError,
  WorkEntryVersionConflictError,
} from "./errors";
import { computeWorkEntryFigures } from "./figures";
import { buildActor, type PrepareWorkEntryCreateResult } from "./prepare-create";
import { findWorkEntryRowForScope, readVehicleOwnerPerson, readWorkEntryView, type WorkEntryView } from "./queries";
import { auditPayload, FIGURE_KEYS, normalizedDailyPayload, updateSubjectSchema } from "./update";

export const WORK_ENTRY_CORRECT_AND_CONFIRM_OPERATION = "work_entry.correct_and_confirm";

export interface CorrectAndConfirmWorkEntryParams {
  requestId: string;
  /** YALNIZ URL'den gelir; gövdedeki kimlik alanları yok sayılır. */
  entryId: string;
  /** Düzeltmenin dayandığı sürüm (iyimser kilit). */
  version: number;
  /** Ham gövde; günlük alanların TAMAMI + `receivedCents`. */
  body: unknown;
}

export type CorrectAndConfirmWorkEntryResult =
  | { ok: true; status: number; workEntry: WorkEntryView }
  | Exclude<PrepareWorkEntryCreateResult, { ok: true }>;

/** Hash: kayıt kimliği, sürüm, normalleştirilmiş günlük alanlar, tür/kişi ve `receivedCents`. */
function computeRequestHash(params: CorrectAndConfirmWorkEntryParams): string | undefined {
  const daily = normalizedDailyPayload(params.body);
  const received = receivedCentsSchema.safeParse(params.body);
  if (!daily || !received.success) return undefined;
  return hashRequestPayload({
    entryId: params.entryId,
    version: params.version,
    ...daily,
    receivedCents: received.data.receivedCents,
  });
}

export function correctAndConfirmWorkEntry(
  db: AppDatabase,
  context: SessionContext,
  scope: Scope,
  params: CorrectAndConfirmWorkEntryParams,
  clock: Clock = systemClock,
): CorrectAndConfirmWorkEntryResult {
  if (!scope.vehicleId) {
    throw new Error("correctAndConfirmWorkEntry: scope.vehicleId eksik (programlama hatası).");
  }
  const vehicleId = scope.vehicleId;
  const requestHash = computeRequestHash(params);

  return withImmediateTransaction(db.$client, (): CorrectAndConfirmWorkEntryResult => {
    // Replay ÖNCE: kayıt sonradan başka sürüme geçse de commit edilmiş sonuç döner.
    if (requestHash !== undefined) {
      const resolved = resolveReceipt(
        db,
        context,
        scope,
        { requestId: params.requestId, operation: WORK_ENTRY_CORRECT_AND_CONFIRM_OPERATION, requestHash },
        clock,
      );
      if (resolved.replay) {
        const replayed = resolved.receipt.entityId
          ? readWorkEntryView(db, scope, resolved.receipt.entityId)
          : undefined;
        if (!replayed) {
          throw new Error("correctAndConfirmWorkEntry: makbuzdaki kayıt bulunamadı (veri bütünlüğü hatası).");
        }
        return { ok: true, status: resolved.receipt.responseCode, workEntry: replayed };
      }
    }

    // Başka araç/işletme ve bilinmeyen kimlik AYNI 404. Şoför oturumu izinle zaten elenir.
    const row = findWorkEntryRowForScope(db, scope, params.entryId, { applyK1: false });
    if (!row) throw new WorkEntryNotFoundError();
    const current = row.entry;
    if (current.version !== params.version) throw new WorkEntryVersionConflictError();
    if (current.workKind !== "driver") throw new WorkEntryConfirmationNotRequiredError();
    if (current.status !== "confirmed") throw new WorkEntryNotConfirmedError();

    const fields: Record<string, string> = {};
    const subject = updateSubjectSchema.safeParse(params.body);
    if (!subject.success) {
      for (const issue of subject.error.issues) {
        fields[issue.path.join(".") || "workType"] ??= issue.message;
      }
    }
    const { workType, workerPersonId } = subject.success ? subject.data : {};
    if (workType !== undefined && workType !== current.workKind) {
      fields.workType = TEXT.workTypeMismatch;
    }

    // Kişi değişimi yalnız seçilebilir şoföre; mevcut (artık pasif) kişiyi korumak serbesttir.
    let personId = current.personId;
    if (workerPersonId !== undefined && workerPersonId !== current.personId) {
      const selectable = findSelectableDriver(db, scope, workerPersonId);
      if (selectable) {
        personId = selectable.personId;
      } else {
        // Yok / başka işletme / pasif / atama pasif / sahip: AYNI metin (varlık sızıntısı yok).
        fields.workerPersonId = TEXT.personUnavailable;
      }
    }

    const received = receivedCentsSchema.safeParse(params.body);
    if (!received.success) {
      for (const issue of received.error.issues) {
        fields[issue.path.join(".") || "receivedCents"] ??= issue.message;
      }
    }

    const computed = computeWorkEntryFigures(current.workKind, params.body);
    if (!computed.ok) Object.assign(fields, computed.fields);
    // Hash yoksa gövde şemaları başarısızdır: `fields` zaten doludur.
    if (Object.keys(fields).length > 0 || !computed.ok || !received.success || requestHash === undefined) {
      return { ok: false, status: 422, code: "VALIDATION_ERROR", fields };
    }
    const figures = computed.figures;
    const receivedCents = received.data.receivedCents;

    // Yalnız alınan tutar değişse de düzeltmedir; hiçbir şey değişmiyorsa 422.
    const unchanged =
      personId === current.personId &&
      FIGURE_KEYS.every((key) => figures[key] === current[key]) &&
      row.confirmation !== null &&
      String(row.confirmation.receivedCents) === receivedCents;
    if (unchanged) {
      return { ok: false, status: 422, code: "VALIDATION_ERROR", fields: { change: DRIVER_FIELD_MESSAGES.noChange } };
    }

    const newVersion = params.version + 1;
    const now = clock().toISOString();
    const updateResult = db
      .update(workEntries)
      .set({
        personId,
        workDate: figures.workDate,
        startsAt: figures.startsAt,
        endsAt: figures.endsAt,
        durationMinutes: figures.durationMinutes,
        grossCents: figures.grossCents,
        fuelCents: figures.fuelCents,
        otherExpenseCents: figures.otherExpenseCents,
        otherExpenseNote: figures.otherExpenseNote,
        shareBps: figures.shareBps,
        shareCents: figures.shareCents,
        remainderCents: figures.remainderCents,
        calculationVersion: figures.calculationVersion,
        version: sql`${workEntries.version} + 1`,
      })
      .where(
        and(
          eq(workEntries.businessId, scope.businessId),
          eq(workEntries.vehicleId, vehicleId),
          eq(workEntries.id, params.entryId),
          eq(workEntries.version, params.version),
          eq(workEntries.status, "confirmed"),
          eq(workEntries.workKind, "driver"),
        ),
      )
      .run();
    if (updateResult.changes !== 1) {
      // BEGIN IMMEDIATE altında beklenmez; savunma: nedenini söyle (last-writer-wins YOK).
      const latest = findWorkEntryRowForScope(db, scope, params.entryId, { applyK1: false });
      if (!latest) throw new WorkEntryNotFoundError();
      if (latest.entry.version !== params.version) throw new WorkEntryVersionConflictError();
      if (latest.entry.workKind !== "driver") throw new WorkEntryConfirmationNotRequiredError();
      throw new WorkEntryNotConfirmedError();
    }

    const owner = readVehicleOwnerPerson(db, scope);
    if (!owner) {
      throw new Error("correctAndConfirmWorkEntry: kapsamdaki aracın sahip kişisi bulunamadı (veri bütünlüğü hatası).");
    }
    const actor = buildActor(context, scope, owner.personId);

    const snapshot = {
      id: current.id,
      vehicleId,
      personId,
      workKind: current.workKind,
      status: "confirmed",
      version: newVersion,
      ...figures,
      receivedCents,
    };
    db.insert(workEntryRevisions)
      .values({
        businessId: scope.businessId,
        entryId: current.id,
        version: newVersion,
        action: "correct_and_confirm",
        snapshotJson: JSON.stringify(snapshot),
        ...actor,
        createdAt: now,
      })
      .run();

    // Onay satırı, aynı (yeni) sürümün revizyonuna FK ile bağlıdır (revizyondan SONRA yazılır).
    db.insert(cashConfirmations)
      .values({
        businessId: scope.businessId,
        id: crypto.randomUUID(),
        entryId: current.id,
        entryVersion: newVersion,
        receivedCents: Number(receivedCents),
        confirmedAt: now,
        ...actor,
      })
      .run();

    // Destek izi yalnız ekip eyleminde; sahip kendi düzeltmesi için audit yazmaz.
    if (actor.actorKind === "platform_user") {
      db.insert(adminAudit)
        .values({
          id: crypto.randomUUID(),
          businessId: scope.businessId,
          vehicleId,
          entityType: "work_entry",
          entityId: current.id,
          action: "work_entry.correct_and_confirm",
          beforeJson: JSON.stringify({
            ...auditPayload(current),
            receivedCents: row.confirmation ? String(row.confirmation.receivedCents) : null,
          }),
          afterJson: JSON.stringify({
            ...auditPayload({ ...figures, personId, status: "confirmed", version: newVersion }),
            receivedCents,
          }),
          ...actor,
          occurredAt: now,
        })
        .run();
    }

    recordReceipt(
      db,
      scope,
      {
        requestId: params.requestId,
        operation: WORK_ENTRY_CORRECT_AND_CONFIRM_OPERATION,
        requestHash,
        entityId: current.id,
        resultVersion: newVersion,
        responseCode: 200,
      },
      clock,
    );

    const corrected = readWorkEntryView(db, scope, current.id);
    if (!corrected) {
      throw new Error("correctAndConfirmWorkEntry: düzeltilen kayıt okunamadı (programlama hatası).");
    }
    return { ok: true, status: 200, workEntry: corrected };
  });
}
