import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS } from "../../scripts/db-seed-dev";
import { calculateWorkEntryAmounts } from "../../src/lib/work-calculation";
import { createDb, openDatabaseConnection } from "../../src/server/data/db";

/**
 * `scripts/db-restore.ts` — gerçek geçici SQLite dosyaları, gerçek migration,
 * `db-backup.ts run` ile üretilmiş gerçek kopya; araç gerçek alt süreçte.
 * Yalnız `systemctl` bir test ikizidir (PATH'in başına konur): durumu bir
 * dosyadan okur ve yalnız `is-active dolmus-takip.service` sorusuna yanıt
 * verir. Kilit gerçek `flock` ile tutulur.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const restoreScript = path.join(projectRoot, "scripts", "db-restore.ts");
const backupScript = path.join(projectRoot, "scripts", "db-backup.ts");
const migrationsFolder = path.join(projectRoot, "drizzle");
const STEM = "app-20260924T120000Z";
const LIVE_SUFFIXES = ["", "-wal", "-shm"];

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

let root: string;
let dbPath: string;
let backupDir: string;
let preservedDir: string;
let markerPath: string;
let lockPath: string;
let serviceStatePath: string;
let binDir: string;

const manifestPath = () => path.join(backupDir, `${STEM}.manifest.json`);
const copyPath = () => path.join(backupDir, `${STEM}.sqlite`);

function runRestore(args: string[], extraEnv: Record<string, string> = {}): CliResult {
  const result = spawnSync(process.execPath, [restoreScript, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      DOLMUS_DB_PATH: dbPath,
      DOLMUS_PRESERVED_DIR: preservedDir,
      DOLMUS_MAINTENANCE_FILE: markerPath,
      DOLMUS_OPS_LOCK: lockPath,
      DOLMUS_OPS_LOCK_WAIT: "5",
      ...extraEnv,
    },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const verify = () => runRestore(["verify", "--manifest", manifestPath()]);
const install = (extraEnv: Record<string, string> = {}) =>
  runRestore(["install", "--manifest", manifestPath()], extraEnv);

function eventFields(stdout: string, event: string): Record<string, string> {
  const line = stdout.split("\n").find((l) => l.includes(` event=${event} `));
  expect(line, `event=${event} yok:\n${stdout}`).toBeDefined();
  return Object.fromEntries(
    line!
      .split(" ")
      .slice(1)
      .map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]),
  );
}

/** Tek `err` satırı, verilen nedenle; çıkış 0 değil. */
function expectRefused(result: CliResult, reason: string, exitCode?: number): void {
  if (exitCode === undefined) expect(result.status, result.stdout + result.stderr).not.toBe(0);
  else expect(result.status, result.stdout + result.stderr).toBe(exitCode);
  const errLines = result.stdout.split("\n").filter((line) => line.startsWith("<3>"));
  expect(errLines, result.stdout).toHaveLength(1);
  expect(errLines[0]).toContain("dolmus-restore event=restore_failed");
  expect(errLines[0]).toContain(`reason=${reason} `);
  expect(result.stdout).not.toContain("event=restore_verified");
  expect(result.stdout).not.toContain("event=restore_installed");
}

const sha256 = (file: string): string => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function liveFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const suffix of LIVE_SUFFIXES) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) files[path.basename(file)] = sha256(file);
  }
  return files;
}

// ---------------------------------------------------------------------------
// Veri
// ---------------------------------------------------------------------------

const ACTOR = ["platform_user", "session-trace-1", "admin", SEED_IDS.platformAdmin1] as const;

interface EntryInput {
  id: string;
  vehicleId: string;
  personId: string;
  workKind: "owner" | "driver";
  workDate: string;
  gross: number;
  version?: number;
  /** Onayın ait olduğu kayıt sürümü; `null` = onay yok. */
  confirmedVersion?: number | null;
  confirmedAt?: string;
}

function insertEntry(sqlite: InstanceType<typeof Database>, input: EntryInput): void {
  const version = input.version ?? 1;
  const amounts = calculateWorkEntryAmounts(input.workKind, input.gross, 10_000, 1_000);
  sqlite
    .prepare(
      `INSERT INTO work_entries (business_id, id, vehicle_id, person_id, work_kind, work_date, starts_at, ends_at,
         duration_minutes, gross_cents, fuel_cents, other_expense_cents, share_bps, share_cents, remainder_cents,
         calculation_version, status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 240, ?, 10000, 1000, ?, ?, ?, ?, 'confirmed', ?)`,
    )
    .run(
      SEED_IDS.businessA,
      input.id,
      input.vehicleId,
      input.personId,
      input.workKind,
      input.workDate,
      `${input.workDate}T05:00:00.000Z`,
      `${input.workDate}T09:00:00.000Z`,
      input.gross,
      amounts.shareBps,
      amounts.shareCents,
      amounts.remainderCents,
      amounts.calculationVersion,
      version,
    );
  for (let v = 1; v <= version; v += 1) {
    sqlite
      .prepare(
        `INSERT INTO work_entry_revisions (business_id, entry_id, version, action, snapshot_json, actor_kind,
           actor_session_id, actor_role, actor_platform_user_id, created_at)
         VALUES (?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)`,
      )
      .run(SEED_IDS.businessA, input.id, v, v === 1 ? "create" : "update", ...ACTOR, `${input.workDate}T09:0${v}:00.000Z`);
  }
  const confirmedVersion = input.confirmedVersion === undefined ? version : input.confirmedVersion;
  if (confirmedVersion !== null) {
    sqlite
      .prepare(
        `INSERT INTO cash_confirmations (business_id, id, entry_id, entry_version, received_cents, confirmed_at,
           actor_kind, actor_session_id, actor_role, actor_platform_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        SEED_IDS.businessA,
        `cc-${input.id}`,
        input.id,
        confirmedVersion,
        Math.max(amounts.remainderCents, 0),
        input.confirmedAt ?? `${input.workDate}T10:00:00.000Z`,
        ...ACTOR,
      );
  }
}

function insertSession(
  sqlite: InstanceType<typeof Database>,
  id: string,
  actor: { credentialId?: string; platformUserId?: string },
  revokedAt: string | null,
): void {
  sqlite
    .prepare(
      `INSERT INTO sessions (id, token_hash, credential_id, platform_user_id, issued_version, created_at, last_seen_at,
         expires_at, revoked_at)
       VALUES (?, ?, ?, ?, 1, '2026-09-24T08:00:00.000Z', '2026-09-24T08:00:00.000Z', '2026-10-24T08:00:00.000Z', ?)`,
    )
    .run(id, `hash-${id}`, actor.credentialId ?? null, actor.platformUserId ?? null, revokedAt);
}

/** Kopyayı değiştirir ve manifesti yeni hash/boyutla yeniden yazar: hash
 * kontrolünü geçen ama içi bozuk bir kopyanın sonraki kontrollerde yakalandığını sınar. */
function tamperCopy(change: (copy: InstanceType<typeof Database>) => void): void {
  const copy = new Database(copyPath());
  try {
    change(copy);
  } finally {
    copy.close();
  }
  rewriteManifest((manifest) => {
    manifest.sha256 = sha256(copyPath());
    manifest.size_bytes = fs.statSync(copyPath()).size;
  });
}

function rewriteManifest(change: (manifest: Record<string, any>) => void): void {
  const manifest = JSON.parse(fs.readFileSync(manifestPath(), "utf8"));
  change(manifest);
  fs.writeFileSync(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`);
}

function setServiceState(state: string): void {
  fs.writeFileSync(serviceStatePath, state);
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-db-restore-"));
  dbPath = path.join(root, "data", "app.sqlite");
  backupDir = path.join(root, "backup-ready");
  preservedDir = path.join(root, "preserved");
  markerPath = path.join(root, "maintenance");
  lockPath = path.join(root, "ops.lock");
  serviceStatePath = path.join(root, "service-state");
  binDir = path.join(root, "bin");
  for (const dir of [backupDir, preservedDir, binDir]) fs.mkdirSync(dir);
  fs.writeFileSync(lockPath, "");
  fs.writeFileSync(markerPath, "");
  setServiceState("inactive");
  fs.writeFileSync(
    path.join(binDir, "systemctl"),
    `#!/bin/sh\n[ "$1" = is-active ] && [ "$2" = dolmus-takip.service ] && [ $# -eq 2 ] || exit 1\n` +
      `state=$(cat "${serviceStatePath}")\necho "$state"\n[ "$state" = active ] && exit 0\nexit 3\n`,
    { mode: 0o755 },
  );

  const sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
  migrate(createDb(sqlite), { migrationsFolder });
  await seedDevData(sqlite);
  insertEntry(sqlite, { id: "e-2025", vehicleId: SEED_IDS.vehicleA2, personId: SEED_IDS.ownerA, workKind: "owner", workDate: "2025-12-31", gross: 250_050, confirmedVersion: null });
  insertEntry(sqlite, { id: "e-2026", vehicleId: SEED_IDS.vehicleA1, personId: SEED_IDS.driverA1a, workKind: "driver", workDate: "2026-09-20", gross: 100_000, confirmedAt: "2026-09-21T07:30:00.000Z" });
  // Sürüm 2'ye düzeltilmiş şoför kaydı; onay yalnız eski sürüme ait. Rapor bunu
  // "alınan" saymaz, manifestin received_cents'i sayar — iki rakam eşitlenmez.
  insertEntry(sqlite, { id: "e-stale", vehicleId: SEED_IDS.vehicleA1, personId: SEED_IDS.driverA1a, workKind: "driver", workDate: "2026-09-19", gross: 80_000, version: 2, confirmedVersion: 1 });
  insertSession(sqlite, "s-vehicle", { credentialId: SEED_IDS.credA1Driver }, null);
  insertSession(sqlite, "s-staff", { platformUserId: SEED_IDS.platformSupport1 }, null);
  insertSession(sqlite, "s-old", { credentialId: SEED_IDS.credA1Owner }, "2026-09-23T10:00:00.000Z");
  sqlite.close();

  const backup = spawnSync(process.execPath, [backupScript, "run"], {
    cwd: projectRoot,
    env: { ...process.env, DOLMUS_DB_PATH: dbPath, DOLMUS_BACKUP_DIR: backupDir, DOLMUS_BACKUP_NOW: "2026-09-24T12:00:00Z" },
    encoding: "utf8",
  });
  expect(backup.status, backup.stdout + backup.stderr).toBe(0);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

describe("scripts/db-restore.ts verify", () => {
  it("sağlam kopyada 0 çıkar; kurtarılabilir nokta kopyanın kendi satırlarından, snapshot/yayın saatinden değil", () => {
    const result = verify();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const fields = eventFields(result.stdout, "restore_verified");

    const copy = new Database(copyPath(), { readonly: true });
    const newest = copy
      .prepare(
        `SELECT MAX(at) AS at FROM (
           SELECT created_at AS at FROM work_entry_revisions
           UNION ALL SELECT confirmed_at FROM cash_confirmations
           UNION ALL SELECT occurred_at FROM admin_audit)`,
      )
      .get() as { at: string };
    copy.close();
    expect(fields.recoverable_point).toBe(new Date(newest.at).toISOString());
    expect(fields.recoverable_point).toBe("2026-09-21T07:30:00.000Z");
    expect(fields.recoverable_record).toBe("cash_confirmation/e-2026/1");
    const manifest = JSON.parse(fs.readFileSync(manifestPath(), "utf8"));
    expect(fields.recoverable_point).not.toBe(manifest.published_at);
    expect(fields.stem).toBe(STEM);
    expect(fields.release_id).toBe(path.basename(fs.realpathSync(projectRoot)));
    expect(fields.work_entries).toBe("3");
    expect(fields.report_periods).toBe("2"); // A2 × 2025, A1 × 2026

    // Manifestin "alınan"ı bütün onayları toplar; raporun tanımı farklıdır ve verify yine geçer.
    expect(manifest.totals.received_cents).not.toBe("0");
  });

  it("giriş kimliklerini listeler; parola hash'i yazmaz; kopyayı değiştirmez", () => {
    const before = sha256(copyPath());
    const result = verify();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const principals = result.stdout.split("\n").filter((l) => l.includes("event=restore_principal"));
    expect(principals.filter((l) => l.includes("kind=vehicle_credential"))).toHaveLength(8);
    expect(principals.filter((l) => l.includes("kind=platform_user"))).toHaveLength(4);
    expect(result.stdout).toContain(`id=${SEED_IDS.platformAdminPassive1}`);
    expect(result.stdout).toMatch(/kind=platform_user id=\S+ username=admin\.pasif\.test role=admin active=false credential_version=1/);

    const copy = new Database(copyPath(), { readonly: true });
    const hashes = copy
      .prepare("SELECT password_hash AS h FROM vehicle_credentials UNION ALL SELECT password_hash FROM platform_users")
      .all() as { h: string }[];
    copy.close();
    for (const { h } of hashes) expect(result.stdout).not.toContain(h);
    expect(result.stdout).not.toMatch(/argon2|password/i);
    expect(sha256(copyPath())).toBe(before);
    expect(fs.readdirSync(backupDir).filter((n) => /-(wal|shm|journal)$/.test(n))).toEqual([]);
  });

  it("sha256/boyut manifestle uyuşmuyorsa", () => {
    fs.appendFileSync(copyPath(), "x");
    expectRefused(verify(), "copy_hash_mismatch");
  });

  it("manifestin release_id'si koşulan release dizininden farklıysa", () => {
    rewriteManifest((m) => {
      m.release_id = "baska-release";
    });
    const result = verify();
    expectRefused(result, "release_mismatch");
    expect(result.stdout).toContain("manifest_release=baska-release");
  });

  it("integrity_check başarısızsa", () => {
    tamperCopy((copy) => {
      // Tekil plaka indeksindeki bir anahtarı bozar: tablo satırı indekste bulunamaz.
      const pageSize = copy.pragma("page_size", { simple: true }) as number;
      const roots = copy
        .prepare("SELECT rootpage FROM sqlite_master WHERE type = 'index' AND tbl_name = 'vehicles'")
        .all() as { rootpage: number }[];
      copy.close();
      const bytes = fs.readFileSync(copyPath());
      const pages = roots.map(({ rootpage }) => bytes.subarray((rootpage - 1) * pageSize, rootpage * pageSize));
      const page = pages.find((p) => p.includes("34AAA001"));
      expect(page, "plaka indeksi sayfası").toBeDefined();
      page!.write("34AAA00X", page!.indexOf("34AAA001"));
      fs.writeFileSync(copyPath(), bytes);
    });
    expectRefused(verify(), "integrity_check_failed");
  });

  it("foreign_key_check başarısızsa", () => {
    tamperCopy((copy) => {
      copy.pragma("foreign_keys = OFF");
      copy
        .prepare(
          `INSERT INTO cash_confirmations (business_id, id, entry_id, entry_version, received_cents, confirmed_at,
             actor_kind, actor_session_id, actor_role, actor_platform_user_id)
           VALUES (?, 'cc-orphan', 'e-2026', 99, 1, '2026-09-21T09:02:00.000Z', ?, ?, ?, ?)`,
        )
        .run(SEED_IDS.businessA, ...ACTOR);
    });
    expectRefused(verify(), "foreign_key_check_failed");
  });

  it("bir iş kaydının payı/kalanı yeniden hesapla uyuşmuyorsa", () => {
    tamperCopy((copy) => copy.prepare("UPDATE work_entries SET share_cents = share_cents + 1 WHERE id = 'e-2026'").run());
    expectRefused(verify(), "entry_amount_mismatch");
  });

  it("kopyada bu release'in bir migration'ı eksikse", () => {
    tamperCopy((copy) =>
      // id sütunu SQLite'ta NULL kalır (drizzle "SERIAL"); son migration created_at ile seçilir.
      expect(
        copy
          .prepare("DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)")
          .run().changes,
      ).toBe(1),
    );
    expectRefused(verify(), "schema_not_current");
  });

  it("kopyada bu release'in bilmediği bir migration varsa (daha yeni şema)", () => {
    tamperCopy((copy) =>
      copy
        .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
        .run("f".repeat(64), 9_999_999_999_999),
    );
    const result = verify();
    expectRefused(result, "schema_not_current");
    expect(result.stdout).toContain("unknown_migrations=1");
  });

  it("araç dönem raporu toplamları kopyanın toplamlarından farklıysa", () => {
    // Rapor dönemine çevrilemeyen yıl: kayıt hiçbir araç raporunda görünmez.
    tamperCopy((copy) =>
      insertEntry(copy, { id: "e-1999", vehicleId: SEED_IDS.vehicleA1, personId: SEED_IDS.ownerA, workKind: "owner", workDate: "1999-05-01", gross: 5_000, confirmedVersion: null }),
    );
    expectRefused(verify(), "report_totals_mismatch");
  });

  it("manifestteki son kayıt kopyanın kendi satırlarıyla uyuşmuyorsa", () => {
    rewriteManifest((m) => {
      m.last_committed_record.cash_confirmation.confirmed_at = "2026-09-24T11:59:00.000Z";
    });
    expectRefused(verify(), "manifest_record_mismatch");
  });

  it("manifestin file alanı stem'in kopyası değilse yol kurulmaz", () => {
    rewriteManifest((m) => {
      m.file = "../data/app.sqlite";
    });
    expectRefused(verify(), "manifest_invalid");
  });

  it("bilinmeyen komut, bilinmeyen/eksik/değersiz bayrak reddedilir", () => {
    expectRefused(runRestore(["restore"]), "usage");
    expectRefused(runRestore(["verify"]), "usage");
    expectRefused(runRestore(["verify", "--manifest"]), "usage");
    expectRefused(runRestore(["verify", "--manifest", manifestPath(), "--force", "1"]), "usage");
    expectRefused(runRestore(["verify", "--manifest", manifestPath(), "--manifest", manifestPath()]), "usage");
    expectRefused(runRestore(["report", "--manifest", manifestPath()]), "usage");
  });
});

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

/** Canlı DB'ye yedekten SONRA yazar ve süreci kill -9 ile bitirir: -wal/-shm yerinde kalır. */
function writeAfterBackupAndCrash(): void {
  const code = `
    const Database = require("better-sqlite3");
    const db = new Database(${JSON.stringify(dbPath)});
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 0");
    db.prepare("UPDATE vehicles SET note = 'yedekten sonra' WHERE id = ?").run(${JSON.stringify(SEED_IDS.vehicleA1)});
    process.kill(process.pid, "SIGKILL");
  `;
  spawnSync(process.execPath, ["-e", code], { cwd: projectRoot });
  expect(fs.existsSync(`${dbPath}-wal`)).toBe(true);
  expect(fs.existsSync(`${dbPath}-shm`)).toBe(true);
}

function preservedSets(): string[] {
  return fs.readdirSync(preservedDir);
}

describe("scripts/db-restore.ts install", () => {
  it("eski app.sqlite/-wal/-shm'i silmeden preserved altına taşır, kopyayı yerleştirir ve bütün oturumları iptal eder", () => {
    writeAfterBackupAndCrash();
    const before = liveFiles();
    expect(Object.keys(before).sort()).toEqual(["app.sqlite", "app.sqlite-shm", "app.sqlite-wal"]);

    const result = install();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const fields = eventFields(result.stdout, "restore_installed");
    expect(fields.revoked_sessions).toBe("2");
    expect(fields.preserved_files).toBe("3");
    expect(fields.recoverable_point).toBe("2026-09-21T07:30:00.000Z");

    // Eski dosyalar bayt bayt aynı, preserved/<zaman>/ altında.
    const [set] = preservedSets();
    expect(preservedSets()).toHaveLength(1);
    expect(set).toMatch(/^\d{8}T\d{6}Z$/);
    expect(fields.preserved).toBe(path.join(preservedDir, set!));
    const moved = Object.fromEntries(
      fs.readdirSync(path.join(preservedDir, set!)).map((name) => [name, sha256(path.join(preservedDir, set!, name))]),
    );
    expect(moved).toEqual(before);

    // Yeni DB: yalnız kopya + iptal; yedekten sonraki yazma yok, hiçbir oturum açık değil.
    expect(fs.readdirSync(path.dirname(dbPath))).toEqual(["app.sqlite"]);
    expect(fs.statSync(dbPath).mode & 0o777).toBe(0o600);
    const restored = new Database(dbPath, { readonly: true });
    try {
      expect(restored.pragma("integrity_check", { simple: true })).toBe("ok");
      const sessions = restored.prepare("SELECT id, revoked_at FROM sessions ORDER BY id").all() as {
        id: string;
        revoked_at: string | null;
      }[];
      expect(sessions.map((s) => s.id)).toEqual(["s-old", "s-staff", "s-vehicle"]);
      expect(sessions.every((s) => s.revoked_at !== null)).toBe(true);
      // Zaten iptal edilmiş oturumun zamanı değişmez (idempotent).
      expect(sessions[0]!.revoked_at).toBe("2026-09-23T10:00:00.000Z");
      const note = restored.prepare("SELECT note FROM vehicles WHERE id = ?").get(SEED_IDS.vehicleA1) as {
        note: string | null;
      };
      expect(note.note).not.toBe("yedekten sonra");
      expect((restored.prepare("SELECT COUNT(*) AS c FROM work_entries").get() as { c: number }).c).toBe(3);
    } finally {
      restored.close();
    }
    // Kilit bırakıldı.
    expect(spawnSync("flock", ["-n", lockPath, "true"]).status).toBe(0);
  });

  it("bakım işareti yoksa reddeder; canlı dosyalara dokunmaz", () => {
    writeAfterBackupAndCrash();
    const before = liveFiles();
    fs.rmSync(markerPath);
    expectRefused(install(), "maintenance_off");
    expect(liveFiles()).toEqual(before);
    expect(preservedSets()).toEqual([]);
  });

  it.each(["active", "activating", "reloading"])("uygulama servisi %s iken reddeder", (state) => {
    const before = liveFiles();
    setServiceState(state);
    const result = install();
    expectRefused(result, "service_active");
    expect(result.stdout).toContain(`state=${state}`);
    expect(liveFiles()).toEqual(before);
    expect(preservedSets()).toEqual([]);
  });

  it("servis durumu okunamazsa reddeder", () => {
    // PATH'te yalnız gerçek flock var, systemctl yok.
    fs.rmSync(path.join(binDir, "systemctl"));
    const flock = spawnSync("sh", ["-c", "command -v flock"], { encoding: "utf8" }).stdout.trim();
    fs.symlinkSync(flock, path.join(binDir, "flock"));
    const before = liveFiles();
    expectRefused(install({ PATH: binDir }), "service_state_unknown");
    expect(liveFiles()).toEqual(before);
    expect(preservedSets()).toEqual([]);
  });

  it("systemctl boş yanıt verirse servis durmuş sayılmaz", () => {
    fs.writeFileSync(path.join(binDir, "systemctl"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const result = install();
    expectRefused(result, "service_active");
    expect(result.stdout).toContain("state=unknown");
  });

  it("ortak kilit tutuluyken sınırlı bekler ve 75 ile çıkar; hiçbir şeye dokunmaz", async () => {
    const holder: ChildProcess = spawn("flock", [lockPath, "sleep", "30"], { stdio: "ignore" });
    try {
      const deadline = Date.now() + 5000;
      while (spawnSync("flock", ["-n", lockPath, "true"]).status === 0) {
        if (Date.now() > deadline) throw new Error("kilit tutucusu başlamadı");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const before = liveFiles();
      expectRefused(install({ DOLMUS_OPS_LOCK_WAIT: "1" }), "ops_lock_busy", 75);
      expect(liveFiles()).toEqual(before);
      expect(preservedSets()).toEqual([]);
    } finally {
      holder.kill("SIGKILL");
    }
  });

  it("kilit dosyası yoksa oluşturmaz ve reddeder", () => {
    const before = liveFiles();
    fs.rmSync(lockPath);
    expectRefused(install(), "ops_lock_missing");
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(liveFiles()).toEqual(before);
  });

  it("kopya doğrulamayı geçmezse canlı DB yerinde kalır", () => {
    const before = liveFiles();
    fs.appendFileSync(copyPath(), "x");
    expectRefused(install(), "copy_hash_mismatch");
    expect(liveFiles()).toEqual(before);
    expect(preservedSets()).toEqual([]);
    expect(fs.readdirSync(path.dirname(dbPath)).filter((n) => n.startsWith("."))).toEqual([]);
  });

  it("canlı DB yokken doğrulama başarısızsa boş DB oluşturmaz", () => {
    fs.rmSync(dbPath);
    rewriteManifest((m) => {
      m.release_id = "baska-release";
    });
    expectRefused(install(), "release_mismatch");
    expect(fs.readdirSync(path.dirname(dbPath))).toEqual([]);
  });

  it("veri dizini yoksa oluşturmaz", () => {
    fs.rmSync(path.dirname(dbPath), { recursive: true });
    expectRefused(install(), "data_dir_missing");
    expect(fs.existsSync(path.dirname(dbPath))).toBe(false);
  });

  it("preserved dizini yoksa oluşturmaz ve canlı DB'ye dokunmaz", () => {
    const before = liveFiles();
    fs.rmSync(preservedDir, { recursive: true });
    expectRefused(install(), "preserved_dir_missing");
    expect(fs.existsSync(preservedDir)).toBe(false);
    expect(liveFiles()).toEqual(before);
  });

  it("ikinci install de öncekini silmez: her yerleştirme ayrı preserved dizinine taşınır", async () => {
    expect(install().status).toBe(0);
    const firstRestored = sha256(dbPath);
    await new Promise((resolve) => setTimeout(resolve, 1100)); // preserved/<zaman> saniye çözünürlüklü
    const result = install();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(eventFields(result.stdout, "restore_installed").revoked_sessions).toBe("2");
    const sets = preservedSets().sort();
    expect(sets).toHaveLength(2);
    expect(sha256(path.join(preservedDir, sets[1]!, "app.sqlite"))).toBe(firstRestored);
  });
});

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

describe("scripts/db-restore.ts report", () => {
  it("olay zamanı yokken kayıp aralığı unknown; kurtarılabilir nokta ve süre yazılır", () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    const result = runRestore(["report", "--started-at", startedAt]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const fields = eventFields(result.stdout, "restore_record");
    expect(fields.recoverable_point).toBe("2026-09-21T07:30:00.000Z");
    expect(fields.recoverable_record).toBe("cash_confirmation/e-2026/1");
    expect(fields.recovery_started_at).toBe(startedAt);
    expect(Number(fields.recovery_duration_s)).toBeGreaterThanOrEqual(90);
    expect(Number(fields.recovery_duration_s)).toBeLessThan(90 + 60);
    expect(fields.incident_at).toBe("unknown");
    expect(fields.loss_window_s).toBe("unknown");
    expect(fields.active_sessions).toBe("2");
  });

  it("olay zamanı verilince kayıp aralığı kurtarılabilir noktadan olaya kadardır", () => {
    const result = runRestore([
      "report",
      "--started-at",
      "2026-09-22T00:00:00Z",
      "--incident-at",
      "2026-09-21T09:30:00Z",
    ]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const fields = eventFields(result.stdout, "restore_record");
    expect(fields.incident_at).toBe("2026-09-21T09:30:00.000Z");
    expect(fields.loss_window_s).toBe(String(2 * 3600));
  });

  it("olay zamanı kurtarılabilir noktadan önceyse reddeder", () => {
    expectRefused(
      runRestore(["report", "--started-at", "2026-09-22T00:00:00Z", "--incident-at", "2026-09-20T00:00:00Z"]),
      "incident_before_recoverable_point",
    );
  });

  it("geçersiz veya gelecekteki zaman reddedilir; DB yoksa boş DB oluşturmaz", () => {
    expectRefused(runRestore(["report", "--started-at", "dun"]), "usage");
    expectRefused(runRestore(["report", "--started-at", "2999-01-01T00:00:00Z"]), "usage");
    expectRefused(runRestore(["report"]), "usage");
    fs.rmSync(dbPath);
    expectRefused(runRestore(["report", "--started-at", "2026-09-22T00:00:00Z"]), "db_missing");
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});
