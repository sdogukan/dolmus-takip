/**
 * GET/POST /api/v1/admin/vehicles ve GET/PATCH .../[vehicleId] — T2.2.
 *
 * QA-PLAN.md §1 — gerçek geçici SQLite dosyası + gerçek migration + seed
 * (mock/`:memory:` YOK). Acceptance'ın kapsadığı senaryolar: 201 + tek
 * transaction'da vehicles+2×vehicle_credentials+audit+receipt; aynı
 * requestId replay (ikinci araç ÜRETMEZ); aynı requestId FARKLI
 * parolalarla 409; plaka çakışması (boşluk/büyük-küçük harf farkıyla)
 * 422 fields.plate; sahip/şoför parolası aynıysa 422; oluşturma SONRASI
 * gerçek `POST /auth/vehicle-login` ile hem sahip hem şoför parolasıyla
 * giriş; eski version ile PATCH 409 (kanonik metin) ve kayıt değişmez;
 * `active:false` PATCH'i o aracın TÜM oturumlarını AYNI transaction'da
 * iptal eder, `active:true` bunları DİRİLTMEZ; owner/driver araç oturumu
 * her uçta 403; bilinmeyen id 404; pasifleştirme/reaktivasyon
 * work_entries/vehicle_drivers/admin_audit'e DOKUNMAZ.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS, SEED_RAW_PLATES, SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { createDb, openDatabaseConnection, type SqliteConnection } from "../../src/server/data/db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { resetHashQueueForTests } from "../../src/server/auth/hash-queue";
import { resetVehicleLoginRateLimitForTests } from "../../src/server/auth/rate-limit";
import { POST as platformLoginRoute } from "../../src/app/api/v1/auth/platform-login/route";
import { POST as vehicleLoginRoute } from "../../src/app/api/v1/auth/vehicle-login/route";
import { GET as getSessionRoute } from "../../src/app/api/v1/session/route";
import { GET as getVehiclesList, POST as postVehicle } from "../../src/app/api/v1/admin/vehicles/route";
import {
  GET as getVehicleDetailRoute,
  PATCH as patchVehicle,
} from "../../src/app/api/v1/admin/vehicles/[vehicleId]/route";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const BASE_URL = "https://example.invalid/api/v1/admin/vehicles";

function cookieHeader(token: string): string {
  return `dolmus_session=${token}`;
}

function getRequest(token: string, url = BASE_URL): Request {
  return new Request(url, { headers: { cookie: cookieHeader(token) } });
}

function writeRequest(
  token: string,
  csrfToken: string,
  method: string,
  body: unknown,
  url = BASE_URL,
): Request {
  return new Request(url, {
    method,
    headers: {
      cookie: cookieHeader(token),
      origin: SELF_ORIGIN,
      "x-csrf-token": csrfToken,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function loginPlatform(username: string, password: string) {
  const response = await platformLoginRoute(
    new Request("https://example.invalid/api/v1/auth/platform-login", {
      method: "POST",
      headers: { origin: SELF_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  );
  expect(response.status).toBe(201);
  const setCookie = response.headers.get("set-cookie");
  const match = /dolmus_session=([^;]+)/.exec(setCookie ?? "");
  const token = decodeURIComponent(match![1]!);
  const body = await response.json();
  return { token, csrfToken: body.csrfToken as string };
}

async function loginVehicle(plate: string, password: string) {
  const response = await vehicleLoginRoute(
    new Request("https://example.invalid/api/v1/auth/vehicle-login", {
      method: "POST",
      headers: { origin: SELF_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ plate, password }),
    }),
  );
  const setCookie = response.headers.get("set-cookie");
  const match = /dolmus_session=([^;]+)/.exec(setCookie ?? "");
  const token = match ? decodeURIComponent(match[1]!) : undefined;
  const body = await response.json();
  return { status: response.status, token, body };
}

function rawDb(dbPath: string): SqliteConnection {
  return openDatabaseConnection(dbPath);
}

function vehicleUrl(vehicleId: string): string {
  return `${BASE_URL}/${vehicleId}`;
}

describe("admin/vehicles routes (T2.2)", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-admin-vehicles-"));
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

  // -------------------------------------------------------------------
  // POST — oluşturma, tek transaction, idempotency.
  // -------------------------------------------------------------------

  it("geçerli gövdeyle 201 döner; tek transaction'da vehicles+2×vehicle_credentials+audit+receipt yazar", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await postVehicle(
      writeRequest(token, csrfToken, "POST", {
        requestId: "a1111111-1111-4111-8111-111111111111",
        businessRef: SEED_IDS.businessA,
        plate: "34 CCC 555",
        brandModel: "Ford Transit",
        year: 2020,
        routeStop: "Merkez",
        note: "Test notu",
        ownerPassword: "yeni-sahip-1234",
        driverPassword: "yeni-sofor-1234",
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.vehicle.plateNormalized).toBe("34CCC555");
    expect(body.vehicle.version).toBe(1);
    expect(body.business.id).toBe(SEED_IDS.businessA);
    expect(body.owner.fullName).toBe("Ali Kaya");

    const sqlite = rawDb(dbPath);
    try {
      const vehicleCount = sqlite
        .prepare("SELECT COUNT(*) c FROM vehicles WHERE id = ?")
        .get(body.vehicle.id) as { c: number };
      expect(vehicleCount.c).toBe(1);

      const credRows = sqlite
        .prepare("SELECT role, password_hash FROM vehicle_credentials WHERE vehicle_id = ?")
        .all(body.vehicle.id) as { role: string; password_hash: string }[];
      expect(credRows).toHaveLength(2);
      expect(credRows.map((r) => r.role).sort()).toEqual(["driver", "owner"]);
      for (const row of credRows) {
        expect(row.password_hash.startsWith("$argon2id$")).toBe(true);
      }

      const auditRows = sqlite
        .prepare(
          "SELECT action, actor_platform_user_id, before_json, after_json FROM admin_audit WHERE entity_id = ? AND action = 'vehicle.create'",
        )
        .all(body.vehicle.id) as {
        action: string;
        actor_platform_user_id: string;
        before_json: string | null;
        after_json: string;
      }[];
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      const auditRow = auditRows[0]!;
      expect(auditRow.before_json).toBeNull();
      expect(typeof auditRow.actor_platform_user_id).toBe("string");
      expect(auditRow.actor_platform_user_id.length).toBeGreaterThan(0);
      expect(JSON.parse(auditRow.after_json)).toMatchObject({
        plateNormalized: "34CCC555",
        brandModel: "Ford Transit",
      });
      expect(auditRow.after_json).not.toContain("password");
      expect(auditRow.after_json).not.toContain("hash");
      expect(auditRow.after_json).not.toContain("yeni-sahip-1234");
      expect(auditRow.after_json).not.toContain("yeni-sofor-1234");

      const receiptRow = sqlite
        .prepare("SELECT entity_id, response_code, result_version FROM mutation_receipts WHERE request_id = ?")
        .get("a1111111-1111-4111-8111-111111111111") as {
        entity_id: string;
        response_code: number;
        result_version: number;
      };
      expect(receiptRow.entity_id).toBe(body.vehicle.id);
      expect(receiptRow.response_code).toBe(201);
      expect(receiptRow.result_version).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("aynı requestId ve aynı gövdeyle tekrar gönderim ikinci araç üretmez; ilk sonucu döner", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const body = {
      requestId: "a2222222-2222-4222-8222-222222222222",
      businessRef: SEED_IDS.businessA,
      plate: "34 DDD 666",
      ownerPassword: "tekrar-sahip-1234",
      driverPassword: "tekrar-sofor-1234",
    };
    const first = await postVehicle(writeRequest(token, csrfToken, "POST", body));
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await postVehicle(writeRequest(token, csrfToken, "POST", body));
    expect(second.status).toBe(201);
    const secondBody = await second.json();
    expect(secondBody.vehicle.id).toBe(firstBody.vehicle.id);

    const sqlite = rawDb(dbPath);
    try {
      const count = sqlite
        .prepare("SELECT COUNT(*) c FROM vehicles WHERE plate_normalized = '34DDD666'")
        .get() as { c: number };
      expect(count.c).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("aynı requestId FARKLI parolalarla gönderilirse 409 REQUEST_ID_REUSED döner (ilk parolalar geçerli kalır)", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const requestId = "a3333333-3333-4333-8333-333333333333";
    const first = await postVehicle(
      writeRequest(token, csrfToken, "POST", {
        requestId,
        businessRef: SEED_IDS.businessA,
        plate: "34 EEE 777",
        ownerPassword: "ilk-sahip-1234",
        driverPassword: "ilk-sofor-1234",
      }),
    );
    expect(first.status).toBe(201);

    const second = await postVehicle(
      writeRequest(token, csrfToken, "POST", {
        requestId,
        businessRef: SEED_IDS.businessA,
        plate: "34 EEE 777",
        ownerPassword: "farkli-sahip-1234",
        driverPassword: "farkli-sofor-1234",
      }),
    );
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("REQUEST_ID_REUSED");

    // İlk parolalar HALA geçerli — replay ikinci (farklı) parolaları
    // sessizce KABUL ETMEDİ.
    const login = await loginVehicle("34 EEE 777", "ilk-sahip-1234");
    expect(login.status).toBe(201);
  });

  it("aynı requestId ve AYNI gövdeyle ama farklı içerikte (plaka değişik) gönderilirse 409 REQUEST_ID_REUSED döner", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const requestId = "a3999999-3999-4399-8399-399999999999";
    const first = await postVehicle(
      writeRequest(token, csrfToken, "POST", {
        requestId,
        businessRef: SEED_IDS.businessA,
        plate: "34 FFA 001",
        ownerPassword: "sahip-farkli-1234",
        driverPassword: "sofor-farkli-1234",
      }),
    );
    expect(first.status).toBe(201);

    const second = await postVehicle(
      writeRequest(token, csrfToken, "POST", {
        requestId,
        businessRef: SEED_IDS.businessA,
        plate: "34 FFA 002",
        ownerPassword: "sahip-farkli-1234",
        driverPassword: "sofor-farkli-1234",
      }),
    );
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("REQUEST_ID_REUSED");
  });

  it("plaka boşluk/büyük-küçük harf farkıyla ÇAKIŞIYORSA 422 fields.plate döner, hiçbir şey yazılmaz", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const sqliteBefore = rawDb(dbPath);
    const countBefore = sqliteBefore.prepare("SELECT COUNT(*) c FROM vehicles").get() as { c: number };
    sqliteBefore.close();

    // Seed: SEED_RAW_PLATES.vehicleA1 = "34 AAA 001" -> normalize "34AAA001".
    const response = await postVehicle(
      writeRequest(token, csrfToken, "POST", {
        requestId: "a4444444-4444-4444-8444-444444444444",
        businessRef: SEED_IDS.businessA,
        plate: "34 aaa 001",
        ownerPassword: "yeni-sahip-1234",
        driverPassword: "yeni-sofor-1234",
      }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.plate).toBeTruthy();

    const sqliteAfter = rawDb(dbPath);
    try {
      const countAfter = sqliteAfter.prepare("SELECT COUNT(*) c FROM vehicles").get() as { c: number };
      expect(countAfter.c).toBe(countBefore.c);
    } finally {
      sqliteAfter.close();
    }
  });

  it("sahip ve şoför şifresi AYNIYSA 422 döner, hiçbir şey yazılmaz", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await postVehicle(
      writeRequest(token, csrfToken, "POST", {
        requestId: "a5555555-5555-4555-8555-555555555555",
        businessRef: SEED_IDS.businessA,
        plate: "34 GGG 888",
        ownerPassword: "ayni-sifre-1234",
        driverPassword: "ayni-sifre-1234",
      }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.ownerPassword).toBeTruthy();
    expect(body.error.fields.driverPassword).toBeTruthy();

    const sqlite = rawDb(dbPath);
    try {
      const count = sqlite
        .prepare("SELECT COUNT(*) c FROM vehicles WHERE plate_normalized = '34GGG888'")
        .get() as { c: number };
      expect(count.c).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it("bilinmeyen businessRef için 422 fields.businessRef döner", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await postVehicle(
      writeRequest(token, csrfToken, "POST", {
        requestId: "a6666666-6666-4666-8666-666666666666",
        businessRef: "00000000-0000-4000-8000-000000000000",
        plate: "34 HHH 999",
        ownerPassword: "sahip-yeni-1234",
        driverPassword: "sofor-yeni-1234",
      }),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.fields.businessRef).toBeTruthy();
  });

  it("oluşturulan araca HEM sahip HEM şoför parolasıyla gerçek POST /auth/vehicle-login ile giriş yapılabilir", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await postVehicle(
      writeRequest(token, csrfToken, "POST", {
        requestId: "a7777777-7777-4777-8777-777777777777",
        businessRef: SEED_IDS.businessB,
        plate: "06 III 111",
        ownerPassword: "giris-sahip-1234",
        driverPassword: "giris-sofor-1234",
      }),
    );
    expect(response.status).toBe(201);

    const ownerLogin = await loginVehicle("06 III 111", "giris-sahip-1234");
    expect(ownerLogin.status).toBe(201);
    expect(ownerLogin.body.role).toBe("owner");

    const driverLogin = await loginVehicle("06 III 111", "giris-sofor-1234");
    expect(driverLogin.status).toBe(201);
    expect(driverLogin.body.role).toBe("driver");
  });

  // -------------------------------------------------------------------
  // Yetki — araç oturumu tüm admin/vehicles uçlarında 403.
  // -------------------------------------------------------------------

  it("owner ve driver araç oturumu ile GET/POST/PATCH admin/vehicles uçları 403 döner", async () => {
    const owner = await loginVehicle("34 AAA 001", SEED_TEST_PASSWORDS.owner);
    expect(owner.status).toBe(201);
    const driver = await loginVehicle("34 AAA 001", SEED_TEST_PASSWORDS.driver);
    expect(driver.status).toBe(201);

    for (const session of [owner, driver]) {
      const listResponse = await getVehiclesList(getRequest(session.token!));
      expect(listResponse.status).toBe(403);

      const postResponse = await postVehicle(
        writeRequest(session.token!, session.body.csrfToken, "POST", {
          requestId: "yasak-0000-4000-8000-000000000000",
          businessRef: SEED_IDS.businessA,
          plate: "34 JJJ 222",
          ownerPassword: "yasak-sahip-1234",
          driverPassword: "yasak-sofor-1234",
        }),
      );
      expect(postResponse.status).toBe(403);

      const detailResponse = await getVehicleDetailRoute(
        getRequest(session.token!, vehicleUrl(SEED_IDS.vehicleA1)),
        { params: Promise.resolve({ vehicleId: SEED_IDS.vehicleA1 }) },
      );
      expect(detailResponse.status).toBe(403);

      const patchResponse = await patchVehicle(
        writeRequest(
          session.token!,
          session.body.csrfToken,
          "PATCH",
          { requestId: "x", version: 1, note: "yasak" },
          vehicleUrl(SEED_IDS.vehicleA1),
        ),
        { params: Promise.resolve({ vehicleId: SEED_IDS.vehicleA1 }) },
      );
      expect(patchResponse.status).toBe(403);
    }
  });

  // -------------------------------------------------------------------
  // GET liste/detay.
  // -------------------------------------------------------------------

  it("GET /admin/vehicles seed araçlarını pasif olan DAHİL listeler", async () => {
    const { token } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await getVehiclesList(getRequest(token));
    expect(response.status).toBe(200);
    const body = await response.json();
    const ids: string[] = body.vehicles.map((v: { id: string }) => v.id);
    expect(ids).toContain(SEED_IDS.vehicleA1);
    expect(ids).toContain(SEED_IDS.vehicleB2);
    const passiveVehicle = body.vehicles.find((v: { id: string }) => v.id === SEED_IDS.vehicleB2);
    expect(passiveVehicle.active).toBe(false);
    const activeVehicle = body.vehicles.find((v: { id: string }) => v.id === SEED_IDS.vehicleA1);
    expect(activeVehicle.owner.fullName).toBe("Ali Kaya");
  });

  it("GET /admin/vehicles/:id detayında araç+işletme+sahip döner", async () => {
    const { token } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await getVehicleDetailRoute(getRequest(token, vehicleUrl(SEED_IDS.vehicleA1)), {
      params: Promise.resolve({ vehicleId: SEED_IDS.vehicleA1 }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.vehicle.id).toBe(SEED_IDS.vehicleA1);
    expect(body.business.id).toBe(SEED_IDS.businessA);
    expect(body.owner.fullName).toBe("Ali Kaya");
  });

  it("bilinmeyen vehicleId için GET/PATCH 404 TARGET_VEHICLE_NOT_FOUND döner", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const unknownId = "00000000-0000-4000-8000-000000000999";

    const getResponse = await getVehicleDetailRoute(getRequest(token, vehicleUrl(unknownId)), {
      params: Promise.resolve({ vehicleId: unknownId }),
    });
    expect(getResponse.status).toBe(404);
    expect((await getResponse.json()).error.code).toBe("TARGET_VEHICLE_NOT_FOUND");

    const patchResponse = await patchVehicle(
      writeRequest(token, csrfToken, "PATCH", { requestId: "x", version: 1, note: "y" }, vehicleUrl(unknownId)),
      { params: Promise.resolve({ vehicleId: unknownId }) },
    );
    expect(patchResponse.status).toBe(404);
    expect((await patchResponse.json()).error.code).toBe("TARGET_VEHICLE_NOT_FOUND");
  });

  // -------------------------------------------------------------------
  // PATCH — sürüm çakışması, kanonik metin, kayıt değişmez.
  // -------------------------------------------------------------------

  it("eski version ile PATCH 409 VERSION_CONFLICT + kanonik metin döner; kayıt değişmez", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const url = vehicleUrl(SEED_IDS.vehicleA1);
    const response = await patchVehicle(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        { requestId: "a8888888-8888-4888-8888-888888888888", version: 999, note: "Değişmeyecek" },
        url,
      ),
      { params: Promise.resolve({ vehicleId: SEED_IDS.vehicleA1 }) },
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("VERSION_CONFLICT");
    expect(body.error.message).toBe("Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.");

    const sqlite = rawDb(dbPath);
    try {
      const row = sqlite
        .prepare("SELECT note, version FROM vehicles WHERE id = ?")
        .get(SEED_IDS.vehicleA1) as { note: string | null; version: number };
      expect(row.note).toBeNull();
      expect(row.version).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("gönderilen değerler mevcutla AYNIYSA 422 { change: 'Değişiklik yok.' } döner, sürüm artmaz", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await patchVehicle(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        { requestId: "a9999999-9999-4999-8999-999999999999", version: 1, active: true },
        vehicleUrl(SEED_IDS.vehicleA1),
      ),
      { params: Promise.resolve({ vehicleId: SEED_IDS.vehicleA1 }) },
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.fields.change).toBe("Değişiklik yok.");
  });

  // -------------------------------------------------------------------
  // Pasifleştirme — oturum iptali, reaktivasyon diriltmez, ilişkili
  // tablolara DOKUNMAZ.
  // -------------------------------------------------------------------

  it("PATCH active:false o aracın TÜM oturumlarını AYNI transaction'da iptal eder; active:true SONRA bunları DİRİLTMEZ", async () => {
    const owner = await loginVehicle("34 AAA 001", SEED_TEST_PASSWORDS.owner);
    expect(owner.status).toBe(201);
    const driver = await loginVehicle("34 AAA 001", SEED_TEST_PASSWORDS.driver);
    expect(driver.status).toBe(201);

    // Girişten SONRA çalışma kaydı/şoför ataması var mı diye kontrol
    // edilecek tabloları da BEFORE olarak alalım (aşağıdaki "dokunmaz"
    // testiyle birleşik, tek admin oturumu).
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);

    const deactivateResponse = await patchVehicle(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        { requestId: "b1111111-1111-4111-8111-111111111111", version: 1, active: false },
        vehicleUrl(SEED_IDS.vehicleA1),
      ),
      { params: Promise.resolve({ vehicleId: SEED_IDS.vehicleA1 }) },
    );
    expect(deactivateResponse.status).toBe(200);
    const deactivateBody = await deactivateResponse.json();
    expect(deactivateBody.vehicle.active).toBe(false);
    expect(deactivateBody.vehicle.version).toBe(2);

    const sqlite = rawDb(dbPath);
    let workEntriesBefore: number;
    let vehicleDriversBefore: number;
    let auditCountAfterDeactivate: number;
    try {
      const revokedCount = sqlite
        .prepare(
          "SELECT COUNT(*) c FROM sessions s JOIN vehicle_credentials vc ON vc.id = s.credential_id " +
            "WHERE vc.vehicle_id = ? AND s.revoked_at IS NOT NULL",
        )
        .get(SEED_IDS.vehicleA1) as { c: number };
      expect(revokedCount.c).toBe(2);
      const activeSessionCount = sqlite
        .prepare(
          "SELECT COUNT(*) c FROM sessions s JOIN vehicle_credentials vc ON vc.id = s.credential_id " +
            "WHERE vc.vehicle_id = ? AND s.revoked_at IS NULL",
        )
        .get(SEED_IDS.vehicleA1) as { c: number };
      expect(activeSessionCount.c).toBe(0);

      workEntriesBefore = (
        sqlite.prepare("SELECT COUNT(*) c FROM work_entries WHERE vehicle_id = ?").get(SEED_IDS.vehicleA1) as {
          c: number;
        }
      ).c;
      vehicleDriversBefore = (
        sqlite.prepare("SELECT COUNT(*) c FROM vehicle_drivers WHERE vehicle_id = ?").get(SEED_IDS.vehicleA1) as {
          c: number;
        }
      ).c;
      auditCountAfterDeactivate = (
        sqlite.prepare("SELECT COUNT(*) c FROM admin_audit WHERE vehicle_id = ?").get(SEED_IDS.vehicleA1) as {
          c: number;
        }
      ).c;
    } finally {
      sqlite.close();
    }

    // Owner/driver oturumları pasif araçta zaten çalışmayan bir GET
    // ucuna erişmeye çalışsa da (403 kapsamı), asıl kanıt yukarıdaki
    // `revoked_at` denetimidir.

    const reactivateResponse = await patchVehicle(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        { requestId: "b2222222-2222-4222-8222-222222222222", version: 2, active: true },
        vehicleUrl(SEED_IDS.vehicleA1),
      ),
      { params: Promise.resolve({ vehicleId: SEED_IDS.vehicleA1 }) },
    );
    expect(reactivateResponse.status).toBe(200);
    expect((await reactivateResponse.json()).vehicle.active).toBe(true);

    const sqliteAfter = rawDb(dbPath);
    try {
      const stillRevokedCount = sqliteAfter
        .prepare(
          "SELECT COUNT(*) c FROM sessions s JOIN vehicle_credentials vc ON vc.id = s.credential_id " +
            "WHERE vc.vehicle_id = ? AND s.revoked_at IS NOT NULL",
        )
        .get(SEED_IDS.vehicleA1) as { c: number };
      expect(stillRevokedCount.c).toBe(2);

      const workEntriesAfter = (
        sqliteAfter.prepare("SELECT COUNT(*) c FROM work_entries WHERE vehicle_id = ?").get(SEED_IDS.vehicleA1) as {
          c: number;
        }
      ).c;
      const vehicleDriversAfter = (
        sqliteAfter.prepare("SELECT COUNT(*) c FROM vehicle_drivers WHERE vehicle_id = ?").get(SEED_IDS.vehicleA1) as {
          c: number;
        }
      ).c;
      expect(workEntriesAfter).toBe(workEntriesBefore);
      expect(vehicleDriversAfter).toBe(vehicleDriversBefore);

      // audit YALNIZ deactivate/reactivate işlemleri için EKLENDİ (mevcut
      // work_entries/vehicle_drivers satırları elle DEĞİŞTİRİLMEDİ); bu
      // ikisinin dokunulmazlığı yukarıdaki sayım EŞİTLİĞİYLE kanıtlanır.
      const auditCountAfterReactivate = (
        sqliteAfter.prepare("SELECT COUNT(*) c FROM admin_audit WHERE vehicle_id = ?").get(SEED_IDS.vehicleA1) as {
          c: number;
        }
      ).c;
      expect(auditCountAfterReactivate).toBe(auditCountAfterDeactivate + 1);
    } finally {
      sqliteAfter.close();
    }

    // Eski oturumlar reaktivasyon SONRASI da kullanılamaz — `resolveSession`
    // `revoked_at` dolu bir satırı asla diriltmez.
    const stillRevoked = await getSessionRoute(
      new Request("https://example.invalid/api/v1/session", {
        headers: { cookie: cookieHeader(owner.token!) },
      }),
    );
    expect(stillRevoked.status).toBe(401);
  });
});
