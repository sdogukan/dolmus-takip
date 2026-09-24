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
import { deliveryStatusLabel, formatWorkTimeRange, workEntryDetailHref } from "./work-entry-ui";
import { addDays, formatDuration, formatWorkDate } from "./work-time";

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
  /** Sunucunun döndürdüğü dönemin ilk günü; kişi raporu AYNI dönemi bununla ister. */
  startDate: string;
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

/** Sunucunun `period` nesnesi → dönem; kind/tarih bozuksa veya aralık ters ise `null`. */
function parseReportPeriod(value: unknown): ReportPeriod | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, startDate, nextStartDate } = value as Record<string, unknown>;
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
  return { kind: kind as ReportPeriodKind, startDate, nextStartDate };
}

/** Kuruş metni → BigInt (üst sınırsız); yalnız `allowNegative` iken eksi kabul edilir. */
function parseCents(value: unknown, allowNegative: boolean): bigint | null {
  if (typeof value !== "string") return null;
  const cents = parseApiTotalCents(value);
  return cents === null || (!allowNegative && cents < 0n) ? null : cents;
}

/**
 * `GET /api/v1/reports/vehicles` gövdesi → veri; biçim bozuksa `null` (ekran
 * bunu "rapor yüklenemedi" sayar, kısmi veri göstermez). Yalnız `remainderCents`
 * eksi olabilir.
 */
export function parseVehiclePeriodReport(body: unknown): VehiclePeriodReportData | null {
  const report = (body as { report?: unknown } | null)?.report as Record<string, unknown> | null | undefined;
  if (typeof report !== "object" || report === null) return null;
  const period = parseReportPeriod(report.period);
  if (period === null) return null;
  if (!isCount(report.entryCount) || !isCount(report.workDays) || !isCount(report.durationMinutes)) return null;

  const grossCents = parseCents(report.grossCents, false);
  const fuelCents = parseCents(report.fuelCents, false);
  const otherExpenseCents = parseCents(report.otherExpenseCents, false);
  const shareCents = parseCents(report.shareCents, false);
  const remainderCents = parseCents(report.remainderCents, true);
  const confirmedReceivedCents = parseCents(report.confirmedReceivedCents, false);
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
    period,
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
    startDate: period.startDate,
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

export interface PersonPeriodTotalsData {
  personId: string;
  fullName: string;
  isOwner: boolean;
  entryCount: number;
  workDays: number;
  durationMinutes: number;
  grossCents: bigint;
  fuelCents: bigint;
  otherExpenseCents: bigint;
  shareCents: bigint;
  remainderCents: bigint;
}

export interface PeoplePeriodReportData {
  period: ReportPeriod;
  people: PersonPeriodTotalsData[];
}

export type PersonEntryStatus = "pending" | "confirmed" | "not_required";

export interface PersonPeriodEntryData {
  id: string;
  workDate: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  grossCents: bigint;
  shareCents: bigint;
  remainderCents: bigint;
  status: PersonEntryStatus;
}

export interface PersonPeriodReportData {
  period: ReportPeriod;
  person: PersonPeriodTotalsData;
  entries: PersonPeriodEntryData[];
  nextCursor: string | null;
}

function parsePersonTotals(value: unknown): PersonPeriodTotalsData | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.personId !== "string" || row.personId === "") return null;
  if (typeof row.fullName !== "string" || typeof row.isOwner !== "boolean") return null;
  if (!isCount(row.entryCount) || !isCount(row.workDays) || !isCount(row.durationMinutes)) return null;
  const grossCents = parseCents(row.grossCents, false);
  const fuelCents = parseCents(row.fuelCents, false);
  const otherExpenseCents = parseCents(row.otherExpenseCents, false);
  const shareCents = parseCents(row.shareCents, false);
  const remainderCents = parseCents(row.remainderCents, true);
  if (
    grossCents === null ||
    fuelCents === null ||
    otherExpenseCents === null ||
    shareCents === null ||
    remainderCents === null
  ) {
    return null;
  }
  return {
    personId: row.personId,
    fullName: row.fullName,
    isOwner: row.isOwner,
    entryCount: row.entryCount,
    workDays: row.workDays,
    durationMinutes: row.durationMinutes,
    grossCents,
    fuelCents,
    otherExpenseCents,
    shareCents,
    remainderCents,
  };
}

function parsePersonEntry(value: unknown): PersonPeriodEntryData | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id === "") return null;
  if (typeof row.workDate !== "string" || !isValidReportDate(row.workDate)) return null;
  if (typeof row.startsAt !== "string" || Number.isNaN(Date.parse(row.startsAt))) return null;
  if (typeof row.endsAt !== "string" || Number.isNaN(Date.parse(row.endsAt))) return null;
  if (!isCount(row.durationMinutes)) return null;
  if (row.status !== "pending" && row.status !== "confirmed" && row.status !== "not_required") return null;
  const grossCents = parseCents(row.grossCents, false);
  const shareCents = parseCents(row.shareCents, false);
  const remainderCents = parseCents(row.remainderCents, true);
  if (grossCents === null || shareCents === null || remainderCents === null) return null;
  return {
    id: row.id,
    workDate: row.workDate,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    durationMinutes: row.durationMinutes,
    grossCents,
    shareCents,
    remainderCents,
    status: row.status,
  };
}

/** `GET /api/v1/reports/people` gövdesi → veri; biçim bozuksa `null`. */
export function parsePeoplePeriodReport(body: unknown): PeoplePeriodReportData | null {
  const report = (body as { report?: unknown } | null)?.report as Record<string, unknown> | null | undefined;
  if (typeof report !== "object" || report === null) return null;
  const period = parseReportPeriod(report.period);
  if (period === null || !Array.isArray(report.people)) return null;
  const people: PersonPeriodTotalsData[] = [];
  for (const item of report.people as unknown[]) {
    const person = parsePersonTotals(item);
    if (person === null) return null;
    people.push(person);
  }
  return { period, people };
}

/** `GET /api/v1/reports/people/{personId}` gövdesi → veri; biçim bozuksa `null`. */
export function parsePersonPeriodReport(body: unknown): PersonPeriodReportData | null {
  const report = (body as { report?: unknown } | null)?.report as Record<string, unknown> | null | undefined;
  if (typeof report !== "object" || report === null) return null;
  const period = parseReportPeriod(report.period);
  const person = parsePersonTotals(report.person);
  if (period === null || person === null || !Array.isArray(report.entries)) return null;
  if (report.nextCursor !== null && (typeof report.nextCursor !== "string" || report.nextCursor === "")) return null;
  const entries: PersonPeriodEntryData[] = [];
  for (const item of report.entries as unknown[]) {
    const entry = parsePersonEntry(item);
    if (entry === null) return null;
    entries.push(entry);
  }
  return { period, person, entries, nextCursor: report.nextCursor };
}

/** Kişi listesi adresi; `date` dönemin sunucudan gelen ilk günüdür. */
export function buildPeoplePeriodReportUrl(period: ReportPeriodKind, date: string | undefined): string {
  const params = new URLSearchParams({ period });
  if (date !== undefined) params.set("date", date);
  return `/api/v1/reports/people?${params.toString()}`;
}

/** Kişi ayrıntısı adresi; `cursor` yalnız sonraki sayfa içindir. */
export function buildPersonPeriodReportUrl(
  personId: string,
  period: ReportPeriodKind,
  date: string | undefined,
  cursor?: string,
): string {
  const params = new URLSearchParams({ period });
  if (date !== undefined) params.set("date", date);
  if (cursor !== undefined) params.set("cursor", cursor);
  return `/api/v1/reports/people/${encodeURIComponent(personId)}?${params.toString()}`;
}

const PEOPLE_TEXT = TEXT.people;

const personSummary = (person: Pick<PersonPeriodTotalsData, "durationMinutes" | "workDays" | "entryCount">): string =>
  `${formatDuration(person.durationMinutes)} · ${TEXT.dayCount(person.workDays)} · ${PEOPLE_TEXT.entryCount(person.entryCount)}`;

export interface PersonCardView {
  personId: string;
  fullName: string;
  /** Yalnız mal sahibi kartında "Mal sahibi"; şoförde `null`. */
  ownerLabel: string | null;
  summary: string;
  amounts: string;
}

export interface PeoplePeriodReportView {
  isEmpty: boolean;
  cards: PersonCardView[];
}

export function peoplePeriodReportView(report: PeoplePeriodReportData): PeoplePeriodReportView {
  return {
    isEmpty: report.people.length === 0,
    cards: report.people.map((person) => ({
      personId: person.personId,
      fullName: person.fullName,
      ownerLabel: person.isOwner ? PEOPLE_TEXT.ownerLabel : null,
      summary: personSummary(person),
      amounts: PEOPLE_TEXT.grossAndShare(formatTlAmount(person.grossCents), formatTlAmount(person.shareCents)),
    })),
  };
}

export interface PersonEntryView {
  id: string;
  dateText: string;
  timeText: string;
  durationText: string;
  amounts: string;
  remainder: string;
  statusText: string;
  href: string;
}

export interface PersonDetailView {
  summary: string;
  totals: { label: string; value: string }[];
  entries: PersonEntryView[];
  nextCursor: string | null;
}

export function personEntryView(entry: PersonPeriodEntryData): PersonEntryView {
  return {
    id: entry.id,
    dateText: formatWorkDate(entry.workDate),
    timeText: formatWorkTimeRange(entry.startsAt, entry.endsAt),
    durationText: formatDuration(entry.durationMinutes),
    amounts: PEOPLE_TEXT.grossAndShare(formatTlAmount(entry.grossCents), formatTlAmount(entry.shareCents)),
    remainder: formatTlAmount(entry.remainderCents),
    statusText: deliveryStatusLabel(entry.status),
    href: workEntryDetailHref("owner", entry.id, ""),
  };
}

export function personDetailView(report: PersonPeriodReportData): PersonDetailView {
  const { person } = report;
  return {
    summary: personSummary(person),
    totals: [
      { label: PEOPLE_TEXT.totals.gross, value: formatTlAmount(person.grossCents) },
      { label: PEOPLE_TEXT.totals.fuel, value: formatTlAmount(person.fuelCents) },
      { label: PEOPLE_TEXT.totals.otherExpense, value: formatTlAmount(person.otherExpenseCents) },
      { label: PEOPLE_TEXT.totals.share, value: formatTlAmount(person.shareCents) },
      { label: PEOPLE_TEXT.totals.remainder, value: formatTlAmount(person.remainderCents) },
    ],
    entries: report.entries.map(personEntryView),
    nextCursor: report.nextCursor,
  };
}
