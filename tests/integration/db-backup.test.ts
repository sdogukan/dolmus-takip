import { spawnSync } from "node:child_process";
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
 * `scripts/db-backup.ts` — gerçek geçici SQLite dosyası, gerçek migration ve
 * script'in KENDİSİ gerçek alt süreçte (mock/`:memory:` yok; QA-PLAN §1).
 * Saat `DOLMUS_BACKUP_NOW` ile sabitlenir: 02:55–04:00 Europe/Istanbul
 * penceresi testleri günün saatine bağlı değildir.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = path.join(projectRoot, "scripts", "db-backup.ts");
const migrationsFolder = path.join(projectRoot, "drizzle");

// Istanbul = UTC+3. Hepsi korumalı pencerenin (23:55Z–01:00Z) DIŞINDA.
const DAY1 = "2026-09-24T12:00:00Z";
const DAY2 = "2026-09-25T12:00:00Z";
const DAY3 = "2026-09-26T12:00:00Z";
const INSIDE_WINDOW = "2026-09-25T00:10:00Z"; // 03:10 Istanbul

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

let root: string;
let dbPath: string;
let backupDir: string;

function runCli(args: string[], now: string | null, extraEnv: Record<string, string> = {}): CliResult {
  const env: Record<string, string | undefined> = {
    ...process.env,
    DOLMUS_DB_PATH: dbPath,
    DOLMUS_BACKUP_DIR: backupDir,
    ...extraEnv,
  };
  if (now === null) delete env.DOLMUS_BACKUP_NOW;
  else env.DOLMUS_BACKUP_NOW = now;
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const ACTOR = {
  actor_kind: "platform_user",
  actor_session_id: "session-trace-1",
  actor_role: "admin",
  actor_platform_user_id: SEED_IDS.platformAdmin1,
} as const;

function insertEntry(
  sqlite: ReturnType<typeof openDatabaseConnection>,
  id: string,
  gross: number,
  fuel: number,
  other: number,
  workKind: "owner" | "driver",
): void {
  const amounts = calculateWorkEntryAmounts(workKind, gross, fuel, other);
  sqlite
    .prepare(
      `INSERT INTO work_entries (business_id, id, vehicle_id, person_id, work_kind, work_date, starts_at, ends_at,
         duration_minutes, gross_cents, fuel_cents, other_expense_cents, share_bps, share_cents, remainder_cents,
         calculation_version, status, version)
       VALUES (?, ?, ?, ?, ?, '2026-09-20', '2026-09-20T05:00:00.000Z', '2026-09-20T09:00:00.000Z',
         240, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 1)`,
    )
    .run(
      SEED_IDS.businessA,
      id,
      SEED_IDS.vehicleA1,
      workKind === "owner" ? SEED_IDS.ownerA : SEED_IDS.driverA1a,
      workKind,
      gross,
      fuel,
      other,
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
    .run(SEED_IDS.businessA, id, ACTOR.actor_kind, ACTOR.actor_session_id, ACTOR.actor_role, ACTOR.actor_platform_user_id);
  sqlite
    .prepare(
      `INSERT INTO cash_confirmations (business_id, id, entry_id, entry_version, received_cents, confirmed_at,
         actor_kind, actor_session_id, actor_role, actor_platform_user_id)
       VALUES (?, ?, ?, 1, ?, '2026-09-20T09:02:00.000Z', ?, ?, ?, ?)`,
    )
    .run(SEED_IDS.businessA, `cc-${id}`, id, remainderOrZero(amounts.remainderCents), ACTOR.actor_kind, ACTOR.actor_session_id, ACTOR.actor_role, ACTOR.actor_platform_user_id);
}

const remainderOrZero = (n: number): number => Math.max(n, 0);

function withLiveDb<T>(fn: (sqlite: ReturnType<typeof openDatabaseConnection>) => T): T {
  const sqlite = openDatabaseConnection(dbPath);
  try {
    return fn(sqlite);
  } finally {
    sqlite.close();
  }
}

const sha256 = (file: string): string => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Yayımlanmış (nokta önekli olmayan) dosyalar. */
function published(): string[] {
  return fs
    .readdirSync(backupDir)
    .filter((name) => !name.startsWith("."))
    .sort();
}

function snapshotOf(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, sha256(path.join(backupDir, name))]));
}

function readManifest(stem: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(backupDir, `${stem}.manifest.json`), "utf8"));
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-db-backup-"));
  dbPath = path.join(root, "data", "app.sqlite");
  backupDir = path.join(root, "backup-ready");
  fs.mkdirSync(backupDir);
  const sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
  migrate(createDb(sqlite), { migrationsFolder });
  await seedDevData(sqlite);
  insertEntry(sqlite, "entry-1", 100_000, 10_000, 5_000, "driver");
  insertEntry(sqlite, "entry-2", 250_050, 0, 1_234, "owner");
  sqlite.close();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("scripts/db-backup.ts run", () => {
  it("gerçek DB'den tarihli kopya + manifest üretir; manifest kopyayla eşleşir", () => {
    const result = runCli(["run"], DAY1);
    expect(result.status, result.stdout + result.stderr).toBe(0);

    const stem = "app-20260924T120000Z";
    expect(published()).toEqual([`${stem}.manifest.json`, `${stem}.sqlite`]);
    const manifest = readManifest(stem);

    expect(manifest.sha256).toBe(sha256(path.join(backupDir, `${stem}.sqlite`)));
    expect(manifest.size_bytes).toBe(fs.statSync(path.join(backupDir, `${stem}.sqlite`)).size);
    expect(manifest.release_id).toBe(path.basename(fs.realpathSync(projectRoot)));
    expect(manifest.schema.applied_migrations).toBe(4);
    expect(manifest.schema.last_migration_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sqlite_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(manifest.verified_at).toBe("2026-09-24T12:00:00.000Z");
    expect(manifest.istanbul.verified_at).toBe("2026-09-24T15:00:00+03:00");
    expect(manifest.row_counts.work_entries).toBe(2);
    expect(manifest.row_counts.work_entry_revisions).toBe(2);
    expect(manifest.row_counts.cash_confirmations).toBe(2);
    expect(manifest.row_counts.sessions).toBe(0);
    expect(manifest.row_counts).not.toHaveProperty("__drizzle_migrations");
    expect(manifest.totals.gross_cents).toBe("350050");
    expect(manifest.totals.fuel_cents).toBe("10000");
    expect(manifest.totals.other_expense_cents).toBe("6234");
    expect(manifest.totals.share_cents).toBe("20000"); // yalnız şoför kaydı: %20 · 100000
    expect(typeof manifest.totals.received_cents).toBe("string");
    expect(manifest.last_committed_record.work_entry_revision).toMatchObject({ version: 1 });
    expect(manifest.last_committed_record.cash_confirmation.confirmed_at).toBe("2026-09-20T09:02:00.000Z");
    expect(manifest.checks).toMatchObject({ integrity_check: "ok", foreign_key_violations: 0, entry_amount_mismatches: 0 });
    expect(JSON.stringify(manifest)).not.toMatch(/password|hash":\s*"\$argon2|token/i);

    expect(result.stdout).toContain("event=backup_published");
  });

  it("yayımlanan kopya tek başına, salt okunur açılır: -wal/-shm yok, kontroller geçer, veri tam", () => {
    expect(runCli(["run"], DAY1).status).toBe(0);
    const copyPath = path.join(backupDir, "app-20260924T120000Z.sqlite");
    const before = sha256(copyPath);

    const copy = new Database(copyPath, { readonly: true, fileMustExist: true });
    try {
      expect(copy.pragma("journal_mode", { simple: true })).toBe("delete");
      expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(copy.pragma("foreign_key_check")).toEqual([]);
      expect((copy.prepare("SELECT COUNT(*) AS c FROM work_entries").get() as { c: number }).c).toBe(2);
    } finally {
      copy.close();
    }
    expect(sha256(copyPath)).toBe(before);
    expect(fs.readdirSync(backupDir).filter((n) => /-(wal|shm|journal)$/.test(n))).toEqual([]);
    // Dosya izinleri: kopya yalnız servis kullanıcısı, manifest grup okur.
    expect(fs.statSync(copyPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(backupDir, "app-20260924T120000Z.manifest.json")).mode & 0o777).toBe(0o640);
  });

  it("WAL'da bekleyen commit'ler kopyada vardır; canlı DB/WAL'a dokunulmaz", () => {
    const writer = openDatabaseConnection(dbPath);
    try {
      writer.pragma("wal_autocheckpoint = 0");
      insertEntry(writer, "entry-wal", 77_000, 1_000, 0, "driver");
      const walPath = `${dbPath}-wal`;
      const walBefore = fs.statSync(walPath).size;
      expect(walBefore).toBeGreaterThan(0);

      const result = runCli(["run"], DAY1);
      expect(result.status, result.stdout + result.stderr).toBe(0);

      expect(fs.statSync(walPath).size).toBe(walBefore);
      expect(writer.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally {
      writer.close();
    }
    expect(readManifest("app-20260924T120000Z").row_counts.work_entries).toBe(3);
  });

  it("saklama: yayından sonra tam olarak en yeni iki kopya kalır; dizin dışına ve yabancı dosyaya dokunmaz", () => {
    const outside = path.join(root, "outside.txt");
    fs.writeFileSync(outside, "dokunma");
    fs.writeFileSync(path.join(backupDir, "notes.txt"), "elle not");
    // Manifesti olmayan yarım kopya: "doğrulanmış kopya" sayılmaz, yayın sonrası temizlenir.
    fs.writeFileSync(path.join(backupDir, "app-20200101T000000Z.sqlite"), "yarım");

    expect(runCli(["run"], DAY1).status).toBe(0);
    expect(runCli(["run"], DAY2).status).toBe(0);
    expect(published().filter((n) => n.startsWith("app-"))).toEqual([
      "app-20260924T120000Z.manifest.json",
      "app-20260924T120000Z.sqlite",
      "app-20260925T120000Z.manifest.json",
      "app-20260925T120000Z.sqlite",
    ]);
    expect(runCli(["run"], DAY3).status).toBe(0);

    expect(published()).toEqual([
      "app-20260925T120000Z.manifest.json",
      "app-20260925T120000Z.sqlite",
      "app-20260926T120000Z.manifest.json",
      "app-20260926T120000Z.sqlite",
      "notes.txt",
    ]);
    expect(fs.readFileSync(outside, "utf8")).toBe("dokunma");
    expect(fs.readFileSync(path.join(backupDir, "notes.txt"), "utf8")).toBe("elle not");
  });

  it("önceki koşudan kalan kendi geçici dosyalarını siler, başkalarına dokunmaz", () => {
    const stale = ".dolmus-backup-tmp-app-20200101T000000Z.sqlite.99999";
    fs.writeFileSync(path.join(backupDir, stale), "yarım");
    fs.writeFileSync(path.join(backupDir, `${stale}-wal`), "yarım");
    fs.writeFileSync(path.join(backupDir, ".baska-arac"), "kalsın");

    expect(runCli(["run"], DAY1).status).toBe(0);
    expect(fs.existsSync(path.join(backupDir, stale))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, `${stale}-wal`))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, ".baska-arac"))).toBe(true);
  });

  describe("reddedilen kopya: önceki iki sağlam kopya bayt bayt aynı kalır", () => {
    let before: Record<string, string>;

    beforeEach(() => {
      expect(runCli(["run"], DAY1).status).toBe(0);
      expect(runCli(["run"], DAY2).status).toBe(0);
      before = snapshotOf(published());
      expect(Object.keys(before)).toHaveLength(4);
    });

    function expectRejected(result: CliResult, reason: string): void {
      expect(result.status, result.stdout + result.stderr).not.toBe(0);
      const errLines = result.stdout.split("\n").filter((line) => line.startsWith("<3>"));
      expect(errLines).toHaveLength(1);
      expect(errLines[0]).toContain("event=backup_failed");
      expect(errLines[0]).toContain(`reason=${reason}`);
      expect(snapshotOf(published())).toEqual(before);
      // Geçici dosya kalıntısı yok.
      expect(fs.readdirSync(backupDir).filter((n) => n.startsWith("."))).toEqual([]);
    }

    it("yayın anı 02:55–04:00 Europe/Istanbul içindeyse", () => {
      expectRejected(runCli(["run"], INSIDE_WINDOW), "protected_window");
      expectRejected(runCli(["run"], "2026-09-24T23:55:00Z"), "protected_window");
      expectRejected(runCli(["run"], "2026-09-25T00:59:59Z"), "protected_window");
    });

    it("pencerenin hemen dışında (04:00) yayımlar", () => {
      const result = runCli(["run"], "2026-09-25T01:00:00Z");
      expect(result.status, result.stdout + result.stderr).toBe(0);
    });

    it("korunan tabloda satır sayısı önceki manifestten azsa", () => {
      withLiveDb((sqlite) => sqlite.prepare("DELETE FROM cash_confirmations WHERE id = 'cc-entry-2'").run());
      const result = runCli(["run"], DAY3);
      expectRejected(result, "row_count_drop");
      expect(result.stdout).toContain("table=cash_confirmations");
    });

    it("foreign_key_check başarısızsa", () => {
      const raw = new Database(dbPath);
      try {
        raw.pragma("foreign_keys = OFF");
        raw
          .prepare(
            `INSERT INTO cash_confirmations (business_id, id, entry_id, entry_version, received_cents, confirmed_at,
               actor_kind, actor_session_id, actor_role, actor_platform_user_id)
             VALUES (?, 'cc-orphan', 'entry-1', 99, 1, '2026-09-21T09:02:00.000Z', ?, ?, ?, ?)`,
          )
          .run(SEED_IDS.businessA, ACTOR.actor_kind, ACTOR.actor_session_id, ACTOR.actor_role, ACTOR.actor_platform_user_id);
      } finally {
        raw.close();
      }
      expectRejected(runCli(["run"], DAY3), "foreign_key_check_failed");
    });

    it("bir iş kaydının payı/kalanı yeniden hesapla uyuşmuyorsa", () => {
      withLiveDb((sqlite) => sqlite.prepare("UPDATE work_entries SET share_cents = share_cents + 1 WHERE id = 'entry-1'").run());
      expectRejected(runCli(["run"], DAY3), "entry_amount_mismatch");
    });
  });

  it("ilk kopya bile pencere içinde yayımlanmaz ve dizinde iz bırakmaz", () => {
    const result = runCli(["run"], INSIDE_WINDOW);
    expect(result.status).not.toBe(0);
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });

  it("DB yoksa boş DB oluşturmaz, sıfırdan farklı çıkar", () => {
    fs.rmSync(path.join(root, "data"), { recursive: true });
    const result = runCli(["run"], DAY1);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("event=backup_failed");
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });

  it("yedek dizini yoksa dizini kendisi oluşturmaz", () => {
    const missing = path.join(root, "yok");
    const result = runCli(["run"], DAY1, { DOLMUS_BACKUP_DIR: missing });
    expect(result.status).not.toBe(0);
    expect(fs.existsSync(missing)).toBe(false);
  });

  it("geçersiz DOLMUS_BACKUP_NOW reddedilir; saat geçersizken kopya alınmaz", () => {
    const result = runCli(["run"], "yarin");
    expect(result.status).not.toBe(0);
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });

  it("bilinmeyen alt komut ve fazla argüman reddedilir", () => {
    expect(runCli(["restore"], DAY1).status).not.toBe(0);
    expect(runCli(["run", "fazla"], DAY1).status).not.toBe(0);
  });

  it("saat geçersiz kılma kullanıldığında bir warn satırı yazılır", () => {
    const result = runCli(["run"], DAY1);
    expect(result.stdout).toContain("<4>dolmus-backup event=backup_clock_override");
  });
});

describe("scripts/db-backup.ts status", () => {
  it("kopya yokken sıfırdan farklı çıkar", () => {
    const result = runCli(["status"], DAY1);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("event=backup_status");
    expect(result.stdout).toContain("verified_copies=0");
  });

  it("tutulan kopyaların release id'lerini listeler; dizini değiştirmez", () => {
    expect(runCli(["run"], DAY1).status).toBe(0);
    expect(runCli(["run"], DAY2).status).toBe(0);
    const before = snapshotOf(fs.readdirSync(backupDir));

    const result = runCli(["status"], DAY3);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const releaseId = path.basename(fs.realpathSync(projectRoot));
    expect(result.stdout).toContain(`release_ids=${releaseId}`);
    expect(result.stdout).toContain("verified_copies=2");
    expect(result.stdout.match(/event=backup_copy/g)).toHaveLength(2);
    expect(snapshotOf(fs.readdirSync(backupDir))).toEqual(before);
  });

  it("hash'i manifestle uyuşmayan kopyayı hata sayar", () => {
    expect(runCli(["run"], DAY1).status).toBe(0);
    fs.appendFileSync(path.join(backupDir, "app-20260924T120000Z.sqlite"), "x");
    const result = runCli(["status"], DAY2);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("sha256_ok=false");
  });

  it("manifestsiz kopya doğrulanmış sayılmaz", () => {
    expect(runCli(["run"], DAY1).status).toBe(0);
    fs.rmSync(path.join(backupDir, "app-20260924T120000Z.manifest.json"));
    const result = runCli(["status"], DAY2);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("event=backup_incomplete");
    expect(result.stdout).toContain("verified_copies=0");
  });
});
