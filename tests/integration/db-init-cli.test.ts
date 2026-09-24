import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabaseConnection } from "../../src/server/data/db";

/**
 * `scripts/db-init.ts` — düz mod (ilk kurulum) ve `--existing` modu; gerçek
 * alt süreç, gerçek geçici dosya.
 */
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const scriptPath = path.join(projectRoot, "scripts", "db-init.ts");

function runDbInit(args: string[], dbPath: string) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: { ...process.env, DOLMUS_DB_PATH: dbPath },
    encoding: "utf8",
  });
}

function tableNames(dbPath: string): string[] {
  const sqlite = openDatabaseConnection(dbPath);
  try {
    return (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name);
  } finally {
    sqlite.close();
  }
}

describe("scripts/db-init.ts", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-db-init-cli-"));
    dbPath = path.join(dir, "nested", "app.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("düz mod: eksik yolda dizin+dosya oluşturur, migrate eder; tekrar çalıştırma idempotenttir", () => {
    const first = runDbInit([], dbPath);
    expect(first.status).toBe(0);
    expect(tableNames(dbPath)).toContain("__drizzle_migrations");

    const second = runDbInit([], dbPath);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("zaten güncel");
  });

  it("--existing: eksik yolda exit 1 verir ve hiçbir şey oluşturmaz", () => {
    const result = runDbInit(["--existing"], dbPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Kurulum başarısız");
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(fs.existsSync(path.dirname(dbPath))).toBe(false);
  });

  it("--existing: boş SQLite dosyasında exit 1 verir ve şema kurmaz", () => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    openDatabaseConnection(dbPath, { createIfMissing: true }).close();

    const result = runDbInit(["--existing"], dbPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("hiç migration uygulanmamış");
    expect(tableNames(dbPath)).toEqual([]);
  });

  it("--existing: kurulu DB'de başarılı olur (bekleyen yoksa 'zaten güncel')", () => {
    expect(runDbInit([], dbPath).status).toBe(0);
    const result = runDbInit(["--existing"], dbPath);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("zaten güncel");
  });

  it("bilinmeyen argümanı reddeder (exit 1)", () => {
    const result = runDbInit(["--exist"], dbPath);
    expect(result.status).toBe(1);
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});
