/**
 * İşletme okuma sorguları (liste + detay) — T2.1.
 *
 * ARCHITECTURE §4 sözleşmesi:
 * - "GET /admin/businesses: businesses [ { id, name, active, owner veya
 *   null, vehicleCount } ]" — arama/sayfalama `listBusinessesPage` ile
 *   (isteğe bağlı `q`/`active`/`cursor`/`limit`; `nextCursor` ekler).
 * - "GET /admin/businesses/[businessId]: business + owner (veya null) +
 *   sahipsizse seçilebilir aynı işletme kişileri [ { id, fullName, active }
 *   ] + etkilenen araçlar [ { id, plateNormalized, active } ]."
 *
 * `listBusinesses` HER işletme için AYRI bir owner/vehicleCount sorgusu
 * ÇALIŞTIRMAZ (N+1) — üç tablo TEK'er sorguyla okunup bellekte
 * eşleştirilir (Micro 3.15 — veri akışı verimliliği).
 */
import { and, asc, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { foldForSearch } from "../../../lib/search-fold";
import type { AppDatabase } from "../../data/db";
import { businessOwners, businesses, people, vehicles } from "../../data/schema";
import { encodeCursor, requireCursor, type ListPage, type ListPageOptions } from "../list-cursor";

export interface BusinessListItem {
  id: string;
  name: string;
  active: boolean;
  owner: { personId: string; fullName: string } | null;
  vehicleCount: number;
}

/**
 * Sıralama: `created_at DESC, id ASC` (yeni oluşturulan işletme ilk sırada).
 * `q` işletme adı veya sahip adında Türkçe duyarlı (`foldForSearch`) alt
 * dize eşleşmesidir; SQLite `LIKE` yalnız ASCII katladığından eşleştirme
 * uygulama katmanında yapılır (tablo küçüktür, indeks/migration YOK).
 * `active` ve imleç koşulları SQL'de uygulanır.
 */
export function listBusinessesPage(
  db: AppDatabase,
  options: ListPageOptions = {},
): ListPage<BusinessListItem> {
  const conditions: SQL[] = [];
  if (options.active === "active") conditions.push(eq(businesses.active, true));
  if (options.active === "inactive") conditions.push(eq(businesses.active, false));
  if (options.cursor !== undefined) {
    const [createdAt, id] = requireCursor(options.cursor, 2) as [string, string];
    conditions.push(
      or(
        sql`${businesses.createdAt} < ${createdAt}`,
        and(eq(businesses.createdAt, createdAt), sql`${businesses.id} > ${id}`),
      )!,
    );
  }

  const businessRows = db
    .select({
      id: businesses.id,
      name: businesses.name,
      active: businesses.active,
      createdAt: businesses.createdAt,
    })
    .from(businesses)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(businesses.createdAt), asc(businesses.id))
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

  const needle = options.q ? foldForSearch(options.q.trim()) : "";
  const matched = needle
    ? businessRows.filter(
        (row) =>
          foldForSearch(row.name).includes(needle) ||
          foldForSearch(ownerByBusinessId.get(row.id)?.fullName ?? "").includes(needle),
      )
    : businessRows;

  const pageRows = options.limit === undefined ? matched : matched.slice(0, options.limit);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    options.limit !== undefined && matched.length > options.limit && last
      ? encodeCursor([last.createdAt, last.id])
      : null;

  const vehicleCountRows = db
    .select({ businessId: vehicles.businessId, count: sql<number>`count(*)` })
    .from(vehicles)
    .groupBy(vehicles.businessId)
    .all();
  const vehicleCountByBusinessId = new Map(
    vehicleCountRows.map((row) => [row.businessId, row.count]),
  );

  return {
    items: pageRows.map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
      owner: ownerByBusinessId.get(row.id) ?? null,
      vehicleCount: vehicleCountByBusinessId.get(row.id) ?? 0,
    })),
    nextCursor,
  };
}

export function listBusinesses(db: AppDatabase): BusinessListItem[] {
  return listBusinessesPage(db).items;
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
