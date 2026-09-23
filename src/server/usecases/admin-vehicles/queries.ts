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
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../data/db";
import { businesses, people, vehicles } from "../../data/schema";

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
}

/** GET /admin/vehicles — "araçlar [...] pasif araçlar dahil" (T2.2
 * sözleşmesi); arama/sayfalama YOK (T2.1'in `listBusinesses`'iyle AYNI
 * kapsam kararı). */
export function listVehicles(db: AppDatabase): VehicleListItem[] {
  const rows = db
    .select({
      id: vehicles.id,
      businessId: vehicles.businessId,
      businessName: businesses.name,
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
    .all();

  return rows.map((row) => ({
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
  }));
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
