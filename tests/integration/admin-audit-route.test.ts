/**
 * GET /api/v1/admin/audit — yönetim işlem geçmişi (salt okunur).
 *
 * Gerçek geçici SQLite dosyası + gerçek migration + seed.
 * Kayıtlar gerçek yazma rotalarıyla üretilir (elle INSERT yalnız aynı
 * `occurred_at`'li sayfalama kenar durumu ve `business_id` NULL satırı için).
 * Kapsam: 401/403/404/422, yalnız GET export'u, gerçek aktör (kullanıcı adı /
 * erişim rolü + plaka), create satırlarında before=null, gizli anahtar/oturum
 * kimliği sızıntısı yok, makbuz replay'inde tek kayıt, sessions silinse de
 * aktör çözümü, keyset sayfalamada her satır tam bir kez.
 */
import crypto from "node:crypto";
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
import * as auditRouteModule from "../../src/app/api/v1/admin/audit/route";
import { GET as getAudit } from "../../src/app/api/v1/admin/audit/route";
import { POST as platformLoginRoute } from "../../src/app/api/v1/auth/platform-login/route";
import { POST as vehicleLoginRoute } from "../../src/app/api/v1/auth/vehicle-login/route";
import { POST as postBusiness } from "../../src/app/api/v1/admin/businesses/route";
import { PATCH as patchBusiness } from "../../src/app/api/v1/admin/businesses/[businessId]/route";
import { POST as postVehicle } from "../../src/app/api/v1/admin/vehicles/route";
import { POST as resetPasswordRoute } from "../../src/app/api/v1/admin/vehicles/[vehicleId]/reset-password/route";
import { POST as postDriver } from "../../src/app/api/v1/drivers/route";
import { PUT as putAssignment } from "../../src/app/api/v1/vehicles/[vehicleId]/drivers/[personId]/route";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const API = "https://example.invalid/api/v1";
const AUDIT_URL = `${API}/admin/audit`;

interface Session {
  token: string;
  csrfToken: string;
}

interface AuditEntryBody {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string;
  business: { id: string; name: string } | null;
  vehicle: { id: string; plateNormalized: string } | null;
  actor:
    | { kind: "platform_user"; username: string; role: string }
    | { kind: "vehicle_credential"; access: string; plateNormalized: string | null };
  onBehalfOf: { kind: string; fullName: string } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function readSession(response: Response, body: { csrfToken: string }): Session {
  const match = /dolmus_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "");
  return { token: decodeURIComponent(match![1]!), csrfToken: body.csrfToken };
}

async function loginPlatform(username: string, password: string): Promise<Session> {
  const response = await platformLoginRoute(
    new Request(`${API}/auth/platform-login`, {
      method: "POST",
      headers: { origin: SELF_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  );
  expect(response.status).toBe(201);
  return readSession(response, await response.json());
}

async function loginVehicle(plate: string, password: string): Promise<Session> {
  const response = await vehicleLoginRoute(
    new Request(`${API}/auth/vehicle-login`, {
      method: "POST",
      headers: { origin: SELF_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ plate, password }),
    }),
  );
  expect(response.status).toBe(201);
  return readSession(response, await response.json());
}

function writeRequest(
  session: Session,
  method: string,
  body: unknown,
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method,
    headers: {
      cookie: `dolmus_session=${session.token}`,
      origin: SELF_ORIGIN,
      "x-csrf-token": session.csrfToken,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function auditRequest(session: Session | null, query = ""): Request {
  return new Request(`${AUDIT_URL}${query}`, {
    headers: session ? { cookie: `dolmus_session=${session.token}` } : {},
  });
}

async function fetchAudit(session: Session, query = ""): Promise<{
  status: number;
  body: { entries: AuditEntryBody[]; nextCursor: string | null; error?: { code: string; fields?: Record<string, string> } };
}> {
  const response = await getAudit(auditRequest(session, query));
  return { status: response.status, body: await response.json() };
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      keys.push(key);
      collectKeys(inner, keys);
    }
  }
  return keys;
}

describe("GET /api/v1/admin/audit", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  function rawDb(): SqliteConnection {
    return openDatabaseConnection(dbPath);
  }

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-admin-audit-"));
    dbPath = path.join(dir, "test.sqlite");
    const setupSqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    migrate(createDb(setupSqlite), { migrationsFolder });
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

  /** Gerçek rotalarla: işletme oluştur → güncelle → araç oluştur → parola
   * sıfırla; ekip adına şoför + atama; sahip oturumuyla şoför. */
  async function seedThroughRoutes(admin: Session) {
    const businessRequestId = `biz-${crypto.randomUUID()}`;
    const createBusinessResponse = await postBusiness(
      writeRequest(
        admin,
        "POST",
        { requestId: businessRequestId, name: "Denetim Turizm", owner: { fullName: "Sema Denetim" } },
        `${API}/admin/businesses`,
      ),
    );
    expect(createBusinessResponse.status).toBe(201);
    const business = (await createBusinessResponse.json()).business as { id: string; version: number };

    const patchResponse = await patchBusiness(
      writeRequest(
        admin,
        "PATCH",
        { requestId: `patch-${crypto.randomUUID()}`, version: business.version, name: "Denetim Turizm Ltd" },
        `${API}/admin/businesses/${business.id}`,
      ),
      { params: Promise.resolve({ businessId: business.id }) },
    );
    expect(patchResponse.status).toBe(200);

    const createVehicleResponse = await postVehicle(
      writeRequest(
        admin,
        "POST",
        {
          requestId: `veh-${crypto.randomUUID()}`,
          businessRef: business.id,
          plate: "35 DNT 001",
          ownerPassword: "gizli-sahip-parola-1",
          driverPassword: "gizli-sofor-parola-1",
        },
        `${API}/admin/vehicles`,
      ),
    );
    expect(createVehicleResponse.status).toBe(201);
    const vehicleId = (await createVehicleResponse.json()).vehicle.id as string;

    const resetResponse = await resetPasswordRoute(
      writeRequest(
        admin,
        "POST",
        { requestId: `reset-${crypto.randomUUID()}`, access: "owner", newPassword: "yeni-gizli-parola-2" },
        `${API}/admin/vehicles/${vehicleId}/reset-password`,
      ),
      { params: Promise.resolve({ vehicleId }) },
    );
    expect(resetResponse.status).toBe(200);

    // Ekip, yeni araç adına şoför oluşturur ve bağlar (x-target-vehicle).
    const staffDriverResponse = await postDriver(
      writeRequest(
        admin,
        "POST",
        { requestId: `drv-${crypto.randomUUID()}`, fullName: "Ekip Şoför" },
        `${API}/drivers`,
        { "x-target-vehicle": vehicleId },
      ),
    );
    expect(staffDriverResponse.status).toBe(201);

    return { business, vehicleId, businessRequestId };
  }

  it("oturumsuz 401, sahip ve şoför araç oturumları 403 döner", async () => {
    const anonymous = await getAudit(auditRequest(null));
    expect(anonymous.status).toBe(401);

    const owner = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner);
    expect((await getAudit(auditRequest(owner))).status).toBe(403);

    const driver = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver);
    expect((await getAudit(auditRequest(driver))).status).toBe(403);
  });

  it("support ve admin 200 + entries/nextCursor alır", async () => {
    for (const [username, password] of [
      [SEED_USERNAMES.support, SEED_TEST_PASSWORDS.support],
      [SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin],
    ] as const) {
      const session = await loginPlatform(username, password);
      const { status, body } = await fetchAudit(session);
      expect(status).toBe(200);
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.nextCursor).toBeNull();
    }
  });

  it("route yalnız GET export eder (POST/PATCH/PUT/DELETE yok)", () => {
    expect(Object.keys(auditRouteModule)).toEqual(["GET"]);
  });

  it("gerçek rotalarla yazılan kayıtlar gerçek aktörle, create satırlarında before=null olarak görünür", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const { business, vehicleId } = await seedThroughRoutes(admin);

    // Sahip oturumu (seed araç A1) kendi işletmesine şoför ekler.
    const owner = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner);
    const ownerDriverResponse = await postDriver(
      writeRequest(owner, "POST", { requestId: `own-${crypto.randomUUID()}`, fullName: "Sahip Şoför" }, `${API}/drivers`),
    );
    expect(ownerDriverResponse.status).toBe(201);

    const { status, body } = await fetchAudit(admin, "?limit=100");
    expect(status).toBe(200);
    const byAction = (action: string) => body.entries.filter((entry) => entry.action === action);

    const businessCreate = byAction("business.create").find((e) => e.entityId === business.id)!;
    expect(businessCreate.before).toBeNull();
    expect(businessCreate.actor).toEqual({ kind: "platform_user", username: SEED_USERNAMES.admin, role: "admin" });
    expect(businessCreate.business).toEqual({ id: business.id, name: "Denetim Turizm Ltd" });

    const businessUpdate = byAction("business.update").find((e) => e.entityId === business.id)!;
    expect(businessUpdate.before).not.toBeNull();

    const vehicleCreate = byAction("vehicle.create").find((e) => e.entityId === vehicleId)!;
    expect(vehicleCreate.before).toBeNull();
    expect(vehicleCreate.vehicle).toEqual({ id: vehicleId, plateNormalized: "35DNT001" });

    const reset = byAction("vehicle.reset_password").find((e) => e.vehicle?.id === vehicleId)!;
    expect(reset.actor).toMatchObject({ kind: "platform_user", username: SEED_USERNAMES.admin });

    // Ekip adına yazılan şoför kaydı: "adına" = araç sahibi.
    const staffPerson = byAction("person.create").find((e) => e.actor.kind === "platform_user")!;
    expect(staffPerson.before).toBeNull();
    expect(staffPerson.onBehalfOf).toEqual({ kind: "owner", fullName: "Sema Denetim" });
    const staffAssignment = byAction("vehicle_driver.create").find((e) => e.actor.kind === "platform_user")!;
    expect(staffAssignment.before).toBeNull();

    // Sahip oturumu: erişim rolü + plaka, kişi adı YOK, on_behalf_of YOK.
    const ownerPerson = byAction("person.create").find((e) => e.actor.kind === "vehicle_credential")!;
    expect(ownerPerson.actor).toEqual({ kind: "vehicle_credential", access: "owner", plateNormalized: "34AAA001" });
    expect(ownerPerson.onBehalfOf).toBeNull();
    expect(JSON.stringify(ownerPerson.actor)).not.toContain("Ali Kaya");
  });

  it("yanıtta parola/özet/token/cookie/csrf anahtarı, oturum kimliği veya ham parola bulunmaz", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    await seedThroughRoutes(admin);

    const sqlite = rawDb();
    const sessionIds = (sqlite.prepare("SELECT id FROM sessions").all() as { id: string }[]).map((r) => r.id);
    sqlite.close();
    expect(sessionIds.length).toBeGreaterThan(0);

    const response = await getAudit(auditRequest(admin, "?limit=100"));
    const text = await response.clone().text();
    const body = await response.json();

    for (const key of collectKeys(body)) {
      expect(key).not.toMatch(/password|hash|token|cookie|csrf|secret|session|credentialId/iu);
    }
    for (const sessionId of sessionIds) expect(text).not.toContain(sessionId);
    for (const secret of ["gizli-sahip-parola-1", "gizli-sofor-parola-1", "yeni-gizli-parola-2", SEED_TEST_PASSWORDS.admin, admin.token, admin.csrfToken]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain("argon2");
  });

  it("aynı request_id ile tekrar gönderim ikinci kayıt eklemez", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const body = { requestId: "replay-1", name: "Replay Turizm", owner: { fullName: "Rep Lay" } };
    const first = await postBusiness(writeRequest(admin, "POST", body, `${API}/admin/businesses`));
    const second = await postBusiness(writeRequest(admin, "POST", body, `${API}/admin/businesses`));
    expect(first.status).toBe(201);
    expect([200, 201]).toContain(second.status);
    const businessId = (await first.json()).business.id as string;

    const { body: audit } = await fetchAudit(admin, `?businessId=${businessId}&limit=100`);
    expect(audit.entries.filter((e) => e.action === "business.create")).toHaveLength(1);
  });

  it("tüm sessions satırları silinse de aktör kullanıcı adı çözülür", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const { business } = await seedThroughRoutes(admin);

    const sqlite = rawDb();
    sqlite.prepare("DELETE FROM sessions").run();
    expect((sqlite.prepare("SELECT COUNT(*) c FROM sessions").get() as { c: number }).c).toBe(0);
    sqlite.close();

    const support = await loginPlatform(SEED_USERNAMES.support, SEED_TEST_PASSWORDS.support);
    const { status, body } = await fetchAudit(support, `?businessId=${business.id}&limit=100`);
    expect(status).toBe(200);
    const creates = body.entries.filter((e) => e.action === "business.create");
    expect(creates).toHaveLength(1);
    expect(creates[0]!.actor).toMatchObject({ kind: "platform_user", username: SEED_USERNAMES.admin });
  });

  it("filtre hataları: bilinmeyen işletme/başka işletmenin aracı 404, geçersiz uuid/limit/cursor 422", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const unknown = crypto.randomUUID();

    const unknownBusiness = await fetchAudit(admin, `?businessId=${unknown}`);
    expect(unknownBusiness.status).toBe(404);
    expect(unknownBusiness.body.error?.code).toBe("TARGET_BUSINESS_NOT_FOUND");

    const unknownVehicle = await fetchAudit(admin, `?vehicleId=${unknown}`);
    expect(unknownVehicle.status).toBe(404);
    expect(unknownVehicle.body.error?.code).toBe("TARGET_VEHICLE_NOT_FOUND");

    const crossBusiness = await fetchAudit(admin, `?businessId=${SEED_IDS.businessB}&vehicleId=${SEED_IDS.vehicleA1}`);
    expect(crossBusiness.status).toBe(404);
    expect(crossBusiness.body.error?.code).toBe("TARGET_VEHICLE_NOT_FOUND");

    const badBusiness = await fetchAudit(admin, "?businessId=degil");
    expect(badBusiness.status).toBe(422);
    expect(badBusiness.body.error?.fields).toHaveProperty("businessId");
    expect((await fetchAudit(admin, "?vehicleId=degil")).body.error?.fields).toHaveProperty("vehicleId");

    for (const limit of ["0", "-1", "101", "abc", "1.5", ""]) {
      const result = await fetchAudit(admin, `?limit=${limit}`);
      expect(result.status, `limit=${limit}`).toBe(422);
      expect(result.body.error?.fields).toHaveProperty("limit");
    }
    for (const cursor of ["bozuk", "", Buffer.from('["tek"]').toString("base64url"), Buffer.from("[1,2]").toString("base64url")]) {
      const result = await fetchAudit(admin, `?cursor=${cursor}`);
      expect(result.status, `cursor=${cursor}`).toBe(422);
      expect(result.body.error?.fields).toHaveProperty("cursor");
    }
  });

  it("businessId/vehicleId filtresi kapsamı daraltır; business_id NULL satır yalnız filtresiz listede çıkar", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const { business, vehicleId } = await seedThroughRoutes(admin);

    const sqlite = rawDb();
    const adminUser = sqlite.prepare("SELECT id FROM platform_users WHERE username = ?").get(SEED_USERNAMES.admin) as { id: string };
    const cliRowId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO admin_audit (id, business_id, vehicle_id, entity_type, entity_id, action, before_json, after_json,
           actor_kind, actor_session_id, actor_role, actor_platform_user_id, occurred_at)
         VALUES (?, NULL, NULL, 'platform_user', ?, 'platform_user.bootstrap', NULL, '{"username":"cli"}',
           'platform_user', 'cli', 'admin', ?, '2020-01-01T00:00:00.000Z')`,
      )
      .run(cliRowId, adminUser.id, adminUser.id);
    sqlite.close();

    const all = await fetchAudit(admin, "?limit=100");
    expect(all.body.entries.map((e) => e.id)).toContain(cliRowId);
    const cliEntry = all.body.entries.find((e) => e.id === cliRowId)!;
    expect(cliEntry.business).toBeNull();
    expect(cliEntry.vehicle).toBeNull();

    const byBusiness = await fetchAudit(admin, `?businessId=${business.id}&limit=100`);
    expect(byBusiness.body.entries.length).toBeGreaterThan(0);
    expect(byBusiness.body.entries.every((e) => e.business?.id === business.id)).toBe(true);
    expect(byBusiness.body.entries.map((e) => e.id)).not.toContain(cliRowId);
    // İşletme düzeyi satır (business.update) araç filtresinde YOK, işletme filtresinde VAR.
    expect(byBusiness.body.entries.some((e) => e.action === "business.update")).toBe(true);

    const byVehicle = await fetchAudit(admin, `?vehicleId=${vehicleId}&limit=100`);
    expect(byVehicle.body.entries.length).toBeGreaterThan(0);
    expect(byVehicle.body.entries.every((e) => e.vehicle?.id === vehicleId)).toBe(true);
    expect(byVehicle.body.entries.some((e) => e.action === "business.update")).toBe(false);

    const matching = await fetchAudit(admin, `?businessId=${business.id}&vehicleId=${vehicleId}&limit=100`);
    expect(matching.status).toBe(200);
    expect(matching.body.entries.map((e) => e.id).sort()).toEqual(byVehicle.body.entries.map((e) => e.id).sort());
  });

  it("cursor ile sayfalama her satırı tam bir kez döndürür (aynı occurred_at dahil)", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    await seedThroughRoutes(admin);

    // Aynı occurred_at'i paylaşan satırlar: sıralama (occurred_at, id) katı demetidir.
    const sqlite = rawDb();
    const adminUser = sqlite.prepare("SELECT id FROM platform_users WHERE username = ?").get(SEED_USERNAMES.admin) as { id: string };
    const insert = sqlite.prepare(
      `INSERT INTO admin_audit (id, business_id, vehicle_id, entity_type, entity_id, action, before_json, after_json,
         actor_kind, actor_session_id, actor_role, actor_platform_user_id, occurred_at)
       VALUES (?, NULL, NULL, 'platform_user', ?, 'platform_user.reset_password', NULL, '{}',
         'platform_user', 'cli', 'admin', ?, '2030-01-01T00:00:00.000Z')`,
    );
    for (let i = 0; i < 5; i += 1) insert.run(crypto.randomUUID(), adminUser.id, adminUser.id);
    sqlite.close();

    const full = await fetchAudit(admin, "?limit=100");
    expect(full.body.nextCursor).toBeNull();
    const expectedIds = full.body.entries.map((e) => e.id);
    expect(new Set(expectedIds).size).toBe(expectedIds.length);
    expect(expectedIds.length).toBeGreaterThanOrEqual(10);

    for (const pageSize of [1, 2, 3]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = `?limit=${pageSize}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const page = await fetchAudit(admin, query);
        expect(page.status).toBe(200);
        expect(page.body.entries.length).toBeLessThanOrEqual(pageSize);
        seen.push(...page.body.entries.map((e) => e.id));
        cursor = page.body.nextCursor;
        pages += 1;
        expect(pages).toBeLessThan(200);
      } while (cursor);
      expect(seen, `pageSize=${pageSize}`).toEqual(expectedIds);
    }
  });

  it("sayfalar arasında yeni kayıt gelse de önceki sayfadaki satırlar tekrarlanmaz", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    await seedThroughRoutes(admin);

    const firstPage = await fetchAudit(admin, "?limit=2");
    expect(firstPage.body.nextCursor).not.toBeNull();

    const createResponse = await postBusiness(
      writeRequest(
        admin,
        "POST",
        { requestId: `late-${crypto.randomUUID()}`, name: "Geç Gelen", owner: { fullName: "Geç Gelen Sahip" } },
        `${API}/admin/businesses`,
      ),
    );
    expect(createResponse.status).toBe(201);
    const lateBusinessId = (await createResponse.json()).business.id as string;

    const secondPage = await fetchAudit(admin, `?limit=2&cursor=${encodeURIComponent(firstPage.body.nextCursor!)}`);
    const firstIds = new Set(firstPage.body.entries.map((e) => e.id));
    for (const entry of secondPage.body.entries) {
      expect(firstIds.has(entry.id)).toBe(false);
      // Yeni satır en yenidir; imlecin gerisinde kaldığı için ikinci sayfada çıkmaz.
      expect(entry.entityId).not.toBe(lateBusinessId);
    }
  });
});
