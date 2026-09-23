/**
 * Araç okuma sorguları (liste + detay) — T2.2.
 *
 * `listVehicles` HER araç için AYRI bir işletme/sahip sorgusu ÇALIŞTIRMAZ
 * (N+1 — Micro 3.15 veri akışı verimliliği) — tek bir JOIN sorgusuyla
 * okunur; `vehicles.owner_person_id` `NOT NULL` olduğundan (şema — her
 * aracın oluşturma anında bir sahibi VARDIR) `../admin-businesses/
 * queries.ts` `listBusinesses`'in AKSİNE sahip için ayrı bir LEFT JOIN/Map
 * GEREKMEZ, tek bir INNER JOIN yeterlidir.
 */
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { foldForSearch } from "../../../lib/search-fold";
import { normalizePlate } from "../../../lib/plate";
import type { AppDatabase } from "../../data/db";
import { businesses, people, vehicles } from "../../data/schema";
import { encodeCursor, requireCursor, type ListPage, type ListPageOptions } from "../list-cursor";

export interface VehicleListItem {
  id: string;
  businessId: string;
  businessName: string;
  plateNormalized: string;
  brandModel: string | null;
  year: number | null;
  routeStop: string | null;
  note: string | null;
  active: boolean;
  version: number;
  owner: { personId: string; fullName: string };
  business: { id: string; name: string; active: boolean };
}

/** GET /admin/vehicles — "araçlar [...] pasif araçlar dahil" (T2.2
 * sözleşmesi). Sıralama: `plate_normalized ASC` (benzersiz → imleç tek
 * bileşen). `q` plaka (boşluk/harf biçiminden bağımsız — `normalizePlate`),
 * işletme adı veya sahip adı üzerinde Türkçe duyarlı alt dize eşleşmesidir;
 * SQLite `LIKE` yalnız ASCII katladığından eşleştirme uygulama katmanında
 * yapılır (tablo küçüktür, indeks/migration YOK). `active`/imleç SQL'dedir. */
export function listVehiclesPage(
  db: AppDatabase,
  options: ListPageOptions = {},
): ListPage<VehicleListItem> {
  const conditions: SQL[] = [];
  if (options.active === "active") conditions.push(eq(vehicles.active, true));
  if (options.active === "inactive") conditions.push(eq(vehicles.active, false));
  if (options.cursor !== undefined) {
    const [plate] = requireCursor(options.cursor, 1) as [string];
    conditions.push(sql`${vehicles.plateNormalized} > ${plate}`);
  }

  const rows = db
    .select({
      id: vehicles.id,
      businessId: vehicles.businessId,
      businessName: businesses.name,
      businessActive: businesses.active,
      plateNormalized: vehicles.plateNormalized,
      brandModel: vehicles.brandModel,
      year: vehicles.year,
      routeStop: vehicles.routeStop,
      note: vehicles.note,
      active: vehicles.active,
      version: vehicles.version,
      ownerPersonId: people.id,
      ownerFullName: people.fullName,
    })
    .from(vehicles)
    .innerJoin(businesses, eq(vehicles.businessId, businesses.id))
    .innerJoin(
      people,
      and(eq(people.businessId, vehicles.businessId), eq(people.id, vehicles.ownerPersonId)),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(vehicles.plateNormalized))
    .all();

  const needle = options.q ? foldForSearch(options.q.trim()) : "";
  const plateNeedle = options.q ? normalizePlate(options.q) : "";
  const matched = needle
    ? rows.filter(
        (row) =>
          (plateNeedle !== "" && row.plateNormalized.includes(plateNeedle)) ||
          foldForSearch(row.businessName).includes(needle) ||
          foldForSearch(row.ownerFullName).includes(needle),
      )
    : rows;

  const pageRows = options.limit === undefined ? matched : matched.slice(0, options.limit);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    options.limit !== undefined && matched.length > options.limit && last
      ? encodeCursor([last.plateNormalized])
      : null;

  return {
    items: pageRows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      businessName: row.businessName,
      plateNormalized: row.plateNormalized,
      brandModel: row.brandModel,
      year: row.year,
      routeStop: row.routeStop,
      note: row.note,
      active: row.active,
      version: row.version,
      owner: { personId: row.ownerPersonId, fullName: row.ownerFullName },
      business: { id: row.businessId, name: row.businessName, active: row.businessActive },
    })),
    nextCursor,
  };
}

export function listVehicles(db: AppDatabase): VehicleListItem[] {
  return listVehiclesPage(db).items;
}

export interface VehicleDetail {
  vehicle: {
    id: string;
    plateNormalized: string;
    brandModel: string | null;
    year: number | null;
    routeStop: string | null;
    note: string | null;
    active: boolean;
    version: number;
  };
  business: { id: string; name: string; active: boolean };
  owner: { personId: string; fullName: string };
}

export class VehicleNotFoundError extends Error {
  constructor(vehicleId: string) {
    super(`Araç bulunamadı: "${vehicleId}".`);
    this.name = "VehicleNotFoundError";
  }
}

/** GET /admin/vehicles/[vehicleId] ve POST/PATCH yanıt gövdesi — T2.2
 * sözleşmesi: `{ vehicle: {...}, business: {...}, owner: {...} }`. */
export function getVehicleDetail(db: AppDatabase, vehicleId: string): VehicleDetail {
  const row = db
    .select({
      id: vehicles.id,
      plateNormalized: vehicles.plateNormalized,
      brandModel: vehicles.brandModel,
      year: vehicles.year,
      routeStop: vehicles.routeStop,
      note: vehicles.note,
      active: vehicles.active,
      version: vehicles.version,
      businessId: businesses.id,
      businessName: businesses.name,
      businessActive: businesses.active,
      ownerPersonId: people.id,
      ownerFullName: people.fullName,
    })
    .from(vehicles)
    .innerJoin(businesses, eq(vehicles.businessId, businesses.id))
    .innerJoin(
      people,
      and(eq(people.businessId, vehicles.businessId), eq(people.id, vehicles.ownerPersonId)),
    )
    .where(eq(vehicles.id, vehicleId))
    .get();
  if (!row) {
    throw new VehicleNotFoundError(vehicleId);
  }

  return {
    vehicle: {
      id: row.id,
      plateNormalized: row.plateNormalized,
      brandModel: row.brandModel,
      year: row.year,
      routeStop: row.routeStop,
      note: row.note,
      active: row.active,
      version: row.version,
    },
    business: { id: row.businessId, name: row.businessName, active: row.businessActive },
    owner: { personId: row.ownerPersonId, fullName: row.ownerFullName },
  };
}
