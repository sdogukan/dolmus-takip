/**
 * GET /api/v1/work-entries/:id/history — kayıt geçmişi. Gerçek geçici SQLite
 * dosyası + gerçek migration + seed. Kapsam: sürüm sırası ve değişiklik listesi,
 * onayların ayrı satırları ve tek `current`, yetki/kapsam (aynı 404), aktör
 * biçimi, gizli veri yokluğu, pasifleşmeden bağımsızlık, eski/eksik anlık görüntü.
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
import { istanbulToday } from "../../src/lib/work-time";
import { POST as platformLoginRoute } from "../../src/app/api/v1/auth/platform-login/route";
import { POST as vehicleLoginRoute } from "../../src/app/api/v1/auth/vehicle-login/route";
import { POST as postWorkEntry } from "../../src/app/api/v1/work-entries/route";
import { PATCH as patchWorkEntry } from "../../src/app/api/v1/work-entries/[id]/route";
import { POST as confirmWorkEntryRoute } from "../../src/app/api/v1/work-entries/[id]/confirm/route";
import { POST as correctAndConfirmRoute } from "../../src/app/api/v1/work-entries/[id]/correct-and-confirm/route";
import { GET as historyRoute } from "../../src/app/api/v1/work-entries/[id]/history/route";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const URL_WORK_ENTRIES = "https://example.invalid/api/v1/work-entries";

interface Session {
  token: string;
  csrfToken: string;
}

function readSession(response: Response, body: { csrfToken: string }): Session {
  const match = /dolmus_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "");
  return { token: decodeURIComponent(match![1]!), csrfToken: body.csrfToken };
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

const writeHeaders = (session: Session, targetVehicle?: string) => ({
  cookie: `dolmus_session=${session.token}`,
  origin: SELF_ORIGIN,
  "x-csrf-token": session.csrfToken,
  "content-type": "application/json",
  ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
});

const post = (session: Session, body: unknown, targetVehicle?: string): Promise<Response> =>
  postWorkEntry(new Request(URL_WORK_ENTRIES, { method: "POST", headers: writeHeaders(session, targetVehicle), body: JSON.stringify(body) }));

const patch = (session: Session, id: string, body: unknown): Promise<Response> =>
  patchWorkEntry(
    new Request(`${URL_WORK_ENTRIES}/${id}`, { method: "PATCH", headers: writeHeaders(session), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

const confirm = (session: Session, id: string, body: unknown): Promise<Response> =>
  confirmWorkEntryRoute(
    new Request(`${URL_WORK_ENTRIES}/${id}/confirm`, { method: "POST", headers: writeHeaders(session), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

const correct = (session: Session, id: string, body: unknown, targetVehicle?: string): Promise<Response> =>
  correctAndConfirmRoute(
    new Request(`${URL_WORK_ENTRIES}/${id}/correct-and-confirm`, { method: "POST", headers: writeHeaders(session, targetVehicle), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

const history = (session: Session | undefined, id: string, targetVehicle?: string, query = ""): Promise<Response> =>
  historyRoute(
    new Request(`${URL_WORK_ENTRIES}/${id}/history${query}`, {
      headers: {
        ...(session ? { cookie: `dolmus_session=${session.token}` } : {}),
        ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
      },
    }),
    { params: Promise.resolve({ id }) },
  );

const TODAY = istanbulToday();
const daily = (extra: Record<string, unknown> = {}) => ({
  date: TODAY,
  startTime: "08:00",
  endTime: "17:30",
  endsNextDay: false,
  grossCents: "1000000",
  fuelCents: "150000",
  otherExpenseCents: "30000",
  otherExpenseNote: "otopark",
  ...extra,
});
const createDriver = (requestId: string) => ({ requestId, workType: "driver", workerPersonId: SEED_IDS.driverA1a, ...daily() });

describe("kayıt geçmişi (GET /work-entries/:id/history)", () => {
  let dir: string;
  let dbPath: string;
  let owner: Session;
  let driver: Session;
  let admin: Session;
  let support: Session;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  function withRaw<T>(fn: (sqlite: SqliteConnection) => T): T {
    const sqlite = openDatabaseConnection(dbPath);
    try {
      return fn(sqlite);
    } finally {
      sqlite.close();
    }
  }
  const raw = (sql: string, ...args: unknown[]) => withRaw((sqlite) => sqlite.prepare(sql).all(...args)) as Record<string, unknown>[];
  const errorOf = async (response: Response) => (await response.json()).error as { code: string; message: string };

  /** v1 create (şoför) → v2 confirm 6.000 (sahip) → v3 correct-and-confirm 6.100 (ekip, kişi+hasılat değişir). */
  async function seedFullHistory(admin_ = admin): Promise<string> {
    const created = await post(driver, createDriver("h-1"));
    expect(created.status).toBe(201);
    const id = (await created.json()).workEntry.id as string;
    expect((await confirm(owner, id, { requestId: "h-2", version: 1, receivedCents: "600000" })).status).toBe(200);
    const corrected = await correct(
      admin_,
      id,
      { requestId: "h-3", version: 2, ...daily({ grossCents: "800000" }), workerPersonId: SEED_IDS.driverA1b, receivedCents: "610000" },
      SEED_IDS.vehicleA1,
    );
    expect(corrected.status).toBe(200);
    return id;
  }

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-work-entries-history-"));
    dbPath = path.join(dir, "test.sqlite");
    const setup = openDatabaseConnection(dbPath, { createIfMissing: true });
    migrate(createDb(setup), { migrationsFolder });
    await seedDevData(setup);
    setup.close();
    process.env.DOLMUS_DB_PATH = dbPath;
    resetAppDbForTests();

    owner = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner);
    driver = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver);
    admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    support = await loginPlatform(SEED_USERNAMES.support, SEED_TEST_PASSWORDS.support);
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

  describe("içerik", () => {
    it("sahip: revizyonlar sürüm sırasıyla; v1 create değişiklik listesiz; sonrakiler yalnız değişen alanlarla", async () => {
      const id = await seedFullHistory();
      const response = await history(owner, id);
      expect(response.status).toBe(200);
      const { history: h } = await response.json();

      expect(h.entry).toEqual({ id, version: 3, status: "confirmed", workKind: "driver" });
      expect(h.revisions.map((r: { version: number; action: string }) => [r.version, r.action])).toEqual([
        [1, "create"],
        [2, "confirm"],
        [3, "correct_and_confirm"],
      ]);
      expect(h.revisions[0].changes).toEqual([]);
      expect(h.revisions[0].values).toMatchObject({ grossCents: "1000000", status: "pending", person: { id: SEED_IDS.driverA1a } });
      expect(h.revisions[0].values).not.toHaveProperty("receivedCents");
      // confirm: yalnız alınan tutar belirir.
      expect(h.revisions[1].changes).toEqual([{ field: "receivedCents", before: null, after: "600000" }]);
      const v3Fields = h.revisions[2].changes.map((c: { field: string }) => c.field);
      expect(v3Fields).toEqual(["person", "grossCents", "shareCents", "remainderCents", "receivedCents"]);
      expect(h.revisions[2].changes.find((c: { field: string }) => c.field === "grossCents")).toEqual({
        field: "grossCents",
        before: "1000000",
        after: "800000",
      });
      expect(h.revisions[2].changes.find((c: { field: string }) => c.field === "receivedCents")).toEqual({
        field: "receivedCents",
        before: "600000",
        after: "610000",
      });
      // Tüm kuruş değerleri metindir.
      for (const r of h.revisions) {
        for (const k of ["grossCents", "fuelCents", "otherExpenseCents", "shareCents", "remainderCents"]) {
          expect(typeof r.values[k]).toBe("string");
        }
      }
    });

    it("onaylar ayrı satırlardır: v2 6.000 ve v3 6.100; yalnız v3 current", async () => {
      const id = await seedFullHistory();
      const { history: h } = await (await history(owner, id)).json();
      expect(h.confirmations).toHaveLength(2);
      expect(h.confirmations.map((c: { entryVersion: number; receivedCents: string; current: boolean }) => [c.entryVersion, c.receivedCents, c.current])).toEqual([
        [2, "600000", false],
        [3, "610000", true],
      ]);
    });

    it("onaysız kayıt: yalnız create revizyonu, onay yok; PATCH sonrası update değişiklikleri", async () => {
      const created = await post(driver, createDriver("h-u1"));
      const id = (await created.json()).workEntry.id as string;
      const patched = await patch(owner, id, { requestId: "h-u2", version: 1, ...daily({ grossCents: "900000" }), workerPersonId: SEED_IDS.driverA1a });
      expect(patched.status).toBe(200);
      const { history: h } = await (await history(owner, id)).json();
      expect(h.confirmations).toEqual([]);
      expect(h.revisions.map((r: { action: string }) => r.action)).toEqual(["create", "update"]);
      expect(h.revisions[1].changes.map((c: { field: string }) => c.field)).toEqual(["grossCents", "shareCents", "remainderCents"]);
    });

    it("ekip (destek dahil) aynı geçmişi X-Target-Vehicle ile okur; sorgu parametreleri yok sayılır", async () => {
      const id = await seedFullHistory();
      const viaOwner = await (await history(owner, id)).json();
      const viaAdmin = await history(admin, id, SEED_IDS.vehicleA1, "?version=1&limit=1");
      const viaSupport = await history(support, id, SEED_IDS.vehicleA1);
      expect(viaAdmin.status).toBe(200);
      expect(viaSupport.status).toBe(200);
      expect((await viaAdmin.json()).history.revisions).toHaveLength(3);
      expect((await viaSupport.json()).history.revisions).toEqual(viaOwner.history.revisions);
    });
  });

  describe("aktörler ve gizli veri", () => {
    it("ekip satırı kullanıcı adı + rol + sahip adına; sahip/şoför satırı erişim + plaka, kişi adı yok", async () => {
      const id = await seedFullHistory();
      const ownerName = raw("SELECT full_name FROM people WHERE id = ?", SEED_IDS.ownerA)[0]!.full_name as string;
      const { history: h } = await (await history(owner, id)).json();

      expect(h.revisions[0].actor).toEqual({ kind: "vehicle_credential", access: "driver", plateNormalized: "34AAA001" });
      expect(h.revisions[1].actor).toEqual({ kind: "vehicle_credential", access: "owner", plateNormalized: "34AAA001" });
      expect(h.revisions[2].actor).toMatchObject({
        kind: "platform_user",
        username: SEED_USERNAMES.admin,
        role: "admin",
        onBehalfOf: { kind: "owner", fullName: ownerName },
      });
      expect(h.confirmations[1].actor).toEqual(h.revisions[2].actor);
      expect(Object.keys(h.revisions[0].actor).sort()).toEqual(["access", "kind", "plateNormalized"]);
    });

    it("gövdede parola, hash, token, csrf, oturum/credential kimliği ve ham snapshot yok", async () => {
      const id = await seedFullHistory();
      const text = JSON.stringify(await (await history(owner, id)).json());
      expect(text).not.toMatch(/password|hash|token|csrf|snapshot|actor_|sessionId|credentialId|platformUserId/iu);
      for (const secret of [owner.token, driver.token, admin.token, admin.csrfToken, owner.csrfToken]) {
        expect(text).not.toContain(secret);
      }
      const sessionIds = raw("SELECT id FROM sessions").map((r) => r.id as string);
      for (const sessionId of sessionIds) expect(text).not.toContain(sessionId);
      for (const credentialId of [SEED_IDS.credA1Owner, SEED_IDS.credA1Driver]) expect(text).not.toContain(credentialId);
    });
  });

  describe("yetki ve kapsam", () => {
    it("şoför 403 FORBIDDEN, oturum yok 401, araç oturumu X-Target-Vehicle ile 403", async () => {
      const id = await seedFullHistory();
      const asDriver = await history(driver, id);
      expect(asDriver.status).toBe(403);
      expect((await errorOf(asDriver)).code).toBe("FORBIDDEN");
      expect((await history(undefined, id)).status).toBe(401);
      const header = await history(owner, id, SEED_IDS.vehicleA2);
      expect(header.status).toBe(403);
      expect((await errorOf(header)).code).toBe("TARGET_HEADER_NOT_ALLOWED");
    });

    it("ekip bilinmeyen hedef araçla 404 TARGET_VEHICLE_NOT_FOUND", async () => {
      const id = await seedFullHistory();
      const response = await history(admin, id, "yok-boyle-arac");
      expect(response.status).toBe(404);
      expect((await errorOf(response)).code).toBe("TARGET_VEHICLE_NOT_FOUND");
    });

    it("başka aracın, başka işletmenin ve bilinmeyen kimlikli kayıt AYNI 404 gövdesini alır", async () => {
      const otherVehicle = await post(admin, { ...createDriver("h-a2"), workerPersonId: SEED_IDS.driverA2a }, SEED_IDS.vehicleA2);
      expect(otherVehicle.status).toBe(201);
      const otherVehicleId = (await otherVehicle.json()).workEntry.id as string;
      const ownerB = await loginVehicle(SEED_RAW_PLATES.vehicleB1, SEED_TEST_PASSWORDS.owner);
      const otherBusiness = await post(ownerB, { ...createDriver("h-b1"), workerPersonId: SEED_IDS.driverB1a });
      expect(otherBusiness.status).toBe(201);
      const otherBusinessId = (await otherBusiness.json()).workEntry.id as string;

      const bodies: unknown[] = [];
      for (const [session, id, target] of [
        [owner, otherVehicleId, undefined],
        [owner, otherBusinessId, undefined],
        [owner, "yok-boyle-kayit", undefined],
        [admin, otherVehicleId, SEED_IDS.vehicleA1],
        [admin, otherBusinessId, SEED_IDS.vehicleA1],
      ] as const) {
        const response = await history(session, id, target);
        expect(response.status).toBe(404);
        bodies.push({ ...(await response.json()), request_id: undefined });
      }
      expect((bodies[0] as { error: { code: string } }).error.code).toBe("WORK_ENTRY_NOT_FOUND");
      for (const body of bodies) expect(body).toEqual(bodies[0]);
    });
  });

  describe("dayanıklılık", () => {
    it("kişi/araç pasifleşse ya da kişi yeniden adlandırılsa da geçmiş satırları düşmez; ad güncel people'dan gelir", async () => {
      const id = await seedFullHistory();
      const before = await (await history(owner, id)).json();
      withRaw((sqlite) => {
        sqlite.prepare("UPDATE people SET active = 0 WHERE id IN (?, ?)").run(SEED_IDS.driverA1a, SEED_IDS.driverA1b);
      });
      const after = await (await history(owner, id)).json();
      expect(after.history).toEqual(before.history);

      withRaw((sqlite) => {
        sqlite.prepare("UPDATE vehicles SET active = 0 WHERE id = ?").run(SEED_IDS.vehicleA1);
      });
      const vehicleOff = await history(admin, id, SEED_IDS.vehicleA1);
      expect(vehicleOff.status).toBe(200);
      expect((await vehicleOff.json()).history).toEqual(before.history);

      withRaw((sqlite) => {
        sqlite.prepare("UPDATE people SET full_name = 'Yeni Ad' WHERE id = ?").run(SEED_IDS.driverA1a);
      });
      const renamed = await (await history(admin, id, SEED_IDS.vehicleA1)).json();
      expect(renamed.history.revisions[0].values.person).toEqual({ id: SEED_IDS.driverA1a, fullName: "Yeni Ad" });
      expect(renamed.history.revisions).toHaveLength(3);
    });

    it("eski/eksik anlık görüntü (anahtarlar eksik, bozuk JSON) 500 üretmez", async () => {
      const id = await seedFullHistory();
      withRaw((sqlite) => {
        sqlite.prepare("UPDATE work_entry_revisions SET snapshot_json = '{\"personId\":\"x\"}' WHERE entry_id = ? AND version = 1").run(id);
        sqlite.prepare("UPDATE work_entry_revisions SET snapshot_json = 'bozuk' WHERE entry_id = ? AND version = 2").run(id);
      });
      const response = await history(owner, id);
      expect(response.status).toBe(200);
      const { history: h } = await response.json();
      expect(h.revisions).toHaveLength(3);
      expect(h.revisions[0].values).toMatchObject({ grossCents: "0", workDate: "", otherExpenseNote: null });
      expect(h.revisions[1].values).not.toHaveProperty("receivedCents");
    });

    it("salt okunur: çağrı sonrası satır sayıları değişmez", async () => {
      const id = await seedFullHistory();
      const count = () =>
        ["work_entries", "work_entry_revisions", "cash_confirmations", "mutation_receipts", "admin_audit"].map(
          (t) => (raw(`SELECT COUNT(*) AS n FROM ${t}`)[0]!.n as number),
        );
      const before = count();
      await history(owner, id);
      expect(count()).toEqual(before);
    });
  });
});
