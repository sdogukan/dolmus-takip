/**
 * Araç dönem raporu (S5.x). Tek SELECT = tek anlık görüntü: toplamlar, sayaçlar
 * ve alınan toplam aynı ifadeden gelir. Kapsam (işletme + araç) yalnız
 * `entryScopeWhere`'den; dönem `work_date >= start AND work_date < next`
 * (K3: kayıt başlangıç günü, onay zamanı dönemi kaydırmaz).
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { ReportPeriod } from "../../../lib/report-period";
import type { Scope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { cashConfirmations, workEntries } from "../../data/schema";
import { entryScopeWhere, requireEntryVehicleScope } from "../work-entries/queries";
import { sumText } from "./sums";

/** Kuruş toplamları ondalık tam sayı METNİDİR (2^53 üstü kesin kalır). */
export interface VehiclePeriodReport {
  period: ReportPeriod;
  entryCount: number;
  workDays: number;
  durationMinutes: number;
  grossCents: string;
  fuelCents: string;
  otherExpenseCents: string;
  shareCents: string;
  remainderCents: string;
  confirmedReceivedCents: string;
}

export function readVehiclePeriodReportForScope(
  db: AppDatabase,
  scope: Scope,
  period: ReportPeriod,
): VehiclePeriodReport {
  requireEntryVehicleScope(scope);
  const row = db
    .select({
      entryCount: sql<number>`COUNT(*)`,
      workDays: sql<number>`COUNT(DISTINCT ${workEntries.workDate})`,
      durationMinutes: sql<number>`COALESCE(SUM(${workEntries.durationMinutes}), 0)`,
      grossCents: sumText(workEntries.grossCents),
      fuelCents: sumText(workEntries.fuelCents),
      otherExpenseCents: sumText(workEntries.otherExpenseCents),
      shareCents: sumText(workEntries.shareCents),
      remainderCents: sumText(workEntries.remainderCents),
      // Yalnız şoför kaydının GÜNCEL sürümündeki onay; sahip kaydı asla "alınan" değildir.
      confirmedReceivedCents: sql<string>`CAST(COALESCE(SUM(CASE WHEN ${workEntries.workKind} = 'driver' THEN ${cashConfirmations.receivedCents} END), 0) AS TEXT)`,
    })
    .from(workEntries)
    .leftJoin(
      cashConfirmations,
      and(
        eq(cashConfirmations.businessId, workEntries.businessId),
        eq(cashConfirmations.entryId, workEntries.id),
        eq(cashConfirmations.entryVersion, workEntries.version),
      ),
    )
    .where(
      and(
        entryScopeWhere(scope),
        gte(workEntries.workDate, period.startDate),
        lt(workEntries.workDate, period.nextStartDate),
      ),
    )
    .get();
  if (!row) throw new Error("reports: toplam satırı dönmedi (programlama hatası).");
  return { period, ...row };
}
