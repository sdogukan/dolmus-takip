/**
 * Günlük tutarlı SQLite kopyası — `node scripts/db-backup.ts [run|status]`
 * (T6.4, S6.4; ARCHITECTURE.md "Flow: Daily backup", OPS.md §4).
 *
 * ## `run` (varsayılan)
 *
 * 1. Canlı DB'den SQLite Backup API (`better-sqlite3` `db.backup`) ile
 *    nokta önekli geçici bir dosyaya tutarlı görüntü alınır. Canlı DB'ye ve
 *    `-wal`/`-shm`'ine yalnız OKUMA bağlantısı açılır: checkpoint, truncate,
 *    silme, journal_mode değişikliği YOKTUR (ARCHITECTURE §3.6, OPS §3/5).
 *    Ana dosyayı elle kopyalamak tutarlı yedek olmadığından kullanılmaz.
 * 2. KOPYA (canlı DB asla) `journal_mode=DELETE`'e çevrilir; yayımlanan dosya
 *    `-wal`/`-shm` gerektirmeyen TEK ve kendine yeten bir dosyadır. Kopya,
 *    `openDatabaseConnection` ile DEĞİL (o WAL'ı zorlar) kendi salt okunur
 *    bağlantısıyla açılıp doğrulanır — açmak hash'lenen baytları değiştiremez;
 *    yine de hash doğrulama öncesi/sonrası karşılaştırılır.
 * 3. Doğrulama: `integrity_check`, `foreign_key_check`, migration'ların
 *    uygulanmış olması, satır sayıları, mali toplamlar (METİN olarak — 2^53
 *    üstü tam sayı better-sqlite3'te yuvarlanır) ve her iş kaydının payı/
 *    kalanının `calculateWorkEntryAmounts` ile yeniden hesabı.
 * 4. Korunan tablolarda (`GUARDED_TABLES`) önceki manifeste göre satır azalması
 *    ya da yayın anının 02:55–04:00 Europe/Istanbul penceresine düşmesi
 *    kopyayı REDDEDER; önceki iki sağlam kopyaya dokunulmaz.
 * 5. Yayın sırası: kopya fsync → kopya rename → manifest fsync → manifest
 *    rename → dizin fsync. Kopyası olmayan manifest / manifesti olmayan kopya
 *    "doğrulanmış kopya" sayılmaz.
 * 6. Saklama YALNIZ yayından sonra: en yeni iki manifesti tamam kopya kalır.
 *
 * Çıkış kodu 0 yalnız kopya doğrulanıp yayımlandığında; diğer her sonuç 0
 * dışıdır ve nedenini adlandıran TEK bir `err`/`warn` logfmt satırı yazar.
 *
 * ## `status`
 *
 * Salt okunur: tutulan kopyaları, hash uyumunu ve kopyaların referans verdiği
 * release id'lerini listeler (o release dizinleri kopya tutulduğu sürece
 * silinmemelidir — SERVER-SETUP §4).
 *
 * ## Ortam
 *
 * - `DOLMUS_DB_PATH`: canlı DB (bkz. `db.ts` `resolveDbPathFromEnv`).
 * - `DOLMUS_BACKUP_DIR`: mevcut hazır-kopya dizini (`.../backup-ready`).
 * - `DOLMUS_BACKUP_NOW`: YALNIZ doğrulama/test için sabit saat (ISO). Pencere
 *   kuralı bu saate de uygulanır; kullanılırsa bir `warn` satırı yazılır.
 *
 * Release id = koşulan release dizininin (`realpath(cwd)`) adı; kopya yalnız
 * o release ile uyumludur. ESM/`.ts` import deseni `scripts/db-init.ts` ile
 * AYNI (açık uzantı, bkz. `./package.json`); bu dosyanın göreli import ağacı
 * `release-build.ts` `bundleDbInitIntoStandalone`'da eksiksiz kopyalanır.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { openDatabaseConnection, resolveDbPathFromEnv } from "../src/server/data/db.ts";
import {
  backupStem,
  copyDeadline,
  copyFileName,
  decidePublish,
  findRowCountDrops,
  formatLogLine,
  groupBackupSets,
  isOwnTempName,
  istanbulIso,
  manifestFileName,
  parseManifest,
  planRetention,
  tempFileName,
  type BackupManifest,
  type LogLevel,
} from "./lib/backup-schedule.ts";
import {
  CopyRejectedError as BackupRejectedError,
  sha256OfFile,
  verifyCopy,
  type Fields,
} from "./lib/copy-verification.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(path.resolve(__dirname, ".."), "drizzle");

let clock: () => Date = () => new Date();

function log(level: LogLevel, event: string, fields: Fields = {}): void {
  console.log(formatLogLine(level, event, fields, clock()));
}

function resolveClock(env: Record<string, string | undefined>): () => Date {
  const raw = env.DOLMUS_BACKUP_NOW;
  if (raw === undefined || raw === "") {
    return () => new Date();
  }
  const fixed = new Date(raw);
  if (Number.isNaN(fixed.getTime())) {
    throw new Error(`DOLMUS_BACKUP_NOW geçerli bir ISO zamanı değil: "${raw}".`);
  }
  return () => new Date(fixed.getTime());
}

function resolveBackupDir(env: Record<string, string | undefined>): string {
  const value = env.DOLMUS_BACKUP_DIR;
  if (!value || value.trim().length === 0) {
    throw new Error("DOLMUS_BACKUP_DIR ortam değişkeni tanımlı değil.");
  }
  const dir = path.resolve(value);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`Yedek dizini yok veya dizin değil: "${dir}". Otomatik oluşturulmaz.`);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Dosya yardımcıları
// ---------------------------------------------------------------------------

function fsyncPath(target: string): void {
  const fd = fs.openSync(target, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Önceki (öldürülmüş) koşudan kalan YALNIZ bu aracın kendi geçici adları. */
function removeOwnTempFiles(dir: string): number {
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (isOwnTempName(name)) {
      fs.rmSync(path.join(dir, name), { force: true });
      removed += 1;
    }
  }
  return removed;
}

function removeTempArtifacts(tmpPath: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    fs.rmSync(`${tmpPath}${suffix}`, { force: true });
  }
}

interface ReadManifest {
  stem: string;
  manifest: BackupManifest;
}

/** Kopyası + geçerli manifesti olan setler, en yeni önce. */
function readCompleteSets(dir: string): ReadManifest[] {
  const result: ReadManifest[] = [];
  for (const set of groupBackupSets(fs.readdirSync(dir))) {
    if (!set.hasCopy || !set.hasManifest) continue;
    const manifest = parseManifest(
      fs.readFileSync(path.join(dir, manifestFileName(set.stem)), "utf8"),
    );
    if (manifest === null || manifest.stem !== set.stem) {
      log("warn", "backup_manifest_invalid", { stem: set.stem });
      continue;
    }
    result.push({ stem: set.stem, manifest });
  }
  return result;
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

class DeadlineExceededError extends BackupRejectedError {
  constructor() {
    super("deadline_passed", "Kopyalama 02:55 son saatine kadar bitmedi.");
  }
}

async function takeCopy(dbPath: string, tmpCopy: string, deadline: Date): Promise<void> {
  const source = openDatabaseConnection(dbPath);
  try {
    await source.backup(tmpCopy, {
      progress: () => {
        // Backup API kaynak başka süreççe yazılırsa baştan başlar; döngü
        // sonsuz denenmez, son saatle sınırlıdır. Sayfaların tamamı tek
        // adımda aktarılarak yeniden başlama penceresi daraltılır.
        if (clock().getTime() >= deadline.getTime()) throw new DeadlineExceededError();
        return 0x7fffffff;
      },
    });
  } finally {
    source.close();
  }
}

/** Kopyayı kendine yeten TEK dosyaya çevirir (canlı DB'ye dokunmaz). */
function makeSelfContained(tmpCopy: string): void {
  const copy = new Database(tmpCopy, { fileMustExist: true });
  try {
    const mode = copy.pragma("journal_mode = DELETE", { simple: true });
    if (mode !== "delete") {
      throw new BackupRejectedError(
        "copy_not_self_contained",
        `Kopya journal_mode=DELETE'e çevrilemedi: "${String(mode)}".`,
      );
    }
  } finally {
    copy.close();
  }
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (fs.existsSync(`${tmpCopy}${suffix}`)) {
      throw new BackupRejectedError("copy_not_self_contained", `Kopyanın yanında "${suffix}" kaldı.`);
    }
  }
}

async function runBackup(env: Record<string, string | undefined>): Promise<void> {
  const dbPath = resolveDbPathFromEnv(env);
  const dir = resolveBackupDir(env);
  const startedAt = clock();
  const deadline = copyDeadline(startedAt);
  const releaseId = path.basename(fs.realpathSync(process.cwd()));

  const early = decidePublish(startedAt, deadline);
  if (!early.ok) {
    throw new BackupRejectedError(early.reason, "Şu an kopya yayımlanamaz (02:55–04:00 Europe/Istanbul).");
  }

  const cleaned = removeOwnTempFiles(dir);
  log("info", "backup_start", { release_id: releaseId, stale_temp_removed: cleaned });

  const stem = backupStem(startedAt);
  const finalCopy = path.join(dir, copyFileName(stem));
  const finalManifest = path.join(dir, manifestFileName(stem));
  if (fs.existsSync(finalCopy) || fs.existsSync(finalManifest)) {
    throw new BackupRejectedError("stem_exists", "Aynı adlı kopya zaten var; üzerine yazılmaz.", { stem });
  }
  const tmpCopy = path.join(dir, tempFileName(stem, "sqlite", process.pid));
  const tmpManifest = path.join(dir, tempFileName(stem, "manifest.json", process.pid));

  let copyPublished = false;
  let manifestPublished = false;
  try {
    await takeCopy(dbPath, tmpCopy, deadline);
    fs.chmodSync(tmpCopy, 0o600);
    makeSelfContained(tmpCopy);

    const before = sha256OfFile(tmpCopy);
    const verified = verifyCopy(tmpCopy, migrationsFolder);
    const after = sha256OfFile(tmpCopy);
    if (before.sha256 !== after.sha256 || before.size !== after.size) {
      throw new BackupRejectedError(
        "copy_changed_during_verification",
        "Kopyanın baytları doğrulama sırasında değişti.",
      );
    }
    const verifiedAt = clock();

    const previous = readCompleteSets(dir)[0];
    if (previous !== undefined) {
      const drops = findRowCountDrops(previous.manifest.row_counts, verified.rowCounts);
      if (drops.length > 0) {
        const first = drops[0]!;
        throw new BackupRejectedError(
          "row_count_drop",
          "Kopyada korunan bir tablonun satır sayısı önceki doğrulanmış kopyadan az.",
          { table: first.table, previous: first.previous, current: first.current, tables: drops.length },
        );
      }
    }

    // Yayın anı kararı: saat bu noktada korumalı pencereye düştüyse yayımlanmaz.
    const publishedAt = clock();
    const decision = decidePublish(publishedAt, deadline);
    if (!decision.ok) {
      throw new BackupRejectedError(decision.reason, "Kopya süresi içinde yayımlanamadı.");
    }

    const manifest: BackupManifest = {
      manifest_version: 1,
      stem,
      file: copyFileName(stem),
      size_bytes: after.size,
      sha256: after.sha256,
      created_at: startedAt.toISOString(),
      verified_at: verifiedAt.toISOString(),
      published_at: publishedAt.toISOString(),
      istanbul: {
        created_at: istanbulIso(startedAt),
        verified_at: istanbulIso(verifiedAt),
        published_at: istanbulIso(publishedAt),
      },
      release_id: releaseId,
      sqlite_version: verified.sqliteVersion,
      schema: verified.schema,
      last_committed_record: verified.lastRecord,
      row_counts: verified.rowCounts,
      totals: verified.totals,
      checks: {
        integrity_check: "ok",
        foreign_key_violations: 0,
        entry_amount_mismatches: 0,
        unchecked_entries: verified.uncheckedEntries,
      },
    };

    fsyncPath(tmpCopy);
    fs.renameSync(tmpCopy, finalCopy);
    copyPublished = true;

    const fd = fs.openSync(tmpManifest, "wx", 0o640);
    try {
      fs.writeSync(fd, `${JSON.stringify(manifest, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpManifest, finalManifest);
    manifestPublished = true;
    fsyncPath(dir);

    log("info", "backup_published", {
      stem,
      sha256: manifest.sha256,
      size_bytes: manifest.size_bytes,
      release_id: releaseId,
      work_entries: verified.rowCounts.work_entries ?? 0,
    });
  } catch (error) {
    // Yayımlanmış kopya + manifesti yoksa o "doğrulanmış kopya" değildir;
    // yarım bırakma.
    if (copyPublished && !manifestPublished) {
      fs.rmSync(finalCopy, { force: true });
    }
    throw error;
  } finally {
    removeTempArtifacts(tmpCopy);
    removeTempArtifacts(tmpManifest);
  }

  applyRetention(dir);
}

/** Yalnız yeni kopya yayımlandıktan sonra çağrılır. */
function applyRetention(dir: string): void {
  const validStems = new Set(readCompleteSets(dir).map((set) => set.stem));
  const plan = planRetention(fs.readdirSync(dir), validStems);
  let removed = 0;
  try {
    for (const name of plan.removeFiles) {
      fs.rmSync(path.join(dir, name));
      removed += 1;
    }
    fsyncPath(dir);
  } catch (error) {
    throw new BackupRejectedError(
      "retention_failed",
      error instanceof Error ? error.message : String(error),
      { published: true, removed, planned: plan.removeFiles.length },
    );
  }
  log("info", "backup_retention", { kept: plan.keepStems.length, removed });
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function runStatus(env: Record<string, string | undefined>): void {
  const dir = resolveBackupDir(env);
  const names = fs.readdirSync(dir);
  const sets = groupBackupSets(names);
  let verified = 0;
  let bad = 0;
  const releaseIds = new Set<string>();

  for (const set of sets) {
    if (!set.hasCopy || !set.hasManifest) {
      log("warn", "backup_incomplete", { stem: set.stem, has_copy: set.hasCopy, has_manifest: set.hasManifest });
      continue;
    }
    const manifest = parseManifest(fs.readFileSync(path.join(dir, manifestFileName(set.stem)), "utf8"));
    if (manifest === null || manifest.stem !== set.stem) {
      bad += 1;
      log("err", "backup_manifest_invalid", { stem: set.stem });
      continue;
    }
    const actual = sha256OfFile(path.join(dir, copyFileName(set.stem)));
    const hashOk = actual.sha256 === manifest.sha256 && actual.size === manifest.size_bytes;
    if (!hashOk) bad += 1;
    else {
      verified += 1;
      releaseIds.add(manifest.release_id);
    }
    log(hashOk ? "info" : "err", "backup_copy", {
      stem: set.stem,
      verified_at: manifest.verified_at,
      release_id: manifest.release_id,
      size_bytes: manifest.size_bytes,
      sha256_ok: hashOk,
    });
  }
  const temps = names.filter(isOwnTempName).length;
  const healthy = verified > 0 && bad === 0;
  log(healthy ? "info" : "err", "backup_status", {
    verified_copies: verified,
    invalid_copies: bad,
    temp_files: temps,
    release_ids: [...releaseIds].sort().join(",") || "none",
  });
  if (!healthy) process.exitCode = 1;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [command = "run", ...rest] = process.argv.slice(2);
  if (rest.length > 0 || (command !== "run" && command !== "status")) {
    throw new BackupRejectedError("usage", "Kullanım: db-backup.ts [run|status]");
  }
  clock = resolveClock(process.env);
  if (process.env.DOLMUS_BACKUP_NOW) {
    log("warn", "backup_clock_override", { now: process.env.DOLMUS_BACKUP_NOW });
  }
  if (command === "status") {
    runStatus(process.env);
  } else {
    await runBackup(process.env);
  }
}

main().catch((error: unknown) => {
  const reason = error instanceof BackupRejectedError ? error.reason : "unexpected_error";
  const fields: Fields = error instanceof BackupRejectedError ? error.fields : {};
  const message = error instanceof Error ? error.message : String(error);
  log("err", "backup_failed", { reason, ...fields, message });
  process.exitCode = 1;
});
