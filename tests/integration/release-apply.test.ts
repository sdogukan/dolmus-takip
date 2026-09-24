import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS } from "../../scripts/db-seed-dev";
import { parseManifest } from "../../scripts/lib/backup-schedule";
import { calculateWorkEntryAmounts } from "../../src/lib/work-calculation";
import { createDb, openDatabaseConnection } from "../../src/server/data/db";

/**
 * `scripts/release-apply.ts` — her release gerçek bir dizindir (projenin
 * `scripts/`, `src/`, `drizzle/` kopyası; `node_modules` bağlantı), DB gerçek
 * geçici SQLite dosyası, yayın öncesi kopyayı ESKİ release'in gerçek
 * `db-backup.ts`'i, migration'ı yeni release'in gerçek `db-init.ts`'i, DB geri
 * dönüşünü eski release'in gerçek `db-restore.ts install`'ı yapar. Kilit
 * gerçek `flock`. Test ikizleri yalnız: `systemctl` (durum bir dosyada),
 * `runuser` (kullanıcı değiştirmeden komutu çalıştırır ve çağrıyı kaydeder)
 * ve uygulamanın localhost live/ready uçları (test içindeki HTTP sunucusu).
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SLOW = 60_000;

/** Çalışan release, migration'sız yeni release, 1 migration'lı yeni release, mali veriyi değiştiren migration'lı release. */
const OLD = "1111111a";
const SAME = "2222222b";
const MIG = "3333333c";
const BAD = "4444444d";

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

let template: string;
let root: string;
let releasesDir: string;
let currentLink: string;
let dbPath: string;
let preMigrationDir: string;
let backupReadyDir: string;
let preservedDir: string;
let stateDir: string;
let markerPath: string;
let recoveryLock: string;
let lockPath: string;
let callsLog: string;
let binDir: string;
let appEnvFile: string;

const health = { live: 200, ready: 200 };
let server: http.Server;
let port: number;

// ---------------------------------------------------------------------------
// Release şablonları
// ---------------------------------------------------------------------------

function addMigration(releaseDir: string, tag: string, sql: string): void {
  const journalPath = path.join(releaseDir, "drizzle", "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as { entries: { idx: number; when: number }[] };
  const last = journal.entries.at(-1)!;
  journal.entries.push({ idx: last.idx + 1, version: "6", when: last.when + 1000, tag, breakpoints: true } as never);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  fs.writeFileSync(path.join(releaseDir, "drizzle", `${tag}.sql`), sql);
}

function buildRelease(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(projectRoot, "scripts"), path.join(dir, "scripts"), { recursive: true });
  fs.cpSync(path.join(projectRoot, "src"), path.join(dir, "src"), {
    recursive: true,
    filter: (source) => !source.endsWith(".test.ts"),
  });
  fs.cpSync(path.join(projectRoot, "drizzle"), path.join(dir, "drizzle"), { recursive: true });
  fs.symlinkSync(path.join(projectRoot, "node_modules"), path.join(dir, "node_modules"));
}

const sha256 = (file: string): string => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** `release-build.ts` manifestinin release-apply'ın okuduğu alanları. */
function writeReleaseManifest(dir: string, id: string): void {
  const journal = JSON.parse(fs.readFileSync(path.join(template, id, "drizzle", "meta", "_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  const manifest = {
    name: "dolmus-takip",
    source_commit: `${id}${"0".repeat(32)}`,
    schema: {
      last_migration_idx: journal.entries.at(-1)!.idx,
      migration_sha256_list: journal.entries.map((entry) => ({
        idx: entry.idx,
        file: `${entry.tag}.sql`,
        sha256: sha256(path.join(template, id, "drizzle", `${entry.tag}.sql`)),
      })),
    },
  };
  fs.writeFileSync(path.join(dir, `${id}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Çalıştırma
// ---------------------------------------------------------------------------

function runApply(release: string, args: string[], extraEnv: Record<string, string> = {}): Promise<CliResult> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    DOLMUS_RELEASES_DIR: releasesDir,
    DOLMUS_CURRENT_LINK: currentLink,
    DOLMUS_APP_ENV_FILE: appEnvFile,
    DOLMUS_RELEASE_STATE_DIR: stateDir,
    DOLMUS_PRE_MIGRATION_DIR: preMigrationDir,
    DOLMUS_BACKUP_READY_DIR: backupReadyDir,
    DOLMUS_PRESERVED_DIR: preservedDir,
    DOLMUS_MAINTENANCE_FILE: markerPath,
    DOLMUS_RECOVERY_LOCK: recoveryLock,
    DOLMUS_OPS_LOCK: lockPath,
    DOLMUS_OPS_LOCK_WAIT: "2",
    DOLMUS_APP_URL: `http://127.0.0.1:${port}`,
    DOLMUS_READINESS_TIMEOUT: "2",
    ...extraEnv,
  };
  // DB yolu yalnız --env-file'dan gelmeli; ortamdaki değer onu ezerdi.
  delete env.DOLMUS_DB_PATH;
  delete env.DOLMUS_BACKUP_NOW;
  delete env.DOLMUS_OPS_LOCK_FD;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(releasesDir, release, "scripts", "release-apply.ts"), ...args], {
      cwd: path.join(releasesDir, release),
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const deploy = (release: string) => runApply(release, ["deploy"]);

function expectOk(result: CliResult): void {
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).not.toContain("<3>dolmus-release");
}

/** Tek `err` satırı, verilen nedenle; çıkış 0 değil. */
function expectRefused(result: CliResult, reason: string, exitCode?: number): string {
  if (exitCode === undefined) expect(result.status, result.stdout + result.stderr).not.toBe(0);
  else expect(result.status, result.stdout + result.stderr).toBe(exitCode);
  const errLines = result.stdout.split("\n").filter((line) => line.startsWith("<3>dolmus-release"));
  expect(errLines, result.stdout).toHaveLength(1);
  expect(errLines[0]).toContain("event=release_failed");
  expect(errLines[0]).toContain(`reason=${reason} `);
  expect(result.stdout).not.toContain("event=release_traffic_opened");
  return errLines[0]!;
}

const calls = (): string[] => (fs.existsSync(callsLog) ? fs.readFileSync(callsLog, "utf8").trim().split("\n") : []);
const indexOfCall = (pattern: RegExp): number => calls().findIndex((line) => pattern.test(line));
const serviceState = (): string => fs.readFileSync(path.join(root, "service-state"), "utf8").trim();
const currentRelease = (): string => path.basename(fs.realpathSync(currentLink));

function readState(): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(stateDir, "state.json"), "utf8"));
}

function withDb<T>(fn: (sqlite: InstanceType<typeof Database>) => T): T {
  const sqlite = openDatabaseConnection(dbPath);
  try {
    return fn(sqlite);
  } finally {
    sqlite.close();
  }
}

const migrationCount = (): number =>
  withDb((sqlite) => (sqlite.prepare("SELECT COUNT(*) AS c FROM __drizzle_migrations").get() as { c: number }).c);

function preMigrationManifests(): string[] {
  return fs.readdirSync(preMigrationDir).filter((name) => name.endsWith(".manifest.json"));
}

// ---------------------------------------------------------------------------
// Veri
// ---------------------------------------------------------------------------

const ACTOR = ["platform_user", "session-trace-1", "admin", SEED_IDS.platformAdmin1] as const;

function insertEntry(sqlite: InstanceType<typeof Database>, id: string, gross: number, workKind: "owner" | "driver"): void {
  const amounts = calculateWorkEntryAmounts(workKind, gross, 10_000, 1_000);
  sqlite
    .prepare(
      `INSERT INTO work_entries (business_id, id, vehicle_id, person_id, work_kind, work_date, starts_at, ends_at,
         duration_minutes, gross_cents, fuel_cents, other_expense_cents, share_bps, share_cents, remainder_cents,
         calculation_version, status, version)
       VALUES (?, ?, ?, ?, ?, '2026-09-20', '2026-09-20T05:00:00.000Z', '2026-09-20T09:00:00.000Z', 240, ?, 10000, 1000,
         ?, ?, ?, ?, 'confirmed', 1)`,
    )
    .run(
      SEED_IDS.businessA,
      id,
      SEED_IDS.vehicleA1,
      workKind === "owner" ? SEED_IDS.ownerA : SEED_IDS.driverA1a,
      workKind,
      gross,
      amounts.shareBps,
      amounts.shareCents,
      amounts.remainderCents,
      amounts.calculationVersion,
    );
  sqlite
    .prepare(
      `INSERT INTO work_entry_revisions (business_id, entry_id, version, action, snapshot_json, actor_kind,
         actor_session_id, actor_role, actor_platform_user_id, created_at)
       VALUES (?, ?, 1, 'create', '{}', ?, ?, ?, ?, '2026-09-20T09:01:00.000Z')`,
    )
    .run(SEED_IDS.businessA, id, ...ACTOR);
  sqlite
    .prepare(
      `INSERT INTO cash_confirmations (business_id, id, entry_id, entry_version, received_cents, confirmed_at,
         actor_kind, actor_session_id, actor_role, actor_platform_user_id)
       VALUES (?, ?, ?, 1, ?, '2026-09-20T09:02:00.000Z', ?, ?, ?, ?)`,
    )
    .run(SEED_IDS.businessA, `cc-${id}`, id, Math.max(amounts.remainderCents, 0), ...ACTOR);
}

function insertSession(sqlite: InstanceType<typeof Database>, id: string): void {
  sqlite
    .prepare(
      `INSERT INTO sessions (id, token_hash, credential_id, platform_user_id, issued_version, created_at, last_seen_at,
         expires_at, revoked_at)
       VALUES (?, ?, ?, NULL, 1, '2026-09-24T08:00:00.000Z', '2026-09-24T08:00:00.000Z', '2026-10-24T08:00:00.000Z', NULL)`,
    )
    .run(id, `hash-${id}`, SEED_IDS.credA1Driver);
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  template = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-release-apply-template-"));
  for (const id of [OLD, SAME, MIG, BAD]) buildRelease(path.join(template, id));
  addMigration(
    path.join(template, MIG),
    "0099_release_apply_probe",
    "CREATE TABLE `release_apply_probe` (`id` integer PRIMARY KEY NOT NULL);\n",
  );
  addMigration(
    path.join(template, BAD),
    "0099_release_apply_bad",
    "UPDATE `cash_confirmations` SET `received_cents` = `received_cents` + 1;\n",
  );
  server = http.createServer((request, response) => {
    const status = request.url === "/api/v1/health/live" ? health.live : request.url === "/api/v1/health/ready" ? health.ready : 404;
    response.writeHead(status).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
}, SLOW);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(template, { recursive: true, force: true });
});

beforeEach(async () => {
  health.live = 200;
  health.ready = 200;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-release-apply-"));
  releasesDir = path.join(root, "releases");
  fs.mkdirSync(releasesDir);
  for (const id of [OLD, SAME, MIG, BAD]) {
    // Sabit bağlantılı kopya: release dosyaları testte değişmez, kopyalama maliyeti yok.
    const copy = spawnSync("cp", ["-al", path.join(template, id), path.join(releasesDir, id)]);
    expect(copy.status).toBe(0);
    writeReleaseManifest(releasesDir, id);
  }
  currentLink = path.join(root, "current");
  fs.symlinkSync(path.join(releasesDir, OLD), currentLink);

  const varDir = path.join(root, "var");
  dbPath = path.join(varDir, "data", "app.sqlite");
  preMigrationDir = path.join(varDir, "pre-migration");
  backupReadyDir = path.join(varDir, "backup-ready");
  preservedDir = path.join(varDir, "preserved");
  stateDir = path.join(varDir, "release-state");
  markerPath = path.join(varDir, "maintenance");
  recoveryLock = path.join(varDir, "health", "recovery.lock");
  lockPath = path.join(varDir, "ops.lock");
  callsLog = path.join(root, "calls.log");
  binDir = path.join(root, "bin");
  appEnvFile = path.join(root, "app.env");
  for (const dir of [preMigrationDir, backupReadyDir, preservedDir, path.join(varDir, "health"), binDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(stateDir, { mode: 0o700 });
  fs.writeFileSync(lockPath, "");
  fs.writeFileSync(appEnvFile, `DOLMUS_DB_PATH=${dbPath}\n`);
  fs.writeFileSync(path.join(root, "service-state"), "active\n");

  const state = path.join(root, "service-state");
  fs.writeFileSync(
    path.join(binDir, "systemctl"),
    `#!/bin/sh
[ "$2" = dolmus-takip.service ] || exit 64
echo "systemctl $1 marker=$([ -f "${markerPath}" ] && echo 1 || echo 0)" >> "${callsLog}"
case "$1" in
  is-active) s=$(cat "${state}"); echo "$s"; [ "$s" = active ] && exit 0; exit 3 ;;
  stop) echo inactive > "${state}"; exit 0 ;;
  start)
    if [ -f "${root}/start-fails" ]; then echo failed > "${state}"; echo "Job for dolmus-takip.service failed." >&2; exit 1; fi
    echo active > "${state}"
    if [ -f "${root}/start-hook.cjs" ]; then "${process.execPath}" "${root}/start-hook.cjs"; fi
    exit 0 ;;
  show)
    echo "ActiveState=$(cat "${state}")"; echo "SubState=dead"
    if [ -f "${root}/start-fails" ]; then echo "Result=start-limit-hit"; else echo "Result=success"; fi
    exit 0 ;;
esac
exit 64
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(binDir, "runuser"),
    `#!/bin/sh
[ "$1" = -u ] && [ "$2" = dolmus-takip ] && [ "$3" = -- ] || exit 64
shift 3
echo "runuser cwd=$(basename "$PWD") pre_migration_manifests=$(ls "${preMigrationDir}" | grep -c 'manifest.json$') $*" >> "${callsLog}"
exec "$@"
`,
    { mode: 0o755 },
  );

  const sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
  migrate(createDb(sqlite), { migrationsFolder: path.join(projectRoot, "drizzle") });
  await seedDevData(sqlite);
  insertEntry(sqlite, "entry-1", 100_000, "driver");
  insertEntry(sqlite, "entry-2", 250_050, "owner");
  insertSession(sqlite, "s-before-release");
  sqlite.close();
}, SLOW);

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Uygulamanın başlarken DB'ye yazdığı durum: trafik açılmadan önce parmak izi değişir. */
function writeOnStart(): void {
  fs.writeFileSync(
    path.join(root, "start-hook.cjs"),
    `const Database = require(${JSON.stringify(path.join(projectRoot, "node_modules", "better-sqlite3"))});
const db = new Database(${JSON.stringify(dbPath)});
db.prepare("UPDATE sessions SET last_seen_at = '2026-09-24T09:00:00.000Z' WHERE id = 's-before-release'").run();
db.close();
`,
  );
}

// ---------------------------------------------------------------------------
// deploy
// ---------------------------------------------------------------------------

describe("scripts/release-apply.ts deploy", () => {
  it("yayın: işaret → durdur → eski release'in doğrulanmış kopyası → db-init --existing → current → live/ready/mali kontrol → trafik", async () => {
    const result = await deploy(MIG);
    expectOk(result);

    // İşaret servis durmadan önce kondu; migration yalnız doğrulanmış kopya varken çalıştı.
    const stop = indexOfCall(/^systemctl stop marker=1$/);
    const copy = indexOfCall(new RegExp(`^runuser cwd=${OLD} pre_migration_manifests=0 .*scripts/db-backup.ts pre-migration$`));
    const init = indexOfCall(new RegExp(`^runuser cwd=${MIG} pre_migration_manifests=1 .*scripts/db-init.ts --existing$`));
    const start = indexOfCall(/^systemctl start marker=1$/);
    expect(stop).toBeGreaterThan(-1);
    expect(copy).toBeGreaterThan(stop);
    expect(init).toBeGreaterThan(copy);
    expect(start).toBeGreaterThan(init);
    expect(calls().filter((line) => line.includes("db-init.ts"))).toHaveLength(1);
    expect(calls().some((line) => /reset-failed/.test(line))).toBe(false);

    const [manifestName] = preMigrationManifests();
    const manifest = parseManifest(fs.readFileSync(path.join(preMigrationDir, manifestName!), "utf8"));
    expect(manifest, "pre-migration manifesti BackupManifest biçiminde").not.toBeNull();
    expect(manifest!.release_id).toBe(OLD);
    expect(manifest!.schema.applied_migrations).toBe(4);
    expect(sha256(path.join(preMigrationDir, manifest!.file))).toBe(manifest!.sha256);

    const state = readState();
    expect(state).toMatchObject({
      release_id: MIG,
      previous_release_id: OLD,
      phase: "traffic_open",
      pre_migration: manifest!.stem,
      migrations_applied: 1,
      verified_at: null,
      failure: null,
    });
    expect(state.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(state.traffic_opened_at).toISOString()).toBe(state.traffic_opened_at);
    expect(fs.existsSync(markerPath)).toBe(false);
    expect(currentRelease()).toBe(MIG);
    expect(migrationCount()).toBe(5);
    expect(serviceState()).toBe("active");
    expect(fs.statSync(path.join(stateDir, "state.json")).mode & 0o777).toBe(0o600);
    // Trafik satırı son, ready/mali kontrol satırlarından sonra.
    const out = result.stdout;
    expect(out.indexOf("event=release_ready")).toBeLessThan(out.indexOf("event=release_financial_smoke"));
    expect(out.indexOf("event=release_financial_smoke")).toBeLessThan(out.indexOf("event=release_traffic_opened"));
  }, SLOW);

  it("yayın öncesi kopya başarısızsa db-init hiç çalışmaz; eski release current, işaret yerinde, eski servis yeniden başlar", async () => {
    fs.chmodSync(preMigrationDir, 0o500);
    try {
      const result = await deploy(MIG);
      expectRefused(result, "pre_migration_failed");
    } finally {
      fs.chmodSync(preMigrationDir, 0o750);
    }
    expect(calls().some((line) => line.includes("db-init.ts"))).toBe(false);
    expect(currentRelease()).toBe(OLD);
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(migrationCount()).toBe(4);
    expect(indexOfCall(/^systemctl start marker=1$/)).toBeGreaterThan(indexOfCall(/^systemctl stop marker=1$/));
    expect(serviceState()).toBe("active");
    expect(readState()).toMatchObject({
      phase: "pre_migration",
      pre_migration: null,
      migrations_applied: 0,
      traffic_opened_at: null,
      failure: { phase: "pre_migration", reason: "pre_migration_failed" },
    });
  }, SLOW);

  it("ready 200 olmazsa trafik açılmaz: işaret yerinde, traffic_opened_at yok", async () => {
    health.ready = 503;
    const result = await deploy(MIG);
    const line = expectRefused(result, "readiness_failed");
    expect(line).toContain("ready=503");
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(readState()).toMatchObject({
      phase: "started",
      migrations_applied: 1,
      traffic_opened_at: null,
      failure: { phase: "started", reason: "readiness_failed" },
    });
  }, SLOW);

  it("live 200 olmazsa trafik açılmaz", async () => {
    health.live = 500;
    expectRefused(await deploy(MIG), "readiness_failed");
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(readState().traffic_opened_at).toBeNull();
  }, SLOW);

  it("başlatma sınırı (start-limit-hit) birim durumuyla hata olur; reset-failed çağrılmaz", async () => {
    fs.writeFileSync(path.join(root, "start-fails"), "");
    const line = expectRefused(await deploy(MIG), "service_start_failed");
    expect(line).toContain("unit_result=start-limit-hit");
    expect(line).toContain("unit_activestate=failed");
    expect(calls().some((l) => /reset-failed/.test(l))).toBe(false);
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(readState().traffic_opened_at).toBeNull();
  }, SLOW);

  it("trafik açılmadan canlı DB değişirse (parmak izi) trafik açılmaz", async () => {
    writeOnStart();
    expectRefused(await deploy(MIG), "db_changed_before_traffic");
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(readState().traffic_opened_at).toBeNull();
  }, SLOW);

  it("migration mali toplamı değiştirirse current değişmeden ve servis başlamadan durur", async () => {
    const line = expectRefused(await deploy(BAD), "financial_smoke_failed");
    expect(line).toContain("field=received_cents");
    expect(currentRelease()).toBe(OLD);
    expect(serviceState()).toBe("inactive");
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(readState()).toMatchObject({ phase: "migrating", migrations_applied: 1, traffic_opened_at: null });
  }, SLOW);

  it("--under-maintenance (F5 ileri düzeltmesi): elle konmuş işareti devralır, kontroller geçince kaldırır", async () => {
    expectOk(await deploy(SAME));
    fs.writeFileSync(markerPath, "");
    const result = await runApply(MIG, ["deploy", "--under-maintenance"]);
    expectOk(result);
    expect(result.stdout).toContain("under_maintenance=true");
    expect(readState()).toMatchObject({ release_id: MIG, previous_release_id: SAME, phase: "traffic_open", migrations_applied: 1 });
    expect(currentRelease()).toBe(MIG);
    expect(fs.existsSync(markerPath)).toBe(false);
  }, SLOW);

  describe("ön kontroller: hiçbir şey değişmez", () => {
    function expectUntouched(): void {
      expect(calls().filter((line) => /^systemctl (stop|start)/.test(line))).toEqual([]);
      expect(fs.existsSync(markerPath)).toBe(false);
      expect(currentRelease()).toBe(OLD);
      expect(preMigrationManifests()).toEqual([]);
    }

    it("kurtarma kilidi varken", async () => {
      fs.writeFileSync(recoveryLock, "reason=restart-budget-exceeded\n");
      expectRefused(await deploy(MIG), "recovery_lock_present");
      expectUntouched();
    }, SLOW);

    it("release zaten current iken", async () => {
      expectRefused(await deploy(OLD), "already_current");
      expectUntouched();
    }, SLOW);

    it("release manifesti yoksa veya migration dosyası manifestle uyuşmuyorsa", async () => {
      fs.rmSync(path.join(releasesDir, `${MIG}.manifest.json`));
      expectRefused(await deploy(MIG), "release_manifest_missing");
      writeReleaseManifest(releasesDir, SAME);
      fs.renameSync(path.join(releasesDir, `${SAME}.manifest.json`), path.join(releasesDir, `${MIG}.manifest.json`));
      expectRefused(await deploy(MIG), "release_manifest_mismatch");
      expectUntouched();
    }, SLOW);

    it("bakım işareti zaten varken (başka bir bakım)", async () => {
      fs.writeFileSync(markerPath, "");
      expectRefused(await deploy(MIG), "maintenance_already_on");
      expect(calls().filter((line) => /^systemctl (stop|start)/.test(line))).toEqual([]);
      expect(fs.existsSync(markerPath)).toBe(true);
      expect(fs.existsSync(path.join(stateDir, "state.json"))).toBe(false);
    }, SLOW);

    it("--under-maintenance işaret yokken reddedilir", async () => {
      expectRefused(await runApply(MIG, ["deploy", "--under-maintenance"]), "maintenance_off");
      expectUntouched();
      expectRefused(await runApply(MIG, ["deploy", "--force"]), "usage");
    }, SLOW);

    it("ortak kilit tutuluyken 75 ile çıkar", async () => {
      const holder: ChildProcess = spawn("flock", [lockPath, "sleep", "30"], { stdio: "ignore" });
      try {
        while (spawnSync("flock", ["-n", lockPath, "true"]).status === 0) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expectRefused(await deploy(MIG), "ops_lock_busy", 75);
      } finally {
        holder.kill();
      }
      expectUntouched();
    }, SLOW);

    it("yayın durumu dizini bu kullanıcıya özel (0700) değilse", async () => {
      fs.chmodSync(stateDir, 0o750);
      expectRefused(await deploy(MIG), "state_dir_not_private");
      expectUntouched();
    }, SLOW);

    it("önceki yayın çözülmemişse (bakımda kaldıysa) ikinci yayın başlamaz", async () => {
      health.ready = 503;
      expectRefused(await deploy(MIG), "readiness_failed");
      fs.rmSync(markerPath);
      const second = expectRefused(await deploy(SAME), "previous_release_unresolved");
      expect(second).toContain(`release_id=${MIG}`);
      expect(currentRelease()).toBe(MIG);
    }, SLOW);

    it("current yoksa (ilk kurulum SERVER-SETUP §3.4'tür)", async () => {
      fs.rmSync(currentLink);
      expectRefused(await deploy(MIG), "current_missing");
      expect(calls()).toEqual([]);
    }, SLOW);
  });
});

// ---------------------------------------------------------------------------
// rollback
// ---------------------------------------------------------------------------

describe("scripts/release-apply.ts rollback", () => {
  it("--code: yayın migration uyguladıysa reddedilir, hiçbir şey değişmez", async () => {
    expectOk(await deploy(MIG));
    const before = calls().length;
    const line = expectRefused(await runApply(MIG, ["rollback", "--code"]), "migrations_applied");
    expect(line).toContain("migrations_applied=1");
    expect(calls()).toHaveLength(before);
    expect(currentRelease()).toBe(MIG);
    expect(fs.existsSync(markerPath)).toBe(false);
  }, SLOW);

  it("--code: migration sayısı bilinmiyorsa (db-init yarıda) reddedilir", async () => {
    fs.chmodSync(preMigrationDir, 0o500);
    try {
      expectRefused(await deploy(MIG), "pre_migration_failed");
    } finally {
      fs.chmodSync(preMigrationDir, 0o750);
    }
    const state = readState();
    fs.writeFileSync(path.join(stateDir, "state.json"), JSON.stringify({ ...state, phase: "migrating", migrations_applied: null }));
    expectRefused(await runApply(MIG, ["rollback", "--code"]), "migrations_unknown");
  }, SLOW);

  it("--code: migration'sız yayın trafik açıldıktan sonra da eski koda döner; DB aynı kalır", async () => {
    expectOk(await deploy(SAME));
    expect(readState().migrations_applied).toBe(0);
    const dbBefore = withDb((sqlite) => sqlite.prepare("SELECT COUNT(*) AS c FROM work_entries").get());
    const result = await runApply(SAME, ["rollback", "--code"]);
    expectOk(result);
    expect(currentRelease()).toBe(OLD);
    expect(fs.existsSync(markerPath)).toBe(false);
    expect(fs.readdirSync(preservedDir)).toEqual([]);
    expect(withDb((sqlite) => sqlite.prepare("SELECT COUNT(*) AS c FROM work_entries").get())).toEqual(dbBefore);
    expect(readState()).toMatchObject({ phase: "rolled_back", rollback: { mode: "code", preserved: null }, failure: null });
    expect(indexOfCall(/^systemctl stop marker=1$/)).toBeGreaterThan(-1);
    expect(result.stdout).toContain("event=release_traffic_opened");
  }, SLOW);

  it("--code: yayın öncesi kopya başarısız olduysa eski release'i doğrulayıp bakımdan çıkar", async () => {
    fs.chmodSync(preMigrationDir, 0o500);
    try {
      expectRefused(await deploy(MIG), "pre_migration_failed");
    } finally {
      fs.chmodSync(preMigrationDir, 0o750);
    }
    // db-init hiç çalışmadı; --code-and-db'nin kopyası yok.
    expectRefused(await runApply(MIG, ["rollback", "--code-and-db"]), "pre_migration_missing");
    expect(fs.existsSync(markerPath)).toBe(true);
    const result = await runApply(MIG, ["rollback", "--code"]);
    expectOk(result);
    expect(currentRelease()).toBe(OLD);
    expect(migrationCount()).toBe(4);
    expect(fs.existsSync(markerPath)).toBe(false);
    expect(readState()).toMatchObject({ phase: "rolled_back", failure: null });
  }, SLOW);

  it("--code-and-db: trafik açıldıktan sonra reddedilir; DB/WAL'a dokunulmaz", async () => {
    expectOk(await deploy(MIG));
    const liveBefore = sha256(dbPath);
    const before = calls().length;
    const line = expectRefused(await runApply(MIG, ["rollback", "--code-and-db"]), "traffic_opened");
    expect(line).toContain("traffic_opened_at=");
    expect(calls()).toHaveLength(before);
    expect(sha256(dbPath)).toBe(liveBefore);
    expect(fs.readdirSync(preservedDir)).toEqual([]);
    expect(currentRelease()).toBe(MIG);
  }, SLOW);

  it("--code-and-db: canlı DB parmak izi kayıtlıdan farklıysa (yazma olmuş) reddedilir; DB yerinde kalır", async () => {
    health.ready = 503;
    expectRefused(await deploy(MIG), "readiness_failed");
    withDb((sqlite) => insertEntry(sqlite, "entry-after-release", 90_000, "owner"));
    health.ready = 200;
    const result = await runApply(MIG, ["rollback", "--code-and-db"]);
    expectRefused(result, "fingerprint_mismatch");
    expect(calls().some((line) => line.includes("db-restore.ts"))).toBe(false);
    expect(fs.readdirSync(preservedDir)).toEqual([]);
    expect(withDb((sqlite) => sqlite.prepare("SELECT COUNT(*) AS c FROM work_entries WHERE id = 'entry-after-release'").get())).toEqual({ c: 1 });
    expect(migrationCount()).toBe(5);
    expect(currentRelease()).toBe(MIG);
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(readState().failure).toMatchObject({ phase: "rolling_back", reason: "fingerprint_mismatch" });
  }, SLOW);

  it("--code-and-db: yayın durumu okunamıyorsa müşteri yazması kabul edilmiş sayılır ve reddedilir", async () => {
    health.ready = 503;
    expectRefused(await deploy(MIG), "readiness_failed");
    fs.writeFileSync(path.join(stateDir, "state.json"), "{ bozuk");
    const before = calls().length;
    expectRefused(await runApply(MIG, ["rollback", "--code-and-db"]), "state_unreadable");
    expect(calls()).toHaveLength(before);
    expect(migrationCount()).toBe(5);
  }, SLOW);

  it("--code-and-db: trafik açılmadan; yeni DB/WAL preserved altına taşınır, oturumlar iptal, eski şema ve eski release", async () => {
    health.ready = 503;
    expectRefused(await deploy(MIG), "readiness_failed");
    expect(migrationCount()).toBe(5);
    const liveBefore: Record<string, string> = {};
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(`${dbPath}${suffix}`)) liveBefore[`app.sqlite${suffix}`] = sha256(`${dbPath}${suffix}`);
    }
    health.ready = 200;

    const result = await runApply(MIG, ["rollback", "--code-and-db"]);
    expectOk(result);
    expect(result.stdout).toContain("event=restore_installed");
    const install = indexOfCall(new RegExp(`^runuser cwd=${OLD} .*scripts/db-restore.ts install --manifest `));
    expect(install).toBeGreaterThan(indexOfCall(/^systemctl stop marker=1$/));

    const state = readState();
    expect(state).toMatchObject({ phase: "rolled_back", rollback: { mode: "code-and-db" }, failure: null });
    const preserved = state.rollback.preserved as string;
    expect(path.dirname(preserved)).toBe(preservedDir);
    const moved = Object.fromEntries(fs.readdirSync(preserved).map((name) => [name, sha256(path.join(preserved, name))]));
    // Geri dönüş öncesi her canlı dosya aynı baytlarla taşındı; salt okunur parmak izi
    // okumasının açtığı -wal/-shm de silinmedi, taşındı.
    expect(moved).toMatchObject(liveBefore);
    expect(Object.keys(moved).every((name) => /^app\.sqlite(-wal|-shm)?$/.test(name))).toBe(true);

    expect(currentRelease()).toBe(OLD);
    expect(migrationCount()).toBe(4);
    expect(withDb((sqlite) => sqlite.prepare("SELECT COUNT(*) AS c FROM sessions WHERE revoked_at IS NULL").get())).toEqual({ c: 0 });
    expect(fs.existsSync(markerPath)).toBe(false);
    expect(state.traffic_opened_at).not.toBeNull();
    // İkinci geri dönüş yok.
    expectRefused(await runApply(MIG, ["rollback", "--code-and-db"]), "already_rolled_back");
  }, SLOW);

  it("geri alınan release'in dizininden çalıştırılmazsa reddedilir", async () => {
    expectOk(await deploy(SAME));
    expectRefused(await runApply(OLD, ["rollback", "--code"]), "wrong_release_dir");
    expect(currentRelease()).toBe(SAME);
  }, SLOW);

  it("bilinmeyen bayrak veya bayraksız rollback reddedilir", async () => {
    expectRefused(await runApply(MIG, ["rollback"]), "usage");
    expectRefused(await runApply(MIG, ["rollback", "--db"]), "usage");
  }, SLOW);
});

// ---------------------------------------------------------------------------
// mark-verified ve cleanup
// ---------------------------------------------------------------------------

describe("scripts/release-apply.ts mark-verified ve cleanup", () => {
  const EXTRA = "5555555e";
  const REFERENCED = "6666666f";

  function addBareRelease(id: string): void {
    fs.mkdirSync(path.join(releasesDir, id));
    fs.writeFileSync(path.join(releasesDir, `${id}.manifest.json`), "{}\n");
  }

  /** backup-ready'de REFERENCED release'e bağlı tutulan bir kopya. */
  function addBackupReferencing(id: string): void {
    const [name] = preMigrationManifests();
    const manifest = JSON.parse(fs.readFileSync(path.join(preMigrationDir, name!), "utf8"));
    const stem = "app-20260101T000000Z";
    fs.copyFileSync(path.join(preMigrationDir, manifest.file), path.join(backupReadyDir, `${stem}.sqlite`));
    fs.writeFileSync(
      path.join(backupReadyDir, `${stem}.manifest.json`),
      JSON.stringify({ ...manifest, stem, file: `${stem}.sqlite`, release_id: id }),
    );
  }

  const releaseEntries = (): string[] => fs.readdirSync(releasesDir).sort();

  it("mark-verified öncesi: önceki release ve yayın öncesi kopya silinmez; kopyaya bağlı release silinmez", async () => {
    expectOk(await deploy(MIG));
    addBareRelease(EXTRA);
    addBareRelease(REFERENCED);
    addBackupReferencing(REFERENCED);
    const copies = fs.readdirSync(preMigrationDir).sort();

    const result = await runApply(MIG, ["cleanup"]);
    expectOk(result);
    expect(result.stdout).toMatch(new RegExp(`event=cleanup_kept .*release_id=${OLD} reason=previous_not_verified`));
    expect(result.stdout).toMatch(/event=cleanup_kept .*pre_migration=app-\S+ reason=previous_not_verified/);
    expect(fs.readdirSync(preMigrationDir).sort()).toEqual(copies);
    expect(releaseEntries()).toEqual(
      [OLD, `${OLD}.manifest.json`, MIG, `${MIG}.manifest.json`, REFERENCED, `${REFERENCED}.manifest.json`].sort(),
    );
  }, SLOW);

  it("mark-verified sonrası: yayın öncesi kopya ve önceki release silinir; current ve kopyaya bağlı release kalır", async () => {
    expectOk(await deploy(MIG));
    addBareRelease(REFERENCED);
    addBackupReferencing(REFERENCED);
    const verified = await runApply(MIG, ["mark-verified"]);
    expectOk(verified);
    expect(readState()).toMatchObject({ phase: "verified" });
    expect(new Date(readState().verified_at).toISOString()).toBe(readState().verified_at);

    expectOk(await runApply(MIG, ["cleanup"]));
    expect(fs.readdirSync(preMigrationDir)).toEqual([]);
    expect(releaseEntries()).toEqual([MIG, `${MIG}.manifest.json`, REFERENCED, `${REFERENCED}.manifest.json`].sort());
    expect(fs.readdirSync(backupReadyDir)).toHaveLength(2);
  }, SLOW);

  it("okunamayan veya yarım manifest varsa hiçbir şey silinmez", async () => {
    expectOk(await deploy(MIG));
    expectOk(await runApply(MIG, ["mark-verified"]));
    addBareRelease(EXTRA);
    fs.writeFileSync(path.join(backupReadyDir, "app-20260101T000000Z.sqlite"), "x");
    fs.writeFileSync(path.join(backupReadyDir, "app-20260101T000000Z.manifest.json"), "{ bozuk");
    const before = releaseEntries();
    const copies = fs.readdirSync(preMigrationDir).sort();
    expectRefused(await runApply(MIG, ["cleanup"]), "manifest_unreadable");
    expect(releaseEntries()).toEqual(before);
    expect(fs.readdirSync(preMigrationDir).sort()).toEqual(copies);

    fs.rmSync(path.join(backupReadyDir, "app-20260101T000000Z.manifest.json"));
    expectRefused(await runApply(MIG, ["cleanup"]), "manifest_unreadable");
    expect(releaseEntries()).toEqual(before);
  }, SLOW);

  it("mark-verified yalnız trafiği açık, hatasız yayında", async () => {
    health.ready = 503;
    expectRefused(await deploy(MIG), "readiness_failed");
    expectRefused(await runApply(MIG, ["mark-verified"]), "not_traffic_open");
    expect(readState().verified_at).toBeNull();
  }, SLOW);
});

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

describe("scripts/release-apply.ts inspect", () => {
  it("salt okunur: DB baytları değişmez; parmak izi bir satır değişince değişir", () => {
    const env = { ...process.env, DOLMUS_DB_PATH: dbPath };
    const inspect = () =>
      spawnSync(process.execPath, [path.join(releasesDir, OLD, "scripts", "release-apply.ts"), "inspect", "--release", path.join(releasesDir, OLD)], {
        cwd: path.join(releasesDir, OLD),
        env,
        encoding: "utf8",
      });
    const before = sha256(dbPath);
    const first = inspect();
    expect(first.status, first.stdout + first.stderr).toBe(0);
    const parsed = JSON.parse(first.stdout.trim());
    expect(parsed.check_failure).toBeNull();
    expect(parsed.verified.row_counts.work_entries).toBe(2);
    expect(parsed.applied_migrations).toBe(4);
    expect(sha256(dbPath)).toBe(before);
    expect(JSON.parse(inspect().stdout.trim()).fingerprint).toBe(parsed.fingerprint);

    withDb((sqlite) => sqlite.prepare("UPDATE people SET full_name = full_name || ' ' WHERE id = ?").run(SEED_IDS.ownerA));
    expect(JSON.parse(inspect().stdout.trim()).fingerprint).not.toBe(parsed.fingerprint);
  }, SLOW);

  it("başka release'in şemasına göre: eksik migration check_failure olarak döner, çıkış yine 0", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(releasesDir, OLD, "scripts", "release-apply.ts"), "inspect", "--release", path.join(releasesDir, MIG)],
      { cwd: path.join(releasesDir, OLD), env: { ...process.env, DOLMUS_DB_PATH: dbPath }, encoding: "utf8" },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.verified).toBeNull();
    expect(parsed.check_failure.reason).toBe("schema_not_current");
  }, SLOW);
});
