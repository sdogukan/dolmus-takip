/**
 * `GET /work-entries/:id/history` — salt okunur kayıt geçmişi. Kayıt, revizyonlar
 * ve onaylar TEK okuma transaction'ında (aynı anlık görüntü) okunur; `current`
 * onayı bu görüntünün sürümünden türetilir. Kayıt ÖNCE kapsam süzgeciyle aranır;
 * revizyon/onay okumaları o kaydın (işletme + kayıt) kimliğiyle sınırlıdır.
 *
 * `snapshot_json` yanıta ham girmez: izin listesiyle (allowlist) projeksiyon
 * yapılır, eski/eksik anahtarlar hata vermez. Aktör oturumdan BAĞIMSIZ çözülür
 * (`actor_session_id` hiç seçilmez; bkz. admin-audit/queries.ts); araç
 * credential'ı kişi adıyla gösterilmez. Kişi adları `people`'dan aktiflik
 * süzgeci OLMADAN çözülür — pasif kişi/araç geçmişi değiştirmez.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  diffWorkEntryRevision,
  type WorkEntryHistoryChange,
  type WorkEntryHistoryValues,
} from "../../../lib/work-entry-history";
import type { Scope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import {
  cashConfirmations,
  people,
  platformUsers,
  vehicleCredentials,
  vehicles,
  workEntries,
  workEntryRevisions,
} from "../../data/schema";
import { entryScopeWhere, requireEntryVehicleScope } from "./queries";

export type WorkEntryHistoryActor =
  | { kind: "vehicle_credential"; access: "owner" | "driver"; plateNormalized: string | null }
  | {
      kind: "platform_user";
      username: string;
      fullName: string | null;
      role: "support" | "admin";
      onBehalfOf: { kind: "owner" | "driver"; fullName: string } | null;
    };

export type WorkEntryHistoryAction = "create" | "update" | "confirm" | "correct_and_confirm";

export interface WorkEntryHistoryRevision {
  version: number;
  action: WorkEntryHistoryAction;
  createdAt: string;
  actor: WorkEntryHistoryActor;
  values: WorkEntryHistoryValues;
  /** Sürüm 1'de boştur; sonrakilerde yalnız değişen alanlar. */
  changes: WorkEntryHistoryChange[];
}

export interface WorkEntryHistoryConfirmation {
  entryVersion: number;
  receivedCents: string;
  confirmedAt: string;
  actor: WorkEntryHistoryActor;
  /** Yalnız kaydın GÜNCEL sürümüne ait onay. */
  current: boolean;
}

export interface WorkEntryHistoryView {
  entry: { id: string; version: number; status: "pending" | "confirmed" | "not_required"; workKind: "owner" | "driver" };
  revisions: WorkEntryHistoryRevision[];
  confirmations: WorkEntryHistoryConfirmation[];
}

interface RawActor {
  actorKind: "vehicle_credential" | "platform_user";
  actorRole: string;
  actorCredentialId: string | null;
  actorPlatformUserId: string | null;
  onBehalfOfKind: "owner" | "driver" | null;
  onBehalfOfPersonId: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function parseSnapshot(json: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(json));
  } catch {
    return {};
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const integer = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Sayı (create/update) ya da metin (confirm) → ondalık tam sayı metni. */
function centsText(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)) return value;
  return "0";
}

/** İzin listesi: yalnız bilinen alanlar, tipleri zorlanmış olarak taşınır. */
function projectValues(
  snapshot: Record<string, unknown>,
  personNames: Map<string, string>,
): WorkEntryHistoryValues {
  const personId = text(snapshot.personId);
  const values: WorkEntryHistoryValues = {
    person: { id: personId, fullName: personNames.get(personId) ?? "" },
    workDate: text(snapshot.workDate),
    startsAt: text(snapshot.startsAt),
    endsAt: text(snapshot.endsAt),
    durationMinutes: integer(snapshot.durationMinutes),
    grossCents: centsText(snapshot.grossCents),
    fuelCents: centsText(snapshot.fuelCents),
    otherExpenseCents: centsText(snapshot.otherExpenseCents),
    otherExpenseNote: typeof snapshot.otherExpenseNote === "string" ? snapshot.otherExpenseNote : null,
    shareCents: centsText(snapshot.shareCents),
    remainderCents: centsText(snapshot.remainderCents),
    status: text(snapshot.status),
  };
  if (snapshot.receivedCents !== undefined && snapshot.receivedCents !== null) {
    values.receivedCents = centsText(snapshot.receivedCents);
  }
  return values;
}

function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null && v !== ""))];
}

/** Kapsamdaki kaydın geçmişi; görünmeyen kayıt (bilinmeyen/başka kapsam) `undefined`. */
export function readWorkEntryHistoryForScope(
  db: AppDatabase,
  scope: Scope,
  entryId: string,
): WorkEntryHistoryView | undefined {
  requireEntryVehicleScope(scope);
  const businessId = scope.businessId;

  return db.$client.transaction((): WorkEntryHistoryView | undefined => {
    const entry = db
      .select({
        id: workEntries.id,
        version: workEntries.version,
        status: workEntries.status,
        workKind: workEntries.workKind,
      })
      .from(workEntries)
      .where(and(entryScopeWhere(scope), eq(workEntries.id, entryId)))
      .get();
    if (!entry) return undefined;

    const actorColumns = {
      actorKind: workEntryRevisions.actorKind,
      actorRole: workEntryRevisions.actorRole,
      actorCredentialId: workEntryRevisions.actorCredentialId,
      actorPlatformUserId: workEntryRevisions.actorPlatformUserId,
      onBehalfOfKind: workEntryRevisions.onBehalfOfKind,
      onBehalfOfPersonId: workEntryRevisions.onBehalfOfPersonId,
    };
    const revisionRows = db
      .select({
        version: workEntryRevisions.version,
        action: workEntryRevisions.action,
        snapshotJson: workEntryRevisions.snapshotJson,
        createdAt: workEntryRevisions.createdAt,
        ...actorColumns,
      })
      .from(workEntryRevisions)
      .where(and(eq(workEntryRevisions.businessId, businessId), eq(workEntryRevisions.entryId, entry.id)))
      .orderBy(asc(workEntryRevisions.version))
      .all();
    const confirmationRows = db
      .select({
        entryVersion: cashConfirmations.entryVersion,
        receivedCents: cashConfirmations.receivedCents,
        confirmedAt: cashConfirmations.confirmedAt,
        actorKind: cashConfirmations.actorKind,
        actorRole: cashConfirmations.actorRole,
        actorCredentialId: cashConfirmations.actorCredentialId,
        actorPlatformUserId: cashConfirmations.actorPlatformUserId,
        onBehalfOfKind: cashConfirmations.onBehalfOfKind,
        onBehalfOfPersonId: cashConfirmations.onBehalfOfPersonId,
      })
      .from(cashConfirmations)
      .where(and(eq(cashConfirmations.businessId, businessId), eq(cashConfirmations.entryId, entry.id)))
      .orderBy(asc(cashConfirmations.entryVersion))
      .all();

    const snapshots = revisionRows.map((row) => parseSnapshot(row.snapshotJson));
    const rawActors: RawActor[] = [...revisionRows, ...confirmationRows];

    // Ad/kimlik çözümü aktiflik süzgeci OLMADAN ve (business_id, id) ile.
    const personIds = distinct([
      ...snapshots.map((s) => text(s.personId)),
      ...rawActors.map((a) => a.onBehalfOfPersonId),
    ]);
    const personNames = new Map<string, string>(
      personIds.length === 0
        ? []
        : db
            .select({ id: people.id, fullName: people.fullName })
            .from(people)
            .where(and(eq(people.businessId, businessId), inArray(people.id, personIds)))
            .all()
            .map((p) => [p.id, p.fullName]),
    );
    const platformIds = distinct(rawActors.map((a) => a.actorPlatformUserId));
    const platformById = new Map(
      platformIds.length === 0
        ? []
        : db
            .select({ id: platformUsers.id, username: platformUsers.username, fullName: platformUsers.fullName })
            .from(platformUsers)
            .where(inArray(platformUsers.id, platformIds))
            .all()
            .map((u) => [u.id, u] as const),
    );
    const credentialIds = distinct(rawActors.map((a) => a.actorCredentialId));
    const plateByCredential = new Map(
      credentialIds.length === 0
        ? []
        : db
            .select({ id: vehicleCredentials.id, plate: vehicles.plateNormalized })
            .from(vehicleCredentials)
            .innerJoin(
              vehicles,
              and(eq(vehicles.businessId, vehicleCredentials.businessId), eq(vehicles.id, vehicleCredentials.vehicleId)),
            )
            .where(and(eq(vehicleCredentials.businessId, businessId), inArray(vehicleCredentials.id, credentialIds)))
            .all()
            .map((c) => [c.id, c.plate] as const),
    );

    const resolveActor = (raw: RawActor): WorkEntryHistoryActor => {
      if (raw.actorKind === "platform_user") {
        const user = raw.actorPlatformUserId ? platformById.get(raw.actorPlatformUserId) : undefined;
        const behalfName = raw.onBehalfOfPersonId ? personNames.get(raw.onBehalfOfPersonId) : undefined;
        return {
          kind: "platform_user",
          username: user?.username ?? "",
          fullName: user?.fullName ?? null,
          role: raw.actorRole as "support" | "admin",
          onBehalfOf: raw.onBehalfOfKind && behalfName ? { kind: raw.onBehalfOfKind, fullName: behalfName } : null,
        };
      }
      return {
        kind: "vehicle_credential",
        access: raw.actorRole as "owner" | "driver",
        plateNormalized: raw.actorCredentialId ? (plateByCredential.get(raw.actorCredentialId) ?? null) : null,
      };
    };

    const revisions: WorkEntryHistoryRevision[] = [];
    revisionRows.forEach((row, index) => {
      const values = projectValues(snapshots[index]!, personNames);
      const previous = revisions[index - 1];
      revisions.push({
        version: row.version,
        action: row.action as WorkEntryHistoryAction,
        createdAt: row.createdAt,
        actor: resolveActor(row),
        values,
        changes: previous ? diffWorkEntryRevision(previous.values, values) : [],
      });
    });

    return {
      entry: { id: entry.id, version: entry.version, status: entry.status, workKind: entry.workKind },
      revisions,
      confirmations: confirmationRows.map((row) => ({
        entryVersion: row.entryVersion,
        receivedCents: String(row.receivedCents),
        confirmedAt: row.confirmedAt,
        actor: resolveActor(row),
        current: row.entryVersion === entry.version,
      })),
    };
  })();
}
