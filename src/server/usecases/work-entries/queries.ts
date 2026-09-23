/**
 * Günlük kayıt okumaları (T3.3). Her okuma kapsam süzgecinden geçer.
 */
import { and, eq } from "drizzle-orm";
import type { Scope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { scopedVehiclesFilter } from "../../data/scoped";
import { people, vehicles } from "../../data/schema";

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
