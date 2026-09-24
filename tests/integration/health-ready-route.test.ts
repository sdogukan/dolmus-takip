import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as liveRoute } from "../../src/app/api/v1/health/live/route";
import { GET as readyRoute } from "../../src/app/api/v1/health/ready/route";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { createDb, openDatabaseConnection } from "../../src/server/data/db";

/**
 * GET /api/v1/health/ready — gerçek geçici SQLite dosyası (QA-PLAN.md §1).
 * 503 gövdesi yol/SQL/migration ayrıntısı taşımaz; live DB'ye dokunmaz.
 */
describe("GET /api/v1/health/ready", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-health-ready-"));
    dbPath = path.join(dir, "app.sqlite");
    process.env.DOLMUS_DB_PATH = dbPath;
    resetAppDbForTests();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    resetAppDbForTests();
    if (originalDbPath === undefined) delete process.env.DOLMUS_DB_PATH;
    else process.env.DOLMUS_DB_PATH = originalDbPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function migrateDb(): void {
    const sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    migrate(createDb(sqlite), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    sqlite.close();
  }

  async function expectUnavailable(response: Response): Promise<void> {
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.error).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "Sunucu şu anda hazır değil. Az sonra tekrar deneyin.",
    });
    expect(typeof body.request_id).toBe("string");
    expect(text).not.toContain(dir);
    expect(text).not.toContain("app.sqlite");
    expect(text.toLowerCase()).not.toContain("select");
    expect(text.toLowerCase()).not.toContain("migration");
    // Sunucu logu: tek satır, aynı request_id, yol/SQL yok.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0]?.[0]);
    expect(logged).toContain(`request_id=${body.request_id}`);
    expect(logged).not.toContain(dir);
    expect(logged.toLowerCase()).not.toContain("select");
  }

  it("migrate edilmiş DB'de 200 {status:'ok'} döner", async () => {
    migrateDb();
    const response = readyRoute();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("eksik DB dosyasında 503 SERVICE_UNAVAILABLE döner ve dosya oluşturmaz", async () => {
    await expectUnavailable(readyRoute());
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("ilklendirilmemiş (boş) DB'de 503 döner", async () => {
    openDatabaseConnection(dbPath, { createIfMissing: true }).close();
    await expectUnavailable(readyRoute());
  });

  it("bekleyen migration varsa 503 döner", async () => {
    migrateDb();
    const sqlite = openDatabaseConnection(dbPath);
    sqlite.exec(
      "DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)",
    );
    sqlite.close();
    await expectUnavailable(readyRoute());
  });

  it("başarısızlık geçiciyse sonraki çağrı düzelince 200 döner (açılış hatası önbelleğe alınmaz)", async () => {
    await expectUnavailable(readyRoute());
    migrateDb();
    expect(readyRoute().status).toBe(200);
  });

  it("live DB'ye dokunmadan 200 döner (DB dosyası yokken bile)", async () => {
    const response = liveRoute();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});
