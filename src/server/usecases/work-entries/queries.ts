/**
 * Günlük kayıt okumaları (T3.3, T3.5). Her okuma kapsam süzgecinden geçer
 * (işletme + araç); URL'den gelen bir kayıt kimliği tek başına ERİŞİM VERMEZ.
 *
 * K1 (şoför görünürlüğü): şoför oturumu yalnız `driver` türünde, kişisi
 * HÂLÂ seçilebilir (aktif atama + aktif kişi, sahip hariç) kayıtları görür.
 * Sahip/ekip görünürlüğü kapsamla sınırlıdır.
 */
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { WORK_ENTRY_MESSAGES as TEXT } from "../../../lib/messages";
import type { Scope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { scopedVehiclesFilter, scopeFilter } from "../../data/scoped";
import { cashConfirmations, people, platformUsers, vehicles, workEntries } from "../../data/schema";
import { entryPersonSelectableWhere, findSelectableDriver } from "../drivers/queries";
import { encodeCursor, requireCursor } from "../list-cursor";

/** API sözleşmesi: tüm kuruş alanları ondalık tam sayı METNİDİR. */
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
  /** Kaydın GÜNCEL sürümüne ait teslim onayı; onaysız kayıtta `null`. */
  confirmation: WorkEntryConfirmationView | null;
}

/** Onaylayan özeti: yalnız tür (+ ekip için kullanıcı adı); hiçbir kimlik dışarı çıkmaz. */
export type WorkEntryConfirmationActor = { kind: "vehicle_credential" } | { kind: "platform_user"; username: string };

/** Oturum/credential/kişi kimliği taşımaz; kuruş ondalık tam sayı metnidir.
 * `actor`: şoför oturumuna her zaman `null` (ekip kullanıcı adı şoföre sızmaz). */
export interface WorkEntryConfirmationView {
  receivedCents: string;
  confirmedAt: string;
  entryVersion: number;
  actor: WorkEntryConfirmationActor | null;
}

/** Kaydın ham satırı (düzenleme kararları için) + kişinin adı + güncel sürümün onayı. */
export interface WorkEntryRow {
  entry: typeof workEntries.$inferSelect;
  fullName: string;
  confirmation: {
    receivedCents: number;
    confirmedAt: string;
    entryVersion: number;
    actorKind: "vehicle_credential" | "platform_user";
  } | null;
  /** Onayı veren ekip kullanıcısının adı (araç onayında ve onaysız kayıtta `null`). */
  confirmedByUsername: string | null;
}

function toConfirmationActor(
  actorKind: "vehicle_credential" | "platform_user",
  username: string | null,
): WorkEntryConfirmationActor | null {
  if (actorKind === "vehicle_credential") return { kind: "vehicle_credential" };
  return username === null ? null : { kind: "platform_user", username };
}

export function toWorkEntryView({ entry: e, fullName, confirmation, confirmedByUsername }: WorkEntryRow, scope: Scope): WorkEntryView {
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
    person: { id: e.personId, fullName },
    confirmation: confirmation
      ? {
          receivedCents: String(confirmation.receivedCents),
          confirmedAt: confirmation.confirmedAt,
          entryVersion: confirmation.entryVersion,
          actor: scope.actor === "driver" ? null : toConfirmationActor(confirmation.actorKind, confirmedByUsername),
        }
      : null,
  };
}

export function requireEntryVehicleScope(scope: Scope): void {
  if (!scope.vehicleId) {
    throw new Error("work-entries: scope.vehicleId eksik (programlama hatası — hedef 'vehicle' olmalı).");
  }
}

export const entryScopeWhere = (scope: Scope): SQL =>
  scopeFilter(scope, { businessId: workEntries.businessId, vehicleId: workEntries.vehicleId });

/** K1: yalnız şoför oturumuna uygulanır; sahip/ekip için koşul yoktur. */
function driverVisibilityWhere(scope: Scope): SQL | undefined {
  if (scope.actor !== "driver") return undefined;
  return and(eq(workEntries.workKind, "driver"), entryPersonSelectableWhere(workEntries));
}

function selectEntryRows(db: AppDatabase, where: SQL | undefined) {
  return db
    .select({
      entry: workEntries,
      fullName: people.fullName,
      confirmation: {
        receivedCents: cashConfirmations.receivedCents,
        confirmedAt: cashConfirmations.confirmedAt,
        entryVersion: cashConfirmations.entryVersion,
        actorKind: cashConfirmations.actorKind,
      },
      confirmedByUsername: platformUsers.username,
    })
    .from(workEntries)
    .innerJoin(
      people,
      and(eq(people.businessId, workEntries.businessId), eq(people.id, workEntries.personId)),
    )
    // Yalnız AYNI işletme + kayıt + GÜNCEL sürümün onayı (eski sürümün onayı eşleşmez).
    .leftJoin(
      cashConfirmations,
      and(
        eq(cashConfirmations.businessId, workEntries.businessId),
        eq(cashConfirmations.entryId, workEntries.id),
        eq(cashConfirmations.entryVersion, workEntries.version),
      ),
    )
    // Ekip onayında kullanıcı adı için; araç onayında (NULL kimlik) satır yine döner.
    .leftJoin(platformUsers, eq(platformUsers.id, cashConfirmations.actorPlatformUserId))
    .where(where);
}

/** Kapsam süzgeçli tek satır; `applyK1` şoför görünürlüğünü de uygular. */
export function findWorkEntryRowForScope(
  db: AppDatabase,
  scope: Scope,
  entryId: string,
  options: { applyK1: boolean },
): WorkEntryRow | undefined {
  requireEntryVehicleScope(scope);
  return selectEntryRows(
    db,
    and(entryScopeWhere(scope), eq(workEntries.id, entryId), options.applyK1 ? driverVisibilityWhere(scope) : undefined),
  ).get();
}

/** Kapsam süzgeçli okuma (K1 YOK): başka işletme/araç kaydı ASLA dönmez.
 * Oluşturma/düzenleme sonucu ve replay içindir — makbuz, kaydı bu aktörün
 * yazdığını zaten kanıtlar; kişi sonradan pasifleşse de sonuç okunur. */
export function readWorkEntryView(
  db: AppDatabase,
  scope: Scope,
  entryId: string,
): WorkEntryView | undefined {
  const row = findWorkEntryRowForScope(db, scope, entryId, { applyK1: false });
  return row ? toWorkEntryView(row, scope) : undefined;
}

/** `GET /work-entries/:id` — kapsam + K1. Görünmeyen kayıt `undefined`. */
export function readWorkEntryForScope(
  db: AppDatabase,
  scope: Scope,
  entryId: string,
): WorkEntryView | undefined {
  const row = findWorkEntryRowForScope(db, scope, entryId, { applyK1: true });
  return row ? toWorkEntryView(row, scope) : undefined;
}

export interface ListWorkEntriesOptions {
  workerPersonId?: string;
  cursor?: string;
  limit: number;
}

export type ListWorkEntriesResult =
  | { ok: true; workEntries: WorkEntryView[]; nextCursor: string | null }
  | { ok: false; fields: Record<string, string> };

/**
 * `GET /work-entries` — en yeni gün önce (`work_date`, `id` azalan), keyset
 * sayfalama (`idx_work_entries_vehicle_period`). Şoför oturumu seçilebilir bir
 * `workerPersonId` OLMADAN liste alamaz (kimlik oturumda değil, seçilen kişidir);
 * yok/pasif/başka araç/sahip kişisi AYNI metni alır (varlık sızıntısı yok).
 */
export function listWorkEntriesForScope(
  db: AppDatabase,
  scope: Scope,
  options: ListWorkEntriesOptions,
): ListWorkEntriesResult {
  requireEntryVehicleScope(scope);
  if (scope.actor === "driver") {
    if (!options.workerPersonId) return { ok: false, fields: { workerPersonId: TEXT.personRequired } };
    if (!findSelectableDriver(db, scope, options.workerPersonId)) {
      return { ok: false, fields: { workerPersonId: TEXT.personUnavailable } };
    }
  }

  const conditions: (SQL | undefined)[] = [entryScopeWhere(scope), driverVisibilityWhere(scope)];
  if (options.workerPersonId) conditions.push(eq(workEntries.personId, options.workerPersonId));
  if (options.cursor !== undefined) {
    const [workDate, id] = requireCursor(options.cursor, 2) as [string, string];
    conditions.push(
      or(lt(workEntries.workDate, workDate), and(eq(workEntries.workDate, workDate), lt(workEntries.id, id))),
    );
  }

  const rows = selectEntryRows(db, and(...conditions))
    .orderBy(desc(workEntries.workDate), desc(workEntries.id))
    .limit(options.limit + 1)
    .all();
  const page = rows.slice(0, options.limit);
  const last = page[page.length - 1];
  return {
    ok: true,
    workEntries: page.map((row) => toWorkEntryView(row, scope)),
    nextCursor: rows.length > options.limit && last ? encodeCursor([last.entry.workDate, last.entry.id]) : null,
  };
}

export interface VehicleOwnerPerson {
  personId: string;
  fullName: string;
}

/** Kapsamdaki aracın sahibi olan kişi (sahip sayfasındaki "Kim çalıştı?"
 * seçeneği ve `owner` kaydının kişisi). Araç kapsamı yoksa fırlatır. */
export function readVehicleOwnerPerson(
  db: AppDatabase,
  scope: Scope,
): VehicleOwnerPerson | undefined {
  if (!scope.vehicleId) {
    throw new Error("work-entries: scope.vehicleId eksik (programlama hatası — hedef 'vehicle' olmalı).");
  }
  return db
    .select({ personId: people.id, fullName: people.fullName })
    .from(vehicles)
    .innerJoin(
      people,
      and(eq(people.businessId, vehicles.businessId), eq(people.id, vehicles.ownerPersonId)),
    )
    .where(scopedVehiclesFilter(scope))
    .get();
}
