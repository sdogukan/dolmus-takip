/**
 * Kontrollü restore — `node scripts/db-restore.ts <verify|install|report>`
 * (T6.5, S6.5; OPS.md §4 "Kontrollü restore", ARCHITECTURE "Flow: Daily
 * backup, restore and release").
 *
 * DB komutları root olarak çalıştırılmaz (SERVER-SETUP §2): her komut uid 0
 * ise reddeder; sunucuda `sudo -u dolmus-takip` ile, kopyanın uyumlu olduğu
 * release dizininden (`/opt/dolmus-takip/releases/<release_id>`) çalışır.
 *
 * ## `verify --manifest <backup-ready/app-….manifest.json>`
 *
 * Salt okunur. Kopya yolu yalnız `parseManifest`'in `file === copyFileName(stem)`
 * kontrolünden SONRA manifestin yanındaki dosya olarak kurulur. Sırayla:
 * sha256/boyut manifestle aynı, manifest `release_id` = koşulan release dizini
 * (`realpath(cwd)` adı), `scripts/lib/copy-verification.ts` `verifyCopy`
 * (integrity, foreign key, bu release'in migration'ları, pay/kalan yeniden
 * hesabı), kopyadaki migration kümesi bu release'inkiyle AYNI (fazlası da
 * red), araç dönem raporunun (`selectVehiclePeriodTotals`, her araç × yıl)
 * toplamları kopyanın `work_entries` toplamlarıyla METİN olarak aynı ve
 * manifest `last_committed_record` kopyanın kendi satırlarıyla aynı. Giriş
 * kimlikleri (id, plaka/kullanıcı adı, aktiflik, credential_version — hash
 * ASLA) listelenir; başarıda kurtarılabilir nokta KOPYANIN satırlarından
 * yazılır (snapshot saati veya dosya zamanı değil).
 *
 * ## `install --manifest <…>`
 *
 * Ortak işletim kilidi (`flock`, sınırlı bekleme; alınamazsa 75) altında:
 * bakım işareti yoksa veya uygulama servisi `inactive`/`failed` değilse
 * REDDEDER. `verify`'ın tamamını çalıştırır; kopyayı veri dizinine nokta
 * önekli geçici ada kopyalar, hash'i yeniden doğrular ve BÜTÜN oturumları
 * (`revokeAllSessionsSync`) uygulama bu DB'yi hiç görmeden iptal eder. Canlı
 * `app.sqlite`/`-wal`/`-shm`/`-journal` SİLİNMEZ, üzerine yazılmaz:
 * `preserved/<zaman>/` altına taşınır; yeni dosya `link` ile (var olan hedefin
 * üzerine yazamaz) yerleşir. Boş DB hiçbir yolda oluşturulmaz.
 *
 * ## `report --started-at <ISO> [--incident-at <ISO>]`
 *
 * Restore kaydı: canlı DB'nin kendi satırlarından kurtarılabilir nokta,
 * başlangıçtan bu ana toparlanma süresi ve olay zamanı verilmişse kayıp
 * aralığı (verilmemişse `unknown`).
 *
 * Her sonuç tek bir logfmt satırıdır (`formatLogLine`, etiket
 * `dolmus-restore`); çıkış 0 yalnız başarıda, hata tek `err` satırında
 * nedeni adlandırır.
 *
 * ## Ortam
 *
 * - `DOLMUS_DB_PATH`: canlı DB (`install`, `report`).
 * - `DOLMUS_PRESERVED_DIR`, `DOLMUS_MAINTENANCE_FILE`, `DOLMUS_OPS_LOCK`,
 *   `DOLMUS_OPS_LOCK_WAIT` (sn): varsayılanları SERVER-SETUP §2 yollarıdır ve
 *   900 sn; yalnız test/deneme ortamı için değiştirilir.
 *
 * Rapor sorgu ağacı (`src/server/usecases/reports/`, `src/lib/work-time.ts`)
 * uzantısız import kullanır; düz `node` onu yalnız `./lib/ts-resolver.mjs`
 * kancasıyla çözer. Kanca bu dosyanın ilk import'uyla kaydedilir, rapor
 * modülleri ondan SONRA dinamik import edilir. Import ağacı
 * `release-build.ts` `bundleDbInitIntoStandalone`'da eksiksiz kopyalanır.
 */
import "./lib/ts-resolver.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { createDb, resolveDbPathFromEnv } from "../src/server/data/db.ts";
import { revokeAllSessionsSync } from "../src/server/usecases/session/revoke-session.ts";
import {
  formatLogLine,
  manifestFileName,
  parseManifest,
  type BackupManifest,
  type LogLevel,
} from "./lib/backup-schedule.ts";
import {
  CopyRejectedError,
  readLastCommittedRecord,
  sha256OfFile,
  verifyCopy,
  type Fields,
  type VerifiedCopy,
} from "./lib/copy-verification.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(path.resolve(__dirname, ".."), "drizzle");

const APP_SERVICE = "dolmus-takip.service";
const STOPPED_SERVICE_STATES: readonly string[] = ["inactive", "failed"];
const DEFAULT_PRESERVED_DIR = "/var/lib/dolmus-takip/preserved";
const DEFAULT_MAINTENANCE_FILE = "/var/lib/dolmus-takip/maintenance";
const DEFAULT_OPS_LOCK = "/var/lib/dolmus-takip/ops.lock";
const DEFAULT_OPS_LOCK_WAIT_SECONDS = 900;
/** `flock -E`: kilit süresinde alınamadı (yedek birimiyle aynı kod). */
const LOCK_BUSY_EXIT = 75;
/** Canlı DB'nin yanında olabilecek bütün dosyalar; hepsi birlikte taşınır. */
const LIVE_SUFFIXES = ["", "-wal", "-shm", "-journal"] as const;

const USAGE =
  "Kullanım: db-restore.ts verify --manifest <yol> | install --manifest <yol> | " +
  "report --started-at <ISO> [--incident-at <ISO>]";
const COMMAND_FLAGS: Record<string, readonly string[]> = {
  verify: ["--manifest"],
  install: ["--manifest"],
  report: ["--started-at", "--incident-at"],
};

type Env = Record<string, string | undefined>;

function log(level: LogLevel, event: string, fields: Fields = {}): void {
  console.log(formatLogLine(level, event, fields, new Date(), "dolmus-restore"));
}

function reject(reason: string, message: string, fields: Fields = {}): never {
  throw new CopyRejectedError(reason, message, fields);
}

function parseArgs(argv: readonly string[]): { command: string; flags: Map<string, string> } {
  const [command = "", ...rest] = argv;
  const allowed = COMMAND_FLAGS[command];
  if (allowed === undefined) reject("usage", USAGE);
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]!;
    const value = rest[i + 1];
    if (!allowed.includes(flag) || flags.has(flag) || value === undefined || value === "") {
      reject("usage", USAGE, { argument: flag });
    }
    flags.set(flag, value);
  }
  return { command, flags };
}

function requiredFlag(flags: Map<string, string>, flag: string): string {
  const value = flags.get(flag);
  if (value === undefined) reject("usage", USAGE, { missing: flag });
  return value;
}

function parseInstant(value: string, flag: string): Date {
  const at = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(value) || Number.isNaN(at.getTime())) {
    reject("usage", `${flag} geçerli bir ISO zamanı değil: "${value}".`, { argument: flag });
  }
  if (at.getTime() > Date.now()) {
    reject("usage", `${flag} gelecekte olamaz: "${value}".`, { argument: flag });
  }
  return at;
}

function isDirectory(dir: string): boolean {
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

function fsyncPath(target: string): void {
  const fd = fs.openSync(target, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** `20260924T120000Z` — preserved alt dizininin adı. */
function compactUtc(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10).replaceAll("-", "")}T${iso.slice(11, 19).replaceAll(":", "")}Z`;
}

// ---------------------------------------------------------------------------
// Kurtarılabilir nokta ve giriş kimlikleri
// ---------------------------------------------------------------------------

interface RecoverablePoint {
  /** UTC ISO; DB'de hiç kayıt yoksa `null`. */
  at: string | null;
  record: string;
}

/** Son kayıt/revizyon, onay ve denetim izinden EN YENİSİ — DB'nin kendi satırları. */
function recoverablePoint(last: BackupManifest["last_committed_record"]): RecoverablePoint {
  const candidates: { at: number; record: string }[] = [];
  if (last.work_entry_revision) {
    const r = last.work_entry_revision;
    candidates.push({ at: Date.parse(r.created_at), record: `work_entry_revision/${r.entry_id}/${r.version}` });
  }
  if (last.cash_confirmation) {
    const c = last.cash_confirmation;
    candidates.push({ at: Date.parse(c.confirmed_at), record: `cash_confirmation/${c.entry_id}/${c.entry_version}` });
  }
  if (last.admin_audit) {
    candidates.push({ at: Date.parse(last.admin_audit.occurred_at), record: `admin_audit/${last.admin_audit.id}` });
  }
  const newest = candidates
    .filter((candidate) => !Number.isNaN(candidate.at))
    .sort((a, b) => b.at - a.at)[0];
  return newest === undefined
    ? { at: null, record: "none" }
    : { at: new Date(newest.at).toISOString(), record: newest.record };
}

/** Parola hash'i OKUNMAZ: yalnız kimlik, plaka/kullanıcı adı, aktiflik ve credential_version. */
function logLoginPrincipals(copy: InstanceType<typeof Database>): void {
  const credentials = copy
    .prepare(
      `SELECT vc.id, vc.role, vc.credential_version, v.plate_normalized, v.active AS vehicle_active,
         b.active AS business_active
       FROM vehicle_credentials vc
       JOIN vehicles v ON v.business_id = vc.business_id AND v.id = vc.vehicle_id
       JOIN businesses b ON b.id = vc.business_id
       ORDER BY v.plate_normalized, vc.role`,
    )
    .all() as {
    id: string;
    role: string;
    credential_version: number;
    plate_normalized: string;
    vehicle_active: number;
    business_active: number;
  }[];
  for (const row of credentials) {
    log("info", "restore_principal", {
      kind: "vehicle_credential",
      id: row.id,
      plate: row.plate_normalized,
      role: row.role,
      vehicle_active: row.vehicle_active === 1,
      business_active: row.business_active === 1,
      credential_version: row.credential_version,
    });
  }
  const users = copy
    .prepare("SELECT id, username, platform_role, active, credential_version FROM platform_users ORDER BY username")
    .all() as { id: string; username: string; platform_role: string; active: number; credential_version: number }[];
  for (const row of users) {
    log("info", "restore_principal", {
      kind: "platform_user",
      id: row.id,
      username: row.username,
      role: row.platform_role,
      active: row.active === 1,
      credential_version: row.credential_version,
    });
  }
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

interface CheckedCopy {
  manifest: BackupManifest;
  copyPath: string;
  verified: VerifiedCopy;
  point: RecoverablePoint;
}

function readManifestArg(manifestArg: string): { manifest: BackupManifest; copyPath: string } {
  const manifestPath = path.resolve(manifestArg);
  let text: string;
  try {
    text = fs.readFileSync(manifestPath, "utf8");
  } catch (error) {
    reject("manifest_unreadable", error instanceof Error ? error.message : String(error));
  }
  const manifest = parseManifest(text);
  if (manifest === null || path.basename(manifestPath) !== manifestFileName(manifest.stem)) {
    reject("manifest_invalid", "Manifest geçerli bir yedek manifesti değil veya adı stem ile uyuşmuyor.");
  }
  // parseManifest `file === copyFileName(stem)` kontrol etti; yol ancak şimdi kurulur.
  const copyPath = path.join(path.dirname(manifestPath), manifest.file);
  if (!fs.existsSync(copyPath)) {
    reject("copy_missing", "Manifestin kopyası yok.", { stem: manifest.stem });
  }
  return { manifest, copyPath };
}

/** `verifyCopy` yalnız eksik migration'ı yakalar; kopyada bu release'in bilmediği migration da olmamalı. */
function assertSchemaIsRelease(copyPath: string): void {
  const releaseHashes = new Set(readMigrationFiles({ migrationsFolder }).map((migration) => migration.hash));
  const copy = new Database(copyPath, { readonly: true, fileMustExist: true });
  try {
    const applied = copy.prepare("SELECT hash FROM __drizzle_migrations").all() as { hash: string }[];
    const unknown = applied.filter((row) => !releaseHashes.has(row.hash)).length;
    if (unknown > 0) {
      reject("schema_not_current", "Kopyada bu release'in migration'larında olmayan migration var.", {
        unknown_migrations: unknown,
      });
    }
  } finally {
    copy.close();
  }
}

/**
 * Araç dönem raporunun (her araç × kayıt yılı) toplamları kopyanın
 * `work_entries` toplamlarına eşit olmalı. "Alınan", manifestin bütün
 * onayları toplayan `received_cents`'iyle DEĞİL, raporla aynı tanımla
 * (şoför kaydının GÜNCEL sürümündeki onay) karşılaştırılır. Tutarlar
 * ondalık metin; toplama BigInt ile.
 */
async function assertReportTotalsMatch(copyPath: string, verified: VerifiedCopy): Promise<number> {
  const { selectVehiclePeriodTotals } = await import("../src/server/usecases/reports/vehicle-period.ts");
  const { resolveReportPeriod } = await import("../src/lib/report-period.ts");
  const sqlite = new Database(copyPath, { readonly: true, fileMustExist: true });
  try {
    const db = createDb(sqlite);
    const targets = sqlite
      .prepare(
        `SELECT DISTINCT we.business_id AS businessId, we.vehicle_id AS vehicleId,
           substr(we.work_date, 1, 4) AS year,
           (SELECT vc.id FROM vehicle_credentials vc
             WHERE vc.business_id = we.business_id AND vc.vehicle_id = we.vehicle_id AND vc.role = 'owner') AS credentialId
         FROM work_entries we ORDER BY businessId, vehicleId, year`,
      )
      .all() as { businessId: string; vehicleId: string; year: string; credentialId: string | null }[];

    const sums = { entries: 0n, gross: 0n, fuel: 0n, other: 0n, share: 0n, remainder: 0n, received: 0n };
    for (const target of targets) {
      if (target.credentialId === null) {
        reject("owner_credential_missing", "Kayıtları olan bir aracın sahip girişi yok.", {
          vehicle_id: target.vehicleId,
        });
      }
      const period = resolveReportPeriod("year", `${target.year}-01-01`);
      if (period === null) {
        reject("report_totals_mismatch", "Bir iş kaydının work_date yılı rapor dönemine çevrilemiyor.", {
          vehicle_id: target.vehicleId,
          year: target.year,
        });
      }
      const scope = {
        kind: "vehicle",
        actor: "owner",
        businessId: target.businessId,
        vehicleId: target.vehicleId,
        credentialId: target.credentialId,
      } as const;
      const row = selectVehiclePeriodTotals(db, scope, period).get();
      if (!row) reject("report_totals_mismatch", "Rapor toplam satırı dönmedi.");
      sums.entries += BigInt(row.entryCount);
      sums.gross += BigInt(row.grossCents);
      sums.fuel += BigInt(row.fuelCents);
      sums.other += BigInt(row.otherExpenseCents);
      sums.share += BigInt(row.shareCents);
      sums.remainder += BigInt(row.remainderCents);
      sums.received += BigInt(row.confirmedReceivedCents);
    }

    const currentDriverReceived = sqlite
      .prepare(
        `SELECT CAST(COALESCE(SUM(cc.received_cents), 0) AS TEXT) AS received
         FROM work_entries we
         JOIN cash_confirmations cc
           ON cc.business_id = we.business_id AND cc.entry_id = we.id AND cc.entry_version = we.version
         WHERE we.work_kind = 'driver'`,
      )
      .get() as { received: string };

    const comparisons: [string, bigint, string][] = [
      ["work_entries", sums.entries, String(verified.rowCounts.work_entries ?? 0)],
      ["gross_cents", sums.gross, verified.totals.gross_cents ?? ""],
      ["fuel_cents", sums.fuel, verified.totals.fuel_cents ?? ""],
      ["other_expense_cents", sums.other, verified.totals.other_expense_cents ?? ""],
      ["share_cents", sums.share, verified.totals.share_cents ?? ""],
      ["remainder_cents", sums.remainder, verified.totals.remainder_cents ?? ""],
      ["confirmed_received_cents", sums.received, currentDriverReceived.received],
    ];
    for (const [field, report, copy] of comparisons) {
      if (report.toString() !== copy) {
        reject("report_totals_mismatch", "Araç dönem raporu toplamı kopyanın toplamından farklı.", {
          field,
          report: report.toString(),
          copy,
        });
      }
    }
    return targets.length;
  } finally {
    sqlite.close();
  }
}

async function checkCopy(manifestArg: string): Promise<CheckedCopy> {
  const { manifest, copyPath } = readManifestArg(manifestArg);

  const actual = sha256OfFile(copyPath);
  if (actual.sha256 !== manifest.sha256 || actual.size !== manifest.size_bytes) {
    reject("copy_hash_mismatch", "Kopyanın sha256/boyutu manifestle uyuşmuyor.", {
      stem: manifest.stem,
      manifest_size: manifest.size_bytes,
      actual_size: actual.size,
    });
  }

  const releaseId = path.basename(fs.realpathSync(process.cwd()));
  if (manifest.release_id !== releaseId) {
    reject("release_mismatch", "Kopya başka bir release ile uyumlu; o release dizininden çalıştırın.", {
      manifest_release: manifest.release_id,
      running_release: releaseId,
    });
  }

  const verified = verifyCopy(copyPath, migrationsFolder);
  assertSchemaIsRelease(copyPath);
  const periods = await assertReportTotalsMatch(copyPath, verified);

  if (!isDeepStrictEqual(manifest.last_committed_record, verified.lastRecord)) {
    reject("manifest_record_mismatch", "Manifestteki son kayıt kopyanın kendi satırlarıyla uyuşmuyor.", {
      stem: manifest.stem,
    });
  }

  const copy = new Database(copyPath, { readonly: true, fileMustExist: true });
  try {
    logLoginPrincipals(copy);
  } finally {
    copy.close();
  }

  const point = recoverablePoint(verified.lastRecord);
  log("info", "restore_verified", {
    stem: manifest.stem,
    release_id: releaseId,
    recoverable_point: point.at ?? "none",
    recoverable_record: point.record,
    work_entries: verified.rowCounts.work_entries ?? 0,
    report_periods: periods,
    unchecked_entries: verified.uncheckedEntries,
  });
  return { manifest, copyPath, verified, point };
}

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

function existingDir(value: string, reason: string): string {
  const dir = path.resolve(value);
  if (!isDirectory(dir)) reject(reason, `Dizin yok: "${dir}". Otomatik oluşturulmaz.`);
  return dir;
}

function lockWaitSeconds(env: Env): number {
  const raw = env.DOLMUS_OPS_LOCK_WAIT;
  if (raw === undefined || raw === "") return DEFAULT_OPS_LOCK_WAIT_SECONDS;
  const seconds = Number(raw);
  if (!/^\d+$/u.test(raw) || seconds > 3600) {
    reject("usage", `DOLMUS_OPS_LOCK_WAIT 0–3600 arası tam saniye olmalı: "${raw}".`);
  }
  return seconds;
}

/**
 * Ortak kilidi `flock` ile alır: dosya bu süreçte açılır, `flock` aynı açık
 * dosyayı (fd 3) kilitleyip çıkar; kilit açık dosyaya bağlıdır ve bu süreç
 * kapatana/çıkana dek tutulur. Kilit dosyası yoksa oluşturulmaz.
 */
function acquireOpsLock(env: Env): number {
  const lockPath = path.resolve(env.DOLMUS_OPS_LOCK || DEFAULT_OPS_LOCK);
  const wait = lockWaitSeconds(env);
  let fd: number;
  try {
    fd = fs.openSync(lockPath, "r");
  } catch (error) {
    reject("ops_lock_missing", error instanceof Error ? error.message : String(error));
  }
  const result = spawnSync("flock", ["-w", String(wait), "-E", String(LOCK_BUSY_EXIT), "3"], {
    stdio: ["ignore", "ignore", "pipe", fd],
    encoding: "utf8",
  });
  if (result.error) {
    fs.closeSync(fd);
    reject("ops_lock_unavailable", `flock çalıştırılamadı: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fs.closeSync(fd);
    if (result.status === LOCK_BUSY_EXIT) {
      reject("ops_lock_busy", "Ortak işletim kilidi süresinde alınamadı; başka bir yayın/yedek/restore sürüyor.", {
        wait_seconds: wait,
      });
    }
    reject("ops_lock_unavailable", `flock başarısız (exit ${result.status}): ${result.stderr.trim()}`);
  }
  return fd;
}

function assertMaintenanceOn(env: Env): void {
  const marker = path.resolve(env.DOLMUS_MAINTENANCE_FILE || DEFAULT_MAINTENANCE_FILE);
  if (!fs.existsSync(marker) || !fs.statSync(marker).isFile()) {
    reject("maintenance_off", "Bakım işareti yok; müşteri trafiği açıkken restore yapılmaz.", { marker });
  }
}

function assertServiceStopped(reason: string): void {
  const result = spawnSync("systemctl", ["is-active", APP_SERVICE], { encoding: "utf8" });
  if (result.error) {
    reject("service_state_unknown", `systemctl çalıştırılamadı: ${result.error.message}`);
  }
  const state = result.stdout.trim() || "unknown";
  if (!STOPPED_SERVICE_STATES.includes(state)) {
    reject(reason, "Uygulama servisi durdurulmuş değil.", { service: APP_SERVICE, state });
  }
}

/** Geçici kopyadaki BÜTÜN oturumlar iptal; uygulama bu dosyayı henüz hiç açmadı. */
function revokeSessionsInStaging(staging: string): number {
  const sqlite = new Database(staging, { fileMustExist: true });
  try {
    const revoked = revokeAllSessionsSync(createDb(sqlite));
    assertNoOpenSessions(sqlite);
    return revoked;
  } finally {
    sqlite.close();
  }
}

function assertNoOpenSessions(sqlite: InstanceType<typeof Database>): void {
  const { open } = sqlite.prepare("SELECT COUNT(*) AS open FROM sessions WHERE revoked_at IS NULL").get() as {
    open: number;
  };
  if (open !== 0) {
    reject("sessions_not_revoked", "Restore edilen DB'de iptal edilmemiş oturum kaldı.", { open });
  }
}

/** Canlı DB dosyalarını SİLMEDEN `preserved/<zaman>/` altına taşır. */
function preserveLiveFiles(dbPath: string, preservedRoot: string, stamp: string): { dir: string; moved: number } {
  const dir = path.join(preservedRoot, stamp);
  try {
    fs.mkdirSync(dir, { mode: 0o750 });
  } catch (error) {
    reject("preserve_failed", error instanceof Error ? error.message : String(error), { preserved: dir });
  }
  let moved = 0;
  try {
    for (const suffix of LIVE_SUFFIXES) {
      const source = `${dbPath}${suffix}`;
      if (!fs.existsSync(source)) continue;
      fs.renameSync(source, path.join(dir, path.basename(source)));
      moved += 1;
    }
    fsyncPath(dir);
    fsyncPath(preservedRoot);
    fsyncPath(path.dirname(dbPath));
  } catch (error) {
    reject("preserve_failed", error instanceof Error ? error.message : String(error), { preserved: dir, moved });
  }
  for (const suffix of LIVE_SUFFIXES) {
    if (fs.existsSync(`${dbPath}${suffix}`)) {
      reject("live_db_present", "Canlı DB dosyası taşındıktan sonra yeniden belirdi.", {
        file: path.basename(`${dbPath}${suffix}`),
        preserved: dir,
      });
    }
  }
  return { dir, moved };
}

async function runInstall(manifestArg: string, env: Env): Promise<void> {
  const dbPath = path.resolve(resolveDbPathFromEnv(env));
  const dataDir = existingDir(path.dirname(dbPath), "data_dir_missing");
  if (fs.statSync(dataDir).uid !== process.getuid?.()) {
    reject("data_dir_owner_mismatch", "Veri dizininin sahibi bu kullanıcı değil; servis kullanıcısıyla çalıştırın.");
  }
  const preservedRoot = existingDir(env.DOLMUS_PRESERVED_DIR || DEFAULT_PRESERVED_DIR, "preserved_dir_missing");

  const lockFd = acquireOpsLock(env);
  try {
    assertMaintenanceOn(env);
    assertServiceStopped("service_active");
    const checked = await checkCopy(manifestArg);

    const staging = path.join(dataDir, `.dolmus-restore-tmp-${checked.manifest.stem}.${process.pid}.sqlite`);
    let revoked: number;
    let preserved: { dir: string; moved: number };
    try {
      fs.copyFileSync(checked.copyPath, staging, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(staging, 0o600);
      const staged = sha256OfFile(staging);
      if (staged.sha256 !== checked.manifest.sha256 || staged.size !== checked.manifest.size_bytes) {
        reject("copy_hash_mismatch", "Veri dizinine alınan kopya manifestle uyuşmuyor.", { stem: checked.manifest.stem });
      }
      revoked = revokeSessionsInStaging(staging);
      fsyncPath(staging);

      preserved = preserveLiveFiles(dbPath, preservedRoot, compactUtc(new Date()));
      try {
        // link var olan hedefin üzerine YAZMAZ (EEXIST); rename yazardı.
        fs.linkSync(staging, dbPath);
      } catch (error) {
        reject("install_failed", error instanceof Error ? error.message : String(error), {
          preserved: preserved.dir,
        });
      }
      fsyncPath(dataDir);
    } finally {
      for (const suffix of ["", "-journal"]) {
        fs.rmSync(`${staging}${suffix}`, { force: true });
      }
    }

    const installed = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      assertNoOpenSessions(installed);
    } finally {
      installed.close();
    }
    assertServiceStopped("service_started_during_install");

    log("info", "restore_installed", {
      stem: checked.manifest.stem,
      release_id: checked.manifest.release_id,
      recoverable_point: checked.point.at ?? "none",
      recoverable_record: checked.point.record,
      revoked_sessions: revoked,
      preserved: preserved.dir,
      preserved_files: preserved.moved,
    });
  } finally {
    fs.closeSync(lockFd);
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function runReport(flags: Map<string, string>, env: Env): void {
  const startedAt = parseInstant(requiredFlag(flags, "--started-at"), "--started-at");
  const incidentRaw = flags.get("--incident-at");
  const incidentAt = incidentRaw === undefined ? null : parseInstant(incidentRaw, "--incident-at");
  const dbPath = path.resolve(resolveDbPathFromEnv(env));
  if (!fs.existsSync(dbPath)) reject("db_missing", "Canlı DB yok; boş DB oluşturulmaz.");

  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  let point: RecoverablePoint;
  let activeSessions: number;
  try {
    point = recoverablePoint(readLastCommittedRecord(sqlite));
    activeSessions = (
      sqlite.prepare("SELECT COUNT(*) AS open FROM sessions WHERE revoked_at IS NULL").get() as { open: number }
    ).open;
  } finally {
    sqlite.close();
  }

  const now = new Date();
  let lossWindow = "unknown";
  if (incidentAt !== null && point.at !== null) {
    const lossMs = incidentAt.getTime() - Date.parse(point.at);
    if (lossMs < 0) {
      reject("incident_before_recoverable_point", "Olay zamanı kurtarılabilir noktadan önce; zamanları denetleyin.", {
        incident_at: incidentAt.toISOString(),
        recoverable_point: point.at,
      });
    }
    lossWindow = String(Math.floor(lossMs / 1000));
  }

  log("info", "restore_record", {
    recoverable_point: point.at ?? "none",
    recoverable_record: point.record,
    recovery_started_at: startedAt.toISOString(),
    reported_at: now.toISOString(),
    recovery_duration_s: Math.floor((now.getTime() - startedAt.getTime()) / 1000),
    incident_at: incidentAt?.toISOString() ?? "unknown",
    loss_window_s: lossWindow,
    active_sessions: activeSessions,
  });
}

// ---------------------------------------------------------------------------

let command = "";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  command = parsed.command;
  if (process.getuid?.() === 0) {
    reject("run_as_root", "DB komutları root olarak çalıştırılmaz; sudo -u dolmus-takip kullanın.");
  }
  if (command === "verify") {
    await checkCopy(requiredFlag(parsed.flags, "--manifest"));
  } else if (command === "install") {
    await runInstall(requiredFlag(parsed.flags, "--manifest"), process.env);
  } else {
    runReport(parsed.flags, process.env);
  }
}

main().catch((error: unknown) => {
  const reason = error instanceof CopyRejectedError ? error.reason : "unexpected_error";
  const fields: Fields = error instanceof CopyRejectedError ? error.fields : {};
  const message = error instanceof Error ? error.message : String(error);
  log("err", "restore_failed", { command: command || "none", reason, ...fields, message });
  process.exitCode = reason === "ops_lock_busy" ? LOCK_BUSY_EXIT : 1;
});
