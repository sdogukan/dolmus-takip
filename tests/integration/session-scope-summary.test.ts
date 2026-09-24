/**
 * GET /api/v1/session — T1.5 ADIM 1/2 eklentisi (izinli kapsam özeti +
 * scopeKey), S1.5.
 *
 * Görev tanımı iş adımı 4: "GET /api/v1/session yanıtını genişlet: izinli
 * kapsam özeti (actor, businessId, vehicleId, permissions listesi) ve
 * gizli OLMAYAN opak `scopeKey` ... Birim testleri: ... scopeKey
 * kararlılığı." `businessId`/`vehicleId`/`role` (actor) zaten T1.4'te
 * test edilmiştir (bkz. `./session-routes.test.ts`); bu dosya YALNIZ bu
 * ADIM'ın EKLEDİĞİ iki alanı (`permissions`, `scopeKey`) gerçek bir route
 * çağrısı üzerinden sınar (QA-PLAN.md §1 — gerçek geçici SQLite + migration
 * + seed).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS } from "../../scripts/db-seed-dev";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import {
  createDb,
  openDatabaseConnection,
  type SqliteConnection,
} from "../../src/server/data/db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { PERMISSIONS } from "../../src/server/auth/permissions";
import { createPlatformSession } from "../../src/server/usecases/session/create-platform-session";
import { createVehicleSession } from "../../src/server/usecases/session/create-vehicle-session";
import { GET as getSession } from "../../src/app/api/v1/session/route";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";

function requestWithCookie(url: string, token: string): Request {
  return new Request(url, { headers: { cookie: `dolmus_session=${token}` } });
}

describe("GET /api/v1/session — izinli kapsam özeti + scopeKey (T1.5 ADIM 1/2)", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();

    dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "dolmus-takip-session-scope-summary-"),
    );
    dbPath = path.join(dir, "test.sqlite");
    const setupSqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    const setupDb = createDb(setupSqlite);
    migrate(setupDb, { migrationsFolder });
    await seedDevData(setupSqlite);
    setupSqlite.close();

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
    if (originalAppOrigin === undefined) {
      delete process.env.APP_ORIGIN;
    } else {
      process.env.APP_ORIGIN = originalAppOrigin;
    }
    resetTrustedAppOriginForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("araç sahibi (owner) oturumu için TAM owner izin listesini (alfabetik) döner", async () => {
    const setupSqlite = openDatabaseConnection(dbPath);
    const setupDb = createDb(setupSqlite);
    const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
    setupSqlite.close();

    const response = await getSession(
      requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.permissions).toEqual(
      [
        "driver.manage",
        "driver.read_active",
        "report.read",
        "work_entry.confirm",
        "work_entry.correct_confirmed",
        "work_entry.create_driver",
        "work_entry.create_owner",
        "work_entry.edit_unconfirmed",
        "work_entry.history",
        "work_entry.read",
      ].sort(),
    );
    // Şoförün ALAMAYACAĞI izinler owner listesinde de OLMAMALI (business/
    // platform yönetimi) — STORIES S1.5 AC3.
    expect(body.permissions).not.toContain("platform_user.manage");
    expect(body.permissions).not.toContain("business.manage");
  });

  it("ortak şoför (driver) oturumu için yalnız 3 izni içeren listeyi döner; sahip/onay/yönetim izinleri YOKTUR", async () => {
    const setupSqlite = openDatabaseConnection(dbPath);
    const setupDb = createDb(setupSqlite);
    const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
    setupSqlite.close();

    const response = await getSession(
      requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
    );
    const body = await response.json();
    expect(body.permissions).toEqual(
      [
        "driver.read_active",
        "work_entry.create_driver",
        "work_entry.edit_unconfirmed",
        "work_entry.read",
      ].sort(),
    );
    expect(body.permissions).not.toContain("work_entry.confirm");
    expect(body.permissions).not.toContain("driver.manage");
  });

  it("platform admin oturumu TÜM izinleri döner (person.anonymize dahil)", async () => {
    const setupSqlite = openDatabaseConnection(dbPath);
    const setupDb = createDb(setupSqlite);
    const created = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
    setupSqlite.close();

    const response = await getSession(
      requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
    );
    const body = await response.json();
    expect(body.permissions).toEqual([...PERMISSIONS].sort());
    expect(body.permissions).toHaveLength(PERMISSIONS.length);
    expect(body.permissions).toContain("person.anonymize");
  });

  it("scopeKey opak (16 hex karakter), gizli veri (token) İÇERMEZ ve AYNI oturumda kararlıdır", async () => {
    const setupSqlite = openDatabaseConnection(dbPath);
    const setupDb = createDb(setupSqlite);
    const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
    setupSqlite.close();

    const first = await getSession(
      requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
    );
    const firstBody = await first.json();
    expect(firstBody.scopeKey).toMatch(/^[0-9a-f]{16}$/);
    expect(firstBody.scopeKey).not.toContain(created.token);

    const second = await getSession(
      requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
    );
    const secondBody = await second.json();
    expect(secondBody.scopeKey).toBe(firstBody.scopeKey);
  });

  it("FARKLI araç (aynı işletmenin İKİNCİ aracı) oturumu FARKLI scopeKey üretir — client-state karışmasını önler (S1.4 AC2)", async () => {
    const setupSqlite = openDatabaseConnection(dbPath);
    const setupDb = createDb(setupSqlite);
    const vehicleA1Owner = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
    const vehicleA2Owner = await createVehicleSession(setupDb, SEED_IDS.credA2Owner);
    setupSqlite.close();

    const r1 = await getSession(
      requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, vehicleA1Owner.token),
    );
    const r2 = await getSession(
      requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, vehicleA2Owner.token),
    );
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1.scopeKey).not.toBe(b2.scopeKey);
  });

  it("İKİ farklı ekip (platform) hesabı (support1 ve admin1) FARKLI scopeKey üretir — gerçek GET /session round-trip", async () => {
    const setupSqlite = openDatabaseConnection(dbPath);
    const setupDb = createDb(setupSqlite);
    // Seed'de yalnız bir aktif support hesabı var; ikinci referans noktası
    // admin1'dir (platformUserId VE role birlikte farklı) — bu test yalnız
    // "gerçek bir DB + route round-trip'inde FARKLI platform_users satırları
    // FARKLI scopeKey üretir" iddiasını doğrular. "role tek başına ayırt
    // edici DEĞİLDİR" iddiasının kendisi (platformUserId SABİTKEN role
    // değişince scopeKey'in DEĞİŞMEDİĞİ, role SABİTKEN platformUserId
    // değişince DEĞİŞTİĞİ) DB'siz, rolü kontrollü tutan birim testlerle
    // `src/server/auth/scope.test.ts`'te ("computeScopeKey" describe
    // bloğu, düzeltme turu 2) ayrıca ve doğrudan kanıtlanır.
    const support = await createPlatformSession(setupDb, SEED_IDS.platformSupport1);
    const admin = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
    setupSqlite.close();

    const r1 = await getSession(
      requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, support.token),
    );
    const r2 = await getSession(
      requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, admin.token),
    );
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1.scopeKey).not.toBe(b2.scopeKey);
  });
});
