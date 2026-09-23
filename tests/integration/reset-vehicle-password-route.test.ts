/**
 * POST /api/v1/admin/vehicles/[vehicleId]/reset-password — T2.3.
 *
 * QA-PLAN.md §1 — gerçek geçici SQLite dosyası + gerçek migration + seed
 * (mock/`:memory:` YOK). `argon2.verify` GEÇİŞLİ (passthrough) casus olarak
 * mock'lanır — `../../src/server/usecases/auth/vehicle-login.ts`in üst
 * notundaki AYNI gerekçeyle (`tests/integration/vehicle-login-route.test.ts`):
 * sonucu ASLA DEĞİŞTİRMEZ, yalnız gerçek Argon2 hesaplaması TAMAMLANDIKTAN
 * hemen SONRA (ama `createVehicleSession`in `sessions` INSERT'i tamamlanmadan
 * ÖNCE) araya GERÇEK bir eşzamanlı yazma sokmayı sağlar (giriş/parola
 * sıfırlama yarışı).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("argon2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("argon2")>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

import { seedDevData, SEED_IDS, SEED_RAW_PLATES, SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { createDb, openDatabaseConnection, type SqliteConnection } from "../../src/server/data/db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { resetHashQueueForTests } from "../../src/server/auth/hash-queue";
import { resetVehicleLoginRateLimitForTests } from "../../src/server/auth/rate-limit";
import { POST as platformLoginRoute } from "../../src/app/api/v1/auth/platform-login/route";
import { POST as vehicleLoginRoute } from "../../src/app/api/v1/auth/vehicle-login/route";
import { GET as getSessionRoute } from "../../src/app/api/v1/session/route";
import { POST as resetPasswordRoute } from "../../src/app/api/v1/admin/vehicles/[vehicleId]/reset-password/route";
import * as recordReceiptModule from "../../src/server/usecases/receipts/record-receipt";
import * as argon2 from "argon2";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const SESSION_URL = "https://example.invalid/api/v1/session";

function cookieHeader(token: string): string {
  return `dolmus_session=${token}`;
}

function resetPasswordUrl(vehicleId: string): string {
  return `https://example.invalid/api/v1/admin/vehicles/${vehicleId}/reset-password`;
}

function writeRequest(token: string, csrfToken: string, method: string, body: unknown, url: string): Request {
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

async function resetPassword(
  token: string,
  csrfToken: string,
  vehicleId: string,
  body: { requestId: string; access: "owner" | "driver"; newPassword: string },
) {
  const response = await resetPasswordRoute(
    writeRequest(token, csrfToken, "POST", body, resetPasswordUrl(vehicleId)),
    { params: Promise.resolve({ vehicleId }) },
  );
  return { status: response.status, body: await response.json() };
}

describe("POST /api/v1/admin/vehicles/[vehicleId]/reset-password (T2.3)", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();
    vi.mocked(argon2.verify).mockClear();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-reset-password-"));
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
  // Temel akış — tek transaction, SADECE hedef credential'ın oturumları,
  // diğer rol DOKUNULMADAN kalır.
  // -------------------------------------------------------------------

  it("geçerli gövdeyle 200 döner; hash+credential_version günceller, SADECE hedef credential'ın oturumunu iptal eder, diğer rol DOKUNULMAZ", async () => {
    const owner = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner);
    expect(owner.status).toBe(201);
    const driver = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver);
    expect(driver.status).toBe(201);

    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const { status, body } = await resetPassword(token, csrfToken, SEED_IDS.vehicleA1, {
      requestId: "d1111111-1111-4111-8111-111111111111",
      access: "owner",
      newPassword: "yeni-sahip-9999",
    });
    expect(status).toBe(200);
    expect(body.access).toBe("owner");
    expect(body.vehicle.id).toBe(SEED_IDS.vehicleA1);
    expect(body.business.id).toBe(SEED_IDS.businessA);
    expect(body.newPassword).toBeUndefined();

    const sqlite = rawDb(dbPath);
    try {
      const ownerCred = sqlite
        .prepare("SELECT password_hash, credential_version FROM vehicle_credentials WHERE id = ?")
        .get(SEED_IDS.credA1Owner) as { password_hash: string; credential_version: number };
      expect(ownerCred.credential_version).toBe(2);
      expect(ownerCred.password_hash.startsWith("$argon2id$")).toBe(true);

      const driverCred = sqlite
        .prepare("SELECT password_hash, credential_version FROM vehicle_credentials WHERE id = ?")
        .get(SEED_IDS.credA1Driver) as { password_hash: string; credential_version: number };
      expect(driverCred.credential_version).toBe(1);

      const ownerRevoked = sqlite
        .prepare("SELECT COUNT(*) c FROM sessions WHERE credential_id = ? AND revoked_at IS NOT NULL")
        .get(SEED_IDS.credA1Owner) as { c: number };
      expect(ownerRevoked.c).toBe(1);
      const driverRevoked = sqlite
        .prepare("SELECT COUNT(*) c FROM sessions WHERE credential_id = ? AND revoked_at IS NOT NULL")
        .get(SEED_IDS.credA1Driver) as { c: number };
      expect(driverRevoked.c).toBe(0);

      const auditRow = sqlite
        .prepare(
          "SELECT entity_type, entity_id, action, before_json, after_json, actor_platform_user_id FROM admin_audit WHERE entity_id = ? AND action = 'vehicle.reset_password'",
        )
        .get(SEED_IDS.credA1Owner) as {
        entity_type: string;
        entity_id: string;
        action: string;
        before_json: string;
        after_json: string;
        actor_platform_user_id: string;
      };
      expect(auditRow.entity_type).toBe("vehicle_credential");
      expect(JSON.parse(auditRow.before_json)).toEqual({ access: "owner", credentialVersion: 1 });
      expect(JSON.parse(auditRow.after_json)).toEqual({ access: "owner", credentialVersion: 2 });
      expect(auditRow.after_json).not.toContain("yeni-sahip-9999");
      expect(auditRow.after_json).not.toContain("hash");
      expect(typeof auditRow.actor_platform_user_id).toBe("string");

      const receiptRow = sqlite
        .prepare("SELECT entity_id, response_code, result_version FROM mutation_receipts WHERE request_id = ?")
        .get("d1111111-1111-4111-8111-111111111111") as {
        entity_id: string;
        response_code: number;
        result_version: number;
      };
      expect(receiptRow.entity_id).toBe(SEED_IDS.credA1Owner);
      expect(receiptRow.response_code).toBe(200);
      expect(receiptRow.result_version).toBe(2);
    } finally {
      sqlite.close();
    }

    const ownerStillValid = await getSessionRoute(
      new Request(SESSION_URL, { headers: { cookie: cookieHeader(owner.token!) } }),
    );
    expect(ownerStillValid.status).toBe(401);
    const driverStillValid = await getSessionRoute(
      new Request(SESSION_URL, { headers: { cookie: cookieHeader(driver.token!) } }),
    );
    expect(driverStillValid.status).toBe(200);

    const oldPasswordLogin = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner);
    expect(oldPasswordLogin.status).toBe(401);
    const newPasswordLogin = await loginVehicle(SEED_RAW_PLATES.vehicleA1, "yeni-sahip-9999");
    expect(newPasswordLogin.status).toBe(201);
    expect(newPasswordLogin.body.role).toBe("owner");
    const driverLoginStillWorks = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver);
    expect(driverLoginStillWorks.status).toBe(201);
  });

  // -------------------------------------------------------------------
  // Tekrar gönderim.
  // -------------------------------------------------------------------

  it("aynı requestId + AYNI newPassword ile tekrar gönderim ikinci sıfırlama YAPMAZ, aynı 200 sonucu döner", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const body = {
      requestId: "d2222222-2222-4222-8222-222222222222",
      access: "owner" as const,
      newPassword: "tekrar-sahip-9999",
    };
    const first = await resetPassword(token, csrfToken, SEED_IDS.vehicleA1, body);
    expect(first.status).toBe(200);
    const second = await resetPassword(token, csrfToken, SEED_IDS.vehicleA1, body);
    expect(second.status).toBe(200);
    // `request_id` HTTP izleme kimliğidir (her istekte YENİDEN üretilir);
    // makbuzun taşıdığı asıl SONUÇ (access/vehicle/business) birebir aynı
    // kalmalıdır.
    expect(second.body.access).toEqual(first.body.access);
    expect(second.body.vehicle).toEqual(first.body.vehicle);
    expect(second.body.business).toEqual(first.body.business);

    const sqlite = rawDb(dbPath);
    try {
      const ownerCred = sqlite
        .prepare("SELECT credential_version FROM vehicle_credentials WHERE id = ?")
        .get(SEED_IDS.credA1Owner) as { credential_version: number };
      expect(ownerCred.credential_version).toBe(2);
      const auditCount = sqlite
        .prepare("SELECT COUNT(*) c FROM admin_audit WHERE entity_id = ? AND action = 'vehicle.reset_password'")
        .get(SEED_IDS.credA1Owner) as { c: number };
      expect(auditCount.c).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("aynı requestId FARKLI newPassword ile gönderilirse 409 REQUEST_ID_REUSED döner; ilk parola geçerli kalır", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const requestId = "d3333333-3333-4333-8333-333333333333";
    const first = await resetPassword(token, csrfToken, SEED_IDS.vehicleA1, {
      requestId,
      access: "owner",
      newPassword: "ilk-parola-9999",
    });
    expect(first.status).toBe(200);

    const second = await resetPassword(token, csrfToken, SEED_IDS.vehicleA1, {
      requestId,
      access: "owner",
      newPassword: "farkli-parola-9999",
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("REQUEST_ID_REUSED");

    const login = await loginVehicle(SEED_RAW_PLATES.vehicleA1, "ilk-parola-9999");
    expect(login.status).toBe(201);
  });

  // -------------------------------------------------------------------
  // Ayrımlılık (distinctness) — diğer rolün MEVCUT şifresiyle aynı olamaz.
  // -------------------------------------------------------------------

  it("newPassword diğer rolün MEVCUT şifresiyle AYNIYSA 422 fields.newPassword döner, hiçbir şey değişmez", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await resetPassword(token, csrfToken, SEED_IDS.vehicleA2, {
      requestId: "d4444444-4444-4444-8444-444444444444",
      access: "owner",
      newPassword: SEED_TEST_PASSWORDS.driver,
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.fields.newPassword).toBeTruthy();

    const sqlite = rawDb(dbPath);
    try {
      const ownerCred = sqlite
        .prepare("SELECT credential_version FROM vehicle_credentials WHERE id = ?")
        .get(SEED_IDS.credA2Owner) as { credential_version: number };
      expect(ownerCred.credential_version).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  // -------------------------------------------------------------------
  // Hedef/kapsam hataları.
  // -------------------------------------------------------------------

  it("bilinmeyen vehicleId için 404 TARGET_VEHICLE_NOT_FOUND döner", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const unknownId = "00000000-0000-4000-8000-000000000999";
    const response = await resetPassword(token, csrfToken, unknownId, {
      requestId: "d5555555-5555-4555-8555-555555555555",
      access: "owner",
      newPassword: "her-hangi-9999",
    });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("TARGET_VEHICLE_NOT_FOUND");
  });

  it("pasif araç için 403 TARGET_INACTIVE_FOR_WRITE döner, hiçbir şey değişmez", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await resetPassword(token, csrfToken, SEED_IDS.vehicleB2, {
      requestId: "d6666666-6666-4666-8666-666666666666",
      access: "owner",
      newPassword: "pasif-arac-9999",
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("TARGET_INACTIVE_FOR_WRITE");

    const sqlite = rawDb(dbPath);
    try {
      const ownerCred = sqlite
        .prepare("SELECT credential_version FROM vehicle_credentials WHERE id = ?")
        .get(SEED_IDS.credB2Owner) as { credential_version: number };
      expect(ownerCred.credential_version).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("owner ve driver araç oturumu ile POST 403 döner", async () => {
    const owner = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner);
    expect(owner.status).toBe(201);
    const driver = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver);
    expect(driver.status).toBe(201);

    for (const session of [owner, driver]) {
      const response = await resetPasswordRoute(
        writeRequest(
          session.token!,
          session.body.csrfToken,
          "POST",
          { requestId: "yasak-0000-4000-8000-000000000000", access: "owner", newPassword: "yasak-9999" },
          resetPasswordUrl(SEED_IDS.vehicleA1),
        ),
        { params: Promise.resolve({ vehicleId: SEED_IDS.vehicleA1 }) },
      );
      expect(response.status).toBe(403);
    }
  });

  // -------------------------------------------------------------------
  // Eşzamanlı owner+driver sıfırlaması AYNI yeni parolaya — ikisi de
  // committer olamaz (sahip/şoför şifresi aynı olamaz kuralı).
  // -------------------------------------------------------------------

  it("GERÇEK eşzamanlı owner+driver sıfırlaması AYNI yeni parolaya: yalnız BİRİ nihai olarak o parolayla çalışır", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const sharedPassword = "ortak-parola-9999";

    const [ownerResponse, driverResponse] = await Promise.all([
      resetPassword(token, csrfToken, SEED_IDS.vehicleA2, {
        requestId: "d7777771-7777-4777-8777-777777777771",
        access: "owner",
        newPassword: sharedPassword,
      }),
      resetPassword(token, csrfToken, SEED_IDS.vehicleA2, {
        requestId: "d7777772-7777-4777-8777-777777777772",
        access: "driver",
        newPassword: sharedPassword,
      }),
    ]);

    const statuses = [ownerResponse.status, driverResponse.status].sort((a, b) => a - b);
    // Biri kesinlikle BAŞARISIZ olmalı (409 VERSION_CONFLICT veya 422
    // VALIDATION_ERROR — zamanlamaya bağlı, ikisi de kabul edilir); İKİSİ
    // BİRDEN 200 OLAMAZ. Artan sırada 200 en küçük değer olduğundan İLK
    // öğede bulunur.
    expect(statuses).not.toEqual([200, 200]);
    expect(statuses[0]).toBe(200);
    expect([409, 422]).toContain(statuses[1]);

    // Kanıt DOĞRUDAN DB'den: `vehicleLogin` role PARAMETRESİ ALMADAN owner'ı
    // ÖNCE dener (bkz. `../../src/server/usecases/auth/vehicle-login.ts`) —
    // aynı plaka+parolayla İKİ AYRI giriş denemesi HER ZAMAN AYNI (owner)
    // credential'ı eşleştirir ve İKİSİ de 201 döner; bu, driver'ın DA aynı
    // parolaya sahip olup OLMADIĞINI KANITLAMAZ. Asıl kanıt: yalnız BİR
    // credential'ın sürümü artmış (committer BUDUR), DİĞERİ sürüm 1'de
    // KALMIŞ olmalı (rollback DEĞİŞTİRMEDİ).
    const sqlite = rawDb(dbPath);
    try {
      const rows = sqlite
        .prepare("SELECT credential_version FROM vehicle_credentials WHERE vehicle_id = ?")
        .all(SEED_IDS.vehicleA2) as { credential_version: number }[];
      const versions = rows.map((row) => row.credential_version).sort((a, b) => a - b);
      expect(versions).toEqual([1, 2]);
    } finally {
      sqlite.close();
    }
  });

  // -------------------------------------------------------------------
  // Giriş/parola sıfırlama yarışı — verified credential_version
  // createVehicleSession'a taşınır.
  // -------------------------------------------------------------------

  it("Argon2 doğrulaması TAMAMLANDIKTAN hemen SONRA credential sıfırlanırsa 401 INVALID_CREDENTIALS döner, oturum AÇILMAZ", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);

    vi.mocked(argon2.verify).mockImplementationOnce(async (digest, password) => {
      const actual = await vi.importActual<typeof import("argon2")>("argon2");
      const matched = await actual.verify(digest, password);
      // Owner parolası GERÇEKTEN eşleşti (bu, o hash'e karşı yapılan İLK ve
      // TEK doğrulamadır — bkz. `vehicleLogin`in owner-önce-driver sırası)
      // ama `createVehicleSession`in `sessions` INSERT'i HENÜZ ÇALIŞMADI —
      // TAM BU ANDA GERÇEK bir parola sıfırlaması commit edilir.
      const resetResponse = await resetPassword(token, csrfToken, SEED_IDS.vehicleA1, {
        requestId: "yaris-login-0000-4000-8000-000000000000",
        access: "owner",
        newPassword: "yaris-yeni-sahip-9999",
      });
      expect(resetResponse.status).toBe(200);
      return matched;
    });

    const login = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner);
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe("INVALID_CREDENTIALS");

    const sqlite = rawDb(dbPath);
    try {
      const activeSessionCount = sqlite
        .prepare("SELECT COUNT(*) c FROM sessions WHERE credential_id = ? AND revoked_at IS NULL")
        .get(SEED_IDS.credA1Owner) as { c: number };
      // Sıfırlamanın KENDİ revoke'u zaten eski (var olmayan) oturumu
      // etkilemez; asıl kanıt YENİ bir oturumun HİÇ İNSERT EDİLMEMİŞ olması.
      expect(activeSessionCount.c).toBe(0);
    } finally {
      sqlite.close();
    }

    // Sıfırlama SONRASI yeni parola normal şekilde çalışır.
    const newLogin = await loginVehicle(SEED_RAW_PLATES.vehicleA1, "yaris-yeni-sahip-9999");
    expect(newLogin.status).toBe(201);
  });

  // -------------------------------------------------------------------
  // Zorla araya giren hata — TEK transaction'ın atomikliği.
  // -------------------------------------------------------------------

  it("transaction içinde araya giren hata TÜM yazmaları GERİ ALDIRIR — hash, sürüm, oturumlar, audit, receipt DEĞİŞMEZ", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const owner = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner);
    expect(owner.status).toBe(201);

    const recordReceiptSpy = vi
      .spyOn(recordReceiptModule, "recordReceipt")
      .mockImplementationOnce(() => {
        throw new Error("simüle edilmiş yazma hatası (ör. disk dolu)");
      });

    try {
      await expect(
        resetPasswordRoute(
          writeRequest(
            token,
            csrfToken,
            "POST",
            { requestId: "rollback-0000-4000-8000-000000000000", access: "owner", newPassword: "rollback-9999" },
            resetPasswordUrl(SEED_IDS.vehicleA1),
          ),
          { params: Promise.resolve({ vehicleId: SEED_IDS.vehicleA1 }) },
        ),
      ).rejects.toThrow("simüle edilmiş yazma hatası");
    } finally {
      recordReceiptSpy.mockRestore();
    }

    const sqlite = rawDb(dbPath);
    try {
      const ownerCred = sqlite
        .prepare("SELECT password_hash, credential_version FROM vehicle_credentials WHERE id = ?")
        .get(SEED_IDS.credA1Owner) as { password_hash: string; credential_version: number };
      expect(ownerCred.credential_version).toBe(1);

      const revokedCount = sqlite
        .prepare("SELECT COUNT(*) c FROM sessions WHERE credential_id = ? AND revoked_at IS NOT NULL")
        .get(SEED_IDS.credA1Owner) as { c: number };
      expect(revokedCount.c).toBe(0);

      const auditCount = sqlite
        .prepare("SELECT COUNT(*) c FROM admin_audit WHERE entity_id = ? AND action = 'vehicle.reset_password'")
        .get(SEED_IDS.credA1Owner) as { c: number };
      expect(auditCount.c).toBe(0);

      const receiptRow = sqlite
        .prepare("SELECT * FROM mutation_receipts WHERE request_id = ?")
        .get("rollback-0000-4000-8000-000000000000");
      expect(receiptRow).toBeUndefined();
    } finally {
      sqlite.close();
    }

    // Eski oturum HALA geçerli, eski parola HALA çalışıyor — sıfırlama
    // hiç GERÇEKLEŞMEMİŞ gibi.
    const stillValid = await getSessionRoute(
      new Request(SESSION_URL, { headers: { cookie: cookieHeader(owner.token!) } }),
    );
    expect(stillValid.status).toBe(200);
    const reLogin = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner);
    expect(reLogin.status).toBe(201);
  });
});
