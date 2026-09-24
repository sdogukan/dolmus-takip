import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Hash kuyruğu aşımı — T1.2 ADIM 1/2, S1.2, görev tanımı doğrulama
 * listesi: "kuyruk aşımı 429 (yavaş sahte verify ile)". Bu TEK senaryo
 * için `argon2.verify` GERÇEK KRİPTOGRAFİK hesaplama YERİNE, HER ZAMAN
 * `false` dönen ama YAPAY OLARAK YAVAŞ (gerçek `setTimeout`) bir sahte
 * fonksiyonla DEĞİŞTİRİLİR — bu, `HASH_QUEUE_MAX_CONCURRENT` (4) +
 * `HASH_QUEUE_MAX_PENDING` (100) = 104 kapasiteyi GERÇEK Argon2
 * hesaplaması olmadan (dakikalarca sürecek CPU yükü YARATMADAN)
 * DETERMİNİSTİK biçimde doldurabilmek içindir; görevin KENDİSİNİN
 * istediği test tasarımıdır ("yavaş sahte verify"), CLAUDE.md'nin
 * yasakladığı "mock ile mali/DB testi geçirme" kapsamına GİRMEZ — burada
 * sınanan şey Argon2'nin doğruluğu DEĞİL, `../../src/server/auth/
 * hash-queue.ts` semaforunun GERÇEK route/usecase/DB akışı İÇİNDEN
 * (sahte olmayan HTTP isteği + gerçek SQLite sorguları + gerçek rate-
 * limit denetimi) doğru ÇALIŞTIĞIDIR.
 *
 * Bu dosya AYRI tutulur (`vehicle-login-route.test.ts`'in GEÇİŞLİ argon2
 * casusuyla KARIŞMAMASI için) — `vi.mock` modül düzeyinde ve dosya
 * başına uygulanır.
 */
vi.mock("argon2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("argon2")>();
  return {
    ...actual,
    verify: vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 30);
        }),
    ),
  };
});

import { seedDevData, SEED_RAW_PLATES, SEED_TEST_PASSWORDS } from "../../scripts/db-seed-dev";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { createDb, openDatabaseConnection } from "../../src/server/data/db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import {
  HASH_QUEUE_MAX_CONCURRENT,
  HASH_QUEUE_MAX_PENDING,
  resetHashQueueForTests,
} from "../../src/server/auth/hash-queue";
import { resetVehicleLoginRateLimitForTests } from "../../src/server/auth/rate-limit";
import { POST as vehicleLoginRoute } from "../../src/app/api/v1/auth/vehicle-login/route";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");

const SELF_ORIGIN = "https://example.invalid";
const LOGIN_URL = "https://example.invalid/api/v1/auth/vehicle-login";

function loginRequest(body: unknown): Request {
  const headers = new Headers();
  headers.set("origin", SELF_ORIGIN);
  headers.set("content-type", "application/json");
  return new Request(LOGIN_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/auth/vehicle-login — hash kuyruğu aşımı (T1.2 ADIM 1/2)", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-hash-queue-"));
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
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();
    if (originalDbPath === undefined) delete process.env.DOLMUS_DB_PATH;
    else process.env.DOLMUS_DB_PATH = originalDbPath;
    if (originalAppOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = originalAppOrigin;
    resetTrustedAppOriginForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("kapasiteyi (4 eşzamanlı + 100 bekleyen = 104) AŞAN eşzamanlı istekler 429 HASH_QUEUE_FULL alır; kapasite İÇİNDEKİLER 401 ile sonuçlanır", async () => {
    const capacity = HASH_QUEUE_MAX_CONCURRENT + HASH_QUEUE_MAX_PENDING; // 104
    const totalRequests = capacity + 10; // kesin bir taşma üretmek için kapasitenin ÜZERİNDE

    const responses = await Promise.all(
      Array.from({ length: totalRequests }, () =>
        vehicleLoginRoute(
          loginRequest({
            plate: SEED_RAW_PLATES.vehicleA1,
            password: SEED_TEST_PASSWORDS.owner,
          }),
        ),
      ),
    );

    const bodies = await Promise.all(responses.map((r) => r.json()));

    const queueFullCount = responses.filter((r) => r.status === 429).length;
    const invalidCredentialsCount = responses.filter(
      (r) => r.status === 401,
    ).length;

    // Pigeonhole: kapasite (104) sabit olduğundan, TOPLAM istek sayısı
    // kapasiteyi aştığı kadarı KESİNLİKLE 429 almalıdır — HANGİ isteğin
    // taştığı zamanlamaya bağlı olabilir, ama TAŞAN SAYI değildir.
    expect(queueFullCount).toBeGreaterThan(0);
    expect(queueFullCount + invalidCredentialsCount).toBe(totalRequests);

    for (const body of bodies) {
      if (body.error) {
        expect(["HASH_QUEUE_FULL", "INVALID_CREDENTIALS"]).toContain(
          body.error.code,
        );
        if (body.error.code === "HASH_QUEUE_FULL") {
          expect(body.error.message).toBe(
            "Sistem şu anda yoğun. Lütfen tekrar dene.",
          );
        }
      }
    }
  }, 30_000);

  it("429 HASH_QUEUE_FULL yanıtları BAŞINA tam BİR log satırı yazar: request_id ve kuyruk alanları var; plaka ve parola YOK", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const totalRequests =
        HASH_QUEUE_MAX_CONCURRENT + HASH_QUEUE_MAX_PENDING + 10;
      const responses = await Promise.all(
        Array.from({ length: totalRequests }, () =>
          vehicleLoginRoute(
            loginRequest({
              plate: SEED_RAW_PLATES.vehicleA1,
              password: "log-parola-sizmamali",
            }),
          ),
        ),
      );
      const queueFull = await Promise.all(
        responses
          .filter((r) => r.status === 429)
          .map(async (r) => (await r.json()) as { request_id: string }),
      );
      expect(queueFull.length).toBeGreaterThan(0);
      expect(warnSpy).toHaveBeenCalledTimes(queueFull.length);
      const lines = warnSpy.mock.calls.map((call) => String(call[0]));
      for (const { request_id: requestId } of queueFull) {
        const matching = lines.filter((l) => l.includes(`request_id=${requestId}`));
        expect(matching).toHaveLength(1);
        expect(matching[0]).toContain("HASH_QUEUE_FULL");
        expect(matching[0]).toMatch(/hash_active=\d+ hash_pending=\d+ hash_longest_wait_ms=\d+/);
      }
      for (const line of lines) {
        expect(line).not.toContain(SEED_RAW_PLATES.vehicleA1);
        expect(line).not.toContain("log-parola-sizmamali");
      }
    } finally {
      warnSpy.mockRestore();
    }
  }, 30_000);
});
