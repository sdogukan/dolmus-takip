/**
 * Kişi dönem raporu (S5.x). Gruplama ve anahtar `work_entries.person_id`'dir;
 * `full_name` yalnız görüntü değeridir (yeniden adlandırma tek satır kalır, aynı
 * ad iki kişiyi birleştirmez). Yalnız GÜNCEL `work_entries` okunur; kişi/atama
 * pasifliği süzgeç DEĞİLDİR (geçmiş pasifleşmeden sonra da görünür). Kapsam
 * yalnız `entryScopeWhere`'den; dönem `work_date >= start AND work_date < next`.
 */
import { and, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";
import type { ReportPeriod } from "../../../lib/report-period";
import type { Scope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { people, workEntries } from "../../data/schema";
import { encodeCursor, requireCursor } from "../list-cursor";
import { entryScopeWhere, requireEntryVehicleScope } from "../work-entries/queries";
import { sumText } from "./sums";

/** Kuruş toplamları ondalık tam sayı METNİDİR; sayaçlar JSON sayısıdır. */
export interface PersonPeriodTotals {
  personId: string;
  fullName: string;
  isOwner: boolean;
  entryCount: number;
  workDays: number;
  durationMinutes: number;
  grossCents: string;
  fuelCents: string;
  otherExpenseCents: string;
  shareCents: string;
  remainderCents: string;
}

export interface PeoplePeriodReport {
  period: ReportPeriod;
  people: PersonPeriodTotals[];
}

export interface PersonPeriodEntry {
  id: string;
  workDate: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  grossCents: string;
  shareCents: string;
  remainderCents: string;
  status: "pending" | "confirmed" | "not_required";
}

export interface PersonPeriodReport {
  period: ReportPeriod;
  person: PersonPeriodTotals;
  entries: PersonPeriodEntry[];
  nextCursor: string | null;
}

export const periodWhere = (scope: Scope, period: ReportPeriod): SQL | undefined =>
  and(
    entryScopeWhere(scope),
    gte(workEntries.workDate, period.startDate),
    lt(workEntries.workDate, period.nextStartDate),
  );

export function selectPersonTotals(db: AppDatabase, where: SQL | undefined) {
  return db
    .select({
      personId: workEntries.personId,
      fullName: people.fullName,
      isOwner: sql<number>`MAX(CASE WHEN ${workEntries.workKind} = 'owner' THEN 1 ELSE 0 END)`,
      entryCount: sql<number>`COUNT(*)`,
      workDays: sql<number>`COUNT(DISTINCT ${workEntries.workDate})`,
      durationMinutes: sql<number>`COALESCE(SUM(${workEntries.durationMinutes}), 0)`,
      grossCents: sumText(workEntries.grossCents),
      fuelCents: sumText(workEntries.fuelCents),
      otherExpenseCents: sumText(workEntries.otherExpenseCents),
      shareCents: sumText(workEntries.shareCents),
      remainderCents: sumText(workEntries.remainderCents),
    })
    .from(workEntries)
    .innerJoin(
      people,
      and(eq(people.businessId, workEntries.businessId), eq(people.id, workEntries.personId)),
    )
    .where(where)
    .groupBy(workEntries.personId);
}

type TotalsRow = ReturnType<typeof selectPersonTotals> extends { all(): (infer R)[] } ? R : never;

const toTotals = (row: TotalsRow): PersonPeriodTotals => ({ ...row, isOwner: row.isOwner === 1 });

/** Kişi listesi sorgusu (çalıştırılmaz): sıralı kişi başına toplamlar. */
export function selectPeoplePeriodTotals(db: AppDatabase, scope: Scope, period: ReportPeriod) {
  return selectPersonTotals(db, periodWhere(scope, period)).orderBy(people.fullName, workEntries.personId);
}

export function readPeoplePeriodReportForScope(
  db: AppDatabase,
  scope: Scope,
  period: ReportPeriod,
): PeoplePeriodReport {
  requireEntryVehicleScope(scope);
  const rows = selectPeoplePeriodTotals(db, scope, period).all();
  return { period, people: rows.map(toTotals) };
}

/** Kişi detayının kayıt sayfası sorgusu (çalıştırılmaz); en yeni gün önce, `limit + 1` satır. */
export function selectPersonEntryPage(db: AppDatabase, where: SQL | undefined, limit: number) {
  return db
    .select({
      id: workEntries.id,
      workDate: workEntries.workDate,
      startsAt: workEntries.startsAt,
      endsAt: workEntries.endsAt,
      durationMinutes: workEntries.durationMinutes,
      grossCents: workEntries.grossCents,
      shareCents: workEntries.shareCents,
      remainderCents: workEntries.remainderCents,
      status: workEntries.status,
    })
    .from(workEntries)
    .where(where)
    .orderBy(desc(workEntries.workDate), desc(workEntries.id))
    .limit(limit + 1);
}

export const personPeriodWhere = (scope: Scope, period: ReportPeriod, personId: string): SQL | undefined =>
  and(periodWhere(scope, period), eq(workEntries.personId, personId));

export function personPageConditions(scope: Scope, period: ReportPeriod, personId: string, cursor?: string): (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [personPeriodWhere(scope, period, personId)];
  if (cursor !== undefined) {
    const [workDate, id] = requireCursor(cursor, 2) as [string, string];
    conditions.push(
      or(lt(workEntries.workDate, workDate), and(eq(workEntries.workDate, workDate), lt(workEntries.id, id))),
    );
  }
  return conditions;
}

export interface PersonPeriodOptions {
  cursor?: string;
  limit: number;
}

/**
 * Kişinin dönem toplamları + en yeni gün önce keyset sayfalı kayıtları; ikisi
 * TEK okuma işleminde (araya giren bir düzeltme toplam ile listeyi ayrıştırmaz).
 * Kapsamda/dönemde kaydı olmayan kimlik (bilinmeyen, başka işletme/araç) `undefined`.
 */
export function readPersonPeriodReportForScope(
  db: AppDatabase,
  scope: Scope,
  period: ReportPeriod,
  personId: string,
  options: PersonPeriodOptions,
): PersonPeriodReport | undefined {
  requireEntryVehicleScope(scope);
  const personWhere = personPeriodWhere(scope, period, personId);
  const pageConditions = personPageConditions(scope, period, personId, options.cursor);

  return db.$client.transaction((): PersonPeriodReport | undefined => {
    const totals = selectPersonTotals(db, personWhere).get();
    if (!totals) return undefined;
    const rows = selectPersonEntryPage(db, and(...pageConditions), options.limit).all();
    const page = rows.slice(0, options.limit);
    const last = page[page.length - 1];
    return {
      period,
      person: toTotals(totals),
      entries: page.map((row) => ({
        ...row,
        grossCents: String(row.grossCents),
        shareCents: String(row.shareCents),
        remainderCents: String(row.remainderCents),
      })),
      nextCursor: rows.length > options.limit && last ? encodeCursor([last.workDate, last.id]) : null,
    };
  })();
}
