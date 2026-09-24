/**
 * Şoför sorguları — T2.4. Her okuma `scoped.ts` süzgeçlerinden geçer
 * (işletme + araç); URL'den gelen bir `personId` tek başına ERİŞİM VERMEZ.
 *
 * "Seçilebilir şoför" kuralı TEK YERDE yaşar: `selectableDriverWhere`
 * (`listSelectableDrivers` ve `findSelectableDriver` paylaşır) —
 * araçta AKTİF atama + AKTİF kişi, araç/işletme sahibi HARİÇ.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Scope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { scopedPeopleFilter, scopedVehicleDriversFilter } from "../../data/scoped";
import { businessOwners, people, vehicleDrivers, vehicles } from "../../data/schema";

export interface SelectableDriver {
  personId: string;
  fullName: string;
}

export interface DriverAssignmentState {
  active: boolean;
  version: number;
}

/** Yönetim (`driver.manage`) görünümündeki bir şoför satırı. `assignment`,
 * kapsamdaki araca ait atama satırıdır; yoksa `null`. */
export interface ManagedDriver {
  personId: string;
  fullName: string;
  personActive: boolean;
  personVersion: number;
  /** Ad KVKK talebiyle anonimleştirildi — yeniden adlandırılamaz. */
  anonymized: boolean;
  assignment: DriverAssignmentState | null;
}

export interface DriverCandidate {
  personId: string;
  fullName: string;
}

export interface VehicleDriversManagementView {
  drivers: ManagedDriver[];
  /** Aynı işletmede, bu araca HENÜZ atanmamış aktif kişiler (mükerrer kişi
   * açmak yerine yeniden kullanım — DESIGN "Şoförlerim — notes"). */
  candidates: DriverCandidate[];
}

export interface AffectedVehicle {
  vehicleId: string;
  plateNormalized: string;
  assignmentActive: boolean;
}

/** İşletme sahibi VEYA herhangi bir aracın sahibi olan kişi — şoför OLMAZ. */
export const NOT_OWNER_PERSON = sql`NOT EXISTS (SELECT 1 FROM ${businessOwners} WHERE ${businessOwners.businessId} = ${people.businessId} AND ${businessOwners.personId} = ${people.id})
  AND NOT EXISTS (SELECT 1 FROM ${vehicles} WHERE ${vehicles.businessId} = ${people.businessId} AND ${vehicles.ownerPersonId} = ${people.id})`;

export function isOwnerPerson(db: AppDatabase, businessId: string, personId: string): boolean {
  const asBusinessOwner = db
    .select({ personId: businessOwners.personId })
    .from(businessOwners)
    .where(and(eq(businessOwners.businessId, businessId), eq(businessOwners.personId, personId)))
    .get();
  if (asBusinessOwner) return true;
  const asVehicleOwner = db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.businessId, businessId), eq(vehicles.ownerPersonId, personId)))
    .get();
  return asVehicleOwner !== undefined;
}

function requireVehicleId(scope: Scope): string {
  if (!scope.vehicleId) {
    throw new Error("drivers: scope.vehicleId eksik (programlama hatası — hedef 'vehicle' olmalı).");
  }
  return scope.vehicleId;
}

/** "Seçilebilir şoför" koşulu — liste ve tekil doğrulama AYNI kuralı paylaşır. */
function selectableDriverWhere(scope: Scope) {
  return and(
    scopedVehicleDriversFilter(scope),
    eq(vehicleDrivers.active, true),
    eq(people.active, true),
    NOT_OWNER_PERSON,
  );
}

/** `selectableDriverWhere` ile AYNI kural, bir kaydın kişisi için: kaydın araç/kişi
 * sütunlarına bağlı aktif atama + (sorguda birleştirilmiş) aktif, sahip olmayan
 * `people` satırı. K1 — şoför oturumunun görebileceği kayıtlar. */
export function entryPersonSelectableWhere(entry: {
  businessId: SQLiteColumn;
  vehicleId: SQLiteColumn;
  personId: SQLiteColumn;
}) {
  return and(
    sql`EXISTS (SELECT 1 FROM ${vehicleDrivers} WHERE ${vehicleDrivers.businessId} = ${entry.businessId} AND ${vehicleDrivers.vehicleId} = ${entry.vehicleId} AND ${vehicleDrivers.personId} = ${entry.personId} AND ${vehicleDrivers.active} = 1)`,
    eq(people.active, true),
    NOT_OWNER_PERSON,
  );
}

/** Araçta işe girebilecek şoförler: aktif atama + aktif kişi, sahip hariç. */
export function listSelectableDrivers(db: AppDatabase, scope: Scope): SelectableDriver[] {
  requireVehicleId(scope);
  return db
    .select({ personId: people.id, fullName: people.fullName })
    .from(vehicleDrivers)
    .innerJoin(
      people,
      and(eq(people.businessId, vehicleDrivers.businessId), eq(people.id, vehicleDrivers.personId)),
    )
    .where(selectableDriverWhere(scope))
    .orderBy(asc(people.fullName), asc(people.id))
    .all();
}

/** `listSelectableDrivers` kuralıyla TEK kişi; seçilebilir değilse `undefined`
 * (yok, başka işletme, pasif, atama pasif veya sahip kişi — ayırt edilmez). */
export function findSelectableDriver(
  db: AppDatabase,
  scope: Scope,
  personId: string,
): SelectableDriver | undefined {
  requireVehicleId(scope);
  return db
    .select({ personId: people.id, fullName: people.fullName })
    .from(vehicleDrivers)
    .innerJoin(
      people,
      and(eq(people.businessId, vehicleDrivers.businessId), eq(people.id, vehicleDrivers.personId)),
    )
    .where(and(selectableDriverWhere(scope), eq(people.id, personId)))
    .get();
}

/** Yönetim listesi: aktif/pasif tüm atamalar + atanabilir aday kişiler. */
export function listVehicleDriversForManagement(
  db: AppDatabase,
  scope: Scope,
): VehicleDriversManagementView {
  requireVehicleId(scope);
  const rows = db
    .select({
      personId: people.id,
      fullName: people.fullName,
      personActive: people.active,
      personVersion: people.version,
      anonymizedAt: people.anonymizedAt,
      assignmentActive: vehicleDrivers.active,
      assignmentVersion: vehicleDrivers.version,
    })
    .from(vehicleDrivers)
    .innerJoin(
      people,
      and(eq(people.businessId, vehicleDrivers.businessId), eq(people.id, vehicleDrivers.personId)),
    )
    .where(and(scopedVehicleDriversFilter(scope), NOT_OWNER_PERSON))
    .orderBy(asc(people.fullName), asc(people.id))
    .all();

  const candidates = db
    .select({ personId: people.id, fullName: people.fullName })
    .from(people)
    .where(
      and(
        scopedPeopleFilter(scope),
        eq(people.active, true),
        NOT_OWNER_PERSON,
        sql`NOT EXISTS (SELECT 1 FROM ${vehicleDrivers} WHERE ${vehicleDrivers.businessId} = ${people.businessId} AND ${vehicleDrivers.vehicleId} = ${scope.vehicleId} AND ${vehicleDrivers.personId} = ${people.id})`,
      ),
    )
    .orderBy(asc(people.fullName), asc(people.id))
    .all();

  return {
    drivers: rows.map((row) => ({
      personId: row.personId,
      fullName: row.fullName,
      personActive: row.personActive,
      personVersion: row.personVersion,
      anonymized: row.anonymizedAt !== null,
      assignment: { active: row.assignmentActive, version: row.assignmentVersion },
    })),
    candidates,
  };
}

/** Tek kişi + kapsamdaki araçtaki ataması. Kişi işletmede yoksa veya sahip
 * kişiyse `undefined`. */
export function getManagedDriver(
  db: AppDatabase,
  scope: Scope,
  personId: string,
): ManagedDriver | undefined {
  requireVehicleId(scope);
  const person = db
    .select({
      personId: people.id,
      fullName: people.fullName,
      personActive: people.active,
      personVersion: people.version,
      anonymizedAt: people.anonymizedAt,
    })
    .from(people)
    .where(and(scopedPeopleFilter(scope), eq(people.id, personId), NOT_OWNER_PERSON))
    .get();
  if (!person) return undefined;
  const assignment = db
    .select({ active: vehicleDrivers.active, version: vehicleDrivers.version })
    .from(vehicleDrivers)
    .where(and(scopedVehicleDriversFilter(scope), eq(vehicleDrivers.personId, personId)))
    .get();
  const { anonymizedAt, ...rest } = person;
  return { ...rest, anonymized: anonymizedAt !== null, assignment: assignment ?? null };
}

/** Kişinin işletmedeki TÜM araç atamaları (küresel aktiflik değişiminin
 * etkilediği araçlar). */
export function listAffectedVehicles(
  db: AppDatabase,
  scope: Scope,
  personId: string,
): AffectedVehicle[] {
  return db
    .select({
      vehicleId: vehicles.id,
      plateNormalized: vehicles.plateNormalized,
      assignmentActive: vehicleDrivers.active,
    })
    .from(vehicleDrivers)
    .innerJoin(
      vehicles,
      and(eq(vehicles.businessId, vehicleDrivers.businessId), eq(vehicles.id, vehicleDrivers.vehicleId)),
    )
    .where(and(eq(vehicleDrivers.businessId, scope.businessId), eq(vehicleDrivers.personId, personId)))
    .orderBy(asc(vehicles.plateNormalized))
    .all();
}

/** `listAffectedVehicles`'in toplu biçimi (kişi başına ayrı sorgu YOK) —
 * ekip sayfası küresel pasifleştirme onayında etkilenen araçları gösterir. */
export function listAffectedVehiclesForPeople(
  db: AppDatabase,
  scope: Scope,
  personIds: string[],
): Record<string, AffectedVehicle[]> {
  const byPerson: Record<string, AffectedVehicle[]> = {};
  if (personIds.length === 0) return byPerson;
  const rows = db
    .select({
      personId: vehicleDrivers.personId,
      vehicleId: vehicles.id,
      plateNormalized: vehicles.plateNormalized,
      assignmentActive: vehicleDrivers.active,
    })
    .from(vehicleDrivers)
    .innerJoin(
      vehicles,
      and(eq(vehicles.businessId, vehicleDrivers.businessId), eq(vehicles.id, vehicleDrivers.vehicleId)),
    )
    .where(
      and(eq(vehicleDrivers.businessId, scope.businessId), inArray(vehicleDrivers.personId, personIds)),
    )
    .orderBy(asc(vehicles.plateNormalized))
    .all();
  for (const { personId, ...vehicle } of rows) {
    (byPerson[personId] ??= []).push(vehicle);
  }
  return byPerson;
}
