/**
 * confirmWorkEntry — T4.1, `POST /api/v1/work-entries/:id/confirm`.
 *
 * Tek BEGIN IMMEDIATE transaction; sıra: makbuz (replay ÖNCE) → kapsamlı kayıt
 * araması (404) → sürüm (409 VERSION_CONFLICT) → onaylı (409 ENTRY_CONFIRMED) →
 * onay gerekmiyor (422 CONFIRMATION_NOT_REQUIRED) → `receivedCents` (422) →
 * koşullu UPDATE (`version` + `status = 'pending'` + `work_kind = 'driver'`) +
 * revizyon (`confirm`) + `cash_confirmations` (revizyona FK) + (yalnız ekip)
 * `admin_audit` + makbuz. Hepsi birlikte commit olur ya da hiçbiri.
 *
 * Sürüm denetimi onaylı denetiminden ÖNCE: aynı sürümde iki eşzamanlı onayın
 * kaybedeni 409 VERSION_CONFLICT alır. `receivedCents` AÇIK ve zorunludur;
 * sunucu onu asla `remainder_cents`'ten doldurmaz.
 */
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { WORK_ENTRY_MESSAGES as TEXT } from "../../../lib/messages";
import { parseApiCents } from "../../../lib/money";
import { scopeSafeObject, type Scope } from "../../auth/scope";
import { systemClock, type Clock } from "../../auth/session";
import { withImmediateTransaction, type AppDatabase } from "../../data/db";
import { adminAudit, cashConfirmations, workEntries, workEntryRevisions } from "../../data/schema";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import type { SessionContext } from "../session/types";
import {
  WorkEntryConfirmationNotRequiredError,
  WorkEntryConfirmedError,
  WorkEntryNotFoundError,
  WorkEntryVersionConflictError,
} from "./errors";
import { buildActor, type PrepareWorkEntryCreateResult } from "./prepare-create";
import { findWorkEntryRowForScope, readVehicleOwnerPerson, readWorkEntryView, type WorkEntryView } from "./queries";

export const WORK_ENTRY_CONFIRM_OPERATION = "work_entry.confirm";

export interface ConfirmWorkEntryParams {
  requestId: string;
  /** YALNIZ URL'den gelir. */
  entryId: string;
  /** Onayın dayandığı sürüm (iyimser kilit). */
  version: number;
  /** Ham gövde; yalnız `receivedCents` okunur, diğer alanlar yok sayılır. */
  body: unknown;
}

export type ConfirmWorkEntryResult =
  | { ok: true; status: number; workEntry: WorkEntryView }
  | Exclude<PrepareWorkEntryCreateResult, { ok: true }>;

/** Alınan tutar: ondalık tam sayı METNİ (sayı tipi, boş, negatif, ondalık → 422). */
export const receivedCentsSchema = scopeSafeObject({
  receivedCents: z
    .string({ error: TEXT.moneyRequired })
    .min(1, TEXT.moneyRequired)
    .regex(/^(0|[1-9][0-9]*)$/u, TEXT.moneyFormat)
    .refine((value) => parseApiCents(value) !== null, TEXT.moneyTooLarge),
});

export function confirmWorkEntry(
  db: AppDatabase,
  context: SessionContext,
  scope: Scope,
  params: ConfirmWorkEntryParams,
  clock: Clock = systemClock,
): ConfirmWorkEntryResult {
  if (!scope.vehicleId) {
    throw new Error("confirmWorkEntry: scope.vehicleId eksik (programlama hatası).");
  }
  const vehicleId = scope.vehicleId;
  const parsed = receivedCentsSchema.safeParse(params.body);
  const requestHash = parsed.success
    ? hashRequestPayload({
        entryId: params.entryId,
        version: params.version,
        receivedCents: parsed.data.receivedCents,
      })
    : undefined;

  return withImmediateTransaction(db.$client, (): ConfirmWorkEntryResult => {
    // Replay ÖNCE: kayıt artık onaylı olsa da commit edilmiş sonuç döner.
    if (requestHash !== undefined) {
      const resolved = resolveReceipt(
        db,
        context,
        scope,
        { requestId: params.requestId, operation: WORK_ENTRY_CONFIRM_OPERATION, requestHash },
        clock,
      );
      if (resolved.replay) {
        const replayed = resolved.receipt.entityId
          ? readWorkEntryView(db, scope, resolved.receipt.entityId)
          : undefined;
        if (!replayed) {
          throw new Error("confirmWorkEntry: makbuzdaki kayıt bulunamadı (veri bütünlüğü hatası).");
        }
        return { ok: true, status: resolved.receipt.responseCode, workEntry: replayed };
      }
    }

    // Başka araç/işletme ve bilinmeyen kimlik AYNI 404. Şoför oturumu izinle zaten elenir.
    const row = findWorkEntryRowForScope(db, scope, params.entryId, { applyK1: false });
    if (!row) throw new WorkEntryNotFoundError();
    const current = row.entry;
    if (current.version !== params.version) throw new WorkEntryVersionConflictError();
    if (current.status === "confirmed") throw new WorkEntryConfirmedError();
    if (current.workKind !== "driver" || current.status !== "pending") {
      throw new WorkEntryConfirmationNotRequiredError();
    }
    if (!parsed.success || requestHash === undefined) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error?.issues ?? []) {
        fields[issue.path.join(".") || "receivedCents"] ??= issue.message;
      }
      return { ok: false, status: 422, code: "VALIDATION_ERROR", fields };
    }
    const receivedCents = parsed.data.receivedCents;

    const newVersion = params.version + 1;
    const now = clock().toISOString();
    const updateResult = db
      .update(workEntries)
      .set({ status: "confirmed", version: sql`${workEntries.version} + 1` })
      .where(
        and(
          eq(workEntries.businessId, scope.businessId),
          eq(workEntries.vehicleId, vehicleId),
          eq(workEntries.id, params.entryId),
          eq(workEntries.version, params.version),
          eq(workEntries.status, "pending"),
          eq(workEntries.workKind, "driver"),
        ),
      )
      .run();
    if (updateResult.changes !== 1) {
      // BEGIN IMMEDIATE altında beklenmez; savunma: nedenini söyle (last-writer-wins YOK).
      const latest = findWorkEntryRowForScope(db, scope, params.entryId, { applyK1: false });
      if (!latest) throw new WorkEntryNotFoundError();
      if (latest.entry.version !== params.version) throw new WorkEntryVersionConflictError();
      if (latest.entry.status === "confirmed") throw new WorkEntryConfirmedError();
      throw new WorkEntryConfirmationNotRequiredError();
    }

    const owner = readVehicleOwnerPerson(db, scope);
    if (!owner) {
      throw new Error("confirmWorkEntry: kapsamdaki aracın sahip kişisi bulunamadı (veri bütünlüğü hatası).");
    }
    const actor = buildActor(context, scope, owner.personId);

    const snapshot = {
      id: current.id,
      vehicleId,
      personId: current.personId,
      workKind: current.workKind,
      status: "confirmed",
      version: newVersion,
      workDate: current.workDate,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      durationMinutes: current.durationMinutes,
      grossCents: current.grossCents,
      fuelCents: current.fuelCents,
      otherExpenseCents: current.otherExpenseCents,
      otherExpenseNote: current.otherExpenseNote,
      shareBps: current.shareBps,
      shareCents: current.shareCents,
      remainderCents: current.remainderCents,
      receivedCents,
    };
    db.insert(workEntryRevisions)
      .values({
        businessId: scope.businessId,
        entryId: current.id,
        version: newVersion,
        action: "confirm",
        snapshotJson: JSON.stringify(snapshot),
        ...actor,
        createdAt: now,
      })
      .run();

    // Onay satırı, aynı sürümün revizyonuna FK ile bağlıdır (revizyondan SONRA yazılır).
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

    // Destek izi yalnız ekip eyleminde; sahip kendi onayı için audit yazmaz.
    if (actor.actorKind === "platform_user") {
      db.insert(adminAudit)
        .values({
          id: crypto.randomUUID(),
          businessId: scope.businessId,
          vehicleId,
          entityType: "work_entry",
          entityId: current.id,
          action: "work_entry.confirm",
          beforeJson: JSON.stringify({ status: current.status, version: current.version }),
          afterJson: JSON.stringify({ status: "confirmed", version: newVersion, receivedCents }),
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
        operation: WORK_ENTRY_CONFIRM_OPERATION,
        requestHash,
        entityId: current.id,
        resultVersion: newVersion,
        responseCode: 200,
      },
      clock,
    );

    const confirmed = readWorkEntryView(db, scope, current.id);
    if (!confirmed) {
      throw new Error("confirmWorkEntry: onaylanan kayıt okunamadı (programlama hatası).");
    }
    return { ok: true, status: 200, workEntry: confirmed };
  });
}
