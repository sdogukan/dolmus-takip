/**
 * Dönem raporu aralığı (S5.x): hafta/ay/yıl + bir takvim günü → yarı açık
 * `[startDate, nextStartDate)` aralığı. Hafta Pazartesi başlar. Yalnız takvim
 * aritmetiği (UTC `YYYY-MM-DD`); sunucunun yerel saat dilimi hesaba girmez.
 */
import { addDays } from "./work-time";

export const REPORT_PERIOD_KINDS = ["week", "month", "year"] as const;
export type ReportPeriodKind = (typeof REPORT_PERIOD_KINDS)[number];

export interface ReportPeriod {
  kind: ReportPeriodKind;
  /** Dönemin ilk günü (dahil). */
  startDate: string;
  /** Sonraki dönemin ilk günü (hariç). */
  nextStartDate: string;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MIN_YEAR = 2000;

const pad = (value: number, length = 2): string => String(value).padStart(length, "0");

/** Geçerli takvim günü değilse `null` (work-time ile aynı alt yıl sınırı). */
function parseCalendarDate(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function isValidReportDate(value: string): boolean {
  return parseCalendarDate(value) !== null;
}

/** Geçersiz `date` için `null` döner. */
export function resolveReportPeriod(kind: ReportPeriodKind, date: string): ReportPeriod | null {
  const parsed = parseCalendarDate(date);
  if (!parsed) return null;
  const { year, month, day } = parsed;

  if (kind === "week") {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Pazar
    const startDate = addDays(date, -((weekday + 6) % 7));
    return { kind, startDate, nextStartDate: addDays(startDate, 7) };
  }
  if (kind === "month") {
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return {
      kind,
      startDate: `${pad(year, 4)}-${pad(month)}-01`,
      nextStartDate: `${pad(nextYear, 4)}-${pad(nextMonth)}-01`,
    };
  }
  return { kind, startDate: `${pad(year, 4)}-01-01`, nextStartDate: `${pad(year + 1, 4)}-01-01` };
}
