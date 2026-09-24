/**
 * T4.6 şoför perspektifi: teslim durumu (bekliyor/teslim alındı, beklenen ve alınan
 * tutar ayrı) ve yetki sınırları. Gerçek geçici SQLite dosyası + gerçek migration +
 * seed (mock/`:memory:` YOK). Şoför onay/düzeltme/geçmiş rotalarında 403 alır,
 * onaylı kaydı düzenleyemez, K1 dışı kayıtlar 404 döner ve ekip kullanıcı adı
 * hiçbir şoför yanıtında yer almaz.
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
import { GET as listWorkEntries, POST as postWorkEntry } from "../../src/app/api/v1/work-entries/route";
import { GET as getWorkEntry, PATCH as patchWorkEntry } from "../../src/app/api/v1/work-entries/[id]/route";
import { POST as confirmWorkEntryRoute } from "../../src/app/api/v1/work-entries/[id]/confirm/route";
import { POST as correctAndConfirmRoute } from "../../src/app/api/v1/work-entries/[id]/correct-and-confirm/route";
import { GET as historyRoute } from "../../src/app/api/v1/work-entries/[id]/history/route";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const URL_WORK_ENTRIES = "https://example.invalid/api/v1/work-entries";
const WRITE_TABLES = ["work_entries", "work_entry_revisions", "mutation_receipts", "admin_audit", "cash_confirmations"] as const;

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

const patch = (session: Session, id: string, body: unknown, targetVehicle?: string): Promise<Response> =>
  patchWorkEntry(
    new Request(`${URL_WORK_ENTRIES}/${id}`, { method: "PATCH", headers: writeHeaders(session, targetVehicle), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

const confirm = (session: Session, id: string, body: unknown, targetVehicle?: string): Promise<Response> =>
  confirmWorkEntryRoute(
    new Request(`${URL_WORK_ENTRIES}/${id}/confirm`, { method: "POST", headers: writeHeaders(session, targetVehicle), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

const correct = (session: Session, id: string, body: unknown, targetVehicle?: string): Promise<Response> =>
  correctAndConfirmRoute(
    new Request(`${URL_WORK_ENTRIES}/${id}/correct-and-confirm`, { method: "POST", headers: writeHeaders(session, targetVehicle), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

const readHeaders = (session: Session, targetVehicle?: string) => ({
  cookie: `dolmus_session=${session.token}`,
  ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
});

const getOne = (session: Session, id: string, targetVehicle?: string): Promise<Response> =>
  getWorkEntry(new Request(`${URL_WORK_ENTRIES}/${id}`, { headers: readHeaders(session, targetVehicle) }), { params: Promise.resolve({ id }) });

const getHistory = (session: Session, id: string): Promise<Response> =>
  historyRoute(new Request(`${URL_WORK_ENTRIES}/${id}/history`, { headers: readHeaders(session) }), { params: Promise.resolve({ id }) });

const getList = (session: Session, query = ""): Promise<Response> =>
  listWorkEntries(new Request(`${URL_WORK_ENTRIES}${query}`, { headers: readHeaders(session) }));

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
const createDriver = (requestId: string, extra: Record<string, unknown> = {}) => ({
  requestId,
  workType: "driver",
  workerPersonId: SEED_IDS.driverA1a,
  ...daily(extra),
});
const createOwner = (requestId: string) => ({ requestId, workType: "owner", ...daily() });
const confirmBody = (requestId: string, version = 1, receivedCents: unknown = "620000") => ({ requestId, version, receivedCents });

const createDriverOf = (requestId: string, workerPersonId: string) => ({ requestId, workType: "driver", workerPersonId, ...daily() });
const correctBody = (requestId: string, version: number, receivedCents: string, extra: Record<string, unknown> = {}) => ({
  requestId,
  version,
  ...daily(),
  receivedCents,
  ...extra,
});

describe("şoför teslim durumu (T4.6)", () => {
  let dir: string;
  let dbPath: string;
  let owner: Session;
  let driver: Session;
  let admin: Session;
  let ownerB: Session;
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

  const counts = () =>
    withRaw((sqlite) =>
      Object.fromEntries(
        WRITE_TABLES.map((table) => [table, (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]),
      ),
    );
  const errorOf = async (response: Response) => (await response.json()).error as { code: string };

  async function seed(session: Session, body: unknown): Promise<string> {
    const response = await post(session, body);
    expect(response.status).toBe(201);
    return (await response.json()).workEntry.id;
  }
  const seedDriverEntry = (requestId: string, personId: string = SEED_IDS.driverA1a) => seed(driver, createDriverOf(requestId, personId));

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-work-entries-driver-delivery-"));
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
    ownerB = await loginVehicle(SEED_RAW_PLATES.vehicleB1, SEED_TEST_PASSWORDS.owner);
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

  describe("teslim durumu ve tutarlar", () => {
    it("sahip 600000 onayladıktan sonra şoför GET'i beklenen 620000 ile alınan 600000'i ayrı gösterir; actor yalnız tür", async () => {
      const id = await seedDriverEntry("d-1");
      const pending = (await (await getOne(driver, id)).json()).workEntry;
      expect(pending).toMatchObject({ status: "pending", remainderCents: "620000", confirmation: null });

      expect((await confirm(owner, id, { requestId: "k-1", version: 1, receivedCents: "600000" })).status).toBe(200);
      const view = (await (await getOne(driver, id)).json()).workEntry;
      expect(view).toMatchObject({ status: "confirmed", version: 2, remainderCents: "620000" });
      expect(view.confirmation).toMatchObject({ receivedCents: "600000", entryVersion: 2 });
      expect(view.confirmation.actor).toEqual({ kind: "vehicle_credential" });
    });

    it("ekip onayında şoför GET'i ve K1 listesi actor {kind: platform_user} döner; kullanıcı adı anahtarı yok ve yanıt metninde geçmez", async () => {
      const id = await seedDriverEntry("d-2");
      expect((await confirm(admin, id, { requestId: "k-2", version: 1, receivedCents: "600000" }, SEED_IDS.vehicleA1)).status).toBe(200);

      const one = await getOne(driver, id);
      const oneText = await one.text();
      const actor = JSON.parse(oneText).workEntry.confirmation.actor;
      expect(actor).toEqual({ kind: "platform_user" });
      expect(Object.keys(actor)).toEqual(["kind"]);
      expect(oneText).not.toContain(SEED_USERNAMES.admin);

      const listText = await (await getList(driver, `?workerPersonId=${SEED_IDS.driverA1a}`)).text();
      const listed = (JSON.parse(listText).workEntries as { id: string; confirmation: { actor: unknown } }[]).find((e) => e.id === id)!;
      expect(listed.confirmation.actor).toEqual({ kind: "platform_user" });
      expect(listText).not.toContain(SEED_USERNAMES.admin);
    });

    it("sahip düzelt-ve-onayla sonrası şoför GET'i yalnız yeni sürümün beklenen/alınan tutarını ve entryVersion'ını gösterir", async () => {
      const id = await seedDriverEntry("d-3");
      expect((await confirm(owner, id, { requestId: "k-3", version: 1, receivedCents: "600000" })).status).toBe(200);
      const corrected = await correct(owner, id, correctBody("x-3", 2, "500000", { grossCents: "800000" }));
      expect(corrected.status).toBe(200);
      const ownerView = (await corrected.json()).workEntry;
      expect(ownerView.remainderCents).not.toBe("620000");

      const view = (await (await getOne(driver, id)).json()).workEntry;
      expect(view).toMatchObject({ version: 3, remainderCents: ownerView.remainderCents });
      expect(view.confirmation).toMatchObject({ receivedCents: "500000", entryVersion: 3 });
      expect(JSON.stringify(view)).not.toContain("600000");
    });
  });

  describe("şoför yetki sınırları", () => {
    it("onay, düzelt-ve-onayla ve geçmiş: 403 FORBIDDEN, hiçbir satır yazılmaz; sahip türü ve başka aracın kayıt kimliğinde de aynı", async () => {
      const own = await seedDriverEntry("d-4");
      const ownerKind = await seed(owner, createOwner("o-4"));
      const foreign = await seed(ownerB, createOwner("f-4"));
      const before = counts();
      for (const id of [own, ownerKind, foreign, "bilinmeyen-kimlik"]) {
        const confirmed = await confirm(driver, id, { requestId: `k-${id}`, version: 1, receivedCents: "620000" });
        expect(confirmed.status).toBe(403);
        expect((await errorOf(confirmed)).code).toBe("FORBIDDEN");
        const corrected = await correct(driver, id, correctBody(`x-${id}`, 2, "610000"));
        expect(corrected.status).toBe(403);
        expect((await errorOf(corrected)).code).toBe("FORBIDDEN");
        const hist = await getHistory(driver, id);
        expect(hist.status).toBe(403);
        expect((await errorOf(hist)).code).toBe("FORBIDDEN");
      }
      expect(counts()).toEqual(before);
    });

    it("şoför bugünkü onaylı kaydı PATCH'leyemez: 409 ENTRY_CONFIRMED, yazma yok", async () => {
      const id = await seedDriverEntry("d-5");
      expect((await confirm(owner, id, { requestId: "k-5", version: 1, receivedCents: "600000" })).status).toBe(200);
      const before = counts();
      const response = await patch(driver, id, { requestId: "p-5", version: 2, ...daily({ grossCents: "500000" }) });
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe("ENTRY_CONFIRMED");
      expect(counts()).toEqual(before);
    });

    it("K1: seçilebilir başka kişinin şoför kaydı 200; sahip türü, pasif kişi ve başka araç kaydı aynı 404 WORK_ENTRY_NOT_FOUND", async () => {
      const otherPerson = await seedDriverEntry("d-6a", SEED_IDS.driverA1b);
      const ownerKind = await seed(owner, createOwner("o-6"));
      const deactivated = await seedDriverEntry("d-6b", SEED_IDS.driverA1c);
      const foreign = await seed(ownerB, createOwner("f-6"));
      withRaw((sqlite) => sqlite.prepare("UPDATE people SET active = 0 WHERE id = ?").run(SEED_IDS.driverA1c));

      const ok = await getOne(driver, otherPerson);
      expect(ok.status).toBe(200);
      expect((await ok.json()).workEntry.person.id).toBe(SEED_IDS.driverA1b);

      const notFound = await Promise.all([ownerKind, deactivated, foreign].map(async (id) => getOne(driver, id)));
      const bodies = [];
      for (const response of notFound) {
        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.error.code).toBe("WORK_ENTRY_NOT_FOUND");
        bodies.push(body.error);
      }
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);
    });
  });
});
