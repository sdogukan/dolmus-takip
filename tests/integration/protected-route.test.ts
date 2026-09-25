/**
 * Korumalı route deseni entegrasyon testleri — T1.5 ADIM 2/2, S1.5.
 *
 * DÜZELTME TURU 3 (denetim bulgusu, `ac` merceği): önceki bir sürüm bu
 * dosyayı gerçek bir `GET /api/v1/vehicles/current` üretim ucuna karşı
 * çalıştırıyordu. Denetim doğruladı ki bu uç (ve onu kullanan
 * `vehicle.read_current` izni) ne mimaride ne de kayıtlı kararlarda
 * karşılığı olan, ürün sahibi onaylı bir yüzeydi —
 * yalnız `withProtectedRoute`'un `target: "vehicle"` dalını CANLI bir HTTP
 * isteğiyle "kanıtlamak" için icat edilmişti (bkz. `../../src/server/auth/
 * permissions.ts` "KALDIRILDI" notu). Uç ve izin KALDIRILDI; bu dosya artık
 * (aşağıdaki `target:"none"`/`"business"` bölümleriyle AYNI, zaten
 * kanıtlanmış desenle) `target:"vehicle"` + `write:false` kombinasyonunu da
 * KÜÇÜK bir SENTETİK handler'la kanıtlar — gerçek bir üretim ucu İCAT
 * ETMEDEN. 401/403/404/422/200 ayrımı ve başka araç/işletme reddi (görev
 * tanımının iş adımı 3'ünün istediği kanıt) böylece KORUNUR; yalnız kanıtın
 * ARACI (gerçek route yerine sentetik handler) değişmiştir.
 *
 * Üç bölüm:
 * 1. `withProtectedRoute — target:'vehicle'` — sentetik handler, gerçek
 *    Request/Response, gerçek geçici SQLite + migration + seed.
 *    401/403/404/422/200 ve başka araç/işletme reddi BURADA kanıtlanır.
 * 2. `target: "none"`/`"business"` ve `write: true` — aynı gerçek DB/oturum
 *    altyapısıyla, KÜÇÜK sentetik handler'lar sarılır (görev tanımının
 *    "Gelecek TÜM route handler'ların izleyeceği deseni ... kur" cümlesi —
 *    yalnız TEK bir target/write kombinasyonu ile sınanmış bir "genel
 *    deseni" kurulmuş SAYMAK "kanıta dayalı çalış" ilkesiyle uyuşmaz).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS } from "../../scripts/db-seed-dev";
import { createDb, openDatabaseConnection, withImmediateTransaction } from "../../src/server/data/db";
import { businesses, vehicles } from "../../src/server/data/schema";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { recheckScopeInTransaction, ScopeTargetInactiveError } from "../../src/server/data/scoped";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { systemClock } from "../../src/server/auth/session";
import { TARGET_VEHICLE_HEADER } from "../../src/server/auth/scope";
import { withProtectedRoute } from "../../src/server/http/handler";
import { jsonErrorResponse, jsonSuccessResponse } from "../../src/server/http/errors";
import { setBusinessActive } from "../../src/server/usecases/access";
import { createPlatformSession } from "../../src/server/usecases/session/create-platform-session";
import { createVehicleSession } from "../../src/server/usecases/session/create-vehicle-session";
import { SessionError } from "../../src/server/usecases/session/errors";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";

function cookieHeader(token: string): string {
  return `dolmus_session=${token}`;
}

function requestWithCookie(
  url: string,
  token: string | null,
  extraHeaders: Record<string, string> = {},
): Request {
  const headers = new Headers(extraHeaders);
  if (token !== null) {
    headers.set("cookie", cookieHeader(token));
  }
  return new Request(url, { headers });
}

describe("Korumalı route deseni (T1.5 ADIM 2/2) — gerçek geçici SQLite + migration + seed", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-protected-route-"));
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

  /** Testin kendi oturum kurma bağlantısı — `getAppDb()`'nin önbelleğe
   * aldığı bağlantıdan AYRIDIR (aynı desen: `session-scope-summary.test.ts`). */
  async function openSetupDb() {
    const setupSqlite = openDatabaseConnection(dbPath);
    const setupDb = createDb(setupSqlite);
    return { setupSqlite, setupDb };
  }

  // =====================================================================
  // 1) withProtectedRoute — target:"vehicle" + write:false, KÜÇÜK sentetik
  //    handler (düzeltme turu 3 — bkz. dosya üstü notu: bir üretim ucu
  //    İCAT ETMEDEN aynı 401/403/404/422/200 ayrımını kanıtlar).
  //    "driver.read_active" dört aktörün de (driver/owner/support/admin)
  //    sahip olduğu gerçek bir izindir (bkz. `../../src/server/auth/
  //    permissions.ts`) — bu bölüm bir İZİN denetimi değil, `target:
  //    "vehicle"` KAPSAM ÇÖZÜMLEMESİNİ sınadığından dört aktörün de geçtiği
  //    bu izin kasıtlı seçilmiştir.
  // =====================================================================

  describe("withProtectedRoute — target:'vehicle'", () => {
    const vehicleTargetDummy = withProtectedRoute({
      permission: "driver.read_active",
      target: "vehicle",
    })((ctx) => {
      const scope = ctx.scope!;
      return jsonSuccessResponse(
        200,
        { businessId: scope.businessId, vehicleId: scope.vehicleId, actor: scope.actor },
        { requestId: ctx.requestId },
      );
    });

    function dummyRequest(token: string | null, extraHeaders: Record<string, string> = {}): Request {
      return requestWithCookie(`${SELF_ORIGIN}/api/v1/_dummy`, token, extraHeaders);
    }

    it("401 — oturum çerezi yok (SESSION_MISSING)", async () => {
      const response = await vehicleTargetDummy(dummyRequest(null));
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe("SESSION_MISSING");
    });

    it("200 — driver oturumu KENDİ aracının Scope'unu (businessId/vehicleId/actor) alır", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      const response = await vehicleTargetDummy(dummyRequest(created.token));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.businessId).toBe(SEED_IDS.businessA);
      expect(body.vehicleId).toBe(SEED_IDS.vehicleA1);
      expect(body.actor).toBe("driver");
    });

    it("200 — owner oturumu da KENDİ aracını (driver ile AYNI aracı) döner", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const response = await vehicleTargetDummy(dummyRequest(created.token));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.vehicleId).toBe(SEED_IDS.vehicleA1);
    });

    it("200 — staff (support) X-Target-Vehicle ile BAŞKA işletmenin (B) aracını AÇIKÇA hedefleyip görebilir (platform desteğinde hedef sunucuda doğrulanır)", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformSupport1);
      setupSqlite.close();

      const response = await vehicleTargetDummy(
        dummyRequest(created.token, { [TARGET_VEHICLE_HEADER]: SEED_IDS.vehicleB1 }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.businessId).toBe(SEED_IDS.businessB);
      expect(body.vehicleId).toBe(SEED_IDS.vehicleB1);
    });

    it("200 — staff PASİF aracı da (mode:'read') görebilir", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformSupport1);
      setupSqlite.close();

      const response = await vehicleTargetDummy(
        dummyRequest(created.token, { [TARGET_VEHICLE_HEADER]: SEED_IDS.vehicleB2 }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.vehicleId).toBe(SEED_IDS.vehicleB2);
    });

    it("404 — staff var olmayan bir araç ID'sini hedeflerse, hangi işletmeye ait olduğu SÖYLENMEDEN reddedilir", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformSupport1);
      setupSqlite.close();

      const response = await vehicleTargetDummy(
        dummyRequest(created.token, {
          [TARGET_VEHICLE_HEADER]: "00000000-0000-4000-8000-000000000000",
        }),
      );
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe("TARGET_VEHICLE_NOT_FOUND");
      const raw = JSON.stringify(body);
      expect(raw).not.toContain(SEED_IDS.businessA);
      expect(raw).not.toContain(SEED_IDS.businessB);
    });

    it("422 — staff hiç X-Target-Vehicle GÖNDERMEZSE (hedef adlandırılmamış — 401/403/404 DEĞİL)", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
      setupSqlite.close();

      const response = await vehicleTargetDummy(dummyRequest(created.token));
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe("TARGET_VEHICLE_MISSING");
    });

    it("403 — BAŞKA ARAÇ reddi: araç (owner) oturumu X-Target-Vehicle ile AYNI işletmenin İKİNCİ aracını (A2) hedeflemeye ÇALIŞIRSA açıkça reddedilir; kendi aracının verisi de SIZMAZ", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const response = await vehicleTargetDummy(
        dummyRequest(created.token, { [TARGET_VEHICLE_HEADER]: SEED_IDS.vehicleA2 }),
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe("TARGET_HEADER_NOT_ALLOWED");
      // A2'nin kimliği hiçbir yanıt alanında YER ALMAZ.
      expect(JSON.stringify(body)).not.toContain(SEED_IDS.vehicleA2);
    });

    it("403 — BAŞKA İŞLETME reddi: araç (driver) oturumu X-Target-Vehicle ile BAŞKA işletmenin (B) aracını hedeflemeye ÇALIŞIRSA açıkça reddedilir", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      const response = await vehicleTargetDummy(
        dummyRequest(created.token, { [TARGET_VEHICLE_HEADER]: SEED_IDS.vehicleB1 }),
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe("TARGET_HEADER_NOT_ALLOWED");
      expect(JSON.stringify(body)).not.toContain(SEED_IDS.businessB);
    });
  });

  // =====================================================================
  // 2) withProtectedRoute — target:"none"/"business" ve write:true, KÜÇÜK
  //    sentetik handler'larla (görev tanımının "Gelecek tüm route
  //    handler'ların izleyeceği deseni kur" istediği GENEL kapsam).
  // =====================================================================

  describe("withProtectedRoute — target:'none'", () => {
    // "audit.read" yalnız support/admin'de vardır (driver/owner'da YOKTUR)
    // — yetki matrisinin "yalnız platform ekibi" satırlarından biri;
    // `/admin/audit` (T2.5, henüz yazılmadı) gibi hiçbir işletme/araca
    // BAĞLI OLMAYAN bir ucu TEMSİL eder.
    const dummy = withProtectedRoute({ permission: "audit.read", target: "none" })(
      (ctx) => {
        expect(ctx.scope).toBeUndefined();
        return Response.json({ ok: true, request_id: ctx.requestId });
      },
    );

    it("driver oturumu 403 alır (audit.read YOK)", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      const response = await dummy(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/_dummy`, created.token),
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("admin oturumu 200 alır (audit.read VAR); ctx.scope tanımsızdır", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
      setupSqlite.close();

      const response = await dummy(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/_dummy`, created.token),
      );
      expect(response.status).toBe(200);
    });
  });

  describe("withProtectedRoute — target:'business'", () => {
    const dummy = withProtectedRoute({ permission: "business.manage", target: "business" })(
      (ctx) => Response.json({ businessId: ctx.scope?.businessId, request_id: ctx.requestId }),
    );

    it("staff (admin) + routeParams.params.businessId → o işletmenin Scope'unu üretir (vehicleId YOK)", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
      setupSqlite.close();

      const response = await dummy(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/_dummy`, created.token),
        { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.businessId).toBe(SEED_IDS.businessA);
    });

    it("staff (admin) + var olmayan businessId → 404 TARGET_BUSINESS_NOT_FOUND", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
      setupSqlite.close();

      const response = await dummy(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/_dummy`, created.token),
        { params: Promise.resolve({ businessId: "00000000-0000-4000-8000-000000000000" }) },
      );
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe("TARGET_BUSINESS_NOT_FOUND");
    });

    it("ARAÇ oturumu (owner) routeParams'ta BAŞKA işletme yazılsa bile KENDİ işletmesinin Scope'unu alır, sonra 403'e düşer (business.manage YOK)", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const response = await dummy(
        requestWithCookie(`${SELF_ORIGIN}/api/v1/_dummy`, created.token),
        { params: Promise.resolve({ businessId: SEED_IDS.businessB }) },
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  /**
   * Denetim bulgusu (düzeltme turu 3, `guvenlik` merceği): `resolveAdminScope`
   * (target:"business") — `resolveStaffVehicleScopeFromHeader`'ın (target:
   * "vehicle") aksine — scope ÇÖZÜMLEME anında hiçbir aktiflik denetimi
   * YAPMAZ (bkz. `../../src/server/auth/scope.ts` `resolveAdminScope` üst
   * notu). Bu, bir eksiklik/unutma DEĞİL, KASITLI bir tasarımdır:
   * yetki matrisinin staff'a verdiği "İşletme/araç açma" TEK meşru
   * reaktivasyon işlemidir; scope çözümleme anında write+pasif'i
   * KOŞULSUZ reddetmek (resolveStaffVehicleScopeFromHeader'ın yaptığı gibi)
   * bu reaktivasyonu YAPISAL olarak İMKANSIZ kılardı (bkz. `../../src/
   * server/data/scoped.ts` `RecheckScopeOptions` üst notu ve
   * `scope-resolution.test.ts`'in "artık YAPISAL olarak mümkün" testleri —
   * `skipBusinessActiveCheck`/`skipVehicleActiveCheck` TAM OLARAK bu yüzden
   * eklendi). Bu yüzden target:"business" yazmalarında TEK savunma katmanı
   * `recheckScopeInTransaction`'ın YAZMA TRANSACTION'I İÇİNDE, HEDEFİ
   * REAKTİVE ETMEYEN her yazma için skip bayrağı OLMADAN çağrılmasıdır —
   * `withProtectedRoute` bunu yapısal/tip düzeyinde ZORUNLU KILAMAZ (denetim
   * + yazma AYNI transaction'da olmalıdır — bir ön-adım olarak genel
   * route wrapper'ına taşınamaz, bkz. `scoped.ts` dosya üstü notu).
   *
   * Bu blok, T2.1 (`PATCH /admin/businesses/:id`) ve T2.2 (`PATCH
   * /admin/vehicles/:id`)'nin KOPYALAMASI gereken DOĞRU deseni CANLI bir
   * HTTP isteğiyle kanıtlar: pasif hedefe sıradan bir yazma 403'e düşer;
   * AYNI mekanizma, hedefi bizzat reaktive eden yazmayı ENGELLEMEZ.
   */
  describe("withProtectedRoute — target:'business' + write:true (recheckScopeInTransaction örneği)", () => {
    const writeBusinessTarget = withProtectedRoute({
      permission: "business.manage",
      write: true,
      target: "business",
    })(async (ctx) => {
      const parsed = JSON.parse(ctx.bodyText ?? "{}") as { active?: boolean };
      const scope = ctx.scope!;
      const reactivating = parsed.active === true;
      try {
        withImmediateTransaction(ctx.db.$client, () => {
          recheckScopeInTransaction(ctx.db, ctx.context, scope, systemClock, {
            skipBusinessActiveCheck: reactivating && !scope.vehicleId,
            skipVehicleActiveCheck: reactivating && !!scope.vehicleId,
          });
          if (scope.vehicleId) {
            ctx.db
              .update(vehicles)
              .set({ active: parsed.active ?? true })
              .where(eq(vehicles.id, scope.vehicleId))
              .run();
          } else {
            ctx.db
              .update(businesses)
              .set({ active: parsed.active ?? true })
              .where(eq(businesses.id, scope.businessId))
              .run();
          }
        });
      } catch (error) {
        if (error instanceof SessionError) {
          return jsonErrorResponse(401, error.code, error.message, { requestId: ctx.requestId });
        }
        if (error instanceof ScopeTargetInactiveError) {
          return jsonErrorResponse(error.status, error.code, error.message, {
            requestId: ctx.requestId,
          });
        }
        throw error;
      }
      return jsonSuccessResponse(200, { updated: true }, { requestId: ctx.requestId });
    });

    function businessWriteRequest(token: string, csrfToken: string, body: unknown): Request {
      const headers = new Headers({
        cookie: cookieHeader(token),
        origin: SELF_ORIGIN,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      });
      return new Request(`${SELF_ORIGIN}/api/v1/_dummy`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
      });
    }

    it("pasif işletmeye sıradan (reaktive ETMEYEN) yazma 403 TARGET_INACTIVE_FOR_WRITE ile reddedilir", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      setBusinessActive(setupDb, SEED_IDS.businessA, false);
      const created = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
      setupSqlite.close();

      const response = await writeBusinessTarget(
        businessWriteRequest(created.token, created.context.csrfToken, {}),
        { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe("TARGET_INACTIVE_FOR_WRITE");

      const verify = await openSetupDb();
      const row = verify.setupDb
        .select({ active: businesses.active })
        .from(businesses)
        .where(eq(businesses.id, SEED_IDS.businessA))
        .get();
      verify.setupSqlite.close();
      expect(row?.active).toBe(false);
    });

    it("pasif işletmeyi REAKTİVE EDEN (active:true) yazma skipBusinessActiveCheck ile GEÇER (200) — staff'ın 'işletme açma' yetkisi YAPISAL olarak mümkün kalır", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      setBusinessActive(setupDb, SEED_IDS.businessA, false);
      const created = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
      setupSqlite.close();

      const response = await writeBusinessTarget(
        businessWriteRequest(created.token, created.context.csrfToken, { active: true }),
        { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
      );
      expect(response.status).toBe(200);

      const verify = await openSetupDb();
      const row = verify.setupDb
        .select({ active: businesses.active })
        .from(businesses)
        .where(eq(businesses.id, SEED_IDS.businessA))
        .get();
      verify.setupSqlite.close();
      expect(row?.active).toBe(true);
    });

    it("pasif aracı (vehicleB2, seed'de zaten pasif) sıradan yazma 403 TARGET_INACTIVE_FOR_WRITE ile reddedilir", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
      setupSqlite.close();

      const response = await writeBusinessTarget(
        businessWriteRequest(created.token, created.context.csrfToken, {}),
        { params: Promise.resolve({ vehicleId: SEED_IDS.vehicleB2 }) },
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe("TARGET_INACTIVE_FOR_WRITE");
    });

    it("pasif aracı (vehicleB2) REAKTİVE EDEN yazma skipVehicleActiveCheck ile GEÇER (200)", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
      setupSqlite.close();

      const response = await writeBusinessTarget(
        businessWriteRequest(created.token, created.context.csrfToken, { active: true }),
        { params: Promise.resolve({ vehicleId: SEED_IDS.vehicleB2 }) },
      );
      expect(response.status).toBe(200);

      const verify = await openSetupDb();
      const row = verify.setupDb
        .select({ active: vehicles.active })
        .from(vehicles)
        .where(eq(vehicles.id, SEED_IDS.vehicleB2))
        .get();
      verify.setupSqlite.close();
      expect(row?.active).toBe(true);
    });

    it("AKTİF hedefe sıradan yazma normal şekilde 200 döner (recheck engellemez)", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
      setupSqlite.close();

      const response = await writeBusinessTarget(
        businessWriteRequest(created.token, created.context.csrfToken, {}),
        { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
      );
      expect(response.status).toBe(200);
    });
  });

  describe("withProtectedRoute — write:true (requireWrite entegrasyonu)", () => {
    const dummy = withProtectedRoute({
      permission: "work_entry.create_driver",
      write: true,
      target: "none",
    })(async (ctx) => Response.json({ echoedBody: ctx.bodyText, request_id: ctx.requestId }));

    function writeRequest(
      token: string,
      csrfToken: string,
      extraHeaders: Record<string, string> = {},
    ): Request {
      const headers = new Headers({
        cookie: cookieHeader(token),
        origin: SELF_ORIGIN,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
        ...extraHeaders,
      });
      return new Request(`${SELF_ORIGIN}/api/v1/_dummy`, {
        method: "POST",
        headers,
        body: JSON.stringify({ hello: "world" }),
      });
    }

    it("geçerli CSRF/origin/Content-Type ile 200 döner; ctx.bodyText gövdeyi taşır", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      const response = await dummy(writeRequest(created.token, created.context.csrfToken));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(JSON.parse(body.echoedBody)).toEqual({ hello: "world" });
    });

    it("CSRF header YANLIŞSA 403 CSRF_TOKEN_INVALID döner (requireWrite ÇALIŞIYOR)", async () => {
      const { setupSqlite, setupDb } = await openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      const response = await dummy(
        writeRequest(created.token, created.context.csrfToken, {
          "x-csrf-token": "yanlis-token",
        }),
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe("CSRF_TOKEN_INVALID");
    });
  });
});
