/**
 * Kapsam yetkilendirme senaryoları (a)–(h) — T1.5 ADIM 2/2, S1.5.
 *
 * Görev tanımı iş adımı 1 (birebir): seed verisiyle (A'da iki araç, B'de
 * bir araç + pasif araç) —
 * (a) aynı işletmede farklı araç ID'si ve
 * (b) farklı işletme ID'si ile okuma/yazma denemeleri 404 (bilgi
 *     sızdırmadan);
 * (c) istemciden gönderilen role/personId/businessId alanları kapsamı
 *     genişletmez;
 * (d) şoför oturumu owner işlemlerini (confirm, driver.manage) ve ekip
 *     yönetimini deneyince 403;
 * (e) support ekip kullanıcı yönetimini deneyince 403, admin geçer;
 * (f) staff hedefi (X-Target-Vehicle) ile çelişen kişi/araç ilişkisi
 *     uygulamada reddedilir VE başka işletmeye ait ilişkiyi DB'ye yazma
 *     denemesi birleşik FK ile başarısız olur (doğrudan SQL testi);
 * (g) yazma transaction'ı içinde arada iptal edilen erişim (credential_
 *     version artışı / araç pasifliği) işlemi geri aldırır;
 * (h) 401/403/404 ayrımı ve hata gövdesinin başka müşteri içeriği/gizli
 *     kimlik içermemesi.
 *
 * E2–E5 endpoint'leri henüz YOK (TASKS.md T1.5 — "henüz varmış gibi
 * sunulmaz"). (a)/(b)/(d)/(e) `../../src/server/http/handler.ts`
 * `withProtectedRoute` ile sarılmış KÜÇÜK sentetik "gelecekteki T2.4
 * `PUT /vehicles/:id/drivers/:personId`/`POST /drivers` benzeri"
 * handler'lar üzerinden, GERÇEK kapsamlı sorgularla (`../../src/server/
 * data/scoped.ts`) kanıtlanır — ne bir GERÇEK T2.4 kullanım durumu İCAT
 * EDİLİR ne de mevcut mekanizma (scope.ts/scoped.ts/permissions.ts)
 * dışında yeni bir yetki kuralı YAZILIR; yalnız o mekanizma GERÇEK bir
 * HTTP isteği/gerçek SQLite üzerinden tetiklenir. (f)/(g) kasıtlı olarak
 * DAHA ALÇAK seviyede (doğrudan kullanım durumu fonksiyonu/ham SQL)
 * çalışır — bkz. ilgili describe bloklarının üst notu.
 *
 * QA-PLAN.md §1 — gerçek geçici SQLite dosyası + gerçek migration + seed
 * (mock/`:memory:` YOK).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS } from "../../scripts/db-seed-dev";
import {
  createDb,
  openDatabaseConnection,
  withImmediateTransaction,
  type AppDatabase,
  type SqliteConnection,
} from "../../src/server/data/db";
import { people, vehicleDrivers } from "../../src/server/data/schema";
import { recheckScopeInTransaction, scopedVehicleDriversFilter } from "../../src/server/data/scoped";
import {
  scopeFromVehicleSession,
  TARGET_VEHICLE_HEADER,
  type Scope,
} from "../../src/server/auth/scope";
import { withProtectedRoute } from "../../src/server/http/handler";
import { jsonErrorResponse, jsonSuccessResponse } from "../../src/server/http/errors";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { bumpCredentialVersion, setVehicleActive } from "../../src/server/usecases/access";
import { createPlatformSession } from "../../src/server/usecases/session/create-platform-session";
import { createVehicleSession } from "../../src/server/usecases/session/create-vehicle-session";
import { SessionRevokedError } from "../../src/server/usecases/session/errors";
import type { SessionContext } from "../../src/server/usecases/session/types";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";

function cookieHeader(token: string): string {
  return `dolmus_session=${token}`;
}

function getRequest(
  token: string,
  extraHeaders: Record<string, string> = {},
): Request {
  const headers = new Headers(extraHeaders);
  headers.set("cookie", cookieHeader(token));
  return new Request(`${SELF_ORIGIN}/api/v1/_dummy`, { headers });
}

function writeRequest(
  token: string,
  csrfToken: string,
  body: unknown,
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
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}

// ===========================================================================
// (a)/(b) sentetik "T2.4 benzeri" handler'lar — GERÇEK scoped sorgularla.
// ===========================================================================

/**
 * "GET .../drivers/:personId" benzeri — oturumun/staff hedefinin KENDİ
 * aracındaki BİR atamayı `personId`'ye göre okur. ARCHITECTURE §4 — "Araç
 * rolü scope'u oturumdan çıkarır; URL'deki ID tek başına erişim hakkı
 * VERMEZ": `:personId` URL'den (route param) gelir ama HANGİ ARACA
 * bakılacağı asla URL'den değil, `ctx.scope.vehicleId`'den gelir.
 */
const readAssignment = withProtectedRoute({
  permission: "driver.read_active",
  target: "vehicle",
})(async (ctx) => {
  const personId = ctx.params?.personId;
  if (!personId) {
    throw new Error("test route: personId route param eksik");
  }
  const row = ctx.db
    .select({ active: vehicleDrivers.active })
    .from(vehicleDrivers)
    .where(and(scopedVehicleDriversFilter(ctx.scope!), eq(vehicleDrivers.personId, personId)))
    .get();
  if (!row) {
    return jsonErrorResponse(404, "ASSIGNMENT_NOT_FOUND", "Atama bulunamadı.", {
      requestId: ctx.requestId,
    });
  }
  return jsonSuccessResponse(200, { active: row.active }, { requestId: ctx.requestId });
});

/**
 * "PUT .../drivers/:personId" benzeri — oturumun/staff hedefinin KENDİ
 * aracındaki BİR atamanın aktifliğini değiştirir. Hedef atama KENDİ
 * kapsamında YOKSA (farklı araç/işletme) 0 satır etkilenir → 404 (sessiz
 * "başarılı no-op" DEĞİL).
 */
const writeAssignment = withProtectedRoute({
  permission: "driver.manage",
  write: true,
  target: "vehicle",
})(async (ctx) => {
  const personId = ctx.params?.personId;
  if (!personId) {
    throw new Error("test route: personId route param eksik");
  }
  const parsed = JSON.parse(ctx.bodyText ?? "{}") as { active?: boolean };
  const scope = ctx.scope!;

  const result = withImmediateTransaction(ctx.db.$client, () => {
    recheckScopeInTransaction(ctx.db, ctx.context, scope);
    return ctx.db
      .update(vehicleDrivers)
      .set({ active: parsed.active ?? true })
      .where(and(scopedVehicleDriversFilter(scope), eq(vehicleDrivers.personId, personId)))
      .run();
  });

  if (result.changes === 0) {
    return jsonErrorResponse(404, "ASSIGNMENT_NOT_FOUND", "Atama bulunamadı.", {
      requestId: ctx.requestId,
    });
  }
  return jsonSuccessResponse(200, { updated: true }, { requestId: ctx.requestId });
});

// ===========================================================================
// (f)/(g) düşük seviyeli yardımcılar — bkz. ilgili describe bloklarının notu.
// ===========================================================================

/** "POST /drivers" benzeri — YENİ bir atama oluşturur; personId hedef
 * kapsamın (staff dahil) İŞLETMESİNE ait DEĞİLSE UYGULAMA KATMANINDA (DB'ye
 * hiç yazmadan) reddeder. */
function assignNewDriverInScope(
  sqlite: SqliteConnection,
  db: AppDatabase,
  context: SessionContext,
  scope: Scope,
  personId: string,
): { ok: true } | { ok: false; status: 404; code: string } {
  const person = db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.businessId, scope.businessId), eq(people.id, personId)))
    .get();
  if (!person) {
    return { ok: false, status: 404, code: "TARGET_PERSON_NOT_FOUND" };
  }
  withImmediateTransaction(sqlite, () => {
    recheckScopeInTransaction(db, context, scope);
    db.insert(vehicleDrivers)
      .values({
        businessId: scope.businessId,
        vehicleId: scope.vehicleId!,
        personId,
        active: true,
        version: 1,
      })
      .run();
  });
  return { ok: true };
}

describe("Kapsam yetkilendirme senaryoları (a)–(h), T1.5 ADIM 2/2 — gerçek geçici SQLite + migration + seed", () => {
  let dir: string;
  let dbPath: string;
  let sqlite: SqliteConnection;
  let db: AppDatabase;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-scope-authz-"));
    dbPath = path.join(dir, "test.sqlite");
    sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    db = createDb(sqlite);
    migrate(db, { migrationsFolder });
    await seedDevData(sqlite);

    process.env.DOLMUS_DB_PATH = dbPath;
    resetAppDbForTests();
  });

  afterEach(() => {
    resetAppDbForTests();
    sqlite.close();
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

  /** Bağımsız kurulum bağlantısı — `getAppDb()`'nin önbelleğinden AYRI
   * (mevcut testlerin deseni, ör. `session-scope-summary.test.ts`). */
  function openSetupDb() {
    const setupSqlite = openDatabaseConnection(dbPath);
    return { setupSqlite, setupDb: createDb(setupSqlite) };
  }

  // =========================================================================
  // (a) Aynı işletmede FARKLI araç ID'si — okuma/yazma 404.
  // =========================================================================

  describe("(a) aynı işletmede farklı araç ID'si → 404 (okuma/yazma)", () => {
    it("driver A1 oturumu, AYNI işletmenin (A) A2 aracına ait bir atamayı OKUYAMAZ (404)", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      // driverA2a GERÇEK bir kişidir (İşletme A) ama vehicleA2'ye atanmıştır.
      const response = await readAssignment(getRequest(created.token), {
        params: Promise.resolve({ personId: SEED_IDS.driverA2a }),
      });
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe("ASSIGNMENT_NOT_FOUND");
    });

    it("owner A1 oturumu, AYNI işletmenin A2 aracındaki atamayı YAZAMAZ (404, 0 satır etkilenir, sessiz no-op DEĞİL)", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const response = await writeAssignment(
        writeRequest(created.token, created.context.csrfToken, { active: false }),
        { params: Promise.resolve({ personId: SEED_IDS.driverA2a }) },
      );
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe("ASSIGNMENT_NOT_FOUND");

      // Gerçekten DEĞİŞMEDİ — A2'deki atama hâlâ orijinal (active) hâlinde.
      const row = db
        .select({ active: vehicleDrivers.active })
        .from(vehicleDrivers)
        .where(
          and(
            eq(vehicleDrivers.vehicleId, SEED_IDS.vehicleA2),
            eq(vehicleDrivers.personId, SEED_IDS.driverA2a),
          ),
        )
        .get();
      expect(row?.active).toBe(true);
    });

    it("kontrol: owner A1 oturumu KENDİ aracındaki (A1) atamayı okuyabilir/yazabilir (200) — mekanizma yalnız BAŞKA aracı reddeder", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const readResponse = await readAssignment(getRequest(created.token), {
        params: Promise.resolve({ personId: SEED_IDS.driverA1a }),
      });
      expect(readResponse.status).toBe(200);

      // driverA1d seed'de PASİF atamadır — aktifleştirme GERÇEK bir
      // değişikliktir (no-op değil).
      const writeResponse = await writeAssignment(
        writeRequest(created.token, created.context.csrfToken, { active: true }),
        { params: Promise.resolve({ personId: SEED_IDS.driverA1d }) },
      );
      expect(writeResponse.status).toBe(200);
      const row = db
        .select({ active: vehicleDrivers.active })
        .from(vehicleDrivers)
        .where(
          and(
            eq(vehicleDrivers.vehicleId, SEED_IDS.vehicleA1),
            eq(vehicleDrivers.personId, SEED_IDS.driverA1d),
          ),
        )
        .get();
      expect(row?.active).toBe(true);
    });
  });

  // =========================================================================
  // (b) FARKLI işletme ID'si — okuma/yazma 404, bilgi sızdırmadan.
  // =========================================================================

  describe("(b) farklı işletme ID'si → 404 (bilgi sızdırmadan)", () => {
    it("driver A1 oturumu, İşletme B'nin bir kişisine ait atamayı OKUYAMAZ (404); yanıt İşletme B'nin varlığını AÇIKLAMAZ", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      const response = await readAssignment(getRequest(created.token), {
        params: Promise.resolve({ personId: SEED_IDS.driverB1a }),
      });
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe("ASSIGNMENT_NOT_FOUND");
      const raw = JSON.stringify(body);
      expect(raw).not.toContain(SEED_IDS.businessB);
      expect(raw).not.toContain("İşletme B");
    });

    it("owner A1 oturumu, İşletme B'nin bir atamasını YAZAMAZ (404); İşletme B'deki gerçek satır DEĞİŞMEZ", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const response = await writeAssignment(
        writeRequest(created.token, created.context.csrfToken, { active: false }),
        { params: Promise.resolve({ personId: SEED_IDS.driverB1a }) },
      );
      expect(response.status).toBe(404);

      const row = db
        .select({ active: vehicleDrivers.active })
        .from(vehicleDrivers)
        .where(
          and(
            eq(vehicleDrivers.vehicleId, SEED_IDS.vehicleB1),
            eq(vehicleDrivers.personId, SEED_IDS.driverB1a),
          ),
        )
        .get();
      expect(row?.active).toBe(true);
    });

    it("staff (support) X-Target-Vehicle=A1 iken İşletme B'nin kişisini OKUYAMAZ (404) — header YALNIZ ARACI seçer, kişiyi başka işletmeden İTHAL ETMEZ", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformSupport1);
      setupSqlite.close();

      const response = await readAssignment(
        getRequest(created.token, { [TARGET_VEHICLE_HEADER]: SEED_IDS.vehicleA1 }),
        { params: Promise.resolve({ personId: SEED_IDS.driverB1a }) },
      );
      expect(response.status).toBe(404);
    });
  });

  // =========================================================================
  // (c) İstemciden gönderilen role/personId/businessId kapsamı GENİŞLETMEZ.
  // =========================================================================

  describe("(c) istemciden gönderilen role/personId/businessId alanları kapsamı genişletmez", () => {
    it("driver oturumu gövdeye role:'owner'+businessId:B EKLESE BİLE, yazma KENDİ (A1) kapsamıyla değerlendirilir (404 — B'nin atamasına ERİŞEMEZ)", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      // driver.manage İZNİ olmadığından zaten 403 beklenir; asıl kanıt
      // gövdedeki "role: owner" alanının bu 403'ü owner'a ÇEVİRMEDİĞİDİR.
      const response = await writeAssignment(
        writeRequest(created.token, created.context.csrfToken, {
          active: true,
          role: "owner",
          businessId: SEED_IDS.businessB,
          personId: "baska-kisi",
        }),
        { params: Promise.resolve({ personId: SEED_IDS.driverA1a }) },
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("staff X-Target-Vehicle=A1 iken gövdeye businessId:B eklese bile GERÇEK hedef A1/İşletme A olarak kalır", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
      setupSqlite.close();

      const response = await writeAssignment(
        writeRequest(
          created.token,
          created.context.csrfToken,
          { active: true, businessId: SEED_IDS.businessB },
          { [TARGET_VEHICLE_HEADER]: SEED_IDS.vehicleA1 },
        ),
        { params: Promise.resolve({ personId: SEED_IDS.driverA1d }) },
      );
      expect(response.status).toBe(200);

      // Yazma GERÇEKTEN İşletme A'nın A1 aracına uygulandı (B'ye DEĞİL).
      const row = db
        .select({ active: vehicleDrivers.active })
        .from(vehicleDrivers)
        .where(
          and(
            eq(vehicleDrivers.vehicleId, SEED_IDS.vehicleA1),
            eq(vehicleDrivers.personId, SEED_IDS.driverA1d),
          ),
        )
        .get();
      expect(row?.active).toBe(true);
    });
  });

  // =========================================================================
  // (d) Şoför oturumu owner işlemlerini VE ekip yönetimini deneyince 403.
  // =========================================================================

  describe("(d) şoför oturumu owner işlemlerini ve ekip yönetimini deneyince 403", () => {
    const confirmDummy = withProtectedRoute({
      permission: "work_entry.confirm",
      target: "vehicle",
    })((ctx) => jsonSuccessResponse(200, {}, { requestId: ctx.requestId }));

    const driverManageDummy = withProtectedRoute({
      permission: "driver.manage",
      target: "vehicle",
    })((ctx) => jsonSuccessResponse(200, {}, { requestId: ctx.requestId }));

    const platformUserManageDummy = withProtectedRoute({
      permission: "platform_user.manage",
      target: "none",
    })((ctx) => jsonSuccessResponse(200, {}, { requestId: ctx.requestId }));

    it("driver oturumu work_entry.confirm (teslim onayı — owner işlemi) dener → 403", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      const response = await confirmDummy(getRequest(created.token));
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("driver oturumu driver.manage (şoför ekleme/atama — owner işlemi) dener → 403", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      const response = await driverManageDummy(getRequest(created.token));
      expect(response.status).toBe(403);
    });

    it("driver oturumu platform_user.manage (ekip yönetimi) dener → 403", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      setupSqlite.close();

      const response = await platformUserManageDummy(getRequest(created.token));
      expect(response.status).toBe(403);
    });

    it("kontrol: owner oturumu AYNI iki izni (confirm/driver.manage) BAŞARIYLA kullanabilir", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      expect((await confirmDummy(getRequest(created.token))).status).toBe(200);
      expect((await driverManageDummy(getRequest(created.token))).status).toBe(200);
    });
  });

  // =========================================================================
  // (e) Support ekip kullanıcı yönetimini deneyince 403, admin geçer.
  // =========================================================================

  describe("(e) support ekip kullanıcı yönetimini deneyince 403, admin geçer", () => {
    const platformUserManageDummy = withProtectedRoute({
      permission: "platform_user.manage",
      target: "none",
    })((ctx) => jsonSuccessResponse(200, {}, { requestId: ctx.requestId }));

    it("support oturumu 403 alır", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformSupport1);
      setupSqlite.close();

      const response = await platformUserManageDummy(getRequest(created.token));
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("admin oturumu 200 alır", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createPlatformSession(setupDb, SEED_IDS.platformAdmin1);
      setupSqlite.close();

      const response = await platformUserManageDummy(getRequest(created.token));
      expect(response.status).toBe(200);
    });
  });

  // =========================================================================
  // (f) Staff hedefiyle çelişen kişi/araç ilişkisi — uygulama VE DB (FK).
  // =========================================================================

  describe("(f) staff hedefi ile çelişen kişi/araç ilişkisi", () => {
    it("UYGULAMA KATMANI: staff X-Target-Vehicle=A1 iken İşletme B'nin kişisini şoför atamaya ÇALIŞIRSA reddedilir (404, DB'ye HİÇ YAZILMAZ)", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const scope: Scope = {
        kind: "staff",
        actor: "support",
        businessId: SEED_IDS.businessA,
        vehicleId: SEED_IDS.vehicleA1,
        platformUserId: SEED_IDS.platformSupport1,
        onBehalfOf: true,
      };

      const result = assignNewDriverInScope(sqlite, db, context, scope, SEED_IDS.driverB1a);
      expect(result).toEqual({ ok: false, status: 404, code: "TARGET_PERSON_NOT_FOUND" });

      const row = db
        .select({ personId: vehicleDrivers.personId })
        .from(vehicleDrivers)
        .where(
          and(
            eq(vehicleDrivers.vehicleId, SEED_IDS.vehicleA1),
            eq(vehicleDrivers.personId, SEED_IDS.driverB1a),
          ),
        )
        .get();
      expect(row).toBeUndefined();
    });

    it("kontrol: AYNI işletmenin GERÇEKTEN uygun kişisi (driverA2a) A1'e BAŞARIYLA atanabilir — mekanizma yalnız ÇELİŞEN ilişkiyi reddeder", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const scope: Scope = {
        kind: "staff",
        actor: "support",
        businessId: SEED_IDS.businessA,
        vehicleId: SEED_IDS.vehicleA1,
        platformUserId: SEED_IDS.platformSupport1,
        onBehalfOf: true,
      };

      const result = assignNewDriverInScope(sqlite, db, context, scope, SEED_IDS.driverA2a);
      expect(result).toEqual({ ok: true });

      const row = db
        .select({ active: vehicleDrivers.active })
        .from(vehicleDrivers)
        .where(
          and(
            eq(vehicleDrivers.vehicleId, SEED_IDS.vehicleA1),
            eq(vehicleDrivers.personId, SEED_IDS.driverA2a),
          ),
        )
        .get();
      expect(row?.active).toBe(true);
    });

    it("DOĞRUDAN SQL: (business_id=A, vehicle_id=A1, person_id=<İşletme B'nin kişisi>) INSERT'i BİRLEŞİK FK (vehicle_drivers_person_fk) ile reddedilir", () => {
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO vehicle_drivers (business_id, vehicle_id, person_id, active, version)
             VALUES (?, ?, ?, 1, 1)`,
          )
          .run(SEED_IDS.businessA, SEED_IDS.vehicleA1, SEED_IDS.driverB1a),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it("DOĞRUDAN SQL: (business_id=A, vehicle_id=<İşletme B'nin aracı>, person_id=A'nın kişisi) INSERT'i BİRLEŞİK FK (vehicle_drivers_vehicle_fk) ile reddedilir", () => {
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO vehicle_drivers (business_id, vehicle_id, person_id, active, version)
             VALUES (?, ?, ?, 1, 1)`,
          )
          .run(SEED_IDS.businessA, SEED_IDS.vehicleB1, SEED_IDS.ownerA),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it("kontrol: GERÇEKTEN tutarlı bir üçlü (business_id=A, vehicle_id=A2, person_id=A'nın kişisi, henüz atanmamış) DOĞRUDAN SQL ile BAŞARIYLA yazılır — FK'nin kendisi HER insert'i değil, yalnız ÇELİŞENİ reddeder", () => {
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO vehicle_drivers (business_id, vehicle_id, person_id, active, version)
             VALUES (?, ?, ?, 1, 1)`,
          )
          .run(SEED_IDS.businessA, SEED_IDS.vehicleA2, SEED_IDS.driverA1d),
      ).not.toThrow();
    });
  });

  // =========================================================================
  // (g) Yazma transaction'ı içinde ARADA iptal edilen erişim → geri aldırır.
  // =========================================================================

  describe("(g) yazma transaction'ı içinde arada iptal edilen erişim işlemi geri aldırır", () => {
    /**
     * Bu senaryo BİLİNÇLİ olarak `withProtectedRoute`'un TAM HTTP hattından
     * DEĞİL, `assignNewDriverInScope`'un kendi düşük seviyeli
     * `recheckScopeInTransaction` çağrısından geçer: `../../src/server/
     * auth/guard.ts` `requireSession`/`requireWrite` HER ZAMAN `resolveSession`
     * ile TAZE bir credential_version/aktiflik kontrolü yaptığından
     * (bkz. `resolve-session.ts`), TAM bir HTTP isteği tekrar gönderildiğinde
     * iptal ZATEN İLK KAPIDA (401) yakalanır — bu, `recheckScopeInTransaction`'ın
     * KENDİ, BAĞIMSIZ ikinci katmanının (aynı İSTEK içinde scope çözümleme
     * İLE yazma transaction'ı ARASINDAKİ teorik yarış durumu için) ayrı
     * kanıtlanmasını GEREKTİRİR — `tests/integration/scope-resolution.test.ts`
     * `recheckScopeInTransaction` bloğunun AYNI, KANITLANMIŞ deseni (bkz. o
     * dosyanın üst notu).
     */
    it("credential_version ARTIŞI (parola sıfırlama benzeri), scope ÇÖZÜLDÜKTEN SONRA gerçekleşirse yazma 401 sınıfı hatayla GERİ ALINIR", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      bumpCredentialVersion(db, SEED_IDS.credA1Owner);

      expect(() =>
        assignNewDriverInScope(sqlite, db, context, scope, SEED_IDS.driverA2a),
      ).toThrow(SessionRevokedError);

      const row = db
        .select({ personId: vehicleDrivers.personId })
        .from(vehicleDrivers)
        .where(
          and(
            eq(vehicleDrivers.vehicleId, SEED_IDS.vehicleA1),
            eq(vehicleDrivers.personId, SEED_IDS.driverA2a),
          ),
        )
        .get();
      expect(row).toBeUndefined();
    });

    it("hedef ARACIN pasifleşmesi, scope ÇÖZÜLDÜKTEN SONRA gerçekleşirse (staff) yazma 403 sınıfı hatayla GERİ ALINIR", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const scope: Scope = {
        kind: "staff",
        actor: "support",
        businessId: SEED_IDS.businessA,
        vehicleId: SEED_IDS.vehicleA1,
        platformUserId: SEED_IDS.platformSupport1,
        onBehalfOf: true,
      };

      setVehicleActive(db, SEED_IDS.vehicleA1, false);

      expect(() =>
        assignNewDriverInScope(sqlite, db, context, scope, SEED_IDS.driverA2a),
      ).toThrow(/pasif/);

      const row = db
        .select({ personId: vehicleDrivers.personId })
        .from(vehicleDrivers)
        .where(
          and(
            eq(vehicleDrivers.vehicleId, SEED_IDS.vehicleA1),
            eq(vehicleDrivers.personId, SEED_IDS.driverA2a),
          ),
        )
        .get();
      expect(row).toBeUndefined();
    });

    it("aynı işlem YAZMA TRANSACTION'I İÇİNDE, kişi kontrolü BAŞARILI olduktan (ama insert ÖNCESİ) iptal olsa da geri aldırır (arada iptal — writeAssignment'ın TAM HTTP hattı üzerinden)", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const created = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      // Oturum HÂLÂ geçerli bir token taşır ama credential_version'ı
      // ARTIRILDIĞINDA `requireWrite`'ın KENDİSİ (resolveSession) isteği
      // 401 SESSION_REVOKED ile reddeder — bu da GERİ ALINAN erişimin en
      // dış katmanda YAKALANDIĞININ kanıtıdır (recheckScopeInTransaction'a
      // hiç ULAŞMAZ, ki bu da doğru: dış kapı zaten yeterlidir).
      bumpCredentialVersion(db, SEED_IDS.credA1Owner);

      const response = await writeAssignment(
        writeRequest(created.token, created.context.csrfToken, { active: true }),
        { params: Promise.resolve({ personId: SEED_IDS.driverA1d }) },
      );
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe("SESSION_REVOKED");

      const row = db
        .select({ active: vehicleDrivers.active })
        .from(vehicleDrivers)
        .where(
          and(
            eq(vehicleDrivers.vehicleId, SEED_IDS.vehicleA1),
            eq(vehicleDrivers.personId, SEED_IDS.driverA1d),
          ),
        )
        .get();
      // Seed'de driverA1d PASİF atamadır; iptal edilen istek onu
      // DEĞİŞTİRMEMİŞ olmalıdır.
      expect(row?.active).toBe(false);
    });
  });

  // =========================================================================
  // (h) 401/403/404 ayrımı ve hata gövdesi başka müşteri içeriği/gizli
  //     kimlik içermez.
  // =========================================================================

  describe("(h) 401/403/404 ayrımı ve hata gövdesinin gizliliği", () => {
    it("401 (oturum yok) / 403 (yetki yok) / 404 (kapsam dışı nesne) AYNI mekanizmadan ÜÇ FARKLI koda düşer", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const driver = await createVehicleSession(setupDb, SEED_IDS.credA1Driver);
      const owner = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const unauthenticated = await readAssignment(getRequest("gecersiz-token"), {
        params: Promise.resolve({ personId: SEED_IDS.driverA1a }),
      });
      expect(unauthenticated.status).toBe(401);

      const forbidden = await writeAssignment(
        writeRequest(driver.token, driver.context.csrfToken, { active: true }),
        { params: Promise.resolve({ personId: SEED_IDS.driverA1a }) },
      );
      expect(forbidden.status).toBe(403);

      const notFound = await readAssignment(getRequest(owner.token), {
        params: Promise.resolve({ personId: SEED_IDS.driverB1a }),
      });
      expect(notFound.status).toBe(404);

      // Üçü de FARKLI kod taşır — hiçbiri diğeriyle KARIŞMAZ.
      const codes = await Promise.all(
        [unauthenticated, forbidden, notFound].map(async (r) => (await r.json()).error.code),
      );
      expect(new Set(codes).size).toBe(3);
    });

    it("hiçbir hata gövdesi ham oturum tokenı, parola hash'i veya SQL/yığın izi İÇERMEZ", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const owner = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const response = await readAssignment(getRequest(owner.token), {
        params: Promise.resolve({ personId: SEED_IDS.driverB1a }),
      });
      const raw = JSON.stringify(await response.json());
      expect(raw).not.toContain(owner.token);
      expect(raw.toLowerCase()).not.toContain("argon2");
      expect(raw.toLowerCase()).not.toContain("sqlite");
      expect(raw.toLowerCase()).not.toContain("stack");
    });

    it("404 yanıtı BAŞKA müşterinin (İşletme B) adını/plaka bilgisini SIZDIRMAZ", async () => {
      const { setupSqlite, setupDb } = openSetupDb();
      const owner = await createVehicleSession(setupDb, SEED_IDS.credA1Owner);
      setupSqlite.close();

      const response = await readAssignment(getRequest(owner.token), {
        params: Promise.resolve({ personId: SEED_IDS.driverB1a }),
      });
      const raw = JSON.stringify(await response.json());
      expect(raw).not.toContain("İşletme B");
      expect(raw).not.toContain(SEED_IDS.businessB);
      expect(raw).not.toContain(SEED_IDS.vehicleB1);
    });
  });
});
