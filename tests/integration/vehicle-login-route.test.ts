import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `argon2.verify` GEÇİŞLİ (passthrough) casus — sonucu ASLA DEĞİŞTİRMEZ
 * (gerçek Argon2id hesaplaması HER ÇAĞRIDA GERÇEKTEN çalışır, CLAUDE.md
 * "asla pragmatik kısayol" ve QA-PLAN.md §1 "gerçek SQLite/gerçek
 * migration" ilkesiyle AYNI doğrultuda "mock ile testi geçirme" YASAĞINI
 * ihlal ETMEZ — burada hiçbir sonuç SAHTELENMEZ, yalnız GERÇEK çağrının
 * hangi ARGÜMANLARLA yapıldığı KAYDEDİLİR). Bu, ARCH §6 "Kullanıcı/plaka
 * tahmini"nin "bilinmeyen kimlikte kontrollü dummy hash yolu kullanılır"
 * gerekliliğini CANLI KANITLAMANIN tek yoludur: yanıt gövdesi/durum kodu
 * TEK BAŞINA (kasıtlı olarak) bilinmeyen plaka ile yanlış şifreyi ayırt
 * ETTİRMEZ; bu yüzden "dummy yol GERÇEKTEN çağrıldı" iddiası ancak
 * `argon2.verify`'nin GERÇEK çağrı argümanlarını gözlemleyerek
 * kanıtlanabilir.
 */
vi.mock("argon2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("argon2")>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

import { seedDevData, SEED_IDS, SEED_RAW_PLATES, SEED_TEST_PASSWORDS } from "../../scripts/db-seed-dev";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { createDb, openDatabaseConnection } from "../../src/server/data/db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { resetHashQueueForTests } from "../../src/server/auth/hash-queue";
import { resetVehicleLoginRateLimitForTests } from "../../src/server/auth/rate-limit";
import { DUMMY_ARGON2ID_HASH } from "../../src/server/usecases/auth/vehicle-login";
import { POST as vehicleLoginRoute } from "../../src/app/api/v1/auth/vehicle-login/route";
import { GET as getSession } from "../../src/app/api/v1/session/route";
import * as revokeSessionModule from "../../src/server/usecases/session/revoke-session";
import * as argon2 from "argon2";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");

const SELF_ORIGIN = "https://example.invalid";
const LOGIN_URL = "https://example.invalid/api/v1/auth/vehicle-login";
const SESSION_URL = "https://example.invalid/api/v1/session";

function loginRequest(
  body: unknown,
  init: { headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("origin", SELF_ORIGIN);
  headers.set("content-type", "application/json");
  return new Request(LOGIN_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function setCookieToken(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  const match = /dolmus_session=([^;]+)/.exec(setCookie ?? "");
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1]!);
}

describe("POST /api/v1/auth/vehicle-login (T1.2 ADIM 1/2)", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;
  const originalTrustedProxy = process.env.TRUSTED_PROXY;

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    delete process.env.TRUSTED_PROXY;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();
    vi.mocked(argon2.verify).mockClear();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-vehicle-login-"));
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
    if (originalTrustedProxy === undefined) delete process.env.TRUSTED_PROXY;
    else process.env.TRUSTED_PROXY = originalTrustedProxy;
    resetTrustedAppOriginForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------
  // Plaka normalizasyonu — "35 abc 123" ve "35ABC123" AYNI araç.
  // -------------------------------------------------------------------

  it("'35 abc 123' (boşluklu/küçük harf) ile normalize edilmiş plaka AYNI aracı açar", async () => {
    const response = await vehicleLoginRoute(
      loginRequest({ plate: "34 aaa 001", password: SEED_TEST_PASSWORDS.owner }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.vehicleId).toBe(SEED_IDS.vehicleA1);
    expect(body.businessId).toBe(SEED_IDS.businessA);
  });

  it("'34AAA001' (boşluksuz) ile AYNI aracı açar", async () => {
    const response = await vehicleLoginRoute(
      loginRequest({ plate: "34AAA001", password: SEED_TEST_PASSWORDS.owner }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.vehicleId).toBe(SEED_IDS.vehicleA1);
  });

  // -------------------------------------------------------------------
  // İki rol credential'ı — rol istemciden ALINMAZ, hangi hash eşleşirse.
  // -------------------------------------------------------------------

  it("sahip şifresiyle owner oturumu açar; plate görüntü biçiminde döner", async () => {
    const response = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleA1,
        password: SEED_TEST_PASSWORDS.owner,
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.role).toBe("owner");
    expect(body.plate).toBe("34 AAA 001");
    expect(typeof body.csrfToken).toBe("string");
    expect(body.csrfToken.length).toBeGreaterThan(0);
    expect(typeof body.scopeKey).toBe("string");
    expect(Array.isArray(body.permissions)).toBe(true);
    expect(body.permissions).toContain("work_entry.create_owner");
  });

  it("ortak şoför şifresiyle driver oturumu açar (owner izinlerini İÇERMEZ)", async () => {
    const response = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleA1,
        password: SEED_TEST_PASSWORDS.driver,
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.role).toBe("driver");
    expect(body.permissions).not.toContain("work_entry.create_owner");
    expect(body.permissions).toContain("work_entry.create_driver");
  });

  it("gövdede role/personId gönderilse de YOK SAYILIR — eşleşen hash'e göre GERÇEK rol döner", async () => {
    const response = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleA1,
        password: SEED_TEST_PASSWORDS.driver,
        role: "owner",
        personId: "saldirgan-kisi-id",
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    // İstemci "owner" istese de GERÇEK eşleşen credential driver'dır.
    expect(body.role).toBe("driver");
    expect(body.permissions).not.toContain("work_entry.create_owner");
  });

  // -------------------------------------------------------------------
  // ARCH §6 "Kullanıcı/plaka tahmini" — genel 401, dummy hash yolu.
  // -------------------------------------------------------------------

  it("bilinmeyen plaka ile yanlış şifre 401 INVALID_CREDENTIALS + genel mesaj döner", async () => {
    const response = await vehicleLoginRoute(
      loginRequest({ plate: "34ZZZ999", password: "her-hangi-bir-sifre" }),
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
    expect(body.error.message).toBe("Plaka veya şifre yanlış.");
  });

  it("pasif araç (vehicleB2) doğru ŞİFREYLE bile AYNI genel 401 hatasını verir", async () => {
    const response = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleB2,
        password: SEED_TEST_PASSWORDS.owner,
      }),
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
    expect(body.error.message).toBe("Plaka veya şifre yanlış.");
  });

  it("pasif işletme (business.active=0) o işletmenin aktif aracında bile AYNI genel 401 hatasını verir", async () => {
    // İşletme B'yi pasifleştir (vehicleB1 kendisi aktif kalır).
    const setupSqlite = openDatabaseConnection(dbPath);
    setupSqlite
      .prepare("UPDATE businesses SET active = 0 WHERE id = ?")
      .run(SEED_IDS.businessB);
    setupSqlite.close();

    const response = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleB1,
        password: SEED_TEST_PASSWORDS.owner,
      }),
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
    expect(body.error.message).toBe("Plaka veya şifre yanlış.");
  });

  it("bilinmeyen plaka ile GERÇEK bir aracın yanlış şifresi AYNI gövdeyi (BİREBİR) üretir", async () => {
    const unknown = await vehicleLoginRoute(
      loginRequest({ plate: "34ZZZ999", password: "yanlis-sifre" }),
    );
    const knownWrong = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleA1,
        password: "yanlis-sifre",
      }),
    );
    expect(unknown.status).toBe(knownWrong.status);
    const [unknownBody, knownBody] = await Promise.all([
      unknown.json(),
      knownWrong.json(),
    ]);
    expect(unknownBody.error).toEqual(
      // request_id/timing DIŞINDA — code/message BİREBİR aynı.
      expect.objectContaining({
        code: "INVALID_CREDENTIALS",
        message: "Plaka veya şifre yanlış.",
      }),
    );
    expect(knownBody.error).toEqual(unknownBody.error);
  });

  it("bilinmeyen plaka denemesi GERÇEKTEN sabit dummy Argon2id özetine karşı 2 doğrulama çalıştırır (owner/driver GERÇEK özetlerine DEĞİL)", async () => {
    vi.mocked(argon2.verify).mockClear();
    const response = await vehicleLoginRoute(
      loginRequest({ plate: "34ZZZ999", password: "her-hangi-bir-sifre" }),
    );
    expect(response.status).toBe(401);

    expect(argon2.verify).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(argon2.verify).mock.calls) {
      expect(call[0]).toBe(DUMMY_ARGON2ID_HASH);
      expect(call[1]).toBe("her-hangi-bir-sifre");
    }
  });

  it("pasif araç denemesi de sabit dummy özete karşı 2 doğrulama çalıştırır (aracın GERÇEK owner/driver özetlerine DEĞİL)", async () => {
    vi.mocked(argon2.verify).mockClear();
    const response = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleB2,
        password: SEED_TEST_PASSWORDS.owner,
      }),
    );
    expect(response.status).toBe(401);
    expect(argon2.verify).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(argon2.verify).mock.calls) {
      expect(call[0]).toBe(DUMMY_ARGON2ID_HASH);
    }
  });

  it("GERÇEK aktif araçta yanlış şifre GERÇEK owner + GERÇEK driver özetlerine karşı (F10: ≤2) doğrulama çalıştırır", async () => {
    vi.mocked(argon2.verify).mockClear();
    const response = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleA1,
        password: "ne-sahip-ne-sofor-sifresi",
      }),
    );
    expect(response.status).toBe(401);
    expect(argon2.verify).toHaveBeenCalledTimes(2);
    const digestsUsed = vi.mocked(argon2.verify).mock.calls.map((c) => c[0]);
    expect(digestsUsed).not.toContain(DUMMY_ARGON2ID_HASH);
  });

  it("sahip şifresiyle GİRİŞ TEK bir Argon2 doğrulaması yapar (owner ilk denemede eşleşir, driver'a bakılmaz)", async () => {
    vi.mocked(argon2.verify).mockClear();
    const response = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleA1,
        password: SEED_TEST_PASSWORDS.owner,
      }),
    );
    expect(response.status).toBe(201);
    expect(argon2.verify).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------
  // 422 alan doğrulama — biçimsiz/eksik plaka, boş şifre.
  // -------------------------------------------------------------------

  it("biçimsiz plaka için 422 VALIDATION_ERROR + alan hatası döner", async () => {
    const response = await vehicleLoginRoute(
      loginRequest({ plate: "GECERSIZ", password: "herhangi" }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.plate).toBe("Plaka biçimi geçersiz.");
  });

  it("boş plaka için 'Plakayı gir.' alan hatası döner", async () => {
    const response = await vehicleLoginRoute(
      loginRequest({ plate: "   ", password: "herhangi" }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.fields.plate).toBe("Plakayı gir.");
  });

  it("eksik plate/password alanları için 422 döner (zod)", async () => {
    const response = await vehicleLoginRoute(loginRequest({}));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.plate).toBeTruthy();
    expect(body.error.fields.password).toBeTruthy();
  });

  it("boş şifre için 'Şifreyi gir.' alan hatası döner; DB/hash kuyruğuna DOKUNULMAZ", async () => {
    vi.mocked(argon2.verify).mockClear();
    const response = await vehicleLoginRoute(
      loginRequest({ plate: SEED_RAW_PLATES.vehicleA1, password: "" }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.fields.password).toBe("Şifreyi gir.");
    expect(argon2.verify).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // Hız sınırı — plaka başına 20/15dk, IP başına 120/15dk, Retry-After.
  // -------------------------------------------------------------------

  it("aynı (bilinmeyen) plakaya 21. başarısız deneme 429 RATE_LIMITED + Retry-After header'ı döner", async () => {
    for (let i = 0; i < 20; i++) {
      const response = await vehicleLoginRoute(
        loginRequest({ plate: "34RLM001", password: `yanlis-${i}` }),
      );
      expect(response.status).toBe(401);
    }
    const blocked = await vehicleLoginRoute(
      loginRequest({ plate: "34RLM001", password: "yanlis-21" }),
    );
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.message).toBe(
      "Çok fazla deneme. Lütfen biraz bekleyip tekrar dene.",
    );
    const retryAfter = blocked.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  }, 20_000);

  it("429 RATE_LIMITED tam BİR log satırı yazar: request_id var; plaka, IP ve parola YOK", async () => {
    vi.stubEnv("TRUSTED_PROXY", "1");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const clientIp = "203.0.113.7";
      for (let i = 0; i < 20; i++) {
        await vehicleLoginRoute(
          loginRequest(
            { plate: "34RLM002", password: `yanlis-${i}` },
            { headers: { "x-forwarded-for": clientIp } },
          ),
        );
      }
      expect(warnSpy).not.toHaveBeenCalled();
      const blocked = await vehicleLoginRoute(
        loginRequest(
          { plate: "34RLM002", password: "log-parola-sizmamali" },
          { headers: { "x-forwarded-for": clientIp } },
        ),
      );
      expect(blocked.status).toBe(429);
      const { request_id: requestId } = await blocked.json();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const line = String(warnSpy.mock.calls[0]?.[0]);
      expect(line).toContain("RATE_LIMITED");
      expect(line).toContain(`request_id=${requestId}`);
      for (const secret of ["34RLM002", "34rlm002", clientIp, "log-parola-sizmamali"]) {
        expect(line).not.toContain(secret);
      }
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  }, 20_000);

  it("IP başına 120. başarısız denemeden sonra (farklı plakalarla dahi) 429 RATE_LIMITED döner", async () => {
    // Her deneme FARKLI bir plaka kullanır (plaka başına 20 sınırına HİÇ
    // takılmadan yalnız IP sınırının kendisini izole sınamak için); harf
    // grubu Türk plakalarında kullanılmayan Q/W/X'i İÇERMEYEN sabit "ZZZ"
    // (bkz. `../../src/lib/plate.ts` `PLATE_PATTERN`).
    for (let i = 0; i < 120; i++) {
      const response = await vehicleLoginRoute(
        loginRequest({
          plate: `34ZZZ${String(1000 + i)}`,
          password: "yanlis",
        }),
      );
      expect(response.status).toBe(401);
    }
    const blocked = await vehicleLoginRoute(
      loginRequest({ plate: "34ZZZ9999", password: "yanlis" }),
    );
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("RATE_LIMITED");
  }, 30_000);

  it("BAŞARILI giriş hız sınırı sayacını ARTIRMAZ (25 başarılı giriş + 20 başarısız deneme HALA 429 vermez)", async () => {
    for (let i = 0; i < 25; i++) {
      const response = await vehicleLoginRoute(
        loginRequest({
          plate: SEED_RAW_PLATES.vehicleA1,
          password: SEED_TEST_PASSWORDS.owner,
        }),
      );
      expect(response.status).toBe(201);
    }
    for (let i = 0; i < 20; i++) {
      const response = await vehicleLoginRoute(
        loginRequest({
          plate: SEED_RAW_PLATES.vehicleA1,
          password: `yanlis-${i}`,
        }),
      );
      expect(response.status).toBe(401);
    }
    // Sayaç yalnız BAŞARISIZ denemelerle dolduysa tam 20'de duruyor
    // olmalı — 21. başarısız deneme ARTIK bloklanır (sınırın GERÇEKTEN
    // 20 başarısızlıkla dolduğunu, 25 başarılı girişin ONA KATKI
    // YAPMADIĞINI doğrular).
    const blocked = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleA1,
        password: "yanlis-son",
      }),
    );
    expect(blocked.status).toBe(429);
  }, 30_000);

  // -------------------------------------------------------------------
  // S1.4 AC2 — ortak telefon: yeni giriş eski oturum çerezini iptal eder.
  // -------------------------------------------------------------------

  it("yeni başarılı giriş, aynı tarayıcıdaki ESKİ oturum çerezini iptal eder", async () => {
    const first = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleA1,
        password: SEED_TEST_PASSWORDS.owner,
      }),
    );
    const firstToken = setCookieToken(first);

    // Eski çerez HALA geçerli mi? (Yeni girişten ÖNCE.)
    const beforeSecondLogin = await getSession(
      new Request(SESSION_URL, {
        headers: { cookie: `dolmus_session=${firstToken}` },
      }),
    );
    expect(beforeSecondLogin.status).toBe(200);

    // Aynı "tarayıcı" (eski çerez GÖNDERİLİYOR) farklı bir araca (B1,
    // driver) giriş yapıyor.
    const second = await vehicleLoginRoute(
      loginRequest(
        { plate: SEED_RAW_PLATES.vehicleB1, password: SEED_TEST_PASSWORDS.driver },
        { headers: { cookie: `dolmus_session=${firstToken}` } },
      ),
    );
    expect(second.status).toBe(201);
    const secondToken = setCookieToken(second);
    expect(secondToken).not.toBe(firstToken);

    // ESKİ çerez ARTIK geçersiz (SESSION_REVOKED).
    const afterSecondLogin = await getSession(
      new Request(SESSION_URL, {
        headers: { cookie: `dolmus_session=${firstToken}` },
      }),
    );
    expect(afterSecondLogin.status).toBe(401);
    expect((await afterSecondLogin.json()).error.code).toBe("SESSION_REVOKED");

    // YENİ çerez GEÇERLİ ve doğru araca (B1/driver) işaret ediyor.
    const withNewCookie = await getSession(
      new Request(SESSION_URL, {
        headers: { cookie: `dolmus_session=${secondToken}` },
      }),
    );
    expect(withNewCookie.status).toBe(200);
    const newBody = await withNewCookie.json();
    expect(newBody.vehicleId).toBe(SEED_IDS.vehicleB1);
    expect(newBody.role).toBe("driver");
  });

  it("hiç ÖNCEKİ çerez YOKKEN giriş normal çalışır (iptal edilecek bir şey yoktur)", async () => {
    const response = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleA1,
        password: SEED_TEST_PASSWORDS.owner,
      }),
    );
    expect(response.status).toBe(201);
  });

  // -------------------------------------------------------------------
  // GET /session ile uçtan uca — plate döner.
  // -------------------------------------------------------------------

  it("başarılı girişten sonra GET /session yanıtı 'plate' alanını GÖRÜNTÜ biçiminde döner", async () => {
    const login = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleA1,
        password: SEED_TEST_PASSWORDS.owner,
      }),
    );
    const token = setCookieToken(login);
    const session = await getSession(
      new Request(SESSION_URL, { headers: { cookie: `dolmus_session=${token}` } }),
    );
    expect(session.status).toBe(200);
    const body = await session.json();
    expect(body.plate).toBe("34 AAA 001");
  });

  // -------------------------------------------------------------------
  // requireAnonymousWrite — origin/Content-Type/gövde denetimi.
  // -------------------------------------------------------------------

  it("origin/Sec-Fetch-Site uyuşmuyorsa 403 ORIGIN_INVALID döner; hiçbir hash/DB işlemi ÇALIŞMAZ", async () => {
    vi.mocked(argon2.verify).mockClear();
    const headers = new Headers();
    headers.set("origin", "https://saldirgan.invalid");
    headers.set("content-type", "application/json");
    const response = await vehicleLoginRoute(
      new Request(LOGIN_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          plate: SEED_RAW_PLATES.vehicleA1,
          password: SEED_TEST_PASSWORDS.owner,
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("ORIGIN_INVALID");
    expect(argon2.verify).not.toHaveBeenCalled();
  });

  it("Content-Type application/json DEĞİLSE 415 döner", async () => {
    const headers = new Headers();
    headers.set("origin", SELF_ORIGIN);
    headers.set("content-type", "text/plain");
    const response = await vehicleLoginRoute(
      new Request(LOGIN_URL, { method: "POST", headers, body: "plate=x" }),
    );
    expect(response.status).toBe(415);
  });

  it("aşırı büyük gövde 413 döner", async () => {
    const headers = new Headers();
    headers.set("origin", SELF_ORIGIN);
    headers.set("content-type", "application/json");
    const hugePassword = "a".repeat(70 * 1024);
    const response = await vehicleLoginRoute(
      new Request(LOGIN_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ plate: "34AAA001", password: hugePassword }),
      }),
    );
    expect(response.status).toBe(413);
  });

  it("başarılı yanıtta Cache-Control: private, no-store döner", async () => {
    const response = await vehicleLoginRoute(
      loginRequest({
        plate: SEED_RAW_PLATES.vehicleA1,
        password: SEED_TEST_PASSWORDS.owner,
      }),
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  // -------------------------------------------------------------------
  // Gizli veri sızıntısı yok — yanıt/loglarda parola/hash/token.
  // -------------------------------------------------------------------

  it("başarılı/başarısız yanıt gövdelerinde şifre, Argon2 özeti veya ham oturum tokenı GEÇMEZ", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const success = await vehicleLoginRoute(
        loginRequest({
          plate: SEED_RAW_PLATES.vehicleA1,
          password: SEED_TEST_PASSWORDS.owner,
        }),
      );
      const token = setCookieToken(success);
      const successText = await success.text();
      expect(successText).not.toContain(SEED_TEST_PASSWORDS.owner);
      expect(successText).not.toContain("$argon2id$");
      expect(successText).not.toContain(token);

      const failure = await vehicleLoginRoute(
        loginRequest({ plate: "34ZZZ999", password: "gizli-sifre-deseni" }),
      );
      const failureText = await failure.text();
      expect(failureText).not.toContain("gizli-sifre-deseni");
      expect(failureText).not.toContain("$argon2id$");

      for (const call of consoleErrorSpy.mock.calls) {
        const joined = call.map((arg) => String(arg)).join(" ");
        expect(joined).not.toContain(SEED_TEST_PASSWORDS.owner);
        expect(joined).not.toContain("gizli-sifre-deseni");
        expect(joined).not.toContain("$argon2id$");
      }
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  // -------------------------------------------------------------------
  // DÜZELTME TURU 3 (denetim bulgusu, "high", `guvenlik` merceği):
  // `vehicleLogin(...)`'in `createVehicleSession` INSERT'i (başarılı
  // girişte HER ZAMAN çalışır) ve `revokePriorSessionCookieIfAny(...)`'nin
  // `revokeSession` UPDATE'i, `../../src/app/api/v1/auth/vehicle-login/
  // route.ts`'in KENDİ iki DB yazma noktasıdır ve `requireAnonymousWrite`
  // ile hiçbir ilgisi yoktur. `tests/integration/session-routes.test.ts`
  // "DB kilitli" bloklarındaki AYNI CANLI yöntemle (mock/`:memory:` DEĞİL
  // — aynı dosyaya ikinci bir better-sqlite3 bağlantısıyla gerçek bir
  // BEGIN IMMEDIATE kilidi) HER İKİ noktayı da AYRI AYRI sınar.
  // -------------------------------------------------------------------
  describe("POST /api/v1/auth/vehicle-login — DB kilitli (503, gerçek SQLITE_BUSY)", () => {
    it(
      "vehicleLogin'in createVehicleSession INSERT'i sırasında canlı bir kilit 503 SERVICE_UNAVAILABLE'a çevrilir (kilit kodu/dosya yolu sızmaz)",
      async () => {
        // SELECT'ler (lookupVehicleByPlate/lookupCredentials) WAL modunda
        // yazıcıdan ETKİLENMEZ (bu dosyanın kendi notu); hata GERÇEKTEN
        // `createVehicleSession`'ın `sessions` INSERT'inde oluşur.
        const lockerSqlite = openDatabaseConnection(dbPath);
        lockerSqlite.exec("BEGIN IMMEDIATE");
        try {
          const response = await vehicleLoginRoute(
            loginRequest({
              plate: SEED_RAW_PLATES.vehicleA1,
              password: SEED_TEST_PASSWORDS.owner,
            }),
          );
          expect(response.status).toBe(503);
          const body = await response.json();
          expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
          expect(typeof body.request_id).toBe("string");
          const raw = JSON.stringify(body);
          expect(raw).not.toContain("SQLITE_BUSY");
          expect(raw).not.toContain("SQLITE_LOCKED");
          expect(raw).not.toContain(dbPath);
        } finally {
          lockerSqlite.exec("ROLLBACK");
          lockerSqlite.close();
        }
      },
      10_000,
    );

    it(
      "revokePriorSessionCookieIfAny'nin revokeSession UPDATE'i sırasında canlı bir kilit 503 SERVICE_UNAVAILABLE'a çevrilir (YENİ oturumun KENDİ INSERT'i o ana kadar zaten TAMAMLANMIŞ olsa bile)",
      async () => {
        // Önce ESKİ bir oturum kur — "aynı tarayıcıdaki eski çerez"
        // (S1.4 AC2) — bu, ikinci yazmanın (revokeSession UPDATE'i)
        // GERÇEKTEN çalışacağı satırı üretir.
        const first = await vehicleLoginRoute(
          loginRequest({
            plate: SEED_RAW_PLATES.vehicleA1,
            password: SEED_TEST_PASSWORDS.owner,
          }),
        );
        const firstToken = setCookieToken(first);

        // Kilidi TAM OLARAK `revokeSession` çağrılmadan HEMEN ÖNCE açan
        // bir GEÇİŞLİ (passthrough) casus: gerçek `revokeSession`'ı
        // ÇAĞIRIR (sonucu DEĞİŞTİRMEZ), yalnız o çağrının HEMEN
        // ÖNCESİNDE ikinci bağlantıyla BEGIN IMMEDIATE açar — böylece
        // YENİ oturumun `createVehicleSession` INSERT'i (route.ts'in
        // İLK yazması, `vehicleLogin(...)` içinde) kilitsiz ortamda
        // BAŞARIYLA tamamlanır ve hata GERÇEKTEN İKİNCİ yazmada
        // (`revokeSession` UPDATE'i) oluşur — ilk yazmada DEĞİL.
        const actualRevokeSession = revokeSessionModule.revokeSession;
        const lockerSqlite = openDatabaseConnection(dbPath);
        const revokeSessionSpy = vi
          .spyOn(revokeSessionModule, "revokeSession")
          .mockImplementation(async (db, sessionId, clock) => {
            lockerSqlite.exec("BEGIN IMMEDIATE");
            return actualRevokeSession(db, sessionId, clock);
          });
        try {
          const second = await vehicleLoginRoute(
            loginRequest(
              {
                plate: SEED_RAW_PLATES.vehicleB1,
                password: SEED_TEST_PASSWORDS.driver,
              },
              { headers: { cookie: `dolmus_session=${firstToken}` } },
            ),
          );
          expect(second.status).toBe(503);
          const body = await second.json();
          expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
          expect(typeof body.request_id).toBe("string");
          const raw = JSON.stringify(body);
          expect(raw).not.toContain("SQLITE_BUSY");
          expect(raw).not.toContain("SQLITE_LOCKED");
          expect(raw).not.toContain(dbPath);

          // ESKİ oturum HALA geçerli — iptal yazması hiç UYGULANMADAN
          // (kilit yüzünden) başarısız oldu, kısmi bir durum BIRAKMADI.
          const stillValid = await getSession(
            new Request(SESSION_URL, {
              headers: { cookie: `dolmus_session=${firstToken}` },
            }),
          );
          expect(stillValid.status).toBe(200);
        } finally {
          revokeSessionSpy.mockRestore();
          lockerSqlite.exec("ROLLBACK");
          lockerSqlite.close();
        }
      },
      10_000,
    );
  });

  // -------------------------------------------------------------------
  // T2.2 risk notu — giriş/pasifleştirme yarışı: parola doğrulaması
  // (Argon2, asenkron) BAŞLADIKTAN SONRA ama `createVehicleSession`in
  // `sessions` INSERT'i tamamlanmadan ÖNCE araç/işletme pasifleşirse,
  // eski (erken okunmuş) aktiflik bilgisine güvenilirse artık pasif bir
  // hedef için YENİ, İPTAL EDİLMEMİŞ bir oturum açılırdı. `argon2.verify`
  // casusunun (dosya üstü not — GEÇİŞLİ, sonucu DEĞİŞTİRMEZ) TAM OLARAK
  // bu ARA ANDA (gerçek Argon2 hesaplaması TAMAMLANDIKTAN, ama
  // `vehicleLogin`in devam etmesinden HEMEN ÖNCE) aracı/işletmeyi
  // pasifleştirmesiyle GERÇEK yarış birebir üretilir.
  // -------------------------------------------------------------------
  describe("POST /api/v1/auth/vehicle-login — giriş/pasifleştirme yarışı (T2.2)", () => {
    it("Argon2 doğrulaması sırasında araç pasifleşirse 401 INVALID_CREDENTIALS döner ve oturum AÇILMAZ", async () => {
      vi.mocked(argon2.verify).mockImplementationOnce(async (digest, password) => {
        const actual = await vi.importActual<typeof import("argon2")>("argon2");
        const matched = await actual.verify(digest, password);
        const lockerSqlite = openDatabaseConnection(dbPath);
        try {
          lockerSqlite
            .prepare("UPDATE vehicles SET active = 0 WHERE id = ?")
            .run(SEED_IDS.vehicleA1);
        } finally {
          lockerSqlite.close();
        }
        return matched;
      });

      const response = await vehicleLoginRoute(
        loginRequest({
          plate: SEED_RAW_PLATES.vehicleA1,
          password: SEED_TEST_PASSWORDS.owner,
        }),
      );
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_CREDENTIALS");
      expect(body.error.message).toBe("Plaka veya şifre yanlış.");

      const sqlite = openDatabaseConnection(dbPath);
      try {
        const count = sqlite
          .prepare(
            "SELECT COUNT(*) c FROM sessions s JOIN vehicle_credentials vc ON vc.id = s.credential_id WHERE vc.vehicle_id = ?",
          )
          .get(SEED_IDS.vehicleA1) as { c: number };
        expect(count.c).toBe(0);
      } finally {
        sqlite.close();
      }
    });

    it("Argon2 doğrulaması sırasında işletme pasifleşirse 401 INVALID_CREDENTIALS döner ve oturum AÇILMAZ", async () => {
      vi.mocked(argon2.verify).mockImplementationOnce(async (digest, password) => {
        const actual = await vi.importActual<typeof import("argon2")>("argon2");
        const matched = await actual.verify(digest, password);
        const lockerSqlite = openDatabaseConnection(dbPath);
        try {
          lockerSqlite
            .prepare("UPDATE businesses SET active = 0 WHERE id = ?")
            .run(SEED_IDS.businessA);
        } finally {
          lockerSqlite.close();
        }
        return matched;
      });

      const response = await vehicleLoginRoute(
        loginRequest({
          plate: SEED_RAW_PLATES.vehicleA1,
          password: SEED_TEST_PASSWORDS.owner,
        }),
      );
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("INVALID_CREDENTIALS");
    });
  });

  // -------------------------------------------------------------------
  // T1.2 EK DÜZELTME — docs/DECISIONS.md "T1.2 uygulama kararları":
  // Set-Cookie'nin Secure bayrağı APP_ORIGIN'in şemasından türetilir,
  // NODE_ENV'DEN BAĞIMSIZDIR (`../../src/server/auth/cookie.ts`
  // `isSecureCookieOrigin`). Her iki test de NODE_ENV'i AÇIKÇA TERSİNE
  // ayarlayarak bunu KANITLAR: yalnız APP_ORIGIN'in şeması sonucu
  // belirler.
  // -------------------------------------------------------------------
  describe("POST /api/v1/auth/vehicle-login — Set-Cookie Secure bayrağı (APP_ORIGIN şemasına göre, NODE_ENV bağımsız)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("APP_ORIGIN https iken, NODE_ENV=development olsa bile Set-Cookie 'Secure' İÇERİR", async () => {
      // beforeEach zaten APP_ORIGIN=SELF_ORIGIN'i https yapıyor.
      vi.stubEnv("NODE_ENV", "development");
      const response = await vehicleLoginRoute(
        loginRequest({
          plate: SEED_RAW_PLATES.vehicleA1,
          password: SEED_TEST_PASSWORDS.owner,
        }),
      );
      expect(response.status).toBe(201);
      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toContain("Secure");
    });

    it("APP_ORIGIN http iken, NODE_ENV=production olsa bile Set-Cookie 'Secure' İÇERMEZ", async () => {
      const httpOrigin = "http://127.0.0.1:3100";
      process.env.APP_ORIGIN = httpOrigin;
      resetTrustedAppOriginForTests();
      vi.stubEnv("NODE_ENV", "production");
      try {
        const headers = new Headers();
        headers.set("origin", httpOrigin);
        headers.set("content-type", "application/json");
        const response = await vehicleLoginRoute(
          new Request(`${httpOrigin}/api/v1/auth/vehicle-login`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              plate: SEED_RAW_PLATES.vehicleA1,
              password: SEED_TEST_PASSWORDS.owner,
            }),
          }),
        );
        expect(response.status).toBe(201);
        const setCookie = response.headers.get("set-cookie");
        expect(setCookie).not.toContain("Secure");
      } finally {
        process.env.APP_ORIGIN = SELF_ORIGIN;
        resetTrustedAppOriginForTests();
      }
    });
  });
});
