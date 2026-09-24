/**
 * Günlük yedek kopyasının SAF zaman-penceresi, adlandırma, saklama ve log
 * kuralları — DB/dosya sistemi/saat YOK; saat her zaman parametredir
 * (`scripts/db-backup.ts` gerçek saati yalnız `DOLMUS_BACKUP_NOW` yoksa
 * `new Date()` ile verir, testler sabit bir an verir).
 *
 * Kaynak — ARCHITECTURE.md "Flow: Daily backup" ve OPS.md §4: Europe/Istanbul
 * 02:30 hazırlık, 02:55 hazır kopya son saati, ~03:00 Lightsail snapshot;
 * "Hazır kopyayı snapshot penceresinde değiştirme" — bu yüzden 02:55–04:00
 * arası HİÇBİR kopya yayımlanmaz. "Yerelde son 2 doğrulanmış kopya".
 *
 * `src/lib/work-time.ts`'in İstanbul yardımcıları BİLEREK kullanılmaz: o dosya
 * `./messages`'ı uzantısız import eder ve düz `node` (bundler'sız) bunu
 * çözemez; bu modül arşivden `/usr/bin/node scripts/db-backup.ts` ile
 * yüklenebilmelidir. Bu yüzden yalnız `Intl` kullanılır.
 */

export const ISTANBUL_TIME_ZONE = "Europe/Istanbul";

/** 02:30 — hazırlık başlangıcı (dakika cinsinden günün İstanbul saati). */
export const PREP_START_MINUTE = 2 * 60 + 30;
/** 02:55 — hazır kopya son saati; korumalı pencere BURADA başlar. */
export const READY_DEADLINE_MINUTE = 2 * 60 + 55;
/** 04:00 — korumalı pencere sonu (dışlayıcı). */
export const PROTECTED_END_MINUTE = 4 * 60;

/** Pencere dışında (elle) başlatılan koşunun kopyalama bütçesi. */
export const OFF_WINDOW_BUDGET_MS = 25 * 60_000;

export const KEEP_VERIFIED_COPIES = 2;

/**
 * Yalnız BÜYÜMESİ gereken tablolar (≥5 yıl kayıt/revizyon saklama kuralı):
 * önceki manifestteki satır sayısından AZ olan bir kopya yayımlanmaz.
 * `sessions`/`mutation_receipts` meşru olarak küçülür, bu yüzden yoktur.
 */
export const GUARDED_TABLES: readonly string[] = [
  "work_entries",
  "work_entry_revisions",
  "cash_confirmations",
  "admin_audit",
];

// ---------------------------------------------------------------------------
// İstanbul saati
// ---------------------------------------------------------------------------

const wallClockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ISTANBUL_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export interface IstanbulWallClock {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM:SS */
  time: string;
  /** Günün başından dakika (0–1439). */
  minuteOfDay: number;
  /** Günün başından saniye (0–86399). */
  secondOfDay: number;
}

export function istanbulWallClock(at: Date): IstanbulWallClock {
  const parts: Record<string, string> = {};
  for (const part of wallClockFormat.formatToParts(at)) {
    parts[part.type] = part.value;
  }
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    minuteOfDay: hour * 60 + minute,
    secondOfDay: hour * 3600 + minute * 60 + second,
  };
}

/** `2026-09-24T02:30:00+03:00` — manifestte UTC anın yanına yazılan yerel saat. */
export function istanbulIso(at: Date): string {
  const wall = istanbulWallClock(at);
  const asIfUtc = Date.parse(`${wall.date}T${wall.time}Z`);
  const offsetMinutes = Math.round((asIfUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${wall.date}T${wall.time}${sign}${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Yayın penceresi
// ---------------------------------------------------------------------------

/** 02:55 ≤ İstanbul saati < 04:00: snapshot penceresi, kopya DEĞİŞTİRİLMEZ. */
export function isInProtectedWindow(at: Date): boolean {
  const { minuteOfDay } = istanbulWallClock(at);
  return minuteOfDay >= READY_DEADLINE_MINUTE && minuteOfDay < PROTECTED_END_MINUTE;
}

/**
 * Koşunun kopyalama döngüsünü sınırlayan son an. Sabah 02:55'ten önce
 * başlayan koşu için AYNI günün 02:55'i; 04:00'ten sonra (elle) başlayan koşu
 * için başlangıç + `OFF_WINDOW_BUDGET_MS`; korumalı pencerede başlayan koşu
 * için başlangıcın kendisi (zaten süresi dolmuş).
 */
export function copyDeadline(startedAt: Date): Date {
  const { minuteOfDay, secondOfDay } = istanbulWallClock(startedAt);
  if (minuteOfDay < READY_DEADLINE_MINUTE) {
    return new Date(startedAt.getTime() + (READY_DEADLINE_MINUTE * 60 - secondOfDay) * 1000);
  }
  if (minuteOfDay < PROTECTED_END_MINUTE) {
    return startedAt;
  }
  return new Date(startedAt.getTime() + OFF_WINDOW_BUDGET_MS);
}

export type PublishDecision =
  | { ok: true }
  | { ok: false; reason: "protected_window" | "deadline_passed" };

export function decidePublish(now: Date, deadline: Date): PublishDecision {
  if (isInProtectedWindow(now)) {
    return { ok: false, reason: "protected_window" };
  }
  if (now.getTime() >= deadline.getTime()) {
    return { ok: false, reason: "deadline_passed" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Adlandırma
// ---------------------------------------------------------------------------

const COPY_SUFFIX = ".sqlite";
const MANIFEST_SUFFIX = ".manifest.json";
const STEM_SOURCE = "app-\\d{8}T\\d{6}Z";
const FINAL_NAME_PATTERN = new RegExp(`^(${STEM_SOURCE})(\\.sqlite|\\.manifest\\.json)$`);
// Yalnız bu aracın kendi geçici adları; başka hiçbir dosyaya dokunulmaz.
const TEMP_NAME_PATTERN = new RegExp(
  `^\\.dolmus-backup-tmp-${STEM_SOURCE}\\.(sqlite|manifest\\.json)\\.\\d+(-wal|-shm|-journal)?$`,
);

/** `app-20260924T233000Z` — UTC, sözlük sırası = zaman sırası. */
export function backupStem(at: Date): string {
  const iso = at.toISOString(); // 2026-09-24T23:30:00.000Z
  return `app-${iso.slice(0, 10).replaceAll("-", "")}T${iso.slice(11, 19).replaceAll(":", "")}Z`;
}

export const copyFileName = (stem: string): string => `${stem}${COPY_SUFFIX}`;
export const manifestFileName = (stem: string): string => `${stem}${MANIFEST_SUFFIX}`;

/** Nokta önekli geçici ad: durum/saklama bunu hiçbir zaman kopya saymaz. */
export function tempFileName(stem: string, kind: "sqlite" | "manifest.json", pid: number): string {
  return `.dolmus-backup-tmp-${stem}.${kind}.${pid}`;
}

export const isOwnTempName = (name: string): boolean => TEMP_NAME_PATTERN.test(name);

export interface BackupSet {
  stem: string;
  hasCopy: boolean;
  hasManifest: boolean;
}

/** Dizin girdilerini kopya/manifest çiftlerine ayırır; en yeni önce. */
export function groupBackupSets(names: readonly string[]): BackupSet[] {
  const byStem = new Map<string, BackupSet>();
  for (const name of names) {
    const match = FINAL_NAME_PATTERN.exec(name);
    if (!match) continue;
    const stem = match[1]!;
    const set = byStem.get(stem) ?? { stem, hasCopy: false, hasManifest: false };
    if (match[2] === COPY_SUFFIX) set.hasCopy = true;
    else set.hasManifest = true;
    byStem.set(stem, set);
  }
  return [...byStem.values()].sort((a, b) => (a.stem < b.stem ? 1 : a.stem > b.stem ? -1 : 0));
}

export interface RetentionPlan {
  keepStems: string[];
  removeFiles: string[];
}

/**
 * En yeni `keep` adet MANİFESTİ TAMAM kopya (`validStems`: manifesti okunup
 * doğrulanmış olanlar) kalır. Kalanların — yarım kalmış çiftler dahil —
 * dosyaları silinir. Yalnız `app-*.sqlite` / `app-*.manifest.json` adlarına
 * dokunulur. Çağıran bunu YALNIZ yeni kopya yayımlandıktan sonra uygular.
 */
export function planRetention(
  names: readonly string[],
  validStems: ReadonlySet<string>,
  keep: number = KEEP_VERIFIED_COPIES,
): RetentionPlan {
  const sets = groupBackupSets(names);
  const keepStems = sets
    .filter((set) => set.hasCopy && set.hasManifest && validStems.has(set.stem))
    .slice(0, keep)
    .map((set) => set.stem);
  const kept = new Set(keepStems);
  const removeFiles: string[] = [];
  for (const set of sets) {
    if (kept.has(set.stem)) continue;
    if (set.hasCopy) removeFiles.push(copyFileName(set.stem));
    if (set.hasManifest) removeFiles.push(manifestFileName(set.stem));
  }
  return { keepStems, removeFiles };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface BackupManifest {
  manifest_version: 1;
  stem: string;
  file: string;
  size_bytes: number;
  sha256: string;
  /** UTC ISO 8601. */
  created_at: string;
  verified_at: string;
  published_at: string;
  /** Aynı anların Europe/Istanbul duvar saati (ofsetli ISO). */
  istanbul: { created_at: string; verified_at: string; published_at: string };
  release_id: string;
  sqlite_version: string;
  schema: {
    applied_migrations: number;
    last_migration_created_at: string;
    last_migration_hash: string;
  };
  last_committed_record: {
    work_entry_revision: { entry_id: string; version: number; created_at: string } | null;
    cash_confirmation: { entry_id: string; entry_version: number; confirmed_at: string } | null;
    admin_audit: { id: string; occurred_at: string } | null;
  };
  row_counts: Record<string, number>;
  /** Kuruş toplamları METİN (2^53 üstü tam sayı kaybolmasın). */
  totals: Record<string, string>;
  checks: {
    integrity_check: "ok";
    foreign_key_violations: 0;
    entry_amount_mismatches: 0;
    unchecked_entries: number;
  };
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function isRecordOf(value: unknown, test: (v: unknown) => boolean): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(test)
  );
}

/** Geçerli bir manifest ise döndürür, değilse `null` (asla fırlatmaz). */
export function parseManifest(text: string): BackupManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  const valid =
    m.manifest_version === 1 &&
    typeof m.stem === "string" &&
    FINAL_NAME_PATTERN.test(`${m.stem}${COPY_SUFFIX}`) &&
    m.file === copyFileName(m.stem) &&
    typeof m.size_bytes === "number" &&
    Number.isSafeInteger(m.size_bytes) &&
    typeof m.sha256 === "string" &&
    SHA256_PATTERN.test(m.sha256) &&
    typeof m.verified_at === "string" &&
    !Number.isNaN(Date.parse(m.verified_at)) &&
    typeof m.release_id === "string" &&
    m.release_id.length > 0 &&
    isRecordOf(m.row_counts, (v) => typeof v === "number" && Number.isSafeInteger(v)) &&
    isRecordOf(m.totals, (v) => typeof v === "string");
  return valid ? (m as unknown as BackupManifest) : null;
}

export interface RowCountDrop {
  table: string;
  previous: number;
  current: number;
}

/** Korunan tablolarda önceki manifeste göre AZALMA — yayımlamayı engeller. */
export function findRowCountDrops(
  previous: Readonly<Record<string, number>>,
  current: Readonly<Record<string, number>>,
  guarded: readonly string[] = GUARDED_TABLES,
): RowCountDrop[] {
  const drops: RowCountDrop[] = [];
  for (const table of guarded) {
    const before = previous[table];
    if (before === undefined) continue;
    const after = current[table] ?? 0;
    if (after < before) drops.push({ table, previous: before, current: after });
  }
  return drops;
}

// ---------------------------------------------------------------------------
// Log (logfmt)
// ---------------------------------------------------------------------------

export type LogLevel = "info" | "warn" | "err";
const PRIORITY: Record<LogLevel, string> = { info: "<6>", warn: "<4>", err: "<3>" };

/**
 * Tek satır logfmt (`deploy/health/health-check.mts` ile aynı biçim); değerler
 * harf/rakam ve `._:/@+-` kümesine indirgenir (Türkçe harfler korunur), yani
 * boşluk/satır sonu/tırnak log satırını bölemez.
 */
export function formatLogLine(
  level: LogLevel,
  event: string,
  fields: Readonly<Record<string, string | number | boolean>>,
  now: Date,
): string {
  const kv = Object.entries(fields)
    .map(([k, v]) => `${k}=${String(v).replace(/[^\p{L}\p{N}._:/@+-]/gu, "_").slice(0, 120)}`)
    .join(" ");
  return `${PRIORITY[level]}dolmus-backup event=${event} ts=${now.toISOString()}${kv ? ` ${kv}` : ""}`;
}
