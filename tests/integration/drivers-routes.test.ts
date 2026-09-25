/**
 * GET/POST /api/v1/drivers, PATCH /api/v1/drivers/[personId] ve
 * PUT /api/v1/vehicles/[vehicleId]/drivers/[personId] — T2.4.
 *
 * Gerçek geçici SQLite dosyası + gerçek migration + seed
 * (mock/`:memory:` YOK). Kapsam: şoför oturumu yalnız seçilebilir listeyi
 * görür (sahipsiz, yalnız aktif kişi + aktif atama) ve yazmada 403 alır;
 * sahip POST tek `people` + tek `vehicle_drivers` + audit + makbuz yazar,
 * replay ikinci satır üretmez; PUT mükerrer satır üretmez, bayat sürüm 409;
 * sahip PATCH `active` 403, ekip `active` yalnız `people.active`'i değiştirir;
 * yeniden adlandırma `people.id`'yi korur, sürümü artırır, gerçek aktörle audit
 * yazar; başka işletme kişisi 404, sahip kişi PUT'ta 422.
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
import { GET as getDrivers, POST as postDriver } from "../../src/app/api/v1/drivers/route";
import { PATCH as patchPerson } from "../../src/app/api/v1/drivers/[personId]/route";
import { PUT as putAssignment } from "../../src/app/api/v1/vehicles/[vehicleId]/drivers/[personId]/route";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const DRIVERS_URL = "https://example.invalid/api/v1/drivers";

interface Session {
  token: string;
  csrfToken: string;
}

function readSession(response: Response, body: { csrfToken: string }): Session {
  const match = /dolmus_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "");
  return { token: decodeURIComponent(match![1]!), csrfToken: body.csrfToken };
}

async function loginPlatform(username: string, password: string): Promise<Session> {
  const response = await platformLoginRoute(
    new Request("https://example.invalid/api/v1/auth/platform-login", {
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
    new Request("https://example.invalid/api/v1/auth/vehicle-login", {
      method: "POST",
      headers: { origin: SELF_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ plate, password }),
    }),
  );
  expect(response.status).toBe(201);
  return readSession(response, await response.json());
}

function getRequest(session: Session, url = DRIVERS_URL, targetVehicle?: string): Request {
  return new Request(url, {
    headers: {
      cookie: `dolmus_session=${session.token}`,
      ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
    },
  });
}

function writeRequest(
  session: Session,
  method: string,
  body: unknown,
  url = DRIVERS_URL,
  targetVehicle?: string,
): Request {
  return new Request(url, {
    method,
    headers: {
      cookie: `dolmus_session=${session.token}`,
      origin: SELF_ORIGIN,
      "x-csrf-token": session.csrfToken,
      "content-type": "application/json",
      ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
    },
    body: JSON.stringify(body),
  });
}

let requestCounter = 0;
function rid(): string {
  requestCounter += 1;
  return `req-${requestCounter}`;
}

function personUrl(personId: string): string {
  return `${DRIVERS_URL}/${personId}`;
}

function patch(
  session: Session,
  personId: string,
  body: Record<string, unknown>,
  targetVehicle?: string,
): Promise<Response> {
  return patchPerson(
    writeRequest(session, "PATCH", { requestId: rid(), ...body }, personUrl(personId), targetVehicle),
    { params: Promise.resolve({ personId }) },
  );
}

function put(
  session: Session,
  vehicleId: string,
  personId: string,
  body: Record<string, unknown>,
  targetVehicle?: string,
): Promise<Response> {
  return putAssignment(
    writeRequest(
      session,
      "PUT",
      { requestId: rid(), ...body },
      `https://example.invalid/api/v1/vehicles/${vehicleId}/drivers/${personId}`,
      targetVehicle,
    ),
    { params: Promise.resolve({ vehicleId, personId }) },
  );
}

interface AssignmentRow {
  active: number;
  version: number;
}

describe("drivers routes (T2.4)", () => {
  let dir: string;
  let dbPath: string;
  let owner: Session;
  let driver: Session;
  let admin: Session;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  function rawDb(): SqliteConnection {
    return openDatabaseConnection(dbPath);
  }

  function withRaw<T>(fn: (sqlite: SqliteConnection) => T): T {
    const sqlite = rawDb();
    try {
      return fn(sqlite);
    } finally {
      sqlite.close();
    }
  }

  function count(sql: string, ...args: unknown[]): number {
    return withRaw((sqlite) => (sqlite.prepare(sql).get(...args) as { c: number }).c);
  }

  function assignment(vehicleId: string, personId: string): AssignmentRow | undefined {
    return withRaw(
      (sqlite) =>
        sqlite
          .prepare("SELECT active, version FROM vehicle_drivers WHERE vehicle_id = ? AND person_id = ?")
          .get(vehicleId, personId) as AssignmentRow | undefined,
    );
  }

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-drivers-"));
    dbPath = path.join(dir, "test.sqlite");
    const setupSqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    migrate(createDb(setupSqlite), { migrationsFolder });
    await seedDevData(setupSqlite);
    setupSqlite.close();
    process.env.DOLMUS_DB_PATH = dbPath;
    resetAppDbForTests();

    owner = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner);
    driver = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver);
    admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
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
  // GET — görünüm izinle belirlenir.
  // -------------------------------------------------------------------

  describe("GET /drivers", () => {
    it("şoför oturumu yalnız aktif kişi + aktif atama satırlarını görür; sahip ve pasif atama yok, alanlar yalnız personId/fullName", async () => {
      const response = await getDrivers(getRequest(driver));
      expect(response.status).toBe(200);
      const body = await response.json();
      const ids = body.drivers.map((d: { personId: string }) => d.personId).sort();
      expect(ids).toEqual([SEED_IDS.driverA1a, SEED_IDS.driverA1b, SEED_IDS.driverA1c].sort());
      expect(body.drivers.every((d: object) => Object.keys(d).sort().join() === "fullName,personId")).toBe(true);
      expect(ids).not.toContain(SEED_IDS.ownerA);
      expect(ids).not.toContain(SEED_IDS.driverA1d);
      expect(body.candidates).toBeUndefined();
    });

    it("sorgu parametresi şoförün görünümünü GENİŞLETMEZ", async () => {
      const response = await getDrivers(getRequest(driver, `${DRIVERS_URL}?include=inactive&all=1&active=false`));
      const body = await response.json();
      expect(body.drivers).toHaveLength(3);
      expect(body.candidates).toBeUndefined();
    });

    it("sahibin araç satırı (vehicle_drivers'a yanlışlıkla yazılsa bile) ve küresel pasif kişi seçilebilir listede yer almaz", async () => {
      withRaw((sqlite) => {
        sqlite
          .prepare("INSERT INTO vehicle_drivers (business_id, vehicle_id, person_id, active, version) VALUES (?, ?, ?, 1, 1)")
          .run(SEED_IDS.businessA, SEED_IDS.vehicleA1, SEED_IDS.ownerA);
      });
      const deactivate = await patch(admin, SEED_IDS.driverA1a, { version: 1, active: false }, SEED_IDS.vehicleA1);
      expect(deactivate.status).toBe(200);

      const body = await (await getDrivers(getRequest(driver))).json();
      const ids = body.drivers.map((d: { personId: string }) => d.personId);
      expect(ids).not.toContain(SEED_IDS.ownerA);
      expect(ids).not.toContain(SEED_IDS.driverA1a);
      expect(ids).toHaveLength(2);

      const managed = await (await getDrivers(getRequest(owner))).json();
      expect(managed.drivers.map((d: { personId: string }) => d.personId)).not.toContain(SEED_IDS.ownerA);
    });

    it("sahip oturumu yönetim görünümü alır: pasif atamalar dahil + atanabilir adaylar (sahip ve başka işletme hariç)", async () => {
      const response = await getDrivers(getRequest(owner));
      expect(response.status).toBe(200);
      const body = await response.json();
      const byId = new Map<string, { assignment: { active: boolean; version: number } | null; personVersion: number }>(
        body.drivers.map((d: { personId: string }) => [d.personId, d]),
      );
      expect(byId.get(SEED_IDS.driverA1d)?.assignment).toEqual({ active: false, version: 1 });
      expect(byId.get(SEED_IDS.driverA1c)?.personVersion).toBe(2);
      expect(byId.has(SEED_IDS.ownerA)).toBe(false);
      const candidateIds = body.candidates.map((c: { personId: string }) => c.personId);
      expect(candidateIds).toEqual([SEED_IDS.driverA2a]);
    });

    it("ekip hedef araç header'ıyla yönetim görünümü alır; header yoksa 422", async () => {
      const ok = await getDrivers(getRequest(admin, DRIVERS_URL, SEED_IDS.vehicleA1));
      expect(ok.status).toBe(200);
      expect((await ok.json()).drivers).toHaveLength(4);

      const missing = await getDrivers(getRequest(admin));
      expect(missing.status).toBe(422);
      expect((await missing.json()).error.code).toBe("TARGET_VEHICLE_MISSING");
    });
  });

  // -------------------------------------------------------------------
  // Şoför oturumu yazamaz.
  // -------------------------------------------------------------------

  it("şoför oturumu POST/PATCH/PUT'ta 403 alır ve hiçbir satır değişmez", async () => {
    const before = count("SELECT COUNT(*) c FROM people");
    const post = await postDriver(writeRequest(driver, "POST", { requestId: rid(), fullName: "Yeni Kişi" }));
    expect(post.status).toBe(403);
    const patched = await patch(driver, SEED_IDS.driverA1a, { version: 1, fullName: "Başka Ad" });
    expect(patched.status).toBe(403);
    const putRes = await put(driver, SEED_IDS.vehicleA1, SEED_IDS.driverA1d, { active: true, version: 1 });
    expect(putRes.status).toBe(403);
    expect(count("SELECT COUNT(*) c FROM people")).toBe(before);
    expect(count("SELECT COUNT(*) c FROM people WHERE full_name = 'Başka Ad'")).toBe(0);
    expect(assignment(SEED_IDS.vehicleA1, SEED_IDS.driverA1d)).toEqual({ active: 0, version: 1 });
  });

  // -------------------------------------------------------------------
  // POST
  // -------------------------------------------------------------------

  describe("POST /drivers", () => {
    it("sahip: tek people + tek vehicle_drivers + 2 audit + makbuz yazar; ad normalize edilir; aktör vehicle_credential", async () => {
      const peopleBefore = count("SELECT COUNT(*) c FROM people");
      const requestId = rid();
      const response = await postDriver(writeRequest(owner, "POST", { requestId, fullName: "  Ayşe   Nur  Kılıç " }));
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.driver.fullName).toBe("Ayşe Nur Kılıç");
      expect(body.driver.personVersion).toBe(1);
      expect(body.driver.assignment).toEqual({ active: true, version: 1 });
      const personId = body.driver.personId as string;

      expect(count("SELECT COUNT(*) c FROM people")).toBe(peopleBefore + 1);
      expect(count("SELECT COUNT(*) c FROM vehicle_drivers WHERE person_id = ?", personId)).toBe(1);
      expect(count("SELECT COUNT(*) c FROM mutation_receipts WHERE request_id = ?", requestId)).toBe(1);

      const audits = withRaw(
        (sqlite) =>
          sqlite
            .prepare(
              "SELECT action, entity_type, business_id, vehicle_id, actor_kind, actor_role, actor_credential_id, actor_platform_user_id, on_behalf_of_kind, on_behalf_of_person_id, before_json, after_json FROM admin_audit WHERE entity_id = ? ORDER BY action",
            )
            .all(personId) as Record<string, string | null>[],
      );
      expect(audits.map((a) => a.action)).toEqual(["person.create", "vehicle_driver.create"]);
      for (const audit of audits) {
        expect(audit.business_id).toBe(SEED_IDS.businessA);
        expect(audit.vehicle_id).toBe(SEED_IDS.vehicleA1);
        expect(audit.actor_kind).toBe("vehicle_credential");
        expect(audit.actor_role).toBe("owner");
        expect(audit.actor_credential_id).toBe(SEED_IDS.credA1Owner);
        expect(audit.actor_platform_user_id).toBeNull();
        expect(audit.on_behalf_of_kind).toBeNull();
        expect(audit.on_behalf_of_person_id).toBeNull();
        expect(audit.before_json).toBeNull();
      }
      expect(JSON.parse(audits[0]!.after_json!)).toEqual({ fullName: "Ayşe Nur Kılıç", active: true, version: 1 });
    });

    it("aynı requestId + aynı gövde replay: aynı personId, ikinci satır yok; farklı ad → 409 REQUEST_ID_REUSED", async () => {
      const requestId = rid();
      const first = await postDriver(writeRequest(owner, "POST", { requestId, fullName: "Tekrar Kişi" }));
      const second = await postDriver(writeRequest(owner, "POST", { requestId, fullName: "Tekrar Kişi" }));
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstId = (await first.json()).driver.personId;
      expect((await second.json()).driver.personId).toBe(firstId);
      expect(count("SELECT COUNT(*) c FROM people WHERE full_name = 'Tekrar Kişi'")).toBe(1);
      expect(count("SELECT COUNT(*) c FROM vehicle_drivers WHERE person_id = ?", firstId)).toBe(1);
      expect(count("SELECT COUNT(*) c FROM admin_audit WHERE entity_id = ?", firstId)).toBe(2);

      const reused = await postDriver(writeRequest(owner, "POST", { requestId, fullName: "Başka Kişi" }));
      expect(reused.status).toBe(409);
      expect((await reused.json()).error.code).toBe("REQUEST_ID_REUSED");
    });

    it("ekip: platform_user aktörü + on_behalf_of = aracın sahibi", async () => {
      const response = await postDriver(
        writeRequest(admin, "POST", { requestId: rid(), fullName: "Ekip Ekledi" }, DRIVERS_URL, SEED_IDS.vehicleA1),
      );
      expect(response.status).toBe(201);
      const personId = (await response.json()).driver.personId as string;
      const audit = withRaw(
        (sqlite) =>
          sqlite
            .prepare(
              "SELECT actor_kind, actor_role, actor_platform_user_id, on_behalf_of_kind, on_behalf_of_person_id FROM admin_audit WHERE entity_id = ? AND action = 'person.create'",
            )
            .get(personId) as Record<string, string | null>,
      );
      expect(audit.actor_kind).toBe("platform_user");
      expect(audit.actor_role).toBe("admin");
      expect(audit.actor_platform_user_id).not.toBeNull();
      expect(audit.on_behalf_of_kind).toBe("owner");
      expect(audit.on_behalf_of_person_id).toBe(SEED_IDS.ownerA);
    });

    it("geçersiz gövde: boş/çok uzun ad, requestId yok, bozuk JSON → 422 ve satır yazılmaz", async () => {
      const before = count("SELECT COUNT(*) c FROM people");
      const empty = await postDriver(writeRequest(owner, "POST", { requestId: rid(), fullName: "   " }));
      expect(empty.status).toBe(422);
      expect((await empty.json()).error.fields.fullName).toBeTypeOf("string");
      const tooLong = await postDriver(writeRequest(owner, "POST", { requestId: rid(), fullName: "A".repeat(121) }));
      expect(tooLong.status).toBe(422);
      const noRequestId = await postDriver(writeRequest(owner, "POST", { fullName: "Ad Soyad" }));
      expect(noRequestId.status).toBe(422);
      const badJson = await postDriver(
        new Request(DRIVERS_URL, {
          method: "POST",
          headers: {
            cookie: `dolmus_session=${owner.token}`,
            origin: SELF_ORIGIN,
            "x-csrf-token": owner.csrfToken,
            "content-type": "application/json",
          },
          body: "{bozuk",
        }),
      );
      expect(badJson.status).toBe(422);
      expect(count("SELECT COUNT(*) c FROM people")).toBe(before);
    });
  });

  // -------------------------------------------------------------------
  // PUT
  // -------------------------------------------------------------------

  describe("PUT /vehicles/:vehicleId/drivers/:personId", () => {
    it("var olan pasif atamayı AYNI satırda açar (mükerrer yok), sonra yalnız bu aracın satırını kapatır; şoför oturumu iptal edilmez", async () => {
      const reopen = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA1d, { active: true, version: 1 });
      expect(reopen.status).toBe(200);
      expect((await reopen.json()).driver.assignment).toEqual({ active: true, version: 2 });
      expect(count("SELECT COUNT(*) c FROM vehicle_drivers WHERE person_id = ?", SEED_IDS.driverA1d)).toBe(1);

      const close = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA1a, { active: false, version: 1 });
      expect(close.status).toBe(200);
      expect(assignment(SEED_IDS.vehicleA1, SEED_IDS.driverA1a)).toEqual({ active: 0, version: 2 });
      expect(assignment(SEED_IDS.vehicleA1, SEED_IDS.driverA1b)).toEqual({ active: 1, version: 1 });
      expect(assignment(SEED_IDS.vehicleA2, SEED_IDS.driverA2a)).toEqual({ active: 1, version: 1 });

      const actions = withRaw(
        (sqlite) =>
          (
            sqlite
              .prepare("SELECT action FROM admin_audit WHERE entity_type = 'vehicle_driver' ORDER BY occurred_at, action")
              .all() as { action: string }[]
          ).map((r) => r.action),
      );
      expect(actions).toEqual(expect.arrayContaining(["vehicle_driver.activate", "vehicle_driver.deactivate"]));

      // Ortak şoför şifresi (F3): şoför oturumu hâlâ geçerli.
      expect((await getDrivers(getRequest(driver))).status).toBe(200);
    });

    it("bayat veya eksik version → 409 VERSION_CONFLICT (kanonik metin), satır değişmez", async () => {
      const stale = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA1d, { active: true, version: 5 });
      expect(stale.status).toBe(409);
      const staleBody = await stale.json();
      expect(staleBody.error.code).toBe("VERSION_CONFLICT");
      expect(staleBody.error.message).toBe("Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.");
      const missing = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA1d, { active: true });
      expect(missing.status).toBe(409);
      expect(assignment(SEED_IDS.vehicleA1, SEED_IDS.driverA1d)).toEqual({ active: 0, version: 1 });
    });

    it("aynı değerle PUT → 422 fields.change, sürüm artmaz", async () => {
      const response = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA1a, { active: true, version: 1 });
      expect(response.status).toBe(422);
      expect((await response.json()).error.fields.change).toBeTypeOf("string");
      expect(assignment(SEED_IDS.vehicleA1, SEED_IDS.driverA1a)).toEqual({ active: 1, version: 1 });
    });

    it("aynı işletmedeki başka araç kişisini bağlar (201); tekrar bağlama 409, satır tekil; iki paralel bağlamadan biri 201 diğeri 409", async () => {
      const [a, b] = await Promise.all([
        put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA2a, { active: true }),
        put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA2a, { active: true }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(count("SELECT COUNT(*) c FROM vehicle_drivers WHERE person_id = ?", SEED_IDS.driverA2a)).toBe(2);
      expect(assignment(SEED_IDS.vehicleA1, SEED_IDS.driverA2a)).toEqual({ active: 1, version: 1 });
      // Kişinin A2 ataması etkilenmez.
      expect(assignment(SEED_IDS.vehicleA2, SEED_IDS.driverA2a)).toEqual({ active: 1, version: 1 });
    });

    it("replay: aynı requestId + aynı gövde ikinci yazım yapmaz", async () => {
      const requestId = rid();
      const first = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA2a, { requestId, active: true });
      const second = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA2a, { requestId, active: true });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(count("SELECT COUNT(*) c FROM admin_audit WHERE entity_id = ? AND action = 'vehicle_driver.create'", SEED_IDS.driverA2a)).toBe(1);
    });

    it("satır yokken active:false → 422; satır yokken version göndermek → 409", async () => {
      const close = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA2a, { active: false });
      expect(close.status).toBe(422);
      const withVersion = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA2a, { active: true, version: 1 });
      expect(withVersion.status).toBe(409);
      expect(assignment(SEED_IDS.vehicleA1, SEED_IDS.driverA2a)).toBeUndefined();
    });

    it("başka işletmenin kişisi ve olmayan kişi 404; URL'deki başka araç 404", async () => {
      const otherBusiness = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverB1a, { active: true });
      expect(otherBusiness.status).toBe(404);
      expect(assignment(SEED_IDS.vehicleA1, SEED_IDS.driverB1a)).toBeUndefined();
      const unknown = await put(owner, SEED_IDS.vehicleA1, "00000000-0000-4000-8000-000000000000", { active: true });
      expect(unknown.status).toBe(404);
      const otherVehicle = await put(owner, SEED_IDS.vehicleA2, SEED_IDS.driverA2a, { active: false, version: 1 });
      expect(otherVehicle.status).toBe(404);
      expect(assignment(SEED_IDS.vehicleA2, SEED_IDS.driverA2a)).toEqual({ active: 1, version: 1 });
    });

    it("araç sahibi kişisini atamak 422; hiçbir satır yazılmaz", async () => {
      const before = count("SELECT COUNT(*) c FROM vehicle_drivers");
      const response = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.ownerA, { active: true });
      expect(response.status).toBe(422);
      expect((await response.json()).error.fields.personId).toBeTypeOf("string");
      expect(count("SELECT COUNT(*) c FROM vehicle_drivers")).toBe(before);
    });

    it("küresel pasif kişiye bağlama/atama açma 422; kapatma serbest", async () => {
      // driverA2a pasifleştirilir (ekip), sonra A1'e bağlanmaya çalışılır.
      const off = await patch(admin, SEED_IDS.driverA2a, { version: 1, active: false }, SEED_IDS.vehicleA2);
      expect(off.status).toBe(200);
      const link = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA2a, { active: true });
      expect(link.status).toBe(422);
      expect(assignment(SEED_IDS.vehicleA1, SEED_IDS.driverA2a)).toBeUndefined();

      // Pasif kişi + kapalı atama → açma 422.
      const offA1d = await patch(admin, SEED_IDS.driverA1d, { version: 1, active: false }, SEED_IDS.vehicleA1);
      expect(offA1d.status).toBe(200);
      const reopen = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA1d, { active: true, version: 1 });
      expect(reopen.status).toBe(422);
      // Pasif kişide aktif atama kapatılabilir.
      const close = await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA1a, { active: false, version: 1 });
      expect(close.status).toBe(200);
    });

    it("ekip: hedef araç header'ı ile PUT; on_behalf_of = araç sahibi; header/URL uyuşmazlığı 404", async () => {
      const ok = await put(admin, SEED_IDS.vehicleA1, SEED_IDS.driverA1d, { active: true, version: 1 }, SEED_IDS.vehicleA1);
      expect(ok.status).toBe(200);
      const audit = withRaw(
        (sqlite) =>
          sqlite
            .prepare("SELECT actor_kind, on_behalf_of_kind, on_behalf_of_person_id FROM admin_audit WHERE action = 'vehicle_driver.activate'")
            .get() as Record<string, string>,
      );
      expect(audit).toEqual({
        actor_kind: "platform_user",
        on_behalf_of_kind: "owner",
        on_behalf_of_person_id: SEED_IDS.ownerA,
      });
      const mismatch = await put(admin, SEED_IDS.vehicleA2, SEED_IDS.driverA2a, { active: false, version: 1 }, SEED_IDS.vehicleA1);
      expect(mismatch.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // PATCH
  // -------------------------------------------------------------------

  describe("PATCH /drivers/:personId", () => {
    it("sahip yeniden adlandırır: people.id korunur, version artar, audit before/after adı + gerçek aktör taşır", async () => {
      const response = await patch(owner, SEED_IDS.driverA1a, { version: 1, fullName: "  Mehmet   Öztürk " });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.driver.personId).toBe(SEED_IDS.driverA1a);
      expect(body.driver.fullName).toBe("Mehmet Öztürk");
      expect(body.driver.personVersion).toBe(2);
      expect(body.affectedVehicles).toBeUndefined();

      const person = withRaw(
        (sqlite) =>
          sqlite.prepare("SELECT id, full_name, version FROM people WHERE id = ?").get(SEED_IDS.driverA1a) as Record<string, unknown>,
      );
      expect(person).toEqual({ id: SEED_IDS.driverA1a, full_name: "Mehmet Öztürk", version: 2 });
      expect(count("SELECT COUNT(*) c FROM people")).toBe(11);

      const audit = withRaw(
        (sqlite) =>
          sqlite
            .prepare(
              "SELECT vehicle_id, actor_kind, actor_role, actor_credential_id, on_behalf_of_kind, before_json, after_json FROM admin_audit WHERE entity_id = ? AND action = 'person.rename'",
            )
            .get(SEED_IDS.driverA1a) as Record<string, string | null>,
      );
      expect(audit.vehicle_id).toBe(SEED_IDS.vehicleA1);
      expect(audit.actor_kind).toBe("vehicle_credential");
      expect(audit.actor_role).toBe("owner");
      expect(audit.actor_credential_id).toBe(SEED_IDS.credA1Owner);
      expect(audit.on_behalf_of_kind).toBeNull();
      expect(JSON.parse(audit.before_json!)).toEqual({ fullName: "Mehmet Öz", version: 1 });
      expect(JSON.parse(audit.after_json!)).toEqual({ fullName: "Mehmet Öztürk", version: 2 });
    });

    it("sahip active gönderirse 403 (rename ile birlikte de); kayıt değişmez", async () => {
      const onlyActive = await patch(owner, SEED_IDS.driverA1a, { version: 1, active: false });
      expect(onlyActive.status).toBe(403);
      const both = await patch(owner, SEED_IDS.driverA1a, { version: 1, active: false, fullName: "Yeni Ad" });
      expect(both.status).toBe(403);
      expect(count("SELECT COUNT(*) c FROM people WHERE id = ? AND active = 1 AND version = 1 AND full_name = 'Mehmet Öz'", SEED_IDS.driverA1a)).toBe(1);
    });

    it("bayat version → 409; aynı ad → 422 fields.change (sürüm artmaz, audit yok)", async () => {
      const stale = await patch(owner, SEED_IDS.driverA1a, { version: 9, fullName: "Yeni Ad" });
      expect(stale.status).toBe(409);
      expect((await stale.json()).error.code).toBe("VERSION_CONFLICT");
      const same = await patch(owner, SEED_IDS.driverA1a, { version: 1, fullName: "Mehmet Öz" });
      expect(same.status).toBe(422);
      expect((await same.json()).error.fields.change).toBeTypeOf("string");
      expect(count("SELECT COUNT(*) c FROM people WHERE id = ? AND version = 1", SEED_IDS.driverA1a)).toBe(1);
      expect(count("SELECT COUNT(*) c FROM admin_audit WHERE entity_id = ?", SEED_IDS.driverA1a)).toBe(0);
    });

    it("sahip: başka işletme kişisi, araca bağlı olmayan kişi ve sahip kişi 404", async () => {
      expect((await patch(owner, SEED_IDS.driverB1a, { version: 1, fullName: "Sızıntı" })).status).toBe(404);
      expect((await patch(owner, SEED_IDS.driverA2a, { version: 1, fullName: "Bağsız" })).status).toBe(404);
      expect((await patch(owner, SEED_IDS.ownerA, { version: 1, fullName: "Sahip Adı" })).status).toBe(404);
      expect(count("SELECT COUNT(*) c FROM people WHERE full_name IN ('Sızıntı','Bağsız','Sahip Adı')")).toBe(0);
    });

    it("ekip active:false yalnız people.active'i değiştirir, vehicle_drivers satırlarına dokunmaz ve etkilenen araçları döner; aktör on_behalf_of'suz", async () => {
      // Kişiyi ikinci araca da bağla ki iki araç etkilensin.
      await put(owner, SEED_IDS.vehicleA1, SEED_IDS.driverA2a, { active: true });
      const driversBefore = withRaw((sqlite) => sqlite.prepare("SELECT * FROM vehicle_drivers ORDER BY person_id, vehicle_id").all());

      const response = await patch(admin, SEED_IDS.driverA2a, { version: 1, active: false }, SEED_IDS.vehicleA1);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.driver.personActive).toBe(false);
      expect(body.driver.personVersion).toBe(2);
      expect(body.driver.fullName).toBe("Zeynep Arslan");
      expect(body.affectedVehicles.map((v: { vehicleId: string }) => v.vehicleId).sort()).toEqual(
        [SEED_IDS.vehicleA1, SEED_IDS.vehicleA2].sort(),
      );
      expect(withRaw((sqlite) => sqlite.prepare("SELECT * FROM vehicle_drivers ORDER BY person_id, vehicle_id").all())).toEqual(driversBefore);

      const audit = withRaw(
        (sqlite) =>
          sqlite
            .prepare(
              "SELECT vehicle_id, actor_kind, actor_role, actor_platform_user_id, on_behalf_of_kind, on_behalf_of_person_id FROM admin_audit WHERE action = 'person.deactivate'",
            )
            .get() as Record<string, string | null>,
      );
      expect(audit.actor_kind).toBe("platform_user");
      expect(audit.actor_role).toBe("admin");
      expect(audit.actor_platform_user_id).not.toBeNull();
      expect(audit.on_behalf_of_kind).toBeNull();
      expect(audit.on_behalf_of_person_id).toBeNull();

      // Yeniden aktifleştirme: yalnız people.active geri gelir.
      const back = await patch(admin, SEED_IDS.driverA2a, { version: 2, active: true }, SEED_IDS.vehicleA1);
      expect(back.status).toBe(200);
      expect(count("SELECT COUNT(*) c FROM admin_audit WHERE action = 'person.reactivate'")).toBe(1);
      expect(withRaw((sqlite) => sqlite.prepare("SELECT * FROM vehicle_drivers ORDER BY person_id, vehicle_id").all())).toEqual(driversBefore);
    });

    it("ekip yeniden adlandırma: on_behalf_of = aracın sahibi; hedef araç header'ı zorunlu", async () => {
      const noHeader = await patch(admin, SEED_IDS.driverA1a, { version: 1, fullName: "Ekip Adı" });
      expect(noHeader.status).toBe(422);

      const response = await patch(admin, SEED_IDS.driverA1a, { version: 1, fullName: "Ekip Adı" }, SEED_IDS.vehicleA1);
      expect(response.status).toBe(200);
      const audit = withRaw(
        (sqlite) =>
          sqlite
            .prepare("SELECT on_behalf_of_kind, on_behalf_of_person_id FROM admin_audit WHERE action = 'person.rename'")
            .get() as Record<string, string>,
      );
      expect(audit).toEqual({ on_behalf_of_kind: "owner", on_behalf_of_person_id: SEED_IDS.ownerA });
    });

    it("ekip: başka işletmenin kişisi ve sahip kişi 404; değişiklik alanı olmayan gövde 422", async () => {
      expect((await patch(admin, SEED_IDS.driverB1a, { version: 1, active: false }, SEED_IDS.vehicleA1)).status).toBe(404);
      expect((await patch(admin, SEED_IDS.ownerA, { version: 1, fullName: "Sahip" }, SEED_IDS.vehicleA1)).status).toBe(404);
      const noChangeFields = await patch(admin, SEED_IDS.driverA1a, { version: 1 }, SEED_IDS.vehicleA1);
      expect(noChangeFields.status).toBe(422);
    });
  });
});
