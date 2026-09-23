/**
 * createWorkEntry — T3.4, `POST /api/v1/work-entries`.
 *
 * Tek BEGIN IMMEDIATE transaction: makbuz çözümü (replay ÖNCE) → hazırlık
 * (`prepareWorkEntryCreate`, kişi/atama aktifliği yazımla AYNI kilit altında) →
 * `work_entries` + `work_entry_revisions` v1 + (yalnız ekip) `admin_audit` +
 * makbuz. Hepsi birlikte commit olur ya da hiçbiri; 201 commit'ten SONRA
 * döner. Aynı `requestId` + aynı normalleştirilmiş içerik → ikinci satır
 * üretmeden aynı sonuç (replay); farklı içerik → 409 REQUEST_ID_REUSED.
 *
 * Parse/doğrulama/hash kilit DIŞINDA yapılır; transaction gövdesi senkrondur.
 */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { Scope } from "../../auth/scope";
import { withImmediateTransaction, type AppDatabase } from "../../data/db";
import { adminAudit, people, workEntries, workEntryRevisions } from "../../data/schema";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import type { SessionContext } from "../session/types";
import { workEntryInputSchema } from "./input";
import {
  prepareWorkEntryCreate,
  type PrepareWorkEntryCreateResult,
  type WorkEntryCreateInput,
} from "./prepare-create";
import { workEntrySubjectSchema } from "./subject";

export const WORK_ENTRY_CREATE_OPERATION = "work_entry.create";

export interface CreateWorkEntryParams {
  requestId: string;
  /** Ham gövde (istemcinin gönderdiği nesne); doğrulama use case'te yapılır. */
  body: unknown;
}

/** API sözleşmesi: tüm kuruş alanları ondalık tam sayı METNİ. */
export interface WorkEntryView {
  id: string;
  version: number;
  status: "pending" | "confirmed" | "not_required";
  workKind: "owner" | "driver";
  workDate: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  grossCents: string;
  fuelCents: string;
  otherExpenseCents: string;
  shareCents: string;
  remainderCents: string;
  otherExpenseNote: string | null;
  shareBps: number;
  calculationVersion: number;
  person: { id: string; fullName: string };
}

export type CreateWorkEntryResult =
  | { ok: true; status: number; workEntry: WorkEntryView }
  | Exclude<PrepareWorkEntryCreateResult, { ok: true }>;

/**
 * Hash, ham metin değil NORMALLEŞTİRİLMİŞ değerler üzerindendir (kuruşlar
 * ondalık metin — BigInt `JSON.stringify`'da fırlatır; anahtar sırası sabit).
 * `workerPersonId` yalnız `driver` türünde anlamlıdır (owner'da yok sayılır).
 */
function computeRequestHash(body: unknown): string | undefined {
  const subject = workEntrySubjectSchema.safeParse(body);
  const input = workEntryInputSchema.safeParse(body);
  if (!subject.success || !input.success) return undefined;
  return hashRequestPayload({
    workType: subject.data.workType,
    workerPersonId:
      subject.data.workType === "driver" ? (subject.data.workerPersonId ?? null) : null,
    date: input.data.date,
    startTime: input.data.startTime,
    endTime: input.data.endTime,
    endsNextDay: input.data.endsNextDay,
    grossCents: input.data.grossCents.toString(),
    fuelCents: input.data.fuelCents.toString(),
    otherExpenseCents: input.data.otherExpenseCents.toString(),
    otherExpenseNote: input.data.otherExpenseNote,
  });
}

/** Kapsam süzgeçli okuma: başka işletme/araç kaydı ASLA dönmez. */
function readWorkEntryView(
  db: AppDatabase,
  scope: Scope,
  entryId: string,
): WorkEntryView | undefined {
  if (!scope.vehicleId) {
    throw new Error("createWorkEntry: scope.vehicleId eksik (programlama hatası).");
  }
  const row = db
    .select({ entry: workEntries, fullName: people.fullName })
    .from(workEntries)
    .innerJoin(
      people,
      and(eq(people.businessId, workEntries.businessId), eq(people.id, workEntries.personId)),
    )
    .where(
      and(
        eq(workEntries.businessId, scope.businessId),
        eq(workEntries.vehicleId, scope.vehicleId),
        eq(workEntries.id, entryId),
      ),
    )
    .get();
  if (!row) return undefined;
  const e = row.entry;
  return {
    id: e.id,
    version: e.version,
    status: e.status,
    workKind: e.workKind,
    workDate: e.workDate,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    durationMinutes: e.durationMinutes,
    grossCents: String(e.grossCents),
    fuelCents: String(e.fuelCents),
    otherExpenseCents: String(e.otherExpenseCents),
    shareCents: String(e.shareCents),
    remainderCents: String(e.remainderCents),
    otherExpenseNote: e.otherExpenseNote,
    shareBps: e.shareBps,
    calculationVersion: e.calculationVersion,
    person: { id: e.personId, fullName: row.fullName },
  };
}

function insertEntryWithRevision(
  db: AppDatabase,
  input: WorkEntryCreateInput,
  entryId: string,
  now: string,
): { snapshot: Record<string, unknown> } {
  const { figures, actor } = input;
  db.insert(workEntries)
    .values({
      businessId: input.businessId,
      id: entryId,
      vehicleId: input.vehicleId,
      personId: input.personId,
      workKind: input.workKind,
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
      status: input.status,
      version: 1,
    })
    .run();

  const snapshot = {
    id: entryId,
    vehicleId: input.vehicleId,
    personId: input.personId,
    workKind: input.workKind,
    status: input.status,
    version: 1,
    ...figures,
  };
  db.insert(workEntryRevisions)
    .values({
      businessId: input.businessId,
      entryId,
      version: 1,
      action: "create",
      snapshotJson: JSON.stringify(snapshot),
      ...actor,
      createdAt: now,
    })
    .run();
  return { snapshot };
}

export function createWorkEntry(
  db: AppDatabase,
  context: SessionContext,
  scope: Scope,
  params: CreateWorkEntryParams,
  clock: Clock = systemClock,
): CreateWorkEntryResult {
  const requestHash = computeRequestHash(params.body);
  if (requestHash === undefined) {
    // Geçersiz gövde hiçbir makbuza denk gelemez: hazırlık 403/422 üretir, yazım yok.
    const rejected = prepareWorkEntryCreate(db, context, scope, params.body);
    if (rejected.ok) {
      throw new Error("createWorkEntry: geçersiz gövde hazırlıktan geçti (programlama hatası).");
    }
    return rejected;
  }

  return withImmediateTransaction(db.$client, (): CreateWorkEntryResult => {
    // Replay ÖNCE: kişi/atama sonradan pasifleşse de commit edilmiş sonuç döner.
    const resolved = resolveReceipt(
      db,
      context,
      scope,
      { requestId: params.requestId, operation: WORK_ENTRY_CREATE_OPERATION, requestHash },
      clock,
    );
    if (resolved.replay) {
      const replayed = resolved.receipt.entityId
        ? readWorkEntryView(db, scope, resolved.receipt.entityId)
        : undefined;
      if (!replayed) {
        throw new Error("createWorkEntry: makbuzdaki kayıt bulunamadı (veri bütünlüğü hatası).");
      }
      return { ok: true, status: resolved.receipt.responseCode, workEntry: replayed };
    }

    const prepared = prepareWorkEntryCreate(db, context, scope, params.body);
    if (!prepared.ok) return prepared;
    const input = prepared.input;

    const entryId = crypto.randomUUID();
    const now = clock().toISOString();
    const { snapshot } = insertEntryWithRevision(db, input, entryId, now);

    // Destek izi yalnız ekip eyleminde; sahip/şoför kendi kaydı için audit yazmaz.
    if (input.actor.actorKind === "platform_user") {
      const { actor } = input;
      db.insert(adminAudit)
        .values({
          id: crypto.randomUUID(),
          businessId: input.businessId,
          vehicleId: input.vehicleId,
          entityType: "work_entry",
          entityId: entryId,
          action: "work_entry.create",
          beforeJson: null,
          afterJson: JSON.stringify({
            workKind: snapshot.workKind,
            personId: snapshot.personId,
            workDate: snapshot.workDate,
            status: snapshot.status,
            version: 1,
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
        operation: WORK_ENTRY_CREATE_OPERATION,
        requestHash,
        entityId: entryId,
        resultVersion: 1,
        responseCode: 201,
      },
      clock,
    );

    const created = readWorkEntryView(db, scope, entryId);
    if (!created) {
      throw new Error("createWorkEntry: oluşturulan kayıt okunamadı (programlama hatası).");
    }
    return { ok: true, status: 201, workEntry: created };
  });
}
