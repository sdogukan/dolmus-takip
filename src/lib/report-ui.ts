/**
 * Sahip raporları ekranının (`../app/_components/vehicle-period-report.tsx`)
 * SAF yardımcıları — DB/ağ/React YOK. Tipler `readVehiclePeriodReportForScope`
 * çıktısının (`../server/usecases/reports/vehicle-period.ts`) istemci-güvenli
 * aynasıdır. Dönem sınırları SUNUCUDAN gelir: aralık metni ve önceki/sonraki
 * çapaları yalnız `startDate`/`nextStartDate`'ten türetilir, istemci dönem
 * hesabı yapmaz. Kuruş toplamları üst sınırsız BigInt'tir; `Number()` YOK.
 */
import { REPORT_MESSAGES as TEXT } from "./messages";
import { formatTlAmount, parseApiTotalCents } from "./money";
import { REPORT_PERIOD_KINDS, isValidReportDate, type ReportPeriod, type ReportPeriodKind } from "./report-period";
import { addDays, formatDuration } from "./work-time";

export interface VehiclePeriodReportData {
  period: ReportPeriod;
  entryCount: number;
  workDays: number;
  durationMinutes: number;
  grossCents: bigint;
  fuelCents: bigint;
  otherExpenseCents: bigint;
  shareCents: bigint;
  remainderCents: bigint;
  confirmedReceivedCents: bigint;
}

export interface VehiclePeriodReportView {
  rangeText: string;
  isEmpty: boolean;
  /** Önceki dönemin herhangi bir günü (başlangıcın önceki günü). */
  previousDate: string;
  /** Sonraki dönemin ilk günü. */
  nextDate: string;
  remainder: string;
  received: string;
  breakdown: { label: string; value: string }[];
}

const MONTH_NAMES = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
] as const;

function splitDate(date: string): { year: number; month: number; day: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) };
}

/**
 * `[startDate, nextStartDate)` → insan metni; son gün `nextStartDate − 1`:
 * "1–30 Eylül 2026", "28 Eylül – 4 Ekim 2026", "1 Ocak – 31 Aralık 2026",
 * "29 Aralık 2025 – 4 Ocak 2026".
 */
export function formatReportPeriodRange(period: Pick<ReportPeriod, "startDate" | "nextStartDate">): string {
  const start = splitDate(period.startDate);
  const end = splitDate(addDays(period.nextStartDate, -1));
  const startMonth = MONTH_NAMES[start.month - 1]!;
  const endMonth = MONTH_NAMES[end.month - 1]!;
  if (start.year === end.year && start.month === end.month) {
    return start.day === end.day
      ? `${start.day} ${startMonth} ${start.year}`
      : `${start.day}–${end.day} ${startMonth} ${start.year}`;
  }
  if (start.year === end.year) return `${start.day} ${startMonth} – ${end.day} ${endMonth} ${end.year}`;
  return `${start.day} ${startMonth} ${start.year} – ${end.day} ${endMonth} ${end.year}`;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * `GET /api/v1/reports/vehicles` gövdesi → veri; biçim bozuksa `null` (ekran
 * bunu "rapor yüklenemedi" sayar, kısmi veri göstermez). Yalnız `remainderCents`
 * eksi olabilir.
 */
export function parseVehiclePeriodReport(body: unknown): VehiclePeriodReportData | null {
  const report = (body as { report?: unknown } | null)?.report as Record<string, unknown> | null | undefined;
  if (typeof report !== "object" || report === null) return null;
  const period = report.period as Record<string, unknown> | null | undefined;
  if (typeof period !== "object" || period === null) return null;
  const { kind, startDate, nextStartDate } = period;
  if (
    typeof kind !== "string" ||
    !(REPORT_PERIOD_KINDS as readonly string[]).includes(kind) ||
    typeof startDate !== "string" ||
    typeof nextStartDate !== "string" ||
    !isValidReportDate(startDate) ||
    !isValidReportDate(nextStartDate) ||
    nextStartDate <= startDate
  ) {
    return null;
  }
  if (!isCount(report.entryCount) || !isCount(report.workDays) || !isCount(report.durationMinutes)) return null;

  const amount = (value: unknown, allowNegative: boolean): bigint | null => {
    if (typeof value !== "string") return null;
    const cents = parseApiTotalCents(value);
    return cents === null || (!allowNegative && cents < 0n) ? null : cents;
  };
  const grossCents = amount(report.grossCents, false);
  const fuelCents = amount(report.fuelCents, false);
  const otherExpenseCents = amount(report.otherExpenseCents, false);
  const shareCents = amount(report.shareCents, false);
  const remainderCents = amount(report.remainderCents, true);
  const confirmedReceivedCents = amount(report.confirmedReceivedCents, false);
  if (
    grossCents === null ||
    fuelCents === null ||
    otherExpenseCents === null ||
    shareCents === null ||
    remainderCents === null ||
    confirmedReceivedCents === null
  ) {
    return null;
  }
  return {
    period: { kind: kind as ReportPeriodKind, startDate, nextStartDate },
    entryCount: report.entryCount,
    workDays: report.workDays,
    durationMinutes: report.durationMinutes,
    grossCents,
    fuelCents,
    otherExpenseCents,
    shareCents,
    remainderCents,
    confirmedReceivedCents,
  };
}

/** İstek adresi; `date` yoksa sunucu bugünü (İstanbul) kullanır. */
export function buildVehiclePeriodReportUrl(period: ReportPeriodKind, date: string | undefined): string {
  const params = new URLSearchParams({ period });
  if (date !== undefined) params.set("date", date);
  return `/api/v1/reports/vehicles?${params.toString()}`;
}

export function vehiclePeriodReportView(report: VehiclePeriodReportData): VehiclePeriodReportView {
  const { period } = report;
  return {
    rangeText: formatReportPeriodRange(period),
    isEmpty: report.entryCount === 0,
    previousDate: addDays(period.startDate, -1),
    nextDate: period.nextStartDate,
    remainder: formatTlAmount(report.remainderCents),
    received: formatTlAmount(report.confirmedReceivedCents),
    breakdown: [
      { label: TEXT.breakdown.gross, value: formatTlAmount(report.grossCents) },
      { label: TEXT.breakdown.fuel, value: formatTlAmount(report.fuelCents) },
      { label: TEXT.breakdown.otherExpense, value: formatTlAmount(report.otherExpenseCents) },
      { label: TEXT.breakdown.share, value: formatTlAmount(report.shareCents) },
      { label: TEXT.breakdown.duration, value: formatDuration(report.durationMinutes) },
      { label: TEXT.breakdown.workDays, value: TEXT.dayCount(report.workDays) },
      { label: TEXT.breakdown.entryCount, value: String(report.entryCount) },
    ],
  };
}
