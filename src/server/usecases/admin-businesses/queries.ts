/**
 * İşletme okuma sorguları (liste + detay) — T2.1.
 *
 * ARCHITECTURE §4 sözleşmesi:
 * - "GET /admin/businesses: businesses [ { id, name, active, owner veya
 *   null, vehicleCount } ] — arama/sayfalama YOK (T2.5 yerini alır)."
 * - "GET /admin/businesses/[businessId]: business + owner (veya null) +
 *   sahipsizse seçilebilir aynı işletme kişileri [ { id, fullName, active }
 *   ] + etkilenen araçlar [ { id, plateNormalized, active } ]."
 *
 * `listBusinesses` HER işletme için AYRI bir owner/vehicleCount sorgusu
 * ÇALIŞTIRMAZ (N+1) — üç tablo TEK'er sorguyla okunup bellekte
 * eşleştirilir (Micro 3.15 — veri akışı verimliliği).
 */
import { and, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "../../data/db";
import { businessOwners, businesses, people, vehicles } from "../../data/schema";

export interface BusinessListItem {
  id: string;
  name: string;
  active: boolean;
  owner: { personId: string; fullName: string } | null;
  vehicleCount: number;
}

export function listBusinesses(db: AppDatabase): BusinessListItem[] {
  const businessRows = db
    .select({
      id: businesses.id,
      name: businesses.name,
      active: businesses.active,
    })
    .from(businesses)
    .all();

  const ownerRows = db
    .select({
      businessId: businessOwners.businessId,
      personId: people.id,
      fullName: people.fullName,
    })
    .from(businessOwners)
    .innerJoin(
      people,
      and(eq(people.businessId, businessOwners.businessId), eq(people.id, businessOwners.personId)),
    )
    .all();
  const ownerByBusinessId = new Map(
    ownerRows.map((row) => [row.businessId, { personId: row.personId, fullName: row.fullName }]),
  );

  const vehicleCountRows = db
    .select({ businessId: vehicles.businessId, count: sql<number>`count(*)` })
    .from(vehicles)
    .groupBy(vehicles.businessId)
    .all();
  const vehicleCountByBusinessId = new Map(
    vehicleCountRows.map((row) => [row.businessId, row.count]),
  );

  return businessRows.map((row) => ({
    id: row.id,
    name: row.name,
    active: row.active,
    owner: ownerByBusinessId.get(row.id) ?? null,
    vehicleCount: vehicleCountByBusinessId.get(row.id) ?? 0,
  }));
}

export interface BusinessDetail {
  business: { id: string; name: string; active: boolean; version: number; createdAt: string };
  owner: { personId: string; fullName: string; active: boolean; version: number } | null;
  /** Yalnız `owner === null` iken dolu — "sahipsizse seçilebilir aynı
   * işletme kişileri" (ARCH §4). Sahip varsa boş dizi döner. */
  eligiblePeople: { id: string; fullName: string; active: boolean }[];
  vehicles: { id: string; plateNormalized: string; active: boolean }[];
}

export class BusinessNotFoundError extends Error {
  constructor(businessId: string) {
    super(`İşletme bulunamadı: "${businessId}".`);
    this.name = "BusinessNotFoundError";
  }
}

export function getBusinessDetail(db: AppDatabase, businessId: string): BusinessDetail {
  const business = db
    .select({
      id: businesses.id,
      name: businesses.name,
      active: businesses.active,
      version: businesses.version,
      createdAt: businesses.createdAt,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .get();
  if (!business) {
    throw new BusinessNotFoundError(businessId);
  }

  const ownerRow = db
    .select({
      personId: people.id,
      fullName: people.fullName,
      active: people.active,
      version: people.version,
    })
    .from(businessOwners)
    .innerJoin(
      people,
      and(eq(people.businessId, businessOwners.businessId), eq(people.id, businessOwners.personId)),
    )
    .where(eq(businessOwners.businessId, businessId))
    .get();
  const owner = ownerRow ?? null;

  const eligiblePeople = owner
    ? []
    : db
        .select({ id: people.id, fullName: people.fullName, active: people.active })
        .from(people)
        .where(and(eq(people.businessId, businessId), eq(people.active, true)))
        .all();

  const vehicleRows = db
    .select({
      id: vehicles.id,
      plateNormalized: vehicles.plateNormalized,
      active: vehicles.active,
    })
    .from(vehicles)
    .where(eq(vehicles.businessId, businessId))
    .all();

  return { business, owner, eligiblePeople, vehicles: vehicleRows };
}
