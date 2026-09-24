/**
 * Sahip özeti: araç başlığı (görüntü plakası + sahip adı) ve dönem toplamları.
 * Başlık ile toplamlar TEK okuma işleminde; toplamlar `readVehiclePeriodReportForScope`
 * ile birebir aynı kaynaktan gelir (SUM SQL'i burada tekrarlanmaz). Araç yalnız
 * kapsamdan (işletme + araç) seçilir.
 */
import { and, eq } from "drizzle-orm";
import { formatPlateForDisplay } from "../../../lib/plate";
import type { ReportPeriod } from "../../../lib/report-period";
import type { Scope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { people, vehicles } from "../../data/schema";
import { requireEntryVehicleScope } from "../work-entries/queries";
import { readVehiclePeriodReportForScope, type VehiclePeriodReport } from "./vehicle-period";

export interface OwnerSummary extends VehiclePeriodReport {
  vehicle: { plate: string };
  owner: { fullName: string };
}

export function readOwnerSummaryForScope(db: AppDatabase, scope: Scope, period: ReportPeriod): OwnerSummary {
  requireEntryVehicleScope(scope);
  const vehicleId = scope.vehicleId as string;
  return db.$client.transaction((): OwnerSummary => {
    const header = db
      .select({ plateNormalized: vehicles.plateNormalized, ownerFullName: people.fullName })
      .from(vehicles)
      .innerJoin(people, and(eq(people.businessId, vehicles.businessId), eq(people.id, vehicles.ownerPersonId)))
      .where(and(eq(vehicles.businessId, scope.businessId), eq(vehicles.id, vehicleId)))
      .get();
    if (!header) throw new Error("reports: kapsamdaki araç veya sahibi bulunamadı (programlama hatası).");
    const report = readVehiclePeriodReportForScope(db, scope, period);
    return {
      ...report,
      vehicle: { plate: formatPlateForDisplay(header.plateNormalized) },
      owner: { fullName: header.ownerFullName },
    };
  })();
}
