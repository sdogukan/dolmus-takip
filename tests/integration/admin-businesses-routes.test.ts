/**
 * GET/POST /api/v1/admin/businesses ve GET/PATCH .../[businessId] — T2.1.
 *
 * QA-PLAN.md §1 — gerçek geçici SQLite dosyası + gerçek migration + seed
 * (mock/`:memory:` YOK). Acceptance'ın kapsadığı senaryolar: 201 + tek
 * transaction'da business+people+business_owners+audit+receipt; aynı
 * requestId/aynı gövde replay; aynı requestId/farklı gövde 409; araç
 * oturumu 403; eski version ile PATCH 409 (kanonik metin) ve kayıt
 * değişmez; başka işletmenin kişi ID'si sahip olarak atanamaz (API +
 * doğrudan SQL FK); pasifleştirmede oturum iptali, reaktivasyonda
 * revoked_at temizlenmez; admin_audit gizli veri içermez; sahip adı
 * düzeltmesi aynı person id'yi korur; migration 0002 dolu DB'ye hatasız
 * uygulanır.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS, SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { createDb, openDatabaseConnection, type SqliteConnection } from "../../src/server/data/db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { resetHashQueueForTests } from "../../src/server/auth/hash-queue";
import { resetVehicleLoginRateLimitForTests } from "../../src/server/auth/rate-limit";
import { POST as platformLoginRoute } from "../../src/app/api/v1/auth/platform-login/route";
import { POST as vehicleLoginRoute } from "../../src/app/api/v1/auth/vehicle-login/route";
import {
  GET as getBusinessesList,
  POST as postBusiness,
} from "../../src/app/api/v1/admin/businesses/route";
import {
  GET as getBusinessDetailRoute,
  PATCH as patchBusiness,
} from "../../src/app/api/v1/admin/businesses/[businessId]/route";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const BASE_URL = "https://example.invalid/api/v1/admin/businesses";

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
  expect(response.status).toBe(201);
  const setCookie = response.headers.get("set-cookie");
  const match = /dolmus_session=([^;]+)/.exec(setCookie ?? "");
  const token = decodeURIComponent(match![1]!);
  const body = await response.json();
  return { token, csrfToken: body.csrfToken as string };
}

function rawDb(dbPath: string): SqliteConnection {
  return openDatabaseConnection(dbPath);
}

describe("admin/businesses routes (T2.1)", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-admin-businesses-"));
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

  it("geçerli gövdeyle 201 döner; tek transaction'da business+people+business_owners+audit+receipt yazar", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await postBusiness(
      writeRequest(token, csrfToken, "POST", {
        requestId: "11111111-1111-4111-8111-111111111111",
        name: "Yeni İşletme",
        owner: { fullName: "Yeni Sahip" },
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.business.name).toBe("Yeni İşletme");
    expect(body.business.version).toBe(1);
    expect(body.business.owner.fullName).toBe("Yeni Sahip");

    const sqlite = rawDb(dbPath);
    try {
      const businessCount = sqlite
        .prepare("SELECT COUNT(*) c FROM businesses WHERE id = ?")
        .get(body.business.id) as { c: number };
      expect(businessCount.c).toBe(1);
      const ownerRow = sqlite
        .prepare("SELECT person_id FROM business_owners WHERE business_id = ?")
        .get(body.business.id) as { person_id: string } | undefined;
      expect(ownerRow?.person_id).toBe(body.business.owner.personId);
      const personRow = sqlite
        .prepare("SELECT full_name FROM people WHERE id = ?")
        .get(body.business.owner.personId) as { full_name: string };
      expect(personRow.full_name).toBe("Yeni Sahip");
      const auditRow = sqlite
        .prepare(
          "SELECT action, actor_platform_user_id, before_json, after_json FROM admin_audit WHERE entity_id = ? AND action = 'business.create'",
        )
        .get(body.business.id) as {
        action: string;
        actor_platform_user_id: string;
        before_json: string | null;
        after_json: string;
      };
      expect(auditRow.before_json).toBeNull();
      expect(JSON.parse(auditRow.after_json)).toMatchObject({
        name: "Yeni İşletme",
        ownerFullName: "Yeni Sahip",
      });
      expect(auditRow.after_json).not.toContain("password");
      expect(auditRow.after_json).not.toContain("hash");
      const receiptRow = sqlite
        .prepare("SELECT entity_id, response_code, result_version FROM mutation_receipts WHERE request_id = ?")
        .get("11111111-1111-4111-8111-111111111111") as {
        entity_id: string;
        response_code: number;
        result_version: number;
      };
      expect(receiptRow.entity_id).toBe(body.business.id);
      expect(receiptRow.response_code).toBe(201);
      expect(receiptRow.result_version).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("aynı requestId ve aynı gövdeyle tekrar gönderim ikinci işletme üretmez; ilk sonucu döner", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const body = {
      requestId: "22222222-2222-4222-8222-222222222222",
      name: "Tekrar İşletmesi",
      owner: { fullName: "Tekrar Sahibi" },
    };
    const first = await postBusiness(writeRequest(token, csrfToken, "POST", body));
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await postBusiness(writeRequest(token, csrfToken, "POST", body));
    expect(second.status).toBe(201);
    const secondBody = await second.json();
    expect(secondBody.business.id).toBe(firstBody.business.id);

    const sqlite = rawDb(dbPath);
    try {
      const count = sqlite
        .prepare("SELECT COUNT(*) c FROM businesses WHERE name = 'Tekrar İşletmesi'")
        .get() as { c: number };
      expect(count.c).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("aynı requestId farklı gövdeyle gönderilirse 409 REQUEST_ID_REUSED döner", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const requestId = "33333333-3333-4333-8333-333333333333";
    const first = await postBusiness(
      writeRequest(token, csrfToken, "POST", {
        requestId,
        name: "İlk Ad",
        owner: { fullName: "İlk Sahip" },
      }),
    );
    expect(first.status).toBe(201);

    const second = await postBusiness(
      writeRequest(token, csrfToken, "POST", {
        requestId,
        name: "Farklı Ad",
        owner: { fullName: "Farklı Sahip" },
      }),
    );
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("REQUEST_ID_REUSED");
  });

  // -------------------------------------------------------------------
  // Yetki — araç oturumu tüm admin/businesses uçlarında 403.
  // -------------------------------------------------------------------

  it("owner araç oturumu ile GET/POST/PATCH admin/businesses uçları 403 döner", async () => {
    const { token, csrfToken } = await loginVehicle("34 AAA 001", SEED_TEST_PASSWORDS.owner);

    const listResponse = await getBusinessesList(getRequest(token));
    expect(listResponse.status).toBe(403);

    const postResponse = await postBusiness(
      writeRequest(token, csrfToken, "POST", {
        requestId: "44444444-4444-4444-8444-444444444444",
        name: "Yasak",
        owner: { fullName: "Yasak Sahip" },
      }),
    );
    expect(postResponse.status).toBe(403);

    const detailResponse = await getBusinessDetailRoute(getRequest(token, `${BASE_URL}/${SEED_IDS.businessA}`), {
      params: Promise.resolve({ businessId: SEED_IDS.businessA }),
    });
    expect(detailResponse.status).toBe(403);

    const patchResponse = await patchBusiness(
      writeRequest(token, csrfToken, "PATCH", { requestId: "x", version: 1, name: "Y" }, `${BASE_URL}/${SEED_IDS.businessA}`),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(patchResponse.status).toBe(403);
  });

  // -------------------------------------------------------------------
  // GET liste/detay.
  // -------------------------------------------------------------------

  it("GET /admin/businesses seed işletmelerini owner ve vehicleCount ile listeler", async () => {
    const { token } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await getBusinessesList(getRequest(token));
    expect(response.status).toBe(200);
    const body = await response.json();
    const businessA = body.businesses.find((b: { id: string }) => b.id === SEED_IDS.businessA);
    expect(businessA.owner.fullName).toBe("Ali Kaya");
    expect(businessA.vehicleCount).toBe(2);
  });

  it("GET /admin/businesses/:id detayında sahip ve araçlar döner", async () => {
    const { token } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await getBusinessDetailRoute(
      getRequest(token, `${BASE_URL}/${SEED_IDS.businessA}`),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.owner.fullName).toBe("Ali Kaya");
    expect(body.vehicles).toHaveLength(2);
    expect(body.eligiblePeople).toEqual([]);
  });

  // -------------------------------------------------------------------
  // PATCH — sürüm çakışması, kanonik metin, kayıt değişmez.
  // -------------------------------------------------------------------

  it("eski version ile PATCH 409 VERSION_CONFLICT + kanonik metin döner; kayıt değişmez", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const url = `${BASE_URL}/${SEED_IDS.businessA}`;
    const response = await patchBusiness(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        { requestId: "55555555-5555-4555-8555-555555555555", version: 999, name: "Değişmeyecek" },
        url,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("VERSION_CONFLICT");
    expect(body.error.message).toBe("Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.");

    const sqlite = rawDb(dbPath);
    try {
      const row = sqlite
        .prepare("SELECT name, version FROM businesses WHERE id = ?")
        .get(SEED_IDS.businessA) as { name: string; version: number };
      expect(row.name).toBe("İşletme A");
      expect(row.version).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("sürüm çakışmasında sahip adı düzeltmesi de GERİ ALINIR (tek transaction atomikliği)", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const url = `${BASE_URL}/${SEED_IDS.businessA}`;
    const response = await patchBusiness(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        {
          requestId: "66666666-6666-4666-8666-666666666666",
          version: 999,
          ownerRename: { fullName: "Ali Kaya Değişti", ownerVersion: 1 },
        },
        url,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(response.status).toBe(409);

    const sqlite = rawDb(dbPath);
    try {
      const person = sqlite
        .prepare("SELECT full_name, version FROM people WHERE id = ?")
        .get(SEED_IDS.ownerA) as { full_name: string; version: number };
      expect(person.full_name).toBe("Ali Kaya");
      expect(person.version).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("işletme adını GÜNCEL sürümle değiştirir, versiyonu artırır ve business.update audit'i yazar", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const url = `${BASE_URL}/${SEED_IDS.businessA}`;
    const response = await patchBusiness(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        { requestId: "77777777-7777-4777-8777-777777777777", version: 1, name: "İşletme A (yeni ad)" },
        url,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.business.name).toBe("İşletme A (yeni ad)");
    expect(body.business.version).toBe(2);

    const sqlite = rawDb(dbPath);
    try {
      const auditRow = sqlite
        .prepare("SELECT action FROM admin_audit WHERE entity_id = ? AND action = 'business.update'")
        .get(SEED_IDS.businessA) as { action: string } | undefined;
      expect(auditRow?.action).toBe("business.update");
    } finally {
      sqlite.close();
    }
  });

  it("değişiklik göndermeyen (aynı değerli) PATCH 422 döner, sürümü artırmaz, audit yazmaz", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const url = `${BASE_URL}/${SEED_IDS.businessA}`;
    const response = await patchBusiness(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        { requestId: "88888888-8888-4888-8888-888888888888", version: 1, name: "İşletme A" },
        url,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");

    const sqlite = rawDb(dbPath);
    try {
      const row = sqlite
        .prepare("SELECT version FROM businesses WHERE id = ?")
        .get(SEED_IDS.businessA) as { version: number };
      expect(row.version).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  // -------------------------------------------------------------------
  // Sahip atama — yalnız sahipsiz işletmeye, devir yok; başka işletmenin
  // kişisi asla sahip olamaz (API + doğrudan SQL FK).
  // -------------------------------------------------------------------

  it("sahibi olan işletmeye yeni sahip atama denemesi 422 döner ('zaten bir sahibi var')", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const url = `${BASE_URL}/${SEED_IDS.businessA}`;
    const response = await patchBusiness(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        {
          requestId: "99999999-9999-4999-8999-999999999999",
          version: 1,
          ownerAssignment: { newFullName: "İkinci Sahip" },
        },
        url,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.fields.ownerAssignment).toContain("zaten bir sahibi var");
  });

  it("başka işletmenin kişi ID'si sahip olarak atanamaz — API 422 döner", async () => {
    // businessB (sahipli) yerine sahipsiz bir işletme oluşturup, businessA'nın
    // sahibinin kişi ID'sini o işletmeye sahip olarak atamayı dener.
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const created = await postBusiness(
      writeRequest(token, csrfToken, "POST", {
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Sahipsiz İşletme",
        owner: { fullName: "Geçici Sahip" },
      }),
    );
    // Sahipsiz bırakmak için: bu uç HER ZAMAN sahiple oluşturur (kontrat
    // gereği); bu yüzden ayrı bir sahipsiz senaryo kurmak için doğrudan SQL
    // ile business_owners satırını silip businessı sahipsiz hale getiriyoruz.
    const createdBody = await created.json();
    const sqlite = rawDb(dbPath);
    try {
      sqlite
        .prepare("DELETE FROM business_owners WHERE business_id = ?")
        .run(createdBody.business.id);
    } finally {
      sqlite.close();
    }

    const response = await patchBusiness(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        {
          requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          version: 1,
          ownerAssignment: { existingPersonRef: SEED_IDS.ownerA },
        },
        `${BASE_URL}/${createdBody.business.id}`,
      ),
      { params: Promise.resolve({ businessId: createdBody.business.id }) },
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.fields.ownerAssignment).toContain("bulunamadı");
  });

  it("sahipsiz işletmeye yeni kişiyle sahip atama 200 döner; business_owners + audit yazılır", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const created = await postBusiness(
      writeRequest(token, csrfToken, "POST", {
        requestId: "12121212-1212-4212-8212-121212121212",
        name: "Sahip Atanacak İşletme",
        owner: { fullName: "Geçici Sahip" },
      }),
    );
    const createdBody = await created.json();
    const sqlite = rawDb(dbPath);
    try {
      sqlite.prepare("DELETE FROM business_owners WHERE business_id = ?").run(createdBody.business.id);
    } finally {
      sqlite.close();
    }

    const response = await patchBusiness(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        {
          requestId: "13131313-1313-4313-8313-131313131313",
          version: 1,
          ownerAssignment: { newFullName: "Yeni Atanan Sahip" },
        },
        `${BASE_URL}/${createdBody.business.id}`,
      ),
      { params: Promise.resolve({ businessId: createdBody.business.id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.owner.fullName).toBe("Yeni Atanan Sahip");
    expect(body.eligiblePeople).toEqual([]);

    const sqliteAfter = rawDb(dbPath);
    try {
      const ownerRow = sqliteAfter
        .prepare("SELECT person_id FROM business_owners WHERE business_id = ?")
        .get(createdBody.business.id) as { person_id: string };
      expect(ownerRow.person_id).toBe(body.owner.personId);
      const auditRow = sqliteAfter
        .prepare(
          "SELECT action, after_json FROM admin_audit WHERE entity_id = ? AND action = 'business.owner_assign'",
        )
        .get(createdBody.business.id) as { action: string; after_json: string } | undefined;
      expect(auditRow?.action).toBe("business.owner_assign");
      expect(JSON.parse(auditRow!.after_json)).toMatchObject({
        ownerPersonId: body.owner.personId,
        ownerFullName: "Yeni Atanan Sahip",
      });
    } finally {
      sqliteAfter.close();
    }
  });

  it("doğrudan SQL ile başka işletmenin kişi ID'sini business_owners'a yazma denemesi birleşik FK ile reddedilir", () => {
    // businessB zaten sahipli (PK ihlali FK'den önce tetiklenmesin diye)
    // sahipsiz YENİ bir işletme kullanılır — böylece tetiklenen HATA
    // gerçekten birleşik FK'den gelir, PK çakışmasından DEĞİL.
    const sqlite = rawDb(dbPath);
    try {
      sqlite
        .prepare(
          "INSERT INTO businesses (id, name, active, created_at, version) VALUES ('22222222-0000-4000-8000-000000000002', 'Sahipsiz', 1, ?, 1)",
        )
        .run(new Date().toISOString());
      expect(() =>
        sqlite
          .prepare("INSERT INTO business_owners (business_id, person_id) VALUES (?, ?)")
          .run("22222222-0000-4000-8000-000000000002", SEED_IDS.ownerA),
      ).toThrow(/FOREIGN KEY/i);
    } finally {
      sqlite.close();
    }
  });

  // -------------------------------------------------------------------
  // Sahip adı düzeltmesi — aynı person id korunur, people.version artar.
  // -------------------------------------------------------------------

  it("sahip adı düzeltmesi aynı person id'yi korur ve people.version artırır", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const url = `${BASE_URL}/${SEED_IDS.businessA}`;
    const response = await patchBusiness(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        {
          requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          version: 1,
          ownerRename: { fullName: "Ali Kaya (yeni ad)", ownerVersion: 1 },
        },
        url,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.owner.personId).toBe(SEED_IDS.ownerA);
    expect(body.owner.fullName).toBe("Ali Kaya (yeni ad)");
    expect(body.owner.version).toBe(2);
  });

  // -------------------------------------------------------------------
  // Aktiflik — pasifleştirmede oturum iptali; reaktivasyon revoked_at'i
  // temizlemez (S2.1 AC6).
  // -------------------------------------------------------------------

  it("işletme pasife alındığında tüm araç oturumları revoked_at alır; reaktivasyon eski oturumları açmaz", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const owner = await loginVehicle("34 AAA 001", SEED_TEST_PASSWORDS.owner);

    const url = `${BASE_URL}/${SEED_IDS.businessA}`;
    const deactivate = await patchBusiness(
      writeRequest(
        admin.token,
        admin.csrfToken,
        "PATCH",
        { requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", version: 1, active: false },
        url,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(deactivate.status).toBe(200);
    expect((await deactivate.json()).business.active).toBe(false);

    const sqliteAfterDeactivate = rawDb(dbPath);
    let revokedAt: string | null;
    try {
      const ownerSession = sqliteAfterDeactivate
        .prepare(
          "SELECT revoked_at FROM sessions WHERE credential_id IN (SELECT id FROM vehicle_credentials WHERE vehicle_id = ?)",
        )
        .get(SEED_IDS.vehicleA1) as { revoked_at: string | null };
      revokedAt = ownerSession.revoked_at;
      expect(revokedAt).not.toBeNull();
    } finally {
      sqliteAfterDeactivate.close();
    }
    void owner;

    const reactivate = await patchBusiness(
      writeRequest(
        admin.token,
        admin.csrfToken,
        "PATCH",
        { requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", version: 2, active: true },
        url,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(reactivate.status).toBe(200);
    expect((await reactivate.json()).business.active).toBe(true);

    const sqliteAfterReactivate = rawDb(dbPath);
    try {
      const ownerSession = sqliteAfterReactivate
        .prepare(
          "SELECT revoked_at FROM sessions WHERE credential_id IN (SELECT id FROM vehicle_credentials WHERE vehicle_id = ?)",
        )
        .get(SEED_IDS.vehicleA1) as { revoked_at: string | null };
      // Reaktivasyon eski oturumu YENİDEN açmaz — revoked_at hâlâ dolu.
      expect(ownerSession.revoked_at).toBe(revokedAt);
    } finally {
      sqliteAfterReactivate.close();
    }
  });

  it("pasif işletmede active dışı bir alanı değiştirme denemesi 403 TARGET_INACTIVE_FOR_WRITE döner", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const url = `${BASE_URL}/${SEED_IDS.businessA}`;
    await patchBusiness(
      writeRequest(
        admin.token,
        admin.csrfToken,
        "PATCH",
        { requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff", version: 1, active: false },
        url,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    const response = await patchBusiness(
      writeRequest(
        admin.token,
        admin.csrfToken,
        "PATCH",
        { requestId: "10101010-1010-4010-8010-101010101010", version: 2, name: "Pasifken değişmez" },
        url,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("TARGET_INACTIVE_FOR_WRITE");
  });

  // -------------------------------------------------------------------
  // Migration 0002 — dolu (mevcut businesses satırı olan) DB'ye hatasız
  // uygulanır (T2.1 risk notu).
  // -------------------------------------------------------------------

  it("migration 0002, 0000+0001 uygulanmış VE veri içeren bir DB'ye hatasız uygulanır", () => {
    const incrementalDir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-migration-0002-"));
    const incrementalDbPath = path.join(incrementalDir, "test.sqlite");
    const partialMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-partial-migrations-"));
    fs.mkdirSync(path.join(partialMigrationsDir, "meta"));
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const partialEntries = journal.entries.filter((entry) => entry.idx < 2);
    for (const entry of partialEntries) {
      fs.copyFileSync(
        path.join(migrationsFolder, `${entry.tag}.sql`),
        path.join(partialMigrationsDir, `${entry.tag}.sql`),
      );
    }
    fs.writeFileSync(
      path.join(partialMigrationsDir, "meta", "_journal.json"),
      JSON.stringify({ ...journal, entries: partialEntries }),
    );

    try {
      const sqlite = openDatabaseConnection(incrementalDbPath, { createIfMissing: true });
      try {
        const db = createDb(sqlite);
        // Yalnız 0000+0001 (business_owners/version YOK).
        migrate(db, { migrationsFolder: partialMigrationsDir });
        sqlite
          .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, 'Dolu DB', 1, ?)")
          .run("11111111-0000-4000-8000-000000000001", new Date().toISOString());

        // Şimdi TAM migration klasörüyle (0002 dahil) devam et.
        expect(() => migrate(db, { migrationsFolder })).not.toThrow();

        const row = sqlite
          .prepare("SELECT version FROM businesses WHERE id = ?")
          .get("11111111-0000-4000-8000-000000000001") as { version: number };
        expect(row.version).toBe(1);
        const ownersTable = sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'business_owners'")
          .get();
        expect(ownersTable).toBeDefined();
      } finally {
        sqlite.close();
      }
    } finally {
      fs.rmSync(incrementalDir, { recursive: true, force: true });
      fs.rmSync(partialMigrationsDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------
  // Düzeltme turu — 409 önceliği, existingPersonRef sınırı, driver 403,
  // canlı kilit 503, audit ABORT atomikliği.
  // -------------------------------------------------------------------

  it("eski version ile AYNI değeri gönderen PATCH 422 değil 409 VERSION_CONFLICT döner", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await patchBusiness(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        { requestId: "14141414-1414-4414-8414-141414141414", version: 999, name: "İşletme A" },
        `${BASE_URL}/${SEED_IDS.businessA}`,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("VERSION_CONFLICT");
    expect(body.error.message).toBe("Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.");
  });

  it("eski version ile sahibi olan işletmeye sahip atama 422 değil 409 VERSION_CONFLICT döner", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await patchBusiness(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        {
          requestId: "15151515-1515-4515-8515-151515151515",
          version: 999,
          ownerAssignment: { newFullName: "İkinci Sahip" },
        },
        `${BASE_URL}/${SEED_IDS.businessA}`,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("VERSION_CONFLICT");
  });

  it.each([
    ["UUID biçiminde olmayan", "kisi-1"],
    ["aşırı uzun", "a".repeat(5000)],
  ])("%s existingPersonRef 422 VALIDATION_ERROR + alan hatası döner", async (_label, ref) => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const response = await patchBusiness(
      writeRequest(
        token,
        csrfToken,
        "PATCH",
        {
          requestId: "16161616-1616-4616-8616-161616161616",
          version: 1,
          ownerAssignment: { existingPersonRef: ref },
        },
        `${BASE_URL}/${SEED_IDS.businessA}`,
      ),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields["ownerAssignment.existingPersonRef"]).toBe("Mevcut kişi kimliği geçersiz.");
  });

  it("şema hatası (POST ve PATCH) VALIDATION_ERROR kodu ve fields döner", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const post = await postBusiness(
      writeRequest(token, csrfToken, "POST", { requestId: "x", name: "", owner: { fullName: "A" } }),
    );
    expect(post.status).toBe(422);
    const postBody = await post.json();
    expect(postBody.error.code).toBe("VALIDATION_ERROR");
    expect(postBody.error.fields.name).toBeDefined();

    const patch = await patchBusiness(
      writeRequest(token, csrfToken, "PATCH", { requestId: "x", version: 0 }, `${BASE_URL}/${SEED_IDS.businessA}`),
      { params: Promise.resolve({ businessId: SEED_IDS.businessA }) },
    );
    expect(patch.status).toBe(422);
    const patchBody = await patch.json();
    expect(patchBody.error.code).toBe("VALIDATION_ERROR");
    expect(patchBody.error.fields.version).toBeDefined();
  });

  it("driver araç oturumu GET/POST/PATCH/detay uçlarının hepsinde 403 alır", async () => {
    const { token, csrfToken } = await loginVehicle("34 AAA 001", SEED_TEST_PASSWORDS.driver);
    const params = { params: Promise.resolve({ businessId: SEED_IDS.businessA }) };
    const url = `${BASE_URL}/${SEED_IDS.businessA}`;

    expect((await getBusinessesList(getRequest(token))).status).toBe(403);
    expect(
      (
        await postBusiness(
          writeRequest(token, csrfToken, "POST", {
            requestId: "17171717-1717-4717-8717-171717171717",
            name: "Yasak",
            owner: { fullName: "Yasak Sahip" },
          }),
        )
      ).status,
    ).toBe(403);
    expect((await getBusinessDetailRoute(getRequest(token, url), params)).status).toBe(403);
    expect(
      (
        await patchBusiness(
          writeRequest(
            token,
            csrfToken,
            "PATCH",
            { requestId: "18181818-1818-4818-8818-181818181818", version: 1, name: "Y" },
            url,
          ),
          params,
        )
      ).status,
    ).toBe(403);
  });

  function expectLockEnvelope(body: { error: { code: string }; request_id?: unknown }): void {
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(typeof body.request_id).toBe("string");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("SQLITE_BUSY");
    expect(raw).not.toContain("SQLITE_LOCKED");
    expect(raw).not.toContain(dbPath);
  }

  it(
    "POST: eşzamanlı BEGIN IMMEDIATE kilidi busy_timeout'u aşınca 503 SERVICE_UNAVAILABLE döner, satır yazılmaz; kilit kalkınca aynı requestId ile ilk kez uygulanır",
    async () => {
      const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
      const requestBody = {
        requestId: "19191919-1919-4919-8919-191919191919",
        name: "Kilitli İşletme",
        owner: { fullName: "Kilitli Sahip" },
      };

      // İKİNCİ, AYRI bir bağlantı kilidi busy_timeout'tan (2000 ms) uzun tutar
      // (bkz. session-routes.test.ts "DB kilitli" blokları).
      const lockerSqlite = rawDb(dbPath);
      lockerSqlite.exec("BEGIN IMMEDIATE");
      try {
        const response = await postBusiness(writeRequest(token, csrfToken, "POST", requestBody));
        expect(response.status).toBe(503);
        expectLockEnvelope(await response.json());
      } finally {
        lockerSqlite.exec("ROLLBACK");
        lockerSqlite.close();
      }

      const sqlite = rawDb(dbPath);
      try {
        const counts = sqlite
          .prepare(
            "SELECT (SELECT COUNT(*) FROM businesses WHERE name = 'Kilitli İşletme') b, (SELECT COUNT(*) FROM people WHERE full_name = 'Kilitli Sahip') p, (SELECT COUNT(*) FROM mutation_receipts WHERE request_id = ?) r",
          )
          .get(requestBody.requestId) as { b: number; p: number; r: number };
        expect(counts).toEqual({ b: 0, p: 0, r: 0 });
      } finally {
        sqlite.close();
      }

      const retry = await postBusiness(writeRequest(token, csrfToken, "POST", requestBody));
      expect(retry.status).toBe(201);
    },
    15_000,
  );

  it(
    "PATCH: eşzamanlı BEGIN IMMEDIATE kilidi busy_timeout'u aşınca 503 SERVICE_UNAVAILABLE döner, kayıt değişmez; kilit kalkınca aynı requestId ile ilk kez uygulanır",
    async () => {
      const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
      const url = `${BASE_URL}/${SEED_IDS.businessA}`;
      const params = { params: Promise.resolve({ businessId: SEED_IDS.businessA }) };
      const requestBody = {
        requestId: "20202020-2020-4020-8020-202020202020",
        version: 1,
        name: "Kilitli Yeni Ad",
      };

      const lockerSqlite = rawDb(dbPath);
      lockerSqlite.exec("BEGIN IMMEDIATE");
      try {
        const response = await patchBusiness(writeRequest(token, csrfToken, "PATCH", requestBody, url), params);
        expect(response.status).toBe(503);
        expectLockEnvelope(await response.json());
      } finally {
        lockerSqlite.exec("ROLLBACK");
        lockerSqlite.close();
      }

      const sqlite = rawDb(dbPath);
      try {
        const row = sqlite
          .prepare("SELECT name, version FROM businesses WHERE id = ?")
          .get(SEED_IDS.businessA) as { name: string; version: number };
        expect(row).toEqual({ name: "İşletme A", version: 1 });
        const receipt = sqlite
          .prepare("SELECT COUNT(*) c FROM mutation_receipts WHERE request_id = ?")
          .get(requestBody.requestId) as { c: number };
        expect(receipt.c).toBe(0);
      } finally {
        sqlite.close();
      }

      const retry = await patchBusiness(writeRequest(token, csrfToken, "PATCH", requestBody, url), params);
      expect(retry.status).toBe(200);
    },
    15_000,
  );

  it("POST: admin_audit yazımı ABORT edilince hiçbir tabloda satır kalmaz (tek transaction atomikliği)", async () => {
    const { token, csrfToken } = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const requestBody = {
      requestId: "21212121-2121-4121-8121-212121212121",
      name: "Atomik İşletme",
      owner: { fullName: "Atomik Sahip" },
    };

    // Geçici trigger yalnız bu testin DB'sinde; sonunda kaldırılır.
    const sqlite = rawDb(dbPath);
    sqlite.exec(
      "CREATE TRIGGER test_abort_admin_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT, 'test abort'); END",
    );
    try {
      // Bilinmeyen (kilit dışı) hata `mapMutationErrorToResponse`'ta
      // `undefined` döner ve yeniden fırlatılır.
      await expect(postBusiness(writeRequest(token, csrfToken, "POST", requestBody))).rejects.toThrow();

      const counts = sqlite
        .prepare(
          "SELECT (SELECT COUNT(*) FROM businesses WHERE name = 'Atomik İşletme') b, (SELECT COUNT(*) FROM people WHERE full_name = 'Atomik Sahip') p, (SELECT COUNT(*) FROM business_owners WHERE business_id NOT IN (SELECT id FROM businesses WHERE id IN (?, ?))) o, (SELECT COUNT(*) FROM mutation_receipts WHERE request_id = ?) r",
        )
        .get(SEED_IDS.businessA, SEED_IDS.businessB, requestBody.requestId) as {
        b: number;
        p: number;
        o: number;
        r: number;
      };
      expect(counts).toEqual({ b: 0, p: 0, o: 0, r: 0 });
    } finally {
      sqlite.exec("DROP TRIGGER IF EXISTS test_abort_admin_audit");
      sqlite.close();
    }
  });
});
