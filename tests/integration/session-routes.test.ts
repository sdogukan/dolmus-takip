import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS } from "../../scripts/db-seed-dev";
import {
  createDb,
  openDatabaseConnection,
  type SqliteConnection,
} from "../../src/server/data/db";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { MAX_WRITE_BODY_BYTES } from "../../src/server/auth/guard";
import type { Clock } from "../../src/server/auth/session";
import { createPlatformSession } from "../../src/server/usecases/session/create-platform-session";
import { createVehicleSession } from "../../src/server/usecases/session/create-vehicle-session";
import { GET as getSession } from "../../src/app/api/v1/session/route";
import { POST as logout } from "../../src/app/api/v1/auth/logout/route";

/**
 * GET /api/v1/session ve POST /api/v1/auth/logout entegrasyon testleri —
 * T1.4 ADIM 1/2 (temel akış) ve ADIM 2/2 (CSRF/origin/Content-Type/gövde
 * boyutu — `requireWrite`), S1.4.
 *
 * Görev tanımı: "Route handler'ları doğrudan Request nesnesiyle test et
 * (Next'in route modulünü import edip GET/POST fonksiyonlarını
 * çağırarak)." Next'in kendi istek kapsamı (AsyncLocalStorage) hiç
 * KURULMAZ — route modülleri doğrudan çağrılır, tıpkı gerçek bir Next
 * sunucusunun onları çağıracağı gibi düz `Request` nesnesiyle.
 *
 * QA-PLAN.md §1 — gerçek geçici SQLite + migration + seed; mock/`:memory:`
 * yok. `getAppDb()` (bkz. `../../src/server/data/app-db.ts`) `DOLMUS_
 * DB_PATH` ortam değişkenini okuduğundan, her test kendi geçici dosyasını
 * bu değişkene atar ve `resetAppDbForTests()` ile önbelleği temizler.
 *
 * ADIM 2/2 NOTU: POST /auth/logout ARTIK `requireWrite` kullanır (bkz.
 * `../../src/server/auth/guard.ts` üst notundaki "DAVRANIŞ DEĞİŞİKLİĞİ").
 * Aşağıdaki "geçersiz oturumla da 200 döner" ADIM 1/2 testleri, bu
 * ADIM'da artık 401 bekleyecek şekilde GÜNCELLENDİ (idempotent logout
 * tasarımı, merkezi denetim gereğiyle terk edildi — STORIES.md S1.4'ün
 * hiçbir kabul kriteri o eski davranışı zorunlu kılmıyordu).
 */

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");

/**
 * Testlerdeki isteklerin gittiği (Next Route Handler'a `new Request(url,
 * ...)` ile doğrudan verilen) URL. DÜZELTME TURU 1 NOTU: `guard.ts`
 * `isSameOriginWriteRequest` artık bunu (`request.url`'i) HİÇ OKUMAZ —
 * "aynı kaynak" denetimi `APP_ORIGIN` ortam değişkeninden (bkz.
 * `../../src/server/auth/app-origin.ts`) gelen `trustedOrigin`'e karşı
 * yapılır. Bu dosyadaki `beforeEach` `process.env.APP_ORIGIN`'i
 * `SELF_ORIGIN`'e eşitler; "geçerli yazma isteği" testleri bu yüzden
 * `origin: SELF_ORIGIN` header'ını gönderir. Aşağıdaki "gerçek Next
 * davranışı" describe bloğu, `request.url`'in KASITLI OLARAK FARKLI bir
 * (dahili) adres taşıdığı ama Origin header'ının yine `APP_ORIGIN`'e
 * eşit/farklı olduğu senaryoları ayrıca sınar — bu, denetim bulgusunun
 * kök nedenini (Next'in üretimde `request.url`'i istemcinin gerçek
 * Origin'inden BAĞIMSIZ üretmesi) doğrudan yeniden üretir.
 */
const SELF_ORIGIN = "https://example.invalid";

function fixedClock(iso: string): Clock {
  return () => new Date(iso);
}

function cookieHeader(token: string): string {
  return `dolmus_session=${token}`;
}

function requestWithCookie(url: string, token: string | null, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (token !== null) {
    headers.set("cookie", cookieHeader(token));
  }
  return new Request(url, { ...init, headers });
}

/**
 * `requireWrite`'ın TAMAMINI (origin + CSRF header + Content-Type) geçen
 * bir yazma isteği kurar — "geçerli yazma isteği" temel çizgisi. Tek tek
 * negatif testler bu temelden BİR alanı bozarak 403/415/413 yolunu dener
 * (S1.4 AC7).
 */
function validWriteRequest(
  url: string,
  token: string,
  csrfToken: string,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookieHeader(token));
  headers.set("origin", SELF_ORIGIN);
  headers.set("x-csrf-token", csrfToken);
  headers.set("content-type", "application/json");
  return new Request(url, { method: "POST", ...init, headers });
}

describe("GET /api/v1/session ve POST /api/v1/auth/logout (T1.4 ADIM 1/2)", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  beforeEach(() => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
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

  async function setUpSeededDb(): Promise<void> {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-session-routes-"));
    dbPath = path.join(dir, "test.sqlite");
    const setupSqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    const setupDb = createDb(setupSqlite);
    migrate(setupDb, { migrationsFolder });
    await seedDevData(setupSqlite);
    setupSqlite.close();

    process.env.DOLMUS_DB_PATH = dbPath;
    resetAppDbForTests();
  }

  /** Migration UYGULANMAMIŞ (ama dosya var) bir DB — 503 yolunu test eder. */
  function setUpUnmigratedDb(): void {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-session-routes-"));
    dbPath = path.join(dir, "test.sqlite");
    openDatabaseConnection(dbPath, { createIfMissing: true }).close();
    process.env.DOLMUS_DB_PATH = dbPath;
    resetAppDbForTests();
  }

  describe("GET /api/v1/session", () => {
    beforeEach(setUpSeededDb);

    it("çerez yoksa 401 SESSION_MISSING döner", async () => {
      const response = await getSession(
        requestWithCookie("https://example.invalid/api/v1/session", null),
      );
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe("SESSION_MISSING");
      expect(typeof body.request_id).toBe("string");
    });

    it("geçersiz/bilinmeyen token için 401 SESSION_MISSING döner", async () => {
      const response = await getSession(
        requestWithCookie(
          "https://example.invalid/api/v1/session",
          "boyle-bir-token-hic-yok",
        ),
      );
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("SESSION_MISSING");
    });

    it("geçerli araç sahibi oturumu için rol/kapsam/CSRF döner; sessionId/credentialId sızmaz", async () => {
      // Test setup'ının kendi bağlantısı `getAppDb()`'den ayrı olduğundan
      // gerçek DB dosyasını doğrudan açıp oturum kaydını oradan üretiyoruz.
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const response = await getSession(
        requestWithCookie(
          "https://example.invalid/api/v1/session",
          created.token,
        ),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        kind: "vehicle",
        role: "owner",
        businessId: SEED_IDS.businessA,
        vehicleId: SEED_IDS.vehicleA1,
        // T1.2, DECISIONS.md T1.5 notunun son cümlesi — "Araç oturumu
        // için T1.2'de plate (görüntü biçimi) eklenecek." seed'in
        // vehicleA1 plakası "34 AAA 001" (SEED_RAW_PLATES.vehicleA1).
        plate: "34 AAA 001",
      });
      expect(typeof body.csrfToken).toBe("string");
      expect(body.csrfToken.length).toBeGreaterThan(0);
      expect(typeof body.request_id).toBe("string");
      // DECISIONS.md T1.4 kararı (satır 89) — GET /session sessionId/
      // credentialId/platformUserId VERMEZ; client-state anahtarı yalnız
      // aşağıdaki `scopeKey`dir (bkz. session-scope-summary.test.ts).
      expect(body).not.toHaveProperty("sessionId");
      expect(body).not.toHaveProperty("credentialId");
      expect(body).not.toHaveProperty("platformUserId");
    });

    it("geçerli ekip (platform) oturumu için businessId/vehicleId/platformUserId alanları HİÇ yoktur", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createPlatformSession(setupDb, SEED_IDS.platformSupport1);
      setupSqlite.close();

      const response = await getSession(
        requestWithCookie("https://example.invalid/api/v1/session", created.token),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.kind).toBe("platform");
      expect(body.role).toBe("support");
      // DECISIONS.md T1.4 kararı (satır 89): iki farklı ekip üyesi (ör. iki
      // "support" hesabı) aynı cihazı paylaşsa bile `platformUserId`
      // yanıtta YOKTUR; ayırt etme ihtiyacı `scopeKey` ile karşılanır (bkz.
      // session-scope-summary.test.ts).
      expect(body).not.toHaveProperty("businessId");
      expect(body).not.toHaveProperty("vehicleId");
      expect(body).not.toHaveProperty("sessionId");
      expect(body).not.toHaveProperty("credentialId");
      expect(body).not.toHaveProperty("platformUserId");
      // T1.2 — `plate` yalnız araç (`kind: "vehicle"`) oturumları içindir;
      // ekip oturumunda hiç `vehicleId` olmadığından plaka sorgusu hiç
      // ÇALIŞTIRILMAZ ve alan yanıtta YOKTUR.
      expect(body).not.toHaveProperty("plate");
    });

    it("süresi dolmuş oturum için 401 SESSION_EXPIRED ve S1.4 AC6 metni birebir döner", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(
        setupDb,
        SEED_IDS.credA1Owner,
        fixedClock("2000-01-01T00:00:00.000Z"),
      );
      setupSqlite.close();

      const response = await getSession(
        requestWithCookie("https://example.invalid/api/v1/session", created.token),
      );
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe("SESSION_EXPIRED");
      expect(body.error.message).toBe("Oturumun sona erdi. Yeniden giriş yap.");
    });

    it("araç SONRADAN pasifleşince 401 SESSION_REVOKED döner", async () => {
      // T2.2 — `createVehicleSession` artık aracın/işletmenin GÜNCEL
      // aktifliğini KENDİSİ de denetlediğinden (bkz. o dosyanın üst
      // notu), zaten pasif bir araç için oturum hiç KURULAMAZ; bu test
      // `resolveSession`in KENDİ (oluşturmadan SONRAKİ) denetimini
      // sınadığından oturum ÖNCE aktifken kurulur, SONRA araç
      // pasifleştirilir.
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.prepare("UPDATE vehicles SET active = 0 WHERE id = ?").run(SEED_IDS.vehicleA1);
      setupSqlite.close();

      const response = await getSession(
        requestWithCookie("https://example.invalid/api/v1/session", created.token),
      );
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("SESSION_REVOKED");
    });

    it("gizli veri (token/hash) yanıt gövdesinde HİÇ yer almaz", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const response = await getSession(
        requestWithCookie("https://example.invalid/api/v1/session", created.token),
      );
      const text = await response.text();
      expect(text).not.toContain(created.token);
    });
  });

  describe("GET /api/v1/session — DB hazır değil (503)", () => {
    beforeEach(setUpUnmigratedDb);

    it("migration uygulanmamışken 503 SERVICE_UNAVAILABLE döner (dosya yolu/iç hata sızmaz)", async () => {
      const response = await getSession(
        requestWithCookie(
          "https://example.invalid/api/v1/session",
          "herhangi-bir-token",
        ),
      );
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
      expect(JSON.stringify(body)).not.toContain(dbPath);
    });
  });

  /**
   * DÜZELTME TURU 2 — denetim bulgusu ("high", `guvenlik` merceği):
   * `resolveSession`'ın SELECT'i/last_seen_at UPDATE'i sırasında canlı bir
   * SQLITE_BUSY/SQLITE_LOCKED, `guard.ts` `requireSession`'ın catch'inden
   * (yalnız `SessionError`/DB-hazır-değil sınıflarını yakalıyordu) SIZIP
   * Next'in genel 500'üne (ARCHITECTURE §4 zarfı OLMADAN) düşüyordu. Bu
   * blok denetimin GERÇEK tekrar üretimini birebir sınar: mock/`:memory:`
   * DEĞİL, AYNI dosyaya İKİNCİ bir better-sqlite3 bağlantısıyla açılan
   * gerçek bir yazma kilidi (QA-PLAN.md §1).
   */
  describe("GET /api/v1/session — DB kilitli (503, gerçek SQLITE_BUSY)", () => {
    beforeEach(setUpSeededDb);

    it(
      "last_seen_at eşiğini aşan bir oturumla, eşzamanlı BEGIN IMMEDIATE kilidi busy_timeout'u (2000 ms) aşınca 503 SERVICE_UNAVAILABLE döner (kilit kodu/dosya yolu sızmaz)",
      async () => {
        // last_seen eşiğini (5 dk — SESSION_LAST_SEEN_WRITE_INTERVAL_MS) AŞAN
        // bir oturum üret: resolveSession yalnız SELECT değil, last_seen_at
        // UPDATE'ini de gerçekten dener — denetimin ORİJİNAL tekrar
        // üretimiyle (last_seen yazma eşiğini aşan gerçek bir çerez) BİREBİR
        // aynı senaryo.
        const staleClock: Clock = () => new Date(Date.now() - 6 * 60_000);
        const setupSqlite = openDatabaseConnection(dbPath);
        const setupDb = createDb(setupSqlite);
        const created = await createVehicleSession(
          setupDb,
          SEED_IDS.credA1Owner,
          staleClock,
        );
        setupSqlite.close();

        // İKİNCİ, TAMAMEN AYRI bir bağlantıyla AYNI dosyada BEGIN IMMEDIATE
        // açıp kilidi busy_timeout'tan UZUN tutuyoruz — WAL modunda bu
        // yalnız YAZMAYI (last_seen_at UPDATE'ini) engeller, ilk SELECT'i
        // DEĞİL; bu yüzden hata gerçekten UPDATE aşamasında oluşur.
        const lockerSqlite = openDatabaseConnection(dbPath);
        lockerSqlite.exec("BEGIN IMMEDIATE");
        try {
          const response = await getSession(
            requestWithCookie(
              "https://example.invalid/api/v1/session",
              created.token,
            ),
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
  });

  describe("POST /api/v1/auth/logout", () => {
    beforeEach(setUpSeededDb);

    it("geçerli oturumu + doğru origin/CSRF/Content-Type ile iptal eder, cookie'yi siler ve sonraki GET /session'ı 401 SESSION_REVOKED yapar", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      const response = await logout(
        validWriteRequest(
          `${SELF_ORIGIN}/api/v1/auth/logout`,
          created.token,
          created.context.csrfToken,
        ),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("ok");
      expect(typeof body.request_id).toBe("string");

      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).not.toBeNull();
      expect(setCookie).toContain("dolmus_session=;");
      expect(setCookie).toContain("Max-Age=0");
      expect(setCookie).toContain("HttpOnly");

      const followUp = await getSession(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
      );
      expect(followUp.status).toBe(401);
      expect((await followUp.json()).error.code).toBe("SESSION_REVOKED");
    });

    it("çerez yoksa 401 SESSION_MISSING döner (ADIM 2/2: requireWrite önce requireSession ister; artık 200 idempotent DEĞİL)", async () => {
      const response = await logout(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/auth/logout`, null, {
          method: "POST",
        }),
      );
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("SESSION_MISSING");
    });

    it("bilinmeyen token ile 401 SESSION_MISSING döner", async () => {
      const response = await logout(
        requestWithCookie(
          `${SELF_ORIGIN}/api/v1/auth/logout`,
          "hic-boyle-bir-token-yok",
          { method: "POST" },
        ),
      );
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("SESSION_MISSING");
    });

    it("süresi dolmuş bir oturumla 401 SESSION_EXPIRED döner", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(
        setupDb,
        SEED_IDS.credA1Owner,
        fixedClock("2000-01-01T00:00:00.000Z"),
      );
      setupSqlite.close();

      const response = await logout(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/auth/logout`, created.token, {
          method: "POST",
        }),
      );
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("SESSION_EXPIRED");
    });

    // -----------------------------------------------------------------
    // S1.4 AC7 — "Cookie/oturum sırrı URL veya ... localStorage alanında
    // tutulmaz; ... yazma isteği kaynağı kontrolleri uygulanır. Geçersiz
    // kaynak/tokenla yazma isteği veri değiştirmez." Her negatif testte
    // aynı oturum SONRADAN hâlâ geçerli olduğu (GET /session 200) ayrıca
    // doğrulanır — "veri değiştirmez" = oturum revoke EDİLMEMİŞTİR.
    // -----------------------------------------------------------------

    it("geçerli oturum ama CSRF header eksik → 403 CSRF_TOKEN_INVALID; oturum hâlâ geçerli (AC7)", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const request = new Request(`${SELF_ORIGIN}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          cookie: cookieHeader(created.token),
          origin: SELF_ORIGIN,
          "content-type": "application/json",
          // "x-csrf-token" KASITLI OLARAK YOK.
        },
      });
      const response = await logout(request);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("CSRF_TOKEN_INVALID");

      const followUp = await getSession(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
      );
      expect(followUp.status).toBe(200);
    });

    it("geçerli oturum ama CSRF header YANLIŞ → 403 CSRF_TOKEN_INVALID; oturum hâlâ geçerli", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const response = await logout(
        validWriteRequest(
          `${SELF_ORIGIN}/api/v1/auth/logout`,
          created.token,
          "baska-bir-oturumun-csrf-tokeni",
        ),
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("CSRF_TOKEN_INVALID");

      const followUp = await getSession(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
      );
      expect(followUp.status).toBe(200);
    });

    it("geçerli oturum ama CSRF header BAŞKA BİR GERÇEK oturumun (AYNI uzunlukta) tokenı → 403 CSRF_TOKEN_INVALID (düzeltme turu 1: timingSafeEqual EŞİT-uzunluk yolu)", async () => {
      // İki farklı gerçek oturumun CSRF tokenı `deriveCsrfToken` çıktısı
      // olduğundan AYNI uzunluktadır (sabit boyutlu SHA-256/base64url) —
      // bu, `csrfTokenMatches`'in `crypto.timingSafeEqual` çağırdığı
      // (uzunluk-eşit) dalını, önceki testin uzunluk-farklı dalından
      // AYRI olarak sınar.
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      const otherSession = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      expect(otherSession.context.csrfToken.length).toBe(
        created.context.csrfToken.length,
      );
      expect(otherSession.context.csrfToken).not.toBe(created.context.csrfToken);

      const response = await logout(
        validWriteRequest(
          `${SELF_ORIGIN}/api/v1/auth/logout`,
          created.token,
          otherSession.context.csrfToken,
        ),
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("CSRF_TOKEN_INVALID");

      const followUp = await getSession(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
      );
      expect(followUp.status).toBe(200);
    });

    it("aynı kaynak DEĞİL (Origin farklı) → 403 ORIGIN_INVALID; oturum hâlâ geçerli", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const request = new Request(`${SELF_ORIGIN}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          cookie: cookieHeader(created.token),
          origin: "https://saldirgan.invalid",
          "x-csrf-token": created.context.csrfToken,
          "content-type": "application/json",
        },
      });
      const response = await logout(request);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("ORIGIN_INVALID");

      const followUp = await getSession(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
      );
      expect(followUp.status).toBe(200);
    });

    it("Sec-Fetch-Site: cross-site VARSA Origin göz ardı edilir → 403 ORIGIN_INVALID", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const request = new Request(`${SELF_ORIGIN}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          cookie: cookieHeader(created.token),
          origin: SELF_ORIGIN,
          "sec-fetch-site": "cross-site",
          "x-csrf-token": created.context.csrfToken,
          "content-type": "application/json",
        },
      });
      const response = await logout(request);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("ORIGIN_INVALID");
    });

    it("Origin VE Sec-Fetch-Site header'larının İKİSİ DE YOK (geçerli cookie+CSRF+Content-Type) → 403 ORIGIN_INVALID; oturum hâlâ geçerli (denetim bulgusu, düzeltme turu 3 — güvenli varsayım regresyon testi)", async () => {
      // `isSameOriginWriteRequest` (guard.ts) ikisi de eksikken `false`
      // döner (güvenli varsayım — modern tarayıcılar POST fetch/XHR'de bu
      // iki header'dan en az birini HER ZAMAN gönderir; ikisi de yoksa
      // istek tarayıcı kaynaklı DEĞİLDİR sayılır). Önceki turlardaki tüm
      // CSRF/origin testleri ya `origin` ya `sec-fetch-site` gönderiyordu;
      // bu test "ikisi de eksik" kombinasyonunu doğrudan sınar.
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const request = new Request(`${SELF_ORIGIN}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          cookie: cookieHeader(created.token),
          "x-csrf-token": created.context.csrfToken,
          "content-type": "application/json",
        },
      });
      expect(request.headers.has("origin")).toBe(false);
      expect(request.headers.has("sec-fetch-site")).toBe(false);

      const response = await logout(request);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("ORIGIN_INVALID");

      const followUp = await getSession(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
      );
      expect(followUp.status).toBe(200);
    });

    // -----------------------------------------------------------------
    // Denetim bulgusu (düzeltme turu 1, "blocker"/"high"/"mimari") — kök
    // neden: Next'in GERÇEK üretim topolojisinde (ARCHITECTURE §2 — "Next
    // ... Yalnız 127.0.0.1:3000") Route Handler'a verilen `request.url`,
    // istemcinin gönderdiği Host/Origin'den DEĞİL, sunucunun kendi dinleme
    // adresinden üretilir (bkz. `../../src/server/auth/app-origin.ts` üst
    // notundaki next-server.js/build-utils.js kaynak kanıtı). Aşağıdaki
    // iki test, `request.url`'i BİLEREK `SELF_ORIGIN`'den (== bu paketin
    // `APP_ORIGIN`'i) FARKLI, dahili bir adrese ayarlayarak GERÇEK Next
    // davranışını taklit eder ve `isSameOriginWriteRequest`'in artık bunu
    // HİÇ OKUMADIĞINI kanıtlar.
    // -----------------------------------------------------------------
    describe("APP_ORIGIN — request.url'den BAĞIMSIZ aynı-kaynak denetimi (düzeltme turu 1)", () => {
      /** Next'in üretimde ürettiği TÜRDEN, istemcinin GERÇEKTE görmediği
       * dahili bir adres — bkz. `build-utils.js`: `hostname =
       * process.env.HOSTNAME || '0.0.0.0'`. */
      const INTERNAL_URL = "http://127.0.0.1:41234/api/v1/auth/logout";

      it("request.url dahili bir adres taşısa da Origin header APP_ORIGIN ile eşleşiyorsa KABUL edilir", async () => {
        const setupSqlite = openDatabaseConnection(dbPath);
        const setupDb = createDb(setupSqlite);
        const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
        setupSqlite.close();

        const request = new Request(INTERNAL_URL, {
          method: "POST",
          headers: {
            cookie: cookieHeader(created.token),
            // Tarayıcının GERÇEKTEN gönderdiği genel origin — APP_ORIGIN
            // ile eşleşir, `request.url`'in origin'iyle DEĞİL.
            origin: SELF_ORIGIN,
            "x-csrf-token": created.context.csrfToken,
            "content-type": "application/json",
          },
        });
        const response = await logout(request);
        expect(response.status).toBe(200);
      });

      it("REGRESYON — Origin header request.url'in origin'iyle eşleşse ama APP_ORIGIN'den FARKLI olsa 403 ORIGIN_INVALID döner (eski hatalı davranış)", async () => {
        const setupSqlite = openDatabaseConnection(dbPath);
        const setupDb = createDb(setupSqlite);
        const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
        setupSqlite.close();

        // Önceki (hatalı) uygulama `new URL(request.url).origin` ile
        // karşılaştırıyordu; bu Origin `request.url`'in origin'iyle
        // BİREBİR aynıdır (eski kod bunu KABUL EDERDİ) ama gerçek
        // `APP_ORIGIN` (`SELF_ORIGIN`) ile FARKLIDIR — doğru davranış
        // REDDETMEKTİR.
        const request = new Request(INTERNAL_URL, {
          method: "POST",
          headers: {
            cookie: cookieHeader(created.token),
            origin: "http://127.0.0.1:41234",
            "x-csrf-token": created.context.csrfToken,
            "content-type": "application/json",
          },
        });
        const response = await logout(request);
        expect(response.status).toBe(403);
        expect((await response.json()).error.code).toBe("ORIGIN_INVALID");

        const followUp = await getSession(
          requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
        );
        expect(followUp.status).toBe(200);
      });
    });

    it("APP_ORIGIN yapılandırılmamışsa (dağıtım hatası) yazma isteği 503 SERVICE_UNAVAILABLE döner; oturum hâlâ geçerli", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      delete process.env.APP_ORIGIN;
      resetTrustedAppOriginForTests();

      const response = await logout(
        validWriteRequest(
          `${SELF_ORIGIN}/api/v1/auth/logout`,
          created.token,
          created.context.csrfToken,
        ),
      );
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("SERVICE_UNAVAILABLE");

      process.env.APP_ORIGIN = SELF_ORIGIN;
      resetTrustedAppOriginForTests();
      const followUp = await getSession(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
      );
      expect(followUp.status).toBe(200);
    });

    it("Content-Type application/json DEĞİL → 415 UNSUPPORTED_MEDIA_TYPE; oturum hâlâ geçerli", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const request = new Request(`${SELF_ORIGIN}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          cookie: cookieHeader(created.token),
          origin: SELF_ORIGIN,
          "x-csrf-token": created.context.csrfToken,
          "content-type": "text/plain",
        },
      });
      const response = await logout(request);
      expect(response.status).toBe(415);
      expect((await response.json()).error.code).toBe("UNSUPPORTED_MEDIA_TYPE");

      const followUp = await getSession(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
      );
      expect(followUp.status).toBe(200);
    });

    it("gövde 64 KB sınırını aşarsa 413 PAYLOAD_TOO_LARGE; oturum hâlâ geçerli", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const oversizedBody = "a".repeat(64 * 1024 + 1);
      const response = await logout(
        validWriteRequest(
          `${SELF_ORIGIN}/api/v1/auth/logout`,
          created.token,
          created.context.csrfToken,
          { body: oversizedBody },
        ),
      );
      expect(response.status).toBe(413);
      expect((await response.json()).error.code).toBe("PAYLOAD_TOO_LARGE");

      const followUp = await getSession(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
      );
      expect(followUp.status).toBe(200);
    });

    // -----------------------------------------------------------------
    // Denetim bulgusu (düzeltme turu 1, "medium") — kök neden: önceki
    // uygulama `request.arrayBuffer()` ile gövdenin TAMAMINI belleğe
    // okuduktan SONRA boyutu denetliyordu; 413 dönmeden ÖNCE isteyerek
    // büyük bir gövde sunucu belleğine tam okunuyordu. Aşağıdaki testler
    // `guard.ts` `readBodyWithLimit`'in artık AKIŞI erken İPTAL ettiğini
    // (gövdenin tamamını okumadığını) doğrudan kanıtlar.
    // -----------------------------------------------------------------

    it("Content-Length sınırı önceden bildiriyorsa gövde OKUYUCUSU (reader) HİÇ BAŞLATILMADAN 413 döner", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      // NOT: Node'un `Request` uygulaması (undici) verilen `ReadableStream`'i
      // gövde ÇIKARIMI (`extractBody`) sırasında KENDİ İÇİNDE bir kez
      // "dokunabilir" (Fetch spec gereği) — bu, `readBodyWithLimit`'in
      // KONTROLÜ DIŞINDADIR ve isteğin gerçek Next sunucusuna ulaşmadan
      // ÖNCE zaten olmuş bir şeydir. Asıl kanıtlanması gereken, BİZİM
      // KODUMUZUN akışı bir OKUMA DÖNGÜSÜNE ASLA SOKMADIĞIDIR — bu yüzden
      // üretilen TOPLAM bayt, tek bir (kaçınılmaz) runtime "dokunuşu"nun
      // ötesine GEÇMEMELİDİR (aşağıdaki sınır, gerçek boyuttan/8 KB'den
      // ÇOK daha büyük, ama saldırganın Content-Length'te beyan ettiği
      // 1 MB'den ÇOK daha küçüktür — eski hatalı davranış TÜM 1 MB'yi
      // okurdu).
      let producedBytes = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          producedBytes += 8 * 1024;
          controller.enqueue(new Uint8Array(8 * 1024).fill(97));
        },
      });

      const request = new Request(`${SELF_ORIGIN}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          cookie: cookieHeader(created.token),
          origin: SELF_ORIGIN,
          "x-csrf-token": created.context.csrfToken,
          "content-type": "application/json",
          // Gerçek boyuttan BAĞIMSIZ, sınırı (64 KB) AŞAN bir
          // Content-Length beyanı — istemci yalan söylese bile hızlı yol
          // yalnız bu header'a bakarak reddetmelidir.
          "content-length": String(1024 * 1024),
        },
        // @ts-expect-error -- Node'un fetch tipleri `duplex`'i henüz
        // `RequestInit`'e eklemedi; runtime'da (undici) gövde akışı
        // gönderirken ZORUNLUDUR.
        duplex: "half",
        body: stream,
      });

      const response = await logout(request);
      expect(response.status).toBe(413);
      expect((await response.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
      // Eski hatalı davranış `request.arrayBuffer()` ile beyan edilen 1
      // MB'nin TAMAMINI okurdu; düzeltme, Content-Length'e bakar bakmaz
      // (bizim kodumuz HİÇ okuma döngüsüne girmeden) reddeder — üretilen
      // veri, kaçınılmaz tek runtime "dokunuşu"nun ötesine geçmemelidir.
      expect(producedBytes).toBeLessThanOrEqual(8 * 1024);

      const followUp = await getSession(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
      );
      expect(followUp.status).toBe(200);
    });

    it("Content-Length YOKSA (veya güvenilmezse) akış sınır AŞILIR AŞILMAZ iptal edilir; gövdenin tamamı okunmaz", async () => {
      const setupSqlite = openDatabaseConnection(dbPath);
      const setupDb = createDb(setupSqlite);
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      // Bu üretici SINIRSIZDIR (her `pull()` çağrısında yeni bir parça
      // üretir) — gerçek bir saldırganın yüzlerce MB'lık gövdesini temsil
      // eder. Eski hatalı davranış (`request.arrayBuffer()`) bunu SONSUZA
      // KADAR okumaya çalışırdı (test asla bitmezdi). Düzeltme sınırı
      // aşar aşmaz akışı iptal etmelidir; bu yüzden üretilen TOPLAM bayt
      // sınırın küçük, SABİT bir katının (birkaç parça payı) ÖTESİNE
      // GEÇMEMELİDİR.
      const chunkSize = 8 * 1024;
      let producedBytes = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          producedBytes += chunkSize;
          controller.enqueue(new Uint8Array(chunkSize).fill(97));
        },
      });

      const request = new Request(`${SELF_ORIGIN}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          cookie: cookieHeader(created.token),
          origin: SELF_ORIGIN,
          "x-csrf-token": created.context.csrfToken,
          "content-type": "application/json",
          // Content-Length KASITLI OLARAK YOK — undici bunu otomatik
          // eklemez (akış uzunluğu önceden bilinmez); asıl savunma akış
          // sayacı olmalıdır.
        },
        // @ts-expect-error -- bkz. yukarıdaki not.
        duplex: "half",
        body: stream,
      });

      const response = await logout(request);
      expect(response.status).toBe(413);
      expect((await response.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
      // Sınırlı (bounded) fazla okuma kabul edilir (runtime'ın kendi
      // gövde çıkarımı + okuma döngüsünün son turu birkaç parça İLERİ
      // gidebilir), ama SINIRSIZ DEĞİLDİR — eski "tüm gövdeyi oku" hatası
      // burada MB'lerce veri üretilmesine yol açardı.
      expect(producedBytes).toBeLessThanOrEqual(MAX_WRITE_BODY_BYTES + 8 * chunkSize);

      const followUp = await getSession(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/session`, created.token),
      );
      expect(followUp.status).toBe(200);
    });
  });

  describe("POST /api/v1/auth/logout — DB hazır değil (503)", () => {
    beforeEach(setUpUnmigratedDb);

    it("migration uygulanmamışken (ve çerez varsa) 503 SERVICE_UNAVAILABLE döner", async () => {
      const response = await logout(
        requestWithCookie(
          "https://example.invalid/api/v1/auth/logout",
          "herhangi-bir-token",
          { method: "POST" },
        ),
      );
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("SERVICE_UNAVAILABLE");
    });
  });

  /**
   * DÜZELTME TURU 2 — denetim bulgusu ("high"): `requireWrite` BAŞARILI
   * olduktan SONRA `route.ts`'in kendi `revokeSession` yazması AYRI bir
   * SQLITE_BUSY/SQLITE_LOCKED riski taşır (`guard.ts`'in denetimi yalnız
   * `requireWrite`'ın KENDİ içindeki okuma/last_seen yazmasını kapsar).
   * Bu, "logout dahil tüm yazma uçları" ifadesinin işaret ettiği İKİNCİ
   * (ve bu paketteki tek diğer) DB yazma noktasıdır.
   */
  describe("POST /api/v1/auth/logout — DB kilitli (503, gerçek SQLITE_BUSY)", () => {
    beforeEach(setUpSeededDb);

    it(
      "revokeSession yazması sırasında canlı bir kilit 503 SERVICE_UNAVAILABLE'a çevrilir; kilit kodu sızmaz",
      async () => {
        const setupSqlite = openDatabaseConnection(dbPath);
        const setupDb = createDb(setupSqlite);
        const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
        setupSqlite.close();

        const lockerSqlite = openDatabaseConnection(dbPath);
        lockerSqlite.exec("BEGIN IMMEDIATE");
        try {
          const response = await logout(
            validWriteRequest(
              `${SELF_ORIGIN}/api/v1/auth/logout`,
              created.token,
              created.context.csrfToken,
            ),
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
  });
});
