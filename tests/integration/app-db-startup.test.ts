import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAppDb, resetAppDbForTests } from "../../src/server/data/app-db";
import {
  MissingDatabaseFileError,
  openDatabaseConnection,
  PendingMigrationsError,
  UninitializedDatabaseError,
} from "../../src/server/data/db";

/**
 * `getAppDb()` açılış kapısı — gerçek geçici dosyalar. Eksik dosya sessizce
 * oluşturulmaz; PRAGMA değerleri de sınanır. Migration klasörü
 * `process.cwd()/drizzle`'dır (proje kökü).
 */
describe("getAppDb() açılış kapısı", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-app-db-startup-"));
    dbPath = path.join(dir, "app.sqlite");
    process.env.DOLMUS_DB_PATH = dbPath;
    resetAppDbForTests();
  });

  afterEach(() => {
    resetAppDbForTests();
    if (originalDbPath === undefined) {
      delete process.env.DOLMUS_DB_PATH;
    } else {
      process.env.DOLMUS_DB_PATH = originalDbPath;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("eksik dosyada MissingDatabaseFileError fırlatır ve dosya oluşturmaz", () => {
    expect(() => getAppDb()).toThrow(MissingDatabaseFileError);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("MissingDatabaseFileError mesajı yolu ve mevcut/ilk kurulum ayrımını içerir", () => {
    try {
      getAppDb();
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain(dbPath);
      expect(message).toContain("node scripts/db-init.ts");
      expect(message).toContain("Mevcut");
    }
  });

  it("boş SQLite dosyasında UninitializedDatabaseError fırlatır (PendingMigrationsError DEĞİL); yolu adlandırır ve ilk şema kurulumuna karşı uyarır", () => {
    openDatabaseConnection(dbPath, { createIfMissing: true }).close();

    let caught: unknown;
    try {
      getAppDb();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UninitializedDatabaseError);
    expect(caught).not.toBeInstanceOf(PendingMigrationsError);
    const message = (caught as Error).message;
    expect(message).toContain(dbPath);
    expect(message).toContain("migration");
    expect(message).toContain("ÇALIŞTIRMAYIN");
  });

  it("hata yolunda uygulama tablosu oluşturmaz ve bağlantıyı kapatır (dosya tekrar açılıp silinebilir)", () => {
    openDatabaseConnection(dbPath, { createIfMissing: true }).close();
    expect(() => getAppDb()).toThrow(UninitializedDatabaseError);

    const sqlite = openDatabaseConnection(dbPath);
    try {
      const tables = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all();
      expect(tables).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it("__drizzle_migrations tablosu var ama satırsızsa da uninitialized sayılır", () => {
    const sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    sqlite.exec(
      "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
    );
    sqlite.close();
    expect(() => getAppDb()).toThrow(UninitializedDatabaseError);
  });

  it("migrate edilmiş DB'de açılır ve beklenen PRAGMA değerlerini raporlar", async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { createDb } = await import("../../src/server/data/db");
    const setup = openDatabaseConnection(dbPath, { createIfMissing: true });
    migrate(createDb(setup), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    setup.close();

    const db = getAppDb();
    const pragma = (name: string) =>
      db.$client.pragma(name, { simple: true });
    expect(pragma("foreign_keys")).toBe(1);
    expect(pragma("journal_mode")).toBe("wal");
    expect(pragma("synchronous")).toBe(2);
    expect(pragma("busy_timeout")).toBe(2000);
  });
});
