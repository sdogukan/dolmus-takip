/**
 * Günlük kayıt tarih/saat kuralı (K3) — SAF: DB/ağ/React YOK.
 *
 * - Süre 1–1440 dakika (`work_entries.duration_minutes` CHECK ile aynı).
 * - `workDate` = başlangıç gününün Europe/Istanbul takvim günü (YYYY-MM-DD).
 * - `startsAt`/`endsAt` ISO UTC metni; girilen saat HER ZAMAN İstanbul
 *   saatidir — cihazın saat dilimi hiçbir yerde kullanılmaz.
 * - Aynı gün eşit saat reddedilir (24 saat sayılmaz); ertesi güne taşan
 *   bitiş kullanıcı tarafından AÇIKÇA işaretlenir, `bitiş < başlangıç`tan
 *   çıkarılmaz.
 */
import { WORK_ENTRY_MESSAGES as TEXT } from "./messages";

export const WORK_TIME_ZONE = "Europe/Istanbul";
export const MAX_DURATION_MINUTES = 1440;

const MINUTE_MS = 60_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const MIN_YEAR = 2000;

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

export interface WorkTimeInput {
  /** YYYY-MM-DD (native date input değeri). */
  date: string;
  /** HH:MM. */
  startTime: string;
  /** HH:MM. */
  endTime: string;
  endsNextDay: boolean;
}

export type WorkTimeField = "date" | "startTime" | "endTime";

export type WorkTimeResult =
  | {
      ok: true;
      workDate: string;
      startsAt: string;
      endsAt: string;
      durationMinutes: number;
      /** Bitişin İstanbul takvim günü (YYYY-MM-DD). */
      endDate: string;
    }
  | { ok: false; errors: Partial<Record<WorkTimeField, string>> };

function parseDate(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function toDateString(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Takvim günü kaydırır (saat dilimi/DST'den bağımsız — yalnız takvim aritmetiği). */
export function addDays(date: string, days: number): string {
  const parsed = parseDate(date);
  if (!parsed) return date;
  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return toDateString(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

const istanbulParts = new Intl.DateTimeFormat("en-US", {
  timeZone: WORK_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

function istanbulFields(utcMs: number): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const part of istanbulParts.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return fields;
}

/** Verilen UTC anında İstanbul'un UTC'den farkı (dakika). */
function istanbulOffsetMinutes(utcMs: number): number {
  const f = istanbulFields(utcMs);
  const asUtc = Date.UTC(f.year!, f.month! - 1, f.day!, f.hour!, f.minute!, f.second!);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / MINUTE_MS);
}

/** İstanbul duvar saatini UTC anına çevirir (cihaz saat diliminden bağımsız). */
function istanbulWallClockToUtcMs(
  date: { year: number; month: number; day: number },
  time: { hour: number; minute: number },
): number {
  const naive = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  const first = naive - istanbulOffsetMinutes(naive) * MINUTE_MS;
  return naive - istanbulOffsetMinutes(first) * MINUTE_MS;
}

/** Şu an İstanbul'da hangi takvim günü (YYYY-MM-DD). `now` testler içindir. */
export function istanbulToday(now: Date = new Date()): string {
  const f = istanbulFields(now.getTime());
  return toDateString(f.year!, f.month!, f.day!);
}

/** Kayıtlı UTC anını İstanbul duvar saatine çevirir: `{ date: "YYYY-MM-DD", time: "HH:MM" }`. */
export function istanbulWallClock(isoUtc: string): { date: string; time: string } {
  const f = istanbulFields(new Date(isoUtc).getTime());
  return { date: toDateString(f.year!, f.month!, f.day!), time: `${pad(f.hour!)}:${pad(f.minute!)}` };
}

/**
 * K3 kuralını değerlendirir. Alan hataları Türkçe metindir; yalnız hatalı
 * alanlar anahtar taşır (diğer alanların değerine dokunulmaz).
 */
export function evaluateWorkTime(input: WorkTimeInput): WorkTimeResult {
  const errors: Partial<Record<WorkTimeField, string>> = {};
  const date = parseDate(input.date);
  const start = parseTime(input.startTime);
  const end = parseTime(input.endTime);
  if (!date) errors.date = TEXT.dateInvalid;
  if (!start) errors.startTime = TEXT.startRequired;
  if (!end) errors.endTime = TEXT.endRequired;
  if (!date || !start || !end) return { ok: false, errors };

  const startMs = istanbulWallClockToUtcMs(date, start);
  const endDateString = input.endsNextDay ? addDays(input.date, 1) : input.date;
  const endDate = parseDate(endDateString);
  if (!endDate) return { ok: false, errors: { date: TEXT.dateInvalid } };
  const endMs = istanbulWallClockToUtcMs(endDate, end);

  const minutes = Math.round((endMs - startMs) / MINUTE_MS);
  if (!input.endsNextDay && minutes === 0) {
    return { ok: false, errors: { endTime: TEXT.timesEqual } };
  }
  if (minutes <= 0) {
    return { ok: false, errors: { endTime: TEXT.endBeforeStart } };
  }
  if (minutes > MAX_DURATION_MINUTES) {
    return { ok: false, errors: { endTime: TEXT.durationTooLong } };
  }
  return {
    ok: true,
    workDate: input.date,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    durationMinutes: minutes,
    endDate: endDateString,
  };
}

/** "14 Eylül 2026" — tarayıcı yerel ayarından bağımsız; geçersizse boş dize. */
export function formatWorkDate(date: string): string {
  const parsed = parseDate(date);
  if (!parsed) return "";
  return `${parsed.day} ${MONTH_NAMES[parsed.month - 1]} ${parsed.year}`;
}

/** "9 saat 30 dakika" / "8 saat" / "45 dakika". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} dakika`;
  if (rest === 0) return `${hours} saat`;
  return `${hours} saat ${rest} dakika`;
}
