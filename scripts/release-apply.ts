/**
 * Kontrollü yayın ve geri dönüş — `node scripts/release-apply.ts <komut>`
 * (T6.5, S6.5; RELEASE.md §5 ve §7, SERVER-SETUP.md §4, ARCHITECTURE "Flow:
 * Daily backup, restore and release").
 *
 * Root olarak, YENİ release dizininden çalışır
 * (`cd /opt/dolmus-takip/releases/<id> && sudo node scripts/release-apply.ts deploy`).
 * Root kanıtı yayın durumu dizinidir: dizin bu sürecin kullanıcısına ait ve
 * yalnız ona açık (`0700`) değilse komut reddedilir (SERVER-SETUP §2:
 * `root:root 0700`). DB'ye dokunan her adım servis kullanıcısıyla
 * (`runuser -u dolmus-takip`, argüman dizisiyle; kabuk yok) ve
 * `--env-file=/etc/dolmus-takip/app.env` ile çalışır; bu araç canlı DB
 * dosyalarını kendisi açmaz, taşımaz, silmez.
 *
 * Değiştiren her komut ortak işletim kilidini (`./lib/ops-lock.ts`, alınamazsa
 * 75) tutar ve yayın durumunu (`release-state/state.json`: release_id,
 * previous_release_id, pre_migration, migrations_applied, phase, fingerprint,
 * traffic_opened_at, verified_at, rollback, inherited; zamanlar UTC ISO) her
 * fazda atomik yazar.
 * Başarısızlıkta bakım işareti YERİNDE kalır ve başarısız faz kaydedilir.
 *
 * ## `deploy`
 *
 * `current` var ve yeni release değil, kurtarma kilidi yok, release manifesti
 * (`releases/<id>.manifest.json`) release dizinindeki migration dosyalarıyla
 * aynı → kilit → önceki yayın çözülmüş (trafik açık/doğrulanmış/geri
 * alınmış), bakım işareti yok → durum yazılır → bakım işareti (Caddy yeni
 * istekleri keser) → servis durdurulur → ESKİ (çalışan) release'in
 * `db-backup.ts pre-migration`'ı doğrulanmış yayın öncesi kopyayı üretir
 * (yeni release'in doğrulaması eski şemayı `schema_not_current` diye
 * reddederdi); kopya başarısızsa eski release bakım altında yeniden
 * başlatılır ve durulur → DB parmak izi → yeni release'in
 * `db-init.ts --existing`'i TEK kez → uygulanan migration sayısı DB'den
 * (kopya manifestiyle fark) → mali kontrol → `current` geçici bağ + rename
 * (atomik) → başlat → localhost live/ready → salt okunur mali kontrol
 * (`inspect`: integrity, foreign key, şema bu release'inki, pay/kalan,
 * toplamlar/korunan satır sayıları/son kayıt kopya manifestiyle AYNI,
 * parmak izi migration sonrasıyla AYNI) → `traffic_opened_at` yazılır →
 * bakım işareti kalkar.
 *
 * `deploy --under-maintenance`: bakım işareti ZATEN varken (RELEASE §7 F5
 * ileri düzeltmesi, işareti bir insan koydu) yalnız bu bayrakla yayımlanır ve
 * işaret mali kontrolden sonra kalkar; işaret yoksa bayrak reddedilir. Önceki
 * yayın çözülmemişse (`previous_release_unresolved`) veya durum dosyası
 * okunamıyorsa (`state_unreadable`) düz `deploy` reddeder; bu bayrak o durumu
 * DEVRALIR: eski `state.json` baytları üzerine yazılmadan aynı dizine
 * `taken-over-<zaman>.json` olarak kopyalanır, sha256'sı ve özeti (release,
 * faz, hata, `pre_migration`, `traffic_opened_at`) yeni durumun `inherited`
 * listesine yazılır. Kurtarma kilidi yine reddeder.
 *
 * ## `rollback --code` | `rollback --code-and-db`
 *
 * Geri alınan (yeni) release'in dizininden. `--code`: yalnız bu yayın hiç
 * migration uygulamadıysa (DB'den ölçülen sayı 0; bilinmiyorsa ret).
 * `--code-and-db`: yalnız trafik hiç açılmadıysa ve kilit altında, işaret
 * varken, servis durmuşken okunan canlı DB parmak izi kayıtlı olanla aynıysa;
 * yayın öncesi kopya ESKİ release'in `db-restore.ts install`'ıyla yerleşir
 * (canlı DB/WAL `preserved/` altına taşınır, bütün oturumlar uygulama
 * başlamadan iptal edilir; kilit devralınan tanıtıcıyla) ve yerleşen DB'nin
 * parmak izi servis başlamadan `rollback.restored_fingerprint`'e yazılır.
 * Sonraki bir adım düşerse aynı komut yeniden denenir: canlı parmak izi bu
 * kayda eşitse `install` tekrarlanmadan `current` değişiminden devam edilir,
 * ikisinden de farklıysa `fingerprint_mismatch`. Durum dosyası okunamıyorsa
 * müşteri yazması kabul edilmiş sayılır: DB geri dönüşü yok. Sonra `current`
 * eski release'e, başlat, live/ready, mali kontrol, trafik.
 *
 * ## `mark-verified`, `cleanup`
 *
 * `mark-verified`: trafiği açık yayının yayın sonrası doğrulandığını kaydeder.
 * `cleanup`: `current`, bu dizin, durumun release'i, doğrulanmadan önce önceki
 * release ve yayın öncesi kopyası ile devralınan (`inherited`) durumların
 * release'leri ve yayın öncesi kopyası, `backup-ready`/`pre-migration`'da
 * tutulan bir manifestin `release_id`'si SİLİNMEZ; doğrulanmadan önce
 * devralınan durumlardan biri okunamamışsa hiçbir kopya/release, okunamayan/
 * yarım manifest varsa hiçbir şey silinmez.
 *
 * ## `inspect [--release <dizin>]` (servis kullanıcısıyla; aracın kendi adımı)
 *
 * Canlı DB'yi salt okunur, tek okuma işleminde açar: bütün tabloların
 * içeriğinden parmak izi, uygulanmış migration sayısı ve `--release`
 * verilmişse o release'in `drizzle/`'ına göre kontroller ve toplamlar. Tek
 * JSON satırı yazar; karar yayın aracınındır.
 *
 * ## Ortam
 *
 * Varsayılanlar SERVER-SETUP §2 yollarıdır; değişkenler yalnız test/deneme
 * içindir: `DOLMUS_RELEASES_DIR`, `DOLMUS_CURRENT_LINK`, `DOLMUS_APP_ENV_FILE`,
 * `DOLMUS_RELEASE_STATE_DIR`, `DOLMUS_PRE_MIGRATION_DIR`,
 * `DOLMUS_BACKUP_READY_DIR`, `DOLMUS_PRESERVED_DIR`, `DOLMUS_MAINTENANCE_FILE`,
 * `DOLMUS_RECOVERY_LOCK`, `DOLMUS_OPS_LOCK`, `DOLMUS_OPS_LOCK_WAIT`,
 * `DOLMUS_APP_URL` (yalnız `http://127.0.0.1:<port>`),
 * `DOLMUS_READINESS_TIMEOUT` (sn).
 *
 * `systemctl reset-failed` hiçbir yolda çağrılmaz: başlatma sınırı
 * (`start-limit-hit`) birim durumuyla hata olarak yazılır, sayacı yalnız
 * insan sıfırlar (OPS §5-B). Import ağacı `release-build.ts`
 * `bundleDbInitIntoStandalone`'da eksiksiz kopyalanır.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import Database from "better-sqlite3";
import { resolveDbPathFromEnv } from "../src/server/data/db.ts";
import {
  findRowCountDrops,
  formatLogLine,
  GUARDED_TABLES,
  groupBackupSets,
  manifestFileName,
  parseManifest,
  type BackupManifest,
  type LogLevel,
} from "./lib/backup-schedule.ts";
import {
  CopyRejectedError,
  countUnknownMigrations,
  sha256OfFile,
  verifyDatabase,
  type Fields,
} from "./lib/copy-verification.ts";
import { acquireOpsLock, LOCK_BUSY_EXIT } from "./lib/ops-lock.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Bu aracın çalıştığı release dizini (`releases/<id>`). */
const selfReleaseDir = fs.realpathSync(path.resolve(__dirname, ".."));

const APP_SERVICE = "dolmus-takip.service";
const SERVICE_USER = "dolmus-takip";
const STOPPED_SERVICE_STATES: readonly string[] = ["inactive", "failed"];
const DEFAULT_RELEASES_DIR = "/opt/dolmus-takip/releases";
const DEFAULT_CURRENT_LINK = "/opt/dolmus-takip/current";
const DEFAULT_APP_ENV_FILE = "/etc/dolmus-takip/app.env";
const DEFAULT_RELEASE_STATE_DIR = "/var/lib/dolmus-takip/release-state";
const DEFAULT_PRE_MIGRATION_DIR = "/var/lib/dolmus-takip/pre-migration";
const DEFAULT_BACKUP_READY_DIR = "/var/lib/dolmus-takip/backup-ready";
const DEFAULT_PRESERVED_DIR = "/var/lib/dolmus-takip/preserved";
const DEFAULT_MAINTENANCE_FILE = "/var/lib/dolmus-takip/maintenance";
const DEFAULT_RECOVERY_LOCK = "/var/lib/dolmus-takip/health/recovery.lock";
const DEFAULT_OPS_LOCK = "/var/lib/dolmus-takip/ops.lock";
const DEFAULT_APP_URL = "http://127.0.0.1:3000";
const DEFAULT_READINESS_TIMEOUT_SECONDS = 120;
const STATE_FILE = "state.json";
/** release-id = arşiv adındaki kısa commit (SERVER-SETUP §2). */
const RELEASE_ID_PATTERN = /^[0-9a-f]{7,40}$/u;
const RELEASE_MANIFEST_SUFFIX = ".manifest.json";
const MIGRATION_FILE_PATTERN = /^[\w.-]+\.sql$/u;

const USAGE =
  "Kullanım: release-apply.ts deploy [--under-maintenance] | rollback --code | rollback --code-and-db | " +
  "mark-verified | cleanup | inspect [--release <dizin>]";

type Env = Record<string, string | undefined>;

function log(level: LogLevel, event: string, fields: Fields = {}): void {
  console.log(formatLogLine(level, event, fields, new Date(), "dolmus-release"));
}

function reject(reason: string, message: string, fields: Fields = {}): never {
  throw new CopyRejectedError(reason, message, fields);
}

const nowIso = (): string => new Date().toISOString();

function fsyncPath(target: string): void {
  const fd = fs.openSync(target, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function isDirectory(dir: string): boolean {
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

// ---------------------------------------------------------------------------
// Argümanlar ve yollar
// ---------------------------------------------------------------------------

type Command =
  | { name: "deploy"; underMaintenance: boolean }
  | { name: "rollback"; mode: "code" | "code-and-db" }
  | { name: "mark-verified" }
  | { name: "cleanup" }
  | { name: "inspect"; release: string | null };

function parseArgs(argv: readonly string[]): Command {
  const [name = "", ...rest] = argv;
  if (name === "deploy") {
    if (rest.length === 0) return { name, underMaintenance: false };
    if (rest.length === 1 && rest[0] === "--under-maintenance") return { name, underMaintenance: true };
    reject("usage", USAGE, { argument: rest[0]! });
  }
  if (name === "mark-verified" || name === "cleanup") {
    if (rest.length > 0) reject("usage", USAGE, { argument: rest[0]! });
    return { name };
  }
  if (name === "rollback") {
    if (rest.length === 1 && rest[0] === "--code") return { name, mode: "code" };
    if (rest.length === 1 && rest[0] === "--code-and-db") return { name, mode: "code-and-db" };
    reject("usage", USAGE, { argument: rest[0] ?? "none" });
  }
  if (name === "inspect") {
    if (rest.length === 0) return { name, release: null };
    if (rest.length === 2 && rest[0] === "--release" && rest[1] !== "") return { name, release: rest[1]! };
    reject("usage", USAGE, { argument: rest[0]! });
  }
  reject("usage", USAGE);
}

interface Paths {
  releasesDir: string;
  currentLink: string;
  appEnvFile: string;
  stateDir: string;
  preMigrationDir: string;
  backupReadyDir: string;
  preservedDir: string;
  maintenanceFile: string;
  recoveryLock: string;
  opsLock: string;
  appUrl: string;
  readinessTimeoutMs: number;
}

function resolveAppUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    reject("usage", `DOLMUS_APP_URL geçerli bir adres değil: "${raw}".`);
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/") {
    reject("usage", `DOLMUS_APP_URL yalnız http://127.0.0.1:<port> olabilir: "${raw}".`);
  }
  return url.origin;
}

function resolveReadinessTimeout(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_READINESS_TIMEOUT_SECONDS * 1000;
  const seconds = Number(raw);
  if (!/^\d+$/u.test(raw) || seconds < 1 || seconds > 3600) {
    reject("usage", `DOLMUS_READINESS_TIMEOUT 1–3600 arası tam saniye olmalı: "${raw}".`);
  }
  return seconds * 1000;
}

function resolvePaths(env: Env): Paths {
  const pick = (value: string | undefined, fallback: string) => path.resolve(value || fallback);
  return {
    releasesDir: pick(env.DOLMUS_RELEASES_DIR, DEFAULT_RELEASES_DIR),
    currentLink: pick(env.DOLMUS_CURRENT_LINK, DEFAULT_CURRENT_LINK),
    appEnvFile: pick(env.DOLMUS_APP_ENV_FILE, DEFAULT_APP_ENV_FILE),
    stateDir: pick(env.DOLMUS_RELEASE_STATE_DIR, DEFAULT_RELEASE_STATE_DIR),
    preMigrationDir: pick(env.DOLMUS_PRE_MIGRATION_DIR, DEFAULT_PRE_MIGRATION_DIR),
    backupReadyDir: pick(env.DOLMUS_BACKUP_READY_DIR, DEFAULT_BACKUP_READY_DIR),
    preservedDir: pick(env.DOLMUS_PRESERVED_DIR, DEFAULT_PRESERVED_DIR),
    maintenanceFile: pick(env.DOLMUS_MAINTENANCE_FILE, DEFAULT_MAINTENANCE_FILE),
    recoveryLock: pick(env.DOLMUS_RECOVERY_LOCK, DEFAULT_RECOVERY_LOCK),
    opsLock: pick(env.DOLMUS_OPS_LOCK, DEFAULT_OPS_LOCK),
    appUrl: resolveAppUrl(env.DOLMUS_APP_URL || DEFAULT_APP_URL),
    readinessTimeoutMs: resolveReadinessTimeout(env.DOLMUS_READINESS_TIMEOUT),
  };
}

/** Yayın durumu dizini bu kullanıcıya ait ve yalnız ona açık olmalı (üretimde root:root 0700). */
function assertPrivateStateDir(paths: Paths): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(paths.stateDir);
  } catch {
    reject("state_dir_missing", `Yayın durumu dizini yok: "${paths.stateDir}". Otomatik oluşturulmaz.`);
  }
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    reject(
      "state_dir_not_private",
      "Yayın durumu dizini bu kullanıcıya ait ve 0700 değil; yayın aracı root olarak çalıştırılır.",
      { dir: paths.stateDir, mode: (stat.mode & 0o777).toString(8) },
    );
  }
}

// ---------------------------------------------------------------------------
// Yayın durumu
// ---------------------------------------------------------------------------

type Phase =
  | "maintenance"
  | "pre_migration"
  | "migrating"
  | "switched"
  | "started"
  | "traffic_open"
  | "verified"
  | "rolling_back"
  | "rolled_back";

const PHASES: readonly Phase[] = [
  "maintenance",
  "pre_migration",
  "migrating",
  "switched",
  "started",
  "traffic_open",
  "verified",
  "rolling_back",
  "rolled_back",
];
/** Yeni yayına izin veren (bakımı kapanmış) durumlar. */
const RESOLVED_PHASES: readonly Phase[] = ["traffic_open", "verified", "rolled_back"];

interface ReleaseState {
  state_version: 1;
  release_id: string;
  previous_release_id: string;
  phase: Phase;
  started_at: string;
  updated_at: string;
  /** Yayın öncesi kopyanın manifest stem'i (`pre-migration/<stem>.manifest.json`). */
  pre_migration: string | null;
  /** DB'den ölçülen, bu yayının uyguladığı migration sayısı; `null` = bilinmiyor. */
  migrations_applied: number | null;
  /** Aracın servis durmuşken veya mali kontrolde gördüğü son DB içeriği. */
  fingerprint: string | null;
  traffic_opened_at: string | null;
  verified_at: string | null;
  rollback: {
    mode: "code" | "code-and-db";
    started_at: string;
    finished_at: string | null;
    preserved: string | null;
    /** `db-restore install`'ın yerleştirdiği DB'nin parmak izi (servis durmuşken okundu). */
    restored_fingerprint: string | null;
  } | null;
  failure: { phase: Phase; reason: string; at: string } | null;
  /** `deploy --under-maintenance`'ın devraldığı çözülmemiş/okunamayan durumlar (RELEASE §7 F5). */
  inherited: InheritedState[];
}

interface InheritedState {
  kind: "unresolved" | "unreadable";
  /** Devralınan `state.json` baytlarının release-state dizinindeki kopyası ve sha256'sı. */
  file: string;
  sha256: string;
  taken_over_at: string;
  release_id: string | null;
  previous_release_id: string | null;
  phase: Phase | null;
  failure: string | null;
  pre_migration: string | null;
  traffic_opened_at: string | null;
}

type StateRead = { kind: "absent" } | { kind: "unreadable" } | { kind: "ok"; state: ReleaseState };

const TAKEN_OVER_FILE_PATTERN = /^taken-over-\d{8}T\d{9}Z\.json$/u;

const isIsoOrNull = (value: unknown): boolean =>
  value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));

const isStringOrAbsent = (value: unknown): boolean => value === undefined || value === null || typeof value === "string";

const isReleaseIdOrNull = (value: unknown): boolean =>
  value === null || (typeof value === "string" && RELEASE_ID_PATTERN.test(value));

function isInheritedState(value: unknown): boolean {
  const e = value as Record<string, unknown> | null;
  return (
    typeof e === "object" &&
    e !== null &&
    (e.kind === "unresolved" || e.kind === "unreadable") &&
    typeof e.file === "string" &&
    TAKEN_OVER_FILE_PATTERN.test(e.file) &&
    typeof e.sha256 === "string" &&
    /^[0-9a-f]{64}$/u.test(e.sha256) &&
    typeof e.taken_over_at === "string" &&
    isIsoOrNull(e.taken_over_at) &&
    isReleaseIdOrNull(e.release_id) &&
    isReleaseIdOrNull(e.previous_release_id) &&
    (e.phase === null || PHASES.includes(e.phase as Phase)) &&
    (e.failure === null || typeof e.failure === "string") &&
    (e.pre_migration === null || typeof e.pre_migration === "string") &&
    isIsoOrNull(e.traffic_opened_at)
  );
}

function readState(paths: Paths): StateRead {
  const file = path.join(paths.stateDir, STATE_FILE);
  if (!fs.existsSync(file)) return { kind: "absent" };
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { kind: "unreadable" };
  }
  const s = value as Record<string, unknown> | null;
  const valid =
    typeof s === "object" &&
    s !== null &&
    s.state_version === 1 &&
    typeof s.release_id === "string" &&
    RELEASE_ID_PATTERN.test(s.release_id) &&
    typeof s.previous_release_id === "string" &&
    RELEASE_ID_PATTERN.test(s.previous_release_id) &&
    PHASES.includes(s.phase as Phase) &&
    (s.pre_migration === null || typeof s.pre_migration === "string") &&
    (s.migrations_applied === null || (Number.isSafeInteger(s.migrations_applied) && (s.migrations_applied as number) >= 0)) &&
    (s.fingerprint === null || typeof s.fingerprint === "string") &&
    isIsoOrNull(s.traffic_opened_at) &&
    isIsoOrNull(s.verified_at) &&
    (s.failure === null || typeof s.failure === "object") &&
    (s.rollback === null ||
      (typeof s.rollback === "object" && isStringOrAbsent((s.rollback as Record<string, unknown>).restored_fingerprint))) &&
    (s.inherited === undefined || (Array.isArray(s.inherited) && s.inherited.every(isInheritedState)));
  if (!valid) return { kind: "unreadable" };
  // Bu alanlardan önce yazılmış durum dosyaları: kayıt yok = null / boş liste.
  const state = s as unknown as ReleaseState;
  return {
    kind: "ok",
    state: {
      ...state,
      rollback: state.rollback === null ? null : { ...state.rollback, restored_fingerprint: state.rollback.restored_fingerprint ?? null },
      inherited: state.inherited ?? [],
    },
  };
}

/** Geçici dosya + fsync + rename + dizin fsync: yarım yazılmış durum dosyası olmaz. */
function writeState(paths: Paths, state: ReleaseState): ReleaseState {
  const next = { ...state, updated_at: nowIso() };
  const file = path.join(paths.stateDir, STATE_FILE);
  const tmp = path.join(paths.stateDir, `.${STATE_FILE}.${process.pid}`);
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(next, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fsyncPath(paths.stateDir);
  log("info", "release_state", {
    release_id: next.release_id,
    phase: next.phase,
    failure: next.failure?.reason ?? "none",
  });
  return next;
}

const isResolved = (state: ReleaseState): boolean =>
  state.failure === null && RESOLVED_PHASES.includes(state.phase);

// ---------------------------------------------------------------------------
// Release dizinleri
// ---------------------------------------------------------------------------

function releaseIdOf(dir: string, paths: Paths): string {
  const id = path.basename(dir);
  const parent = fs.realpathSync(paths.releasesDir);
  if (path.dirname(dir) !== parent || !RELEASE_ID_PATTERN.test(id)) {
    reject("not_a_release_dir", "Dizin releases altında kısa commit adlı bir release değil.", { dir });
  }
  return id;
}

/** `current`'ın gösterdiği release; ilk kurulum SERVER-SETUP §3.4'tür. */
function currentReleaseDir(paths: Paths): string {
  let isLink = false;
  try {
    isLink = fs.lstatSync(paths.currentLink).isSymbolicLink();
  } catch {
    // yok
  }
  if (!isLink) {
    reject("current_missing", "current sembolik bağı yok; ilk kurulum SERVER-SETUP §3.4 ile yapılır.");
  }
  const dir = fs.realpathSync(paths.currentLink);
  releaseIdOf(dir, paths);
  return dir;
}

/** Release manifesti var ve release dizinindeki migration dosyaları onunla aynı. */
function assertReleaseManifest(paths: Paths, releaseId: string, releaseDir: string): void {
  const file = path.join(paths.releasesDir, `${releaseId}${RELEASE_MANIFEST_SUFFIX}`);
  let manifest: { source_commit?: unknown; schema?: { migration_sha256_list?: unknown } };
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    reject("release_manifest_missing", error instanceof Error ? error.message : String(error), { release_id: releaseId });
  }
  const list = manifest.schema?.migration_sha256_list;
  if (
    typeof manifest.source_commit !== "string" ||
    !manifest.source_commit.startsWith(releaseId) ||
    !Array.isArray(list) ||
    list.length === 0
  ) {
    reject("release_manifest_mismatch", "Release manifesti bu release'e ait değil.", { release_id: releaseId });
  }
  for (const entry of list as { file?: unknown; sha256?: unknown }[]) {
    const name = entry.file;
    if (typeof name !== "string" || !MIGRATION_FILE_PATTERN.test(name)) {
      reject("release_manifest_mismatch", "Release manifestinde geçersiz migration adı.", { release_id: releaseId });
    }
    const migration = path.join(releaseDir, "drizzle", name);
    if (!fs.existsSync(migration) || sha256OfFile(migration).sha256 !== entry.sha256) {
      reject("release_manifest_mismatch", "Release dizinindeki migration dosyası manifestle uyuşmuyor.", {
        release_id: releaseId,
        file: name,
      });
    }
  }
}

/** Geçici sembolik bağ + rename (`ln -sfn` + `mv -T` ile aynı atomik değişim). */
function switchCurrent(paths: Paths, targetDir: string): void {
  if (fs.realpathSync(paths.currentLink) === targetDir) return;
  const tmp = `${paths.currentLink}.tmp`;
  try {
    if (fs.lstatSync(tmp).isSymbolicLink()) fs.unlinkSync(tmp);
    else reject("current_tmp_exists", "Geçici current yolu sembolik bağ olmayan bir dosya.", { path: tmp });
  } catch (error) {
    if (error instanceof CopyRejectedError) throw error;
    // yok: beklenen durum
  }
  fs.symlinkSync(targetDir, tmp);
  fs.renameSync(tmp, paths.currentLink);
  fsyncPath(path.dirname(paths.currentLink));
  if (fs.realpathSync(paths.currentLink) !== targetDir) {
    reject("current_switch_failed", "current hedef release'i göstermiyor.", { target: path.basename(targetDir) });
  }
  log("info", "release_current_switched", { release_id: path.basename(targetDir) });
}

// ---------------------------------------------------------------------------
// Bakım işareti, servis ve hazırlık
// ---------------------------------------------------------------------------

function ensureMarker(paths: Paths): void {
  if (!fs.existsSync(paths.maintenanceFile)) {
    fs.writeFileSync(paths.maintenanceFile, "", { flag: "wx", mode: 0o644 });
    fs.chmodSync(paths.maintenanceFile, 0o644);
    fsyncPath(path.dirname(paths.maintenanceFile));
  }
  if (!fs.statSync(paths.maintenanceFile).isFile()) {
    reject("maintenance_marker_invalid", "Bakım işareti bir dosya değil.", { marker: paths.maintenanceFile });
  }
  log("info", "release_maintenance_on", { marker: paths.maintenanceFile });
}

function removeMarker(paths: Paths): void {
  try {
    fs.unlinkSync(paths.maintenanceFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  fsyncPath(path.dirname(paths.maintenanceFile));
  if (fs.existsSync(paths.maintenanceFile)) {
    reject("maintenance_marker_stuck", "Bakım işareti kaldırılamadı.", { marker: paths.maintenanceFile });
  }
}

function systemctl(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("systemctl", args, { encoding: "utf8" });
  if (result.error) {
    reject("service_state_unknown", `systemctl çalıştırılamadı: ${result.error.message}`);
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Birim durumu (hata satırlarına eklenir; `Result=start-limit-hit` burada görünür). */
function unitFields(): Fields {
  const shown = systemctl(["show", APP_SERVICE, "-p", "ActiveState", "-p", "SubState", "-p", "Result"]);
  const fields: Fields = {};
  for (const line of shown.stdout.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) fields[`unit_${line.slice(0, at).toLowerCase()}`] = line.slice(at + 1);
  }
  return fields;
}

function serviceState(): string {
  return systemctl(["is-active", APP_SERVICE]).stdout.trim() || "unknown";
}

function stopService(): void {
  const stop = systemctl(["stop", APP_SERVICE]);
  const state = serviceState();
  if (stop.status !== 0 || !STOPPED_SERVICE_STATES.includes(state)) {
    reject("service_stop_failed", "Uygulama servisi durdurulamadı.", { state, ...unitFields() });
  }
  log("info", "release_service_stopped", { service: APP_SERVICE });
}

/** Kurtarma kilidi varken başlatılmaz (birimin AssertPathExists'i zaten reddeder). */
function startService(paths: Paths): void {
  if (fs.existsSync(paths.recoveryLock)) {
    reject("recovery_lock_present", "Sağlık görevinin kurtarma kilidi var; yalnız ekip kaldırır (OPS §5-B).", {
      lock: paths.recoveryLock,
    });
  }
  const start = systemctl(["start", APP_SERVICE]);
  if (start.status !== 0) {
    reject("service_start_failed", start.stderr.trim().split("\n")[0] || "systemctl start başarısız.", unitFields());
  }
  log("info", "release_service_started", { service: APP_SERVICE });
}

async function probe(url: string): Promise<string> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    return String(response.status);
  } catch (error) {
    return error instanceof Error ? error.name : "error";
  }
}

/** live ve ready AYNI turda 200 olana dek; servis düşerse beklemeden reddeder. */
async function waitForReadiness(paths: Paths): Promise<void> {
  const deadline = Date.now() + paths.readinessTimeoutMs;
  for (;;) {
    const [live, ready] = await Promise.all([
      probe(`${paths.appUrl}/api/v1/health/live`),
      probe(`${paths.appUrl}/api/v1/health/ready`),
    ]);
    if (live === "200" && ready === "200") {
      log("info", "release_ready", { live, ready });
      return;
    }
    const state = serviceState();
    if (state === "failed" || Date.now() >= deadline) {
      reject("readiness_failed", "Uygulama localhost live/ready'de hazır olmadı.", { live, ready, state, ...unitFields() });
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// ---------------------------------------------------------------------------
// Servis kullanıcısıyla alt komutlar
// ---------------------------------------------------------------------------

interface ChildResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** `runuser -u dolmus-takip -- node --env-file=<app.env> <args>`; kabuk yok. */
function runAsServiceUser(
  paths: Paths,
  cwd: string,
  args: string[],
  options: { lockFd?: number; echo?: boolean; env?: Record<string, string> } = {},
): ChildResult {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DOLMUS_MAINTENANCE_FILE: paths.maintenanceFile,
    DOLMUS_PRESERVED_DIR: paths.preservedDir,
    DOLMUS_OPS_LOCK: paths.opsLock,
    ...options.env,
  };
  if (options.lockFd !== undefined) env.DOLMUS_OPS_LOCK_FD = "3";
  const result = spawnSync(
    "runuser",
    ["-u", SERVICE_USER, "--", process.execPath, `--env-file=${paths.appEnvFile}`, ...args],
    {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: options.lockFd === undefined ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe", options.lockFd],
    },
  );
  if (result.error) {
    reject("service_user_command_failed", `runuser çalıştırılamadı: ${result.error.message}`);
  }
  if (options.echo !== false) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** logfmt satırından alan: `event=<event>` satırındaki `<key>=` değeri. */
function eventField(stdout: string, event: string, key: string): string | undefined {
  const line = stdout.split("\n").find((l) => l.includes(` event=${event} `) || l.endsWith(` event=${event}`));
  const match = line === undefined ? null : new RegExp(`(?:^| )${key}=(\\S*)`, "u").exec(line);
  return match?.[1];
}

function childReason(stdout: string): string {
  return /(?:^| )reason=(\S+)/mu.exec(stdout)?.[1] ?? "unknown";
}

interface VerifiedView {
  applied_migrations: number;
  row_counts: Record<string, number>;
  totals: Record<string, string>;
  last_committed_record: BackupManifest["last_committed_record"];
  unchecked_entries: number;
}

interface Inspection {
  fingerprint: string;
  applied_migrations: number;
  verified: VerifiedView | null;
  check_failure: { reason: string; message: string } | null;
}

function inspectLiveDb(paths: Paths, schemaReleaseDir: string | null): Inspection {
  const args = ["scripts/release-apply.ts", "inspect", ...(schemaReleaseDir ? ["--release", schemaReleaseDir] : [])];
  const result = runAsServiceUser(paths, selfReleaseDir, args, { echo: false });
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    reject("inspect_failed", "Canlı DB servis kullanıcısıyla okunamadı.", { child_reason: childReason(result.stdout) });
  }
  let parsed: Inspection;
  try {
    parsed = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "") as Inspection;
  } catch {
    reject("inspect_failed", "inspect çıktısı JSON değil.");
  }
  if (typeof parsed.fingerprint !== "string" || !Number.isSafeInteger(parsed.applied_migrations)) {
    reject("inspect_failed", "inspect çıktısı beklenen biçimde değil.");
  }
  return parsed;
}

/** `--release` ile çağrılan inspect'in kontrolleri geçmiş olmalı. */
function requireVerified(inspection: Inspection): VerifiedView {
  if (inspection.check_failure !== null || inspection.verified === null) {
    reject(inspection.check_failure?.reason ?? "inspect_failed", inspection.check_failure?.message ?? "Kontrol sonucu yok.");
  }
  return inspection.verified;
}

/** Trafik açılmadan: toplamlar, korunan tabloların satır sayısı ve son kayıt kopyanın manifestiyle AYNI. */
function assertSameAsManifest(verified: VerifiedView, manifest: BackupManifest): void {
  for (const [field, expected] of Object.entries(manifest.totals)) {
    if (verified.totals[field] !== expected) {
      reject("financial_smoke_failed", "Canlı DB mali toplamı yayın öncesi kopyadan farklı.", {
        field,
        expected,
        actual: verified.totals[field] ?? "none",
      });
    }
  }
  for (const table of GUARDED_TABLES) {
    const expected = manifest.row_counts[table] ?? 0;
    const actual = verified.row_counts[table] ?? 0;
    if (actual !== expected) {
      reject("financial_smoke_failed", "Canlı DB korunan tablo satır sayısı yayın öncesi kopyadan farklı.", {
        field: table,
        expected,
        actual,
      });
    }
  }
  if (!isDeepStrictEqual(verified.last_committed_record, manifest.last_committed_record)) {
    reject("financial_smoke_failed", "Canlı DB son kaydı yayın öncesi kopyadan farklı.", {
      field: "last_committed_record",
    });
  }
}

/** Trafik açıldıktan sonra: korunan tablolarda kopyaya göre azalma yok. */
function assertNoDropSinceManifest(verified: VerifiedView, manifest: BackupManifest): void {
  const drops = findRowCountDrops(manifest.row_counts, verified.row_counts);
  if (drops.length > 0) {
    reject("financial_smoke_failed", "Korunan bir tablonun satır sayısı yayın öncesi kopyadan az.", {
      field: drops[0]!.table,
      expected: drops[0]!.previous,
      actual: drops[0]!.current,
    });
  }
}

/** Manifest geçerli, kopyası var ve hash/boyut aynı; `release_id` beklenen (eski) release. */
function readPreMigrationManifest(paths: Paths, stem: string, expectedReleaseId: string): BackupManifest {
  const manifestPath = path.join(paths.preMigrationDir, manifestFileName(stem));
  let manifest: BackupManifest | null = null;
  try {
    manifest = parseManifest(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    // aşağıda reddedilir
  }
  if (manifest === null || manifest.stem !== stem) {
    reject("pre_migration_invalid", "Yayın öncesi kopyanın manifesti okunamıyor.", { stem });
  }
  const copyPath = path.join(paths.preMigrationDir, manifest.file);
  const actual = fs.existsSync(copyPath) ? sha256OfFile(copyPath) : null;
  if (actual === null || actual.sha256 !== manifest.sha256 || actual.size !== manifest.size_bytes) {
    reject("pre_migration_invalid", "Yayın öncesi kopya yok veya manifestle uyuşmuyor.", { stem });
  }
  if (manifest.release_id !== expectedReleaseId) {
    reject("pre_migration_invalid", "Yayın öncesi kopya önceki release'e ait değil.", {
      stem,
      manifest_release: manifest.release_id,
      expected_release: expectedReleaseId,
    });
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// deploy
// ---------------------------------------------------------------------------

function takePreMigrationCopy(paths: Paths, previousDir: string, previousId: string): BackupManifest {
  const result = runAsServiceUser(paths, previousDir, ["scripts/db-backup.ts", "pre-migration"], {
    env: { DOLMUS_BACKUP_DIR: paths.preMigrationDir },
  });
  const stem = result.status === 0 ? eventField(result.stdout, "backup_published", "stem") : undefined;
  if (stem === undefined) {
    reject("pre_migration_failed", "Önceki release yayın öncesi kopyayı üretemedi.", {
      exit: result.status ?? "signal",
      child_reason: childReason(result.stdout),
    });
  }
  return readPreMigrationManifest(paths, stem, previousId);
}

/**
 * F5 devralması: önceki `state.json`'un baytları üzerine yazılmadan önce aynı
 * (0700) dizine `taken-over-<zaman>.json` olarak kopyalanır ve hash'lenir;
 * `traffic_opened_at`, yayın öncesi kopya ve başarısız faz insanın inceleyeceği
 * kanıttır (RELEASE §7 F5 adım 3).
 */
function keepTakenOverState(paths: Paths, prior: StateRead): InheritedState {
  const bytes = fs.readFileSync(path.join(paths.stateDir, STATE_FILE));
  const at = nowIso();
  const file = `taken-over-${at.replace(/[-:.]/gu, "")}.json`;
  const fd = fs.openSync(path.join(paths.stateDir, file), "wx", 0o600);
  try {
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncPath(paths.stateDir);
  const state = prior.kind === "ok" ? prior.state : null;
  const entry: InheritedState = {
    kind: state === null ? "unreadable" : "unresolved",
    file,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    taken_over_at: at,
    release_id: state?.release_id ?? null,
    previous_release_id: state?.previous_release_id ?? null,
    phase: state?.phase ?? null,
    failure: state?.failure?.reason ?? null,
    pre_migration: state?.pre_migration ?? null,
    traffic_opened_at: state?.traffic_opened_at ?? null,
  };
  log("warn", "release_state_taken_over", {
    kind: entry.kind,
    file: entry.file,
    sha256: entry.sha256,
    release_id: entry.release_id ?? "unknown",
    phase: entry.phase ?? "unknown",
    failure: entry.failure ?? "none",
  });
  return entry;
}

function newState(releaseId: string, previousId: string, inherited: InheritedState[]): ReleaseState {
  const at = nowIso();
  return {
    state_version: 1,
    release_id: releaseId,
    previous_release_id: previousId,
    phase: "maintenance",
    started_at: at,
    updated_at: at,
    pre_migration: null,
    migrations_applied: null,
    fingerprint: null,
    traffic_opened_at: null,
    verified_at: null,
    rollback: null,
    failure: null,
    inherited,
  };
}

/** `traffic_opened_at` işaret kalkmadan ÖNCE yazılır: yarıda kalırsa müşteri yazması kabul edilmiş sayılır. */
function openTraffic(paths: Paths, state: ReleaseState, changes: Partial<ReleaseState>): ReleaseState {
  const opened = writeState(paths, {
    ...state,
    ...changes,
    traffic_opened_at: state.traffic_opened_at ?? nowIso(),
  });
  removeMarker(paths);
  log("info", "release_traffic_opened", {
    release_id: opened.release_id,
    current: path.basename(fs.realpathSync(paths.currentLink)),
    traffic_opened_at: opened.traffic_opened_at!,
  });
  return opened;
}

/** Durum dosyası oluşturulduktan sonraki her hata fazıyla kaydedilir; bakım işareti yerinde kalır. */
async function withFailureRecord(
  paths: Paths,
  holder: { state: ReleaseState | null },
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (holder.state !== null) {
      const reason = error instanceof CopyRejectedError ? error.reason : "unexpected_error";
      writeState(paths, { ...holder.state, failure: { phase: holder.state.phase, reason, at: nowIso() } });
    }
    throw error;
  }
}

async function runDeploy(paths: Paths, env: Env, underMaintenance: boolean): Promise<void> {
  const releaseId = releaseIdOf(selfReleaseDir, paths);
  assertReleaseManifest(paths, releaseId, selfReleaseDir);
  if (!fs.existsSync(paths.appEnvFile)) reject("app_env_missing", "Uygulama ayar dosyası yok.", { file: paths.appEnvFile });
  if (fs.existsSync(paths.recoveryLock)) {
    reject("recovery_lock_present", "Sağlık görevinin kurtarma kilidi var; yalnız ekip kaldırır (OPS §5-B).");
  }

  const lockFd = acquireOpsLock(env, DEFAULT_OPS_LOCK);
  const holder: { state: ReleaseState | null } = { state: null };
  try {
    const prior = readState(paths);
    // Çözülmemiş veya okunamayan önceki durumu yalnız F5 kararı (--under-maintenance, işaret varken) devralır.
    const takeOver = prior.kind === "unreadable" || (prior.kind === "ok" && !isResolved(prior.state));
    if (!underMaintenance && prior.kind === "unreadable") {
      reject("state_unreadable", "Önceki yayın durumu okunamıyor (F5 düzeltmesi: --under-maintenance).");
    }
    if (!underMaintenance && prior.kind === "ok" && !isResolved(prior.state)) {
      reject("previous_release_unresolved", "Önceki yayın çözülmedi (bakımda); önce geri dönüş veya ekip kararı.", {
        release_id: prior.state.release_id,
        phase: prior.state.phase,
        failure: prior.state.failure?.reason ?? "none",
      });
    }
    // Var olan işaret bir insanın bakım kararıdır: yayın onu yalnız açık bayrakla devralır (RELEASE §7 F5).
    if (!underMaintenance && fs.existsSync(paths.maintenanceFile)) {
      reject("maintenance_already_on", "Bakım işareti zaten var; başka bir bakım sürüyor olabilir (F5 düzeltmesi: --under-maintenance).");
    }
    if (underMaintenance && !fs.existsSync(paths.maintenanceFile)) {
      reject("maintenance_off", "--under-maintenance verildi ama bakım işareti yok.");
    }
    if (fs.existsSync(paths.recoveryLock)) {
      reject("recovery_lock_present", "Sağlık görevinin kurtarma kilidi var; yalnız ekip kaldırır (OPS §5-B).");
    }
    const previousDir = currentReleaseDir(paths);
    const previousId = path.basename(previousDir);
    if (previousDir === selfReleaseDir) reject("already_current", "Bu release zaten current.", { release_id: releaseId });

    log("info", "release_deploy_start", {
      release_id: releaseId,
      previous_release_id: previousId,
      under_maintenance: underMaintenance,
    });
    // Devralınan durumun kendi devraldıkları da taşınır: zincir doğrulanana dek hepsi korunur.
    const inherited = takeOver
      ? [...(prior.kind === "ok" ? prior.state.inherited : []), keepTakenOverState(paths, prior)]
      : [];
    holder.state = writeState(paths, newState(releaseId, previousId, inherited));
    await withFailureRecord(paths, holder, async () => {
      // İşaret servis durmadan ÖNCE: Caddy yeni istekleri keser, süreç SIGTERM'de süren istekleri bitirir.
      ensureMarker(paths);
      stopService();

      holder.state = writeState(paths, { ...holder.state!, phase: "pre_migration" });
      let manifest: BackupManifest;
      try {
        manifest = takePreMigrationCopy(paths, previousDir, previousId);
      } catch (error) {
        // db-init hiç çalışmadı: bu yayının uyguladığı migration 0 (kod dönüşü bakımdan çıkış yoludur).
        holder.state = writeState(paths, { ...holder.state!, migrations_applied: 0 });
        // Eski release current'ta kalır; bakım altında yeniden başlatılır.
        try {
          startService(paths);
        } catch (startError) {
          const fields = startError instanceof CopyRejectedError ? startError.fields : {};
          log("err", "release_restart_previous_failed", {
            reason: startError instanceof CopyRejectedError ? startError.reason : "unexpected_error",
            ...fields,
          });
        }
        throw error;
      }
      const before = inspectLiveDb(paths, null);
      holder.state = writeState(paths, {
        ...holder.state!,
        phase: "migrating",
        pre_migration: manifest.stem,
        fingerprint: before.fingerprint,
      });
      log("info", "release_pre_migration_copy", { stem: manifest.stem, release_id: manifest.release_id });

      const init = runAsServiceUser(paths, selfReleaseDir, ["scripts/db-init.ts", "--existing"]);
      if (init.status !== 0) reject("migration_failed", "db-init --existing başarısız.", { exit: init.status ?? "signal" });
      const migrated = inspectLiveDb(paths, selfReleaseDir);
      const applied = migrated.applied_migrations - manifest.schema.applied_migrations;
      holder.state = writeState(paths, {
        ...holder.state!,
        fingerprint: migrated.fingerprint,
        migrations_applied: applied >= 0 ? applied : null,
      });
      if (applied < 0) reject("migration_count_decreased", "Uygulanmış migration sayısı kopyadakinden az.");
      assertSameAsManifest(requireVerified(migrated), manifest);
      log("info", "release_migrated", { migrations_applied: applied });

      switchCurrent(paths, selfReleaseDir);
      holder.state = writeState(paths, { ...holder.state!, phase: "switched" });
      startService(paths);
      holder.state = writeState(paths, { ...holder.state!, phase: "started" });
      await waitForReadiness(paths);

      const smoke = inspectLiveDb(paths, selfReleaseDir);
      const verified = requireVerified(smoke);
      if (smoke.fingerprint !== holder.state.fingerprint) {
        reject("db_changed_before_traffic", "Trafik açılmadan canlı DB değişti.");
      }
      assertSameAsManifest(verified, manifest);
      log("info", "release_financial_smoke", { work_entries: verified.row_counts.work_entries ?? 0 });

      holder.state = openTraffic(paths, holder.state, { phase: "traffic_open" });
    });
  } finally {
    fs.closeSync(lockFd);
  }
}

// ---------------------------------------------------------------------------
// rollback
// ---------------------------------------------------------------------------

function readStateOrReject(paths: Paths): ReleaseState {
  const read = readState(paths);
  if (read.kind === "absent") reject("no_release_state", "Yayın durumu kaydı yok.");
  if (read.kind === "unreadable") {
    reject(
      "state_unreadable",
      "Yayın durumu okunamıyor; müşteri yazması kabul edilmiş sayılır, eski DB'ye otomatik dönülmez (RELEASE §7).",
    );
  }
  return read.state;
}

async function runRollback(paths: Paths, env: Env, mode: "code" | "code-and-db"): Promise<void> {
  const selfId = releaseIdOf(selfReleaseDir, paths);
  const lockFd = acquireOpsLock(env, DEFAULT_OPS_LOCK);
  const holder: { state: ReleaseState | null } = { state: null };
  try {
    const state = readStateOrReject(paths);
    if (state.release_id !== selfId) {
      reject("wrong_release_dir", "Geri dönüş, geri alınan release'in dizininden çalıştırılır.", {
        state_release: state.release_id,
        running_release: selfId,
      });
    }
    if (state.phase === "rolled_back") reject("already_rolled_back", "Bu yayın zaten geri alındı.");
    const previousDir = path.join(fs.realpathSync(paths.releasesDir), state.previous_release_id);
    if (!isDirectory(previousDir)) {
      reject("previous_release_missing", "Önceki release dizini yok.", { release_id: state.previous_release_id });
    }

    let manifest: BackupManifest | null = null;
    if (mode === "code") {
      if (state.migrations_applied === null) {
        reject("migrations_unknown", "Bu yayının uyguladığı migration sayısı bilinmiyor; kod dönüşü şema uyumunu kanıtlamaz.");
      }
      if (state.migrations_applied > 0) {
        reject("migrations_applied", "Bu yayın migration uyguladı; yalnız kod dönüşü eski kodu yeni şemada açardı.", {
          migrations_applied: state.migrations_applied,
        });
      }
      if (state.pre_migration !== null) {
        manifest = readPreMigrationManifest(paths, state.pre_migration, state.previous_release_id);
      }
    } else {
      if (state.traffic_opened_at !== null) {
        reject("traffic_opened", "Trafik açıldı; müşteri yazması kabul edilmiş olabilir, eski DB'ye dönülmez (RELEASE §7 F5).", {
          traffic_opened_at: state.traffic_opened_at,
        });
      }
      if (state.pre_migration === null) reject("pre_migration_missing", "Doğrulanmış yayın öncesi kopya yok.");
      if (state.fingerprint === null) reject("fingerprint_missing", "Kayıtlı DB parmak izi yok.");
      manifest = readPreMigrationManifest(paths, state.pre_migration, state.previous_release_id);
    }
    if (fs.existsSync(paths.recoveryLock)) {
      reject("recovery_lock_present", "Sağlık görevinin kurtarma kilidi var; yalnız ekip kaldırır (OPS §5-B).");
    }

    log("info", "release_rollback_start", { mode, release_id: state.release_id, target: state.previous_release_id });
    // Önceki denemenin yerleştirdiği DB'nin kaydı taşınır: yeniden deneme yalnız ona dayanır.
    const earlier = state.rollback;
    holder.state = writeState(paths, {
      ...state,
      phase: "rolling_back",
      rollback: {
        mode,
        started_at: nowIso(),
        finished_at: null,
        preserved: earlier?.preserved ?? null,
        restored_fingerprint: earlier?.restored_fingerprint ?? null,
      },
      failure: null,
    });
    await withFailureRecord(paths, holder, async () => {
      ensureMarker(paths);
      stopService();

      if (mode === "code-and-db") {
        // Parmak izi kilit altında, işaret varken ve servis durmuşken okunur.
        const live = inspectLiveDb(paths, null);
        if (
          typeof earlier?.preserved === "string" &&
          typeof earlier.restored_fingerprint === "string" &&
          live.fingerprint === earlier.restored_fingerprint
        ) {
          // Önceki deneme kopyayı yerleştirdi ve DB o andan beri değişmedi: install tekrarlanmaz.
          log("info", "release_rollback_resume", { preserved: earlier.preserved });
        } else {
          if (live.fingerprint !== state.fingerprint) {
            reject("fingerprint_mismatch", "Canlı DB kayıtlı parmak izinden farklı; yazma kabul edilmiş olabilir, eski DB'ye dönülmez.");
          }
          const install = runAsServiceUser(
            paths,
            previousDir,
            ["scripts/db-restore.ts", "install", "--manifest", path.join(paths.preMigrationDir, manifestFileName(state.pre_migration!))],
            { lockFd },
          );
          const preserved = install.status === 0 ? eventField(install.stdout, "restore_installed", "preserved") : undefined;
          if (preserved === undefined) {
            reject("db_restore_failed", "Önceki release yayın öncesi kopyayı yerleştiremedi.", {
              exit: install.status ?? "signal",
              child_reason: childReason(install.stdout),
            });
          }
          holder.state = writeState(paths, {
            ...holder.state!,
            rollback: { ...holder.state!.rollback!, preserved, restored_fingerprint: null },
          });
          // Yerleşen DB'nin parmak izi servis başlamadan okunur; sonraki bir adım düşerse yeniden deneme buna dayanır.
          const restored = inspectLiveDb(paths, null);
          holder.state = writeState(paths, {
            ...holder.state!,
            rollback: { ...holder.state!.rollback!, restored_fingerprint: restored.fingerprint },
          });
        }
      }

      switchCurrent(paths, previousDir);
      startService(paths);
      await waitForReadiness(paths);

      const smoke = inspectLiveDb(paths, previousDir);
      const verified = requireVerified(smoke);
      if (mode === "code-and-db" || state.traffic_opened_at === null) {
        if (mode === "code" && state.fingerprint !== null && smoke.fingerprint !== state.fingerprint) {
          reject("db_changed_before_traffic", "Trafik açılmadan canlı DB değişti.");
        }
        if (manifest !== null) assertSameAsManifest(verified, manifest);
      } else if (manifest !== null) {
        assertNoDropSinceManifest(verified, manifest);
      }
      log("info", "release_financial_smoke", { work_entries: verified.row_counts.work_entries ?? 0 });

      holder.state = openTraffic(paths, holder.state!, {
        phase: "rolled_back",
        fingerprint: smoke.fingerprint,
        rollback: { ...holder.state!.rollback!, finished_at: nowIso() },
      });
    });
  } finally {
    fs.closeSync(lockFd);
  }
}

// ---------------------------------------------------------------------------
// mark-verified
// ---------------------------------------------------------------------------

function runMarkVerified(paths: Paths, env: Env): void {
  const lockFd = acquireOpsLock(env, DEFAULT_OPS_LOCK);
  try {
    const state = readStateOrReject(paths);
    if (state.phase !== "traffic_open" || state.failure !== null) {
      reject("not_traffic_open", "Yalnız trafiği açık, hatasız yayın doğrulandı olarak işaretlenir.", {
        phase: state.phase,
        failure: state.failure?.reason ?? "none",
      });
    }
    const verified = writeState(paths, { ...state, phase: "verified", verified_at: nowIso() });
    log("info", "release_verified", { release_id: verified.release_id, verified_at: verified.verified_at! });
  } finally {
    fs.closeSync(lockFd);
  }
}

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

/** Dizindeki bütün kopya/manifest setleri; yarım set veya okunamayan manifest varsa ret. */
function readKeptManifests(dir: string): { stem: string; manifest: BackupManifest }[] {
  if (!isDirectory(dir)) reject("manifest_dir_missing", "Kopya dizini yok.", { dir });
  const sets: { stem: string; manifest: BackupManifest }[] = [];
  for (const set of groupBackupSets(fs.readdirSync(dir))) {
    if (!set.hasCopy || !set.hasManifest) {
      reject("manifest_unreadable", "Yarım kopya/manifest seti var; hangi release'e bağlı olduğu bilinemez.", {
        dir,
        stem: set.stem,
      });
    }
    let manifest: BackupManifest | null = null;
    try {
      manifest = parseManifest(fs.readFileSync(path.join(dir, manifestFileName(set.stem)), "utf8"));
    } catch {
      // aşağıda reddedilir
    }
    if (manifest === null || manifest.stem !== set.stem) {
      reject("manifest_unreadable", "Manifest okunamıyor; hiçbir şey silinmez.", { dir, stem: set.stem });
    }
    sets.push({ stem: set.stem, manifest });
  }
  return sets;
}

function runCleanup(paths: Paths, env: Env): void {
  const lockFd = acquireOpsLock(env, DEFAULT_OPS_LOCK);
  try {
    const read = readState(paths);
    if (read.kind === "unreadable") reject("state_unreadable", "Yayın durumu okunamıyor; hiçbir şey silinmez.");
    const state = read.kind === "ok" ? read.state : null;
    const unverified = state !== null && state.verified_at === null;
    // F5'te devralınan durumların kopyası ve release'leri bu yayın doğrulanana dek tutulur.
    const inherited = unverified ? state!.inherited : [];
    // Okunamayan bir durum devralındıysa neyi koruduğu bilinmez: doğrulanana dek hiçbir kopya/release silinmez.
    const keepAll = inherited.some((entry) => entry.kind === "unreadable");

    const keepReleases = new Map<string, string>();
    keepReleases.set(path.basename(currentReleaseDir(paths)), "current");
    if (!keepReleases.has(path.basename(selfReleaseDir))) keepReleases.set(path.basename(selfReleaseDir), "running");
    if (state !== null) {
      if (!keepReleases.has(state.release_id)) keepReleases.set(state.release_id, "release_state");
      if (unverified && !keepReleases.has(state.previous_release_id)) {
        keepReleases.set(state.previous_release_id, "previous_not_verified");
      }
    }
    for (const entry of inherited) {
      for (const id of [entry.release_id, entry.previous_release_id]) {
        if (id !== null && !keepReleases.has(id)) keepReleases.set(id, "inherited_state");
      }
    }

    const preMigration = readKeptManifests(paths.preMigrationDir);
    const backups = readKeptManifests(paths.backupReadyDir);
    const removeCopies: string[] = [];
    const kept: BackupManifest[] = backups.map((set) => set.manifest);
    for (const set of preMigration) {
      if (unverified && set.stem === state!.pre_migration) {
        log("info", "cleanup_kept", { pre_migration: set.stem, reason: "previous_not_verified" });
        kept.push(set.manifest);
      } else if (keepAll || inherited.some((entry) => entry.pre_migration === set.stem)) {
        log("info", "cleanup_kept", { pre_migration: set.stem, reason: keepAll ? "inherited_state_unreadable" : "inherited_state" });
        kept.push(set.manifest);
      } else {
        removeCopies.push(set.stem);
      }
    }
    for (const manifest of kept) {
      if (!keepReleases.has(manifest.release_id)) keepReleases.set(manifest.release_id, `manifest_${manifest.stem}`);
    }

    const releasesDir = fs.realpathSync(paths.releasesDir);
    const releaseIds = new Set<string>();
    for (const entry of fs.readdirSync(releasesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && RELEASE_ID_PATTERN.test(entry.name)) releaseIds.add(entry.name);
      if (entry.isFile() && entry.name.endsWith(RELEASE_MANIFEST_SUFFIX)) {
        const id = entry.name.slice(0, -RELEASE_MANIFEST_SUFFIX.length);
        if (RELEASE_ID_PATTERN.test(id)) releaseIds.add(id);
      }
    }

    let removedCopies = 0;
    let removedReleases = 0;
    try {
      for (const stem of removeCopies) {
        const manifest = preMigration.find((set) => set.stem === stem)!.manifest;
        fs.rmSync(path.join(paths.preMigrationDir, manifestFileName(stem)));
        fs.rmSync(path.join(paths.preMigrationDir, manifest.file));
        removedCopies += 1;
        log("info", "cleanup_removed", { pre_migration: stem, release_id: manifest.release_id });
      }
      if (removedCopies > 0) fsyncPath(paths.preMigrationDir);
      for (const id of [...releaseIds].sort()) {
        const reason = keepReleases.get(id) ?? (keepAll ? "inherited_state_unreadable" : undefined);
        if (reason !== undefined) {
          log("info", "cleanup_kept", { release_id: id, reason });
          continue;
        }
        fs.rmSync(path.join(releasesDir, id), { recursive: true, force: true });
        fs.rmSync(path.join(releasesDir, `${id}${RELEASE_MANIFEST_SUFFIX}`), { force: true });
        removedReleases += 1;
        log("info", "cleanup_removed", { release_id: id });
      }
      fsyncPath(releasesDir);
    } catch (error) {
      reject("cleanup_failed", error instanceof Error ? error.message : String(error), {
        removed_copies: removedCopies,
        removed_releases: removedReleases,
      });
    }
    log("info", "cleanup_done", { removed_copies: removedCopies, removed_releases: removedReleases });
  } finally {
    fs.closeSync(lockFd);
  }
}

// ---------------------------------------------------------------------------
// inspect (servis kullanıcısıyla)
// ---------------------------------------------------------------------------

type Connection = InstanceType<typeof Database>;

/** Her tablonun bütün satırları, tablo adı ve bütün sütunlara göre sıralı; tek sha256. */
function contentFingerprint(sqlite: Connection): string {
  const hash = crypto.createHash("sha256");
  const tables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
    )
    .all() as { name: string }[];
  for (const { name } of tables) {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    const columns = (sqlite.pragma(`table_info(${quoted})`) as unknown[]).length;
    const order = Array.from({ length: columns }, (_, i) => String(i + 1)).join(", ");
    hash.update(`table ${name} ${columns}\n`);
    const rows = sqlite.prepare(`SELECT * FROM ${quoted} ORDER BY ${order}`).raw(true).safeIntegers(true).iterate();
    for (const row of rows as IterableIterator<unknown[]>) {
      hash.update(
        `${JSON.stringify(row, (_key, value: unknown) => (typeof value === "bigint" ? { int: value.toString() } : value))}\n`,
      );
    }
  }
  return hash.digest("hex");
}

function runInspect(release: string | null, env: Env): void {
  if (process.getuid?.() === 0) {
    reject("run_as_root", "DB komutları root olarak çalıştırılmaz; yayın aracı inspect'i servis kullanıcısıyla çağırır.");
  }
  const dbPath = path.resolve(resolveDbPathFromEnv(env));
  if (!fs.existsSync(dbPath)) reject("db_missing", "Canlı DB yok; boş DB oluşturulmaz.");
  let migrationsFolder: string | null = null;
  if (release !== null) {
    migrationsFolder = path.join(path.resolve(release), "drizzle");
    if (!isDirectory(migrationsFolder)) reject("usage", "--release bir release dizini değil.", { release });
  }

  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    // Tek okuma işlemi: parmak izi ve kontroller aynı anlık görüntüden.
    sqlite.exec("BEGIN");
    const hasMigrations = sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
      .get();
    const applied = hasMigrations
      ? (sqlite.prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations").get() as { count: number }).count
      : 0;
    const result: Inspection = {
      fingerprint: contentFingerprint(sqlite),
      applied_migrations: applied,
      verified: null,
      check_failure: null,
    };
    if (migrationsFolder !== null) {
      try {
        const verified = verifyDatabase(sqlite, migrationsFolder);
        const unknown = countUnknownMigrations(sqlite, migrationsFolder);
        if (unknown > 0) {
          reject("schema_not_current", "DB'de bu release'in migration'larında olmayan migration var.", {
            unknown_migrations: unknown,
          });
        }
        result.verified = {
          applied_migrations: verified.schema.applied_migrations,
          row_counts: verified.rowCounts,
          totals: verified.totals,
          last_committed_record: verified.lastRecord,
          unchecked_entries: verified.uncheckedEntries,
        };
      } catch (error) {
        if (!(error instanceof CopyRejectedError)) throw error;
        result.check_failure = { reason: error.reason, message: error.message };
      }
    }
    sqlite.exec("ROLLBACK");
    console.log(JSON.stringify(result));
  } finally {
    sqlite.close();
  }
}

// ---------------------------------------------------------------------------

let commandName = "";

async function main(): Promise<void> {
  const command = parseArgs(process.argv.slice(2));
  commandName = command.name;
  if (command.name === "inspect") {
    runInspect(command.release, process.env);
    return;
  }
  const paths = resolvePaths(process.env);
  assertPrivateStateDir(paths);
  if (command.name === "deploy") await runDeploy(paths, process.env, command.underMaintenance);
  else if (command.name === "rollback") await runRollback(paths, process.env, command.mode);
  else if (command.name === "mark-verified") runMarkVerified(paths, process.env);
  else runCleanup(paths, process.env);
}

main().catch((error: unknown) => {
  const reason = error instanceof CopyRejectedError ? error.reason : "unexpected_error";
  const fields: Fields = error instanceof CopyRejectedError ? error.fields : {};
  const message = error instanceof Error ? error.message : String(error);
  log("err", "release_failed", { command: commandName || "none", reason, ...fields, message });
  process.exitCode = reason === "ops_lock_busy" ? LOCK_BUSY_EXIT : 1;
});
