import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  openDatabaseConnection,
  type SqliteConnection,
} from "../../src/server/data/db";
import {
  CliUsageError,
  createFirstAdmin,
  parseArgs,
  resetAdminPassword,
} from "../../scripts/platform-admin";

/**
 * `scripts/platform-admin.ts` entegrasyon testleri — T1.3 ADIM 1/2, S1.3, F11.
 *
 * Finansal/kimlik DB testleri yalnız mock veya :memory: üzerinde kabul
 * edilmez. Her test kendi geçici GERÇEK SQLite dosyasını açar, gerçek
 * migration'ı uygular; idempotency testi gerçek `child_process`
 * ile script'in KENDİSİNİ (stdout/exit kodu dahil) çalıştırır — hiçbir
 * yerde mock kimlik doğrulama YOKTUR.
 */

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");
const scriptPath = path.join(projectRoot, "scripts", "platform-admin.ts");

function freshMigratedDb(): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-platform-admin-"));
  const dbPath = path.join(dir, "test.sqlite");
  const sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
  const db = createDb(sqlite);
  migrate(db, { migrationsFolder });
  sqlite.close();
  return { dir, dbPath };
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Gerçek script'i GERÇEK bir alt süreçte (`node scripts/platform-admin.ts
 * ...`) çalıştırır — `--password-stdin` ile parola boruya (stdin) yazılır.
 * `npm run platform-admin` DEĞİL, doğrudan `node` kullanılır (npm'in kendi
 * stdout ön ekleri/gürültüsü olmadan tek satır çıktı doğrulamak için). */
function runCli(
  args: string[],
  options: { password: string; dbPath: string },
): CliResult {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: { ...process.env, DOLMUS_DB_PATH: options.dbPath },
    input: options.password,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function readPlatformUserRow(
  sqlite: SqliteConnection,
  username: string,
): { id: string; passwordHash: string; credentialVersion: number } | undefined {
  const row = sqlite
    .prepare(
      "SELECT id, password_hash AS passwordHash, credential_version AS credentialVersion FROM platform_users WHERE username = ?",
    )
    .get(username) as
    | { id: string; passwordHash: string; credentialVersion: number }
    | undefined;
  return row;
}

describe("scripts/platform-admin.ts — parseArgs (T1.3 ADIM 1/2)", () => {
  it("bilinmeyen alt komut için CliUsageError fırlatır", () => {
    expect(() => parseArgs(["yanlis-komut", "--username", "x"])).toThrow(
      CliUsageError,
    );
  });

  it("--username eksikse CliUsageError fırlatır", () => {
    expect(() => parseArgs(["create-first-admin"])).toThrow(CliUsageError);
  });

  it("--username değeri eksikse CliUsageError fırlatır", () => {
    expect(() =>
      parseArgs(["create-first-admin", "--username"]),
    ).toThrow(CliUsageError);
  });

  it("bilinmeyen bayrak için CliUsageError fırlatır", () => {
    expect(() =>
      parseArgs(["create-first-admin", "--username", "x", "--bilinmeyen"]),
    ).toThrow(CliUsageError);
  });

  it("geçerli girdiyi doğru ayrıştırır", () => {
    const parsed = parseArgs([
      "reset-admin-password",
      "--username",
      "admin.test",
      "--password-stdin",
    ]);
    expect(parsed).toEqual({
      subcommand: "reset-admin-password",
      username: "admin.test",
      passwordStdin: true,
    });
  });
});

describe("scripts/platform-admin.ts — createFirstAdmin/resetAdminPassword (fonksiyon düzeyi)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    ({ dir, dbPath } = freshMigratedDb());
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("create-first-admin ADMIN rolüyle, active=1, credential_version=1 kaydeder ve self-bootstrap admin_audit yazar", async () => {
    const sqlite = openDatabaseConnection(dbPath);
    try {
      const result = await createFirstAdmin(sqlite, "yeni.yonetici", "cok-guclu-sifre-1");
      expect(result.created).toBe(true);

      const row = sqlite
        .prepare(
          "SELECT platform_role AS role, active, credential_version AS version FROM platform_users WHERE username = ?",
        )
        .get("yeni.yonetici") as { role: string; active: number; version: number };
      expect(row.role).toBe("admin");
      expect(row.active).toBe(1);
      expect(row.version).toBe(1);

      const audit = sqlite
        .prepare(
          "SELECT action, actor_kind AS actorKind, actor_platform_user_id AS actorPlatformUserId, entity_id AS entityId, before_json AS beforeJson, after_json AS afterJson FROM admin_audit",
        )
        .all() as {
        action: string;
        actorKind: string;
        actorPlatformUserId: string;
        entityId: string;
        beforeJson: string | null;
        afterJson: string;
      }[];
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe("platform_user.bootstrap");
      expect(audit[0]!.actorKind).toBe("platform_user");
      // Self-bootstrap: aktör KENDİ (yeni oluşturulan) id'sidir.
      expect(audit[0]!.actorPlatformUserId).toBe(audit[0]!.entityId);
      expect(audit[0]!.beforeJson).toBeNull();
      expect(audit[0]!.afterJson).not.toContain("cok-guclu-sifre-1");
      expect(audit[0]!.afterJson.toLowerCase()).not.toContain("hash");
    } finally {
      sqlite.close();
    }
  });

  it("aynı kullanıcı adıyla İKİNCİ create-first-admin çağrısı hesabı ÇOĞALTMAZ ve hash'i DEĞİŞTİRMEZ", async () => {
    const sqlite = openDatabaseConnection(dbPath);
    try {
      const first = await createFirstAdmin(sqlite, "tek.admin", "ilk-sifre-123");
      expect(first.created).toBe(true);
      const afterFirst = readPlatformUserRow(sqlite, "tek.admin")!;

      const second = await createFirstAdmin(sqlite, "tek.admin", "farkli-sifre-456");
      expect(second.created).toBe(false);
      const afterSecond = readPlatformUserRow(sqlite, "tek.admin")!;

      expect(afterSecond.passwordHash).toBe(afterFirst.passwordHash);
      expect(afterSecond.id).toBe(afterFirst.id);

      const count = sqlite
        .prepare("SELECT COUNT(*) AS n FROM platform_users WHERE username = ?")
        .get("tek.admin") as { n: number };
      expect(count.n).toBe(1);

      // Yalnız 1 admin_audit satırı — ikinci (reddedilen) çağrı hiçbir
      // audit ÜRETMEDİ (DB'ye HİÇ dokunulmadı).
      const auditCount = sqlite
        .prepare("SELECT COUNT(*) AS n FROM admin_audit")
        .get() as { n: number };
      expect(auditCount.n).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("resetAdminPassword bilinmeyen kullanıcı için found:false döner (DB'ye dokunmaz)", async () => {
    const sqlite = openDatabaseConnection(dbPath);
    try {
      const result = await resetAdminPassword(sqlite, "hic-yok", "her-hangi-sifre");
      expect(result.found).toBe(false);
      const auditCount = sqlite
        .prepare("SELECT COUNT(*) AS n FROM admin_audit")
        .get() as { n: number };
      expect(auditCount.n).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it("resetAdminPassword hash'i günceller, credential_version'ı artırır ve reset_password audit'i yazar", async () => {
    const sqlite = openDatabaseConnection(dbPath);
    try {
      await createFirstAdmin(sqlite, "reset.hedef", "eski-sifre-1");
      const before = readPlatformUserRow(sqlite, "reset.hedef")!;

      const result = await resetAdminPassword(sqlite, "reset.hedef", "yeni-sifre-2");
      expect(result.found).toBe(true);

      const after = readPlatformUserRow(sqlite, "reset.hedef")!;
      expect(after.passwordHash).not.toBe(before.passwordHash);
      expect(after.credentialVersion).toBe(before.credentialVersion + 1);

      const audit = sqlite
        .prepare(
          "SELECT action, after_json AS afterJson FROM admin_audit WHERE action = 'platform_user.reset_password'",
        )
        .all() as { action: string; afterJson: string }[];
      expect(audit).toHaveLength(1);
      expect(audit[0]!.afterJson).toBe(JSON.stringify({ source: "server-shell" }));
      expect(audit[0]!.afterJson).not.toContain("yeni-sifre-2");
    } finally {
      sqlite.close();
    }
  });
});

describe("scripts/platform-admin.ts — GERÇEK child_process (create-first-admin idempotency)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    ({ dir, dbPath } = freshMigratedDb());
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("İKİ ayrı çalıştırma: birincisi oluşturur (tek satır), ikincisi 'zaten var' der; hash DEĞİŞMEZ; exit 0/0", () => {
    const first = runCli(
      ["create-first-admin", "--username", "cli.admin", "--password-stdin"],
      { password: "ilk-cli-sifresi", dbPath },
    );
    expect(first.status).toBe(0);
    const firstStdoutLines = first.stdout.trim().split("\n").filter(Boolean);
    expect(firstStdoutLines).toHaveLength(1);
    expect(firstStdoutLines[0]).toContain("oluşturuldu");
    expect(first.stdout).not.toContain("ilk-cli-sifresi");
    expect(first.stderr).not.toContain("ilk-cli-sifresi");

    const sqliteAfterFirst = openDatabaseConnection(dbPath);
    const hashAfterFirst = readPlatformUserRow(sqliteAfterFirst, "cli.admin")!.passwordHash;
    sqliteAfterFirst.close();

    const second = runCli(
      ["create-first-admin", "--username", "cli.admin", "--password-stdin"],
      { password: "ikinci-farkli-sifre", dbPath },
    );
    expect(second.status).toBe(0);
    const secondStdoutLines = second.stdout.trim().split("\n").filter(Boolean);
    expect(secondStdoutLines).toHaveLength(1);
    expect(secondStdoutLines[0]).toContain("zaten var");

    const sqliteAfterSecond = openDatabaseConnection(dbPath);
    const rowAfterSecond = readPlatformUserRow(sqliteAfterSecond, "cli.admin")!;
    const countAfterSecond = sqliteAfterSecond
      .prepare("SELECT COUNT(*) AS n FROM platform_users WHERE username = ?")
      .get("cli.admin") as { n: number };
    sqliteAfterSecond.close();

    expect(rowAfterSecond.passwordHash).toBe(hashAfterFirst);
    expect(countAfterSecond.n).toBe(1);
  });

  it("bilinmeyen kullanıcıyla reset-admin-password exit 1 döner ve DB'ye dokunmaz", () => {
    const result = runCli(
      ["reset-admin-password", "--username", "hic-yok-boyle-biri", "--password-stdin"],
      { password: "her-hangi-sifre", dbPath },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bulunamadı");

    const sqlite = openDatabaseConnection(dbPath);
    const count = sqlite.prepare("SELECT COUNT(*) AS n FROM platform_users").get() as {
      n: number;
    };
    sqlite.close();
    expect(count.n).toBe(0);
  });

  it("gerçek reset-admin-password çalıştırması stdout/stderr'de parolayı SIZDIRMAZ", () => {
    const created = runCli(
      ["create-first-admin", "--username", "cli.reset.admin", "--password-stdin"],
      { password: "ilk-sifre-abc", dbPath },
    );
    expect(created.status).toBe(0);

    const reset = runCli(
      ["reset-admin-password", "--username", "cli.reset.admin", "--password-stdin"],
      { password: "COK-GIZLI-YENI-SIFRE", dbPath },
    );
    expect(reset.status).toBe(0);
    expect(reset.stdout).toContain("güncellendi");
    expect(reset.stdout).not.toContain("COK-GIZLI-YENI-SIFRE");
    expect(reset.stderr).not.toContain("COK-GIZLI-YENI-SIFRE");
    expect(reset.stdout.toLowerCase()).not.toContain("argon2id");
  });

  it("migration uygulanmamış bir DB'ye karşı açık hatayla exit 1 verir (otomatik migration YOK)", () => {
    const noMigDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "dolmus-takip-platform-admin-nomig-"),
    );
    const noMigDbPath = path.join(noMigDir, "no-migrations.sqlite");
    // Geçerli bir SQLite dosyası AÇILIR ama `migrate()` HİÇ ÇAĞRILMAZ —
    // `db-init` çalıştırılmamış bir kurulumu temsil eder.
    const rawSqlite = openDatabaseConnection(noMigDbPath, { createIfMissing: true });
    rawSqlite.close();
    try {
      const result = runCli(
        ["create-first-admin", "--username", "x", "--password-stdin"],
        { password: "sifre", dbPath: noMigDbPath },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("migration");
    } finally {
      fs.rmSync(noMigDir, { recursive: true, force: true });
    }
  });
});
