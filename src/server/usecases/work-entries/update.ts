/**
 * updateWorkEntry — T3.5, `PATCH /api/v1/work-entries/:id`.
 *
 * Tek BEGIN IMMEDIATE transaction; sıra: makbuz (replay ÖNCE) → kapsamlı kayıt
 * araması (404, şoför için K1 dahil) → onaylı (409 ENTRY_CONFIRMED) → sürüm
 * (409 VERSION_CONFLICT) → şoför aynı-gün penceresi (403) → alan doğrulaması
 * (tür/kişi/tutar/saat, 422) → "değişiklik yok" (422 `change`) → koşullu UPDATE
 * (`version` + `status <> 'confirmed'`) + revizyon (`update`) + (yalnız ekip)
 * `admin_audit` + makbuz. Hepsi birlikte commit olur ya da hiçbiri.
 *
 * Kayıt türü (K4) ve durum DEĞİŞMEZ: `work_kind` yalnız karşılaştırılır, pay
 * `figures` ile KAYDIN türüne göre yeniden hesaplanır (K3/K5/K6). Bu uç asla
 * `cash_confirmations` yazmaz. Bugün, `clock` ile (İstanbul) hesaplanır.
 *
 * Parse/doğrulama/hash kilit DIŞINDA; transaction gövdesi senkrondur.
 */
import crypto from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { DRIVER_FIELD_MESSAGES, WORK_ENTRY_MESSAGES as TEXT } from "../../../lib/messages";
import { istanbulToday } from "../../../lib/work-time";
import { scopeSafeObject, type Scope } from "../../auth/scope";
import { systemClock, type Clock } from "../../auth/session";
import { withImmediateTransaction, type AppDatabase } from "../../data/db";
import { adminAudit, workEntries, workEntryRevisions } from "../../data/schema";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { findSelectableDriver } from "../drivers/queries";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import type { SessionContext } from "../session/types";
import { WorkEntryConfirmedError, WorkEntryNotFoundError, WorkEntryVersionConflictError } from "./errors";
import { computeWorkEntryFigures, type WorkEntryFigures } from "./figures";
import { workEntryInputSchema } from "./input";
import { buildActor, type PrepareWorkEntryCreateResult } from "./prepare-create";
import {
  findWorkEntryRowForScope,
  readVehicleOwnerPerson,
  readWorkEntryView,
  type WorkEntryView,
} from "./queries";
import { WORK_TYPES, WORKER_PERSON_ID_MAX_LENGTH } from "./subject";

export const WORK_ENTRY_UPDATE_OPERATION = "work_entry.update";

export interface UpdateWorkEntryParams {
  requestId: string;
  /** YALNIZ URL'den gelir; gövdedeki kimlik alanları yok sayılır. */
  entryId: string;
  /** Düzenlemenin dayandığı sürüm (iyimser kilit). */
  version: number;
  /** Ham gövde; günlük alanların TAMAMI (oluşturma ile aynı şema). */
  body: unknown;
}

export type UpdateWorkEntryResult =
  | { ok: true; status: number; workEntry: WorkEntryView }
  | Exclude<PrepareWorkEntryCreateResult, { ok: true }>;

/** `workType` verilirse yalnız kayıt türüyle karşılaştırılır; `workerPersonId`
 * yalnız `driver` kaydında kişi değişimi içindir. Kayıt kimliği/kapsam yok. */
export const updateSubjectSchema = scopeSafeObject({
  workType: z.enum(WORK_TYPES, { error: TEXT.workTypeInvalid }).optional(),
  workerPersonId: z
    .string({ error: TEXT.personRequired })
    .max(WORKER_PERSON_ID_MAX_LENGTH, TEXT.personUnavailable)
    .optional(),
});

/** Yeniden hesaplanan ve "değişiklik yok" kararında karşılaştırılan alanlar. */
export const FIGURE_KEYS = [
  "workDate",
  "startsAt",
  "endsAt",
  "durationMinutes",
  "grossCents",
  "fuelCents",
  "otherExpenseCents",
  "otherExpenseNote",
  "shareBps",
  "shareCents",
  "remainderCents",
] as const satisfies readonly (keyof WorkEntryFigures)[];

/** Hash'e giren, NORMALLEŞTİRİLMİŞ günlük alanlar + tür/kişi (düzelt-ve-onayla ile ORTAK).
 * Gövde şemaları başarısızsa `undefined` (geçersiz gövde hiçbir makbuza denk gelemez). */
export function normalizedDailyPayload(body: unknown): Record<string, unknown> | undefined {
  const subject = updateSubjectSchema.safeParse(body);
  const input = workEntryInputSchema.safeParse(body);
  if (!subject.success || !input.success) return undefined;
  return {
    workType: subject.data.workType ?? null,
    workerPersonId: subject.data.workType === "owner" ? null : (subject.data.workerPersonId ?? null),
    date: input.data.date,
    startTime: input.data.startTime,
    endTime: input.data.endTime,
    endsNextDay: input.data.endsNextDay,
    grossCents: input.data.grossCents.toString(),
    fuelCents: input.data.fuelCents.toString(),
    otherExpenseCents: input.data.otherExpenseCents.toString(),
    otherExpenseNote: input.data.otherExpenseNote,
  };
}

/** Hash NORMALLEŞTİRİLMİŞ değerler üzerindendir; kayıt kimliği ve sürüm dahildir
 * (aynı requestId başka kayıtta/sürümde 409 REQUEST_ID_REUSED alır). */
function computeRequestHash(params: UpdateWorkEntryParams): string | undefined {
  const daily = normalizedDailyPayload(params.body);
  if (!daily) return undefined;
  return hashRequestPayload({ entryId: params.entryId, version: params.version, ...daily });
}

function validationError(fields: Record<string, string>): UpdateWorkEntryResult {
  return { ok: false, status: 422, code: "VALIDATION_ERROR", fields };
}

/** Audit yükü yalnız günlük alanları + sürüm taşır (oturum/hash/çerez YOK). */
export function auditPayload(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    [...FIGURE_KEYS, "personId", "status", "version"].map((key) => [key, values[key]]),
  );
}

export function updateWorkEntry(
  db: AppDatabase,
  context: SessionContext,
  scope: Scope,
  params: UpdateWorkEntryParams,
  clock: Clock = systemClock,
): UpdateWorkEntryResult {
  if (!scope.vehicleId) {
    throw new Error("updateWorkEntry: scope.vehicleId eksik (programlama hatası).");
  }
  const vehicleId = scope.vehicleId;
  const requestHash = computeRequestHash(params);
  const isDriver = scope.actor === "driver";

  return withImmediateTransaction(db.$client, (): UpdateWorkEntryResult => {
    // Replay ÖNCE: kişi pasifleşse / kayıt sonradan onaylansa da commit edilmiş sonuç döner.
    // Geçersiz gövde hiçbir makbuza denk gelemez (hash yok) — aşağıda 404/409 sonrası 422 alır.
    if (requestHash !== undefined) {
      const resolved = resolveReceipt(
        db,
        context,
        scope,
        { requestId: params.requestId, operation: WORK_ENTRY_UPDATE_OPERATION, requestHash },
        clock,
      );
      if (resolved.replay) {
        const replayed = resolved.receipt.entityId
          ? readWorkEntryView(db, scope, resolved.receipt.entityId)
          : undefined;
        if (!replayed) {
          throw new Error("updateWorkEntry: makbuzdaki kayıt bulunamadı (veri bütünlüğü hatası).");
        }
        return { ok: true, status: resolved.receipt.responseCode, workEntry: replayed };
      }
    }

    // Başka araç/işletme ve (şoför için) K1 dışı kayıt, bilinmeyen kimlikle AYNI 404.
    const row = findWorkEntryRowForScope(db, scope, params.entryId, { applyK1: true });
    if (!row) throw new WorkEntryNotFoundError();
    const current = row.entry;
    if (current.status === "confirmed") throw new WorkEntryConfirmedError();
    // Bayat sürüm "değişiklik yok" 422'sinden ÖNCE 409 alır (T2.6 sırası).
    if (current.version !== params.version) throw new WorkEntryVersionConflictError();

    const today = istanbulToday(clock());
    if (isDriver && current.workDate !== today) {
      return { ok: false, status: 403, code: "FORBIDDEN" };
    }

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

    // Owner kaydında kişi sabittir (aracın GÜNCEL sahibinden türetilmez).
    let personId = current.personId;
    if (current.workKind === "driver" && workerPersonId !== undefined && workerPersonId !== current.personId) {
      const selectable = findSelectableDriver(db, scope, workerPersonId);
      if (selectable) {
        personId = selectable.personId;
      } else {
        // Yok / başka işletme / pasif / atama pasif / sahip: AYNI metin (varlık sızıntısı yok).
        fields.workerPersonId = TEXT.personUnavailable;
      }
    }

    const computed = computeWorkEntryFigures(current.workKind, params.body);
    if (!computed.ok) Object.assign(fields, computed.fields);
    else if (isDriver && computed.figures.workDate !== today) fields.date = TEXT.dateMustBeToday;
    // Hash yoksa gövde şemaları başarısızdır: `fields` zaten doludur.
    if (Object.keys(fields).length > 0 || !computed.ok || requestHash === undefined) {
      return validationError(fields);
    }
    const figures = computed.figures;

    const unchanged =
      personId === current.personId && FIGURE_KEYS.every((key) => figures[key] === current[key]);
    if (unchanged) return validationError({ change: DRIVER_FIELD_MESSAGES.noChange });

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
          ne(workEntries.status, "confirmed"),
        ),
      )
      .run();
    if (updateResult.changes !== 1) {
      // BEGIN IMMEDIATE altında beklenmez; savunma: son durumu okuyup nedenini söyle (last-writer-wins YOK).
      const latest = findWorkEntryRowForScope(db, scope, params.entryId, { applyK1: false });
      if (!latest) throw new WorkEntryNotFoundError();
      if (latest.entry.status === "confirmed") throw new WorkEntryConfirmedError();
      throw new WorkEntryVersionConflictError();
    }

    const owner = readVehicleOwnerPerson(db, scope);
    if (!owner) {
      throw new Error("updateWorkEntry: kapsamdaki aracın sahip kişisi bulunamadı (veri bütünlüğü hatası).");
    }
    const actor = buildActor(context, scope, owner.personId);

    const snapshot = {
      id: current.id,
      vehicleId,
      personId,
      workKind: current.workKind,
      status: current.status,
      version: newVersion,
      ...figures,
    };
    db.insert(workEntryRevisions)
      .values({
        businessId: scope.businessId,
        entryId: current.id,
        version: newVersion,
        action: "update",
        snapshotJson: JSON.stringify(snapshot),
        ...actor,
        createdAt: now,
      })
      .run();

    // Destek izi yalnız ekip eyleminde; sahip/şoför kendi kaydı için audit yazmaz.
    if (actor.actorKind === "platform_user") {
      db.insert(adminAudit)
        .values({
          id: crypto.randomUUID(),
          businessId: scope.businessId,
          vehicleId,
          entityType: "work_entry",
          entityId: current.id,
          action: "work_entry.update",
          beforeJson: JSON.stringify(auditPayload(current)),
          afterJson: JSON.stringify(auditPayload({ ...figures, personId, status: current.status, version: newVersion })),
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
        operation: WORK_ENTRY_UPDATE_OPERATION,
        requestHash,
        entityId: current.id,
        resultVersion: newVersion,
        responseCode: 200,
      },
      clock,
    );

    const updated = readWorkEntryView(db, scope, current.id);
    if (!updated) {
      throw new Error("updateWorkEntry: güncellenen kayıt okunamadı (programlama hatası).");
    }
    return { ok: true, status: 200, workEntry: updated };
  });
}
