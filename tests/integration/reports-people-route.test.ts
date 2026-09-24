/**
 * GET /api/v1/reports/people ve /people/[personId]: kişi bazlı dönem raporu. Gerçek geçici
 * SQLite dosyası + gerçek migration + seed (mock/`:memory:` YOK). person_id gruplama,
 * yeniden adlandırma/pasifleşme, düzeltme ile taşınma, detay toplam + keyset sayfa,
 * kapsam sızıntısızlığı (aynı 404) ve yetki sınırları.
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
import { POST as postWorkEntry } from "../../src/app/api/v1/work-entries/route";
import { GET as peopleRoute } from "../../src/app/api/v1/reports/people/route";
import { GET as personRoute } from "../../src/app/api/v1/reports/people/[personId]/route";
import { GET as vehiclesRoute } from "../../src/app/api/v1/reports/vehicles/route";
import { POST as confirmWorkEntryRoute } from "../../src/app/api/v1/work-entries/[id]/confirm/route";
import { POST as correctAndConfirmRoute } from "../../src/app/api/v1/work-entries/[id]/correct-and-confirm/route";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const URL_WORK_ENTRIES = "https://example.invalid/api/v1/work-entries";
const URL_REPORT = "https://example.invalid/api/v1/reports";

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

const confirm = (session: Session, id: string, body: unknown): Promise<Response> =>
  confirmWorkEntryRoute(
    new Request(`${URL_WORK_ENTRIES}/${id}/confirm`, { method: "POST", headers: writeHeaders(session), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

const correct = (session: Session, id: string, body: unknown): Promise<Response> =>
  correctAndConfirmRoute(
    new Request(`${URL_WORK_ENTRIES}/${id}/correct-and-confirm`, { method: "POST", headers: writeHeaders(session), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

const reportHeaders = (session: Session | null, targetVehicle?: string) => ({
  ...(session ? { cookie: `dolmus_session=${session.token}` } : {}),
  ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
});

const getPeople = (session: Session | null, query = "", targetVehicle?: string): Promise<Response> =>
  peopleRoute(new Request(`${URL_REPORT}/people${query}`, { headers: reportHeaders(session, targetVehicle) }));

const getPerson = (session: Session | null, personId: string, query = "", targetVehicle?: string): Promise<Response> =>
  personRoute(new Request(`${URL_REPORT}/people/${personId}${query}`, { headers: reportHeaders(session, targetVehicle) }), {
    params: Promise.resolve({ personId }),
  });

const getVehicleReport = (session: Session, query: string): Promise<Response> =>
  vehiclesRoute(new Request(`${URL_REPORT}/vehicles${query}`, { headers: reportHeaders(session) }));

const DAY = "2026-09-15";
const daily = (date: string, extra: Record<string, unknown> = {}) => ({
  date,
  startTime: "08:00",
  endTime: "17:30",
  endsNextDay: false,
  grossCents: "1000000",
  fuelCents: "150000",
  otherExpenseCents: "30000",
  otherExpenseNote: "otopark",
  ...extra,
});
const driverBody = (requestId: string, date = DAY, extra: Record<string, unknown> = {}, personId: string = SEED_IDS.driverA1a) => ({
  requestId,
  workType: "driver",
  workerPersonId: personId,
  ...daily(date, extra),
});
const ownerBody = (requestId: string, date = DAY, extra: Record<string, unknown> = {}) => ({
  requestId,
  workType: "owner",
  ...daily(date, extra),
});

interface PersonRow {
  personId: string;
  fullName: string;
  isOwner: boolean;
  entryCount: number;
  workDays: number;
  durationMinutes: number;
  grossCents: string;
  shareCents: string;
  remainderCents: string;
}

describe("kişi dönem raporu", () => {
  let dir: string;
  let dbPath: string;
  let owner: Session;
  let driver: Session;
  let admin: Session;
  let ownerB: Session;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  async function seed(session: Session, body: unknown): Promise<string> {
    const response = await post(session, body);
    expect(response.status).toBe(201);
    return (await response.json()).workEntry.id;
  }
  const people = async (session: Session = owner, query = `?period=month&date=${DAY}`): Promise<PersonRow[]> => {
    const response = await getPeople(session, query);
    expect(response.status).toBe(200);
    return (await response.json()).report.people;
  };
  const rowOf = (rows: PersonRow[], personId: string) => rows.find((r) => r.personId === personId);
  const sql = (statement: string, ...params: string[]) => {
    const connection = openDatabaseConnection(dbPath, {});
    try {
      connection.prepare(statement).run(...params);
    } finally {
      connection.close();
    }
  };

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-reports-people-"));
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

  describe("liste", () => {
    it("aynı gün iki aralık: entryCount 2, workDays 1, 480 dk", async () => {
      await seed(driver, driverBody("d-1", DAY, { startTime: "08:00", endTime: "12:00" }));
      await seed(driver, driverBody("d-2", DAY, { startTime: "13:00", endTime: "17:00" }));
      const rows = await people();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        personId: SEED_IDS.driverA1a,
        fullName: "Mehmet Öz",
        isOwner: false,
        entryCount: 2,
        workDays: 1,
        durationMinutes: 480,
        grossCents: "2000000",
      });
    });

    it("şoför + sahip kaydı iki satır; sahip satırı isOwner ve pay 0; araç raporu 1140 dk", async () => {
      await seed(driver, driverBody("d-1"));
      await seed(owner, ownerBody("o-1"));
      const rows = await people();
      expect(rows).toHaveLength(2);
      expect(rowOf(rows, SEED_IDS.driverA1a)).toMatchObject({ isOwner: false, durationMinutes: 570, shareCents: "200000" });
      expect(rowOf(rows, SEED_IDS.ownerA)).toMatchObject({ isOwner: true, durationMinutes: 570, shareCents: "0" });
      const vehicle = await getVehicleReport(owner, `?period=month&date=${DAY}`);
      expect((await vehicle.json()).report.durationMinutes).toBe(1140);
    });

    it("yanıt gövdesi sözleşme şekline uyar; kuruş alanları metin, sayaçlar sayı", async () => {
      await seed(driver, driverBody("d-1"));
      const response = await getPeople(owner, `?period=month&date=${DAY}`);
      expect((await response.json()).report).toEqual({
        period: { kind: "month", startDate: "2026-09-01", nextStartDate: "2026-10-01" },
        people: [
          {
            personId: SEED_IDS.driverA1a,
            fullName: "Mehmet Öz",
            isOwner: false,
            entryCount: 1,
            workDays: 1,
            durationMinutes: 570,
            grossCents: "1000000",
            fuelCents: "150000",
            otherExpenseCents: "30000",
            shareCents: "200000",
            remainderCents: "620000",
          },
        ],
      });
    });

    it("boş dönem: people []", async () => {
      const response = await getPeople(owner, "?period=year&date=2020-05-05");
      expect((await response.json()).report.people).toEqual([]);
    });

    it("yeniden adlandırılan kişi yeni adla tek satır kalır", async () => {
      await seed(driver, driverBody("d-1", "2026-09-14"));
      sql("UPDATE people SET full_name = ?, version = version + 1 WHERE id = ?", "Mehmet Yeni", SEED_IDS.driverA1a);
      await seed(driver, driverBody("d-2", "2026-09-15"));
      const rows = await people();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ fullName: "Mehmet Yeni", entryCount: 2 });
    });

    it("aynı ada sahip iki ayrı kişi iki satır kalır", async () => {
      await seed(driver, driverBody("d-1", DAY, {}, SEED_IDS.driverA1a));
      await seed(driver, driverBody("d-2", DAY, {}, SEED_IDS.driverA1b));
      const rows = await people();
      expect(rows.map((r) => r.fullName)).toEqual(["Mehmet Öz", "Mehmet Öz"]);
      expect(new Set(rows.map((r) => r.personId)).size).toBe(2);
    });

    it("pasifleşen kişi ve kapanan atama satırını ve toplamını korur", async () => {
      await seed(driver, driverBody("d-1"));
      sql("UPDATE vehicle_drivers SET active = 0, version = version + 1 WHERE person_id = ?", SEED_IDS.driverA1a);
      sql("UPDATE people SET active = 0, version = version + 1 WHERE id = ?", SEED_IDS.driverA1a);
      const rows = await people();
      expect(rowOf(rows, SEED_IDS.driverA1a)).toMatchObject({ entryCount: 1, durationMinutes: 570 });
      // Şoför oturumu yine 403: rapor izni yok.
      expect((await getPeople(driver)).status).toBe(403);
    });

    it("düzeltilen kayıt yeni kişiye/döneme taşınır ve bir kez sayılır", async () => {
      const id = await seed(driver, driverBody("d-1", DAY, {}, SEED_IDS.driverA1a));
      expect((await confirm(owner, id, { requestId: "k-1", version: 1, receivedCents: "600000" })).status).toBe(200);
      const moved = await correct(owner, id, {
        requestId: "x-1",
        version: 2,
        workType: "driver",
        workerPersonId: SEED_IDS.driverA1b,
        ...daily(DAY),
        receivedCents: "600000",
      });
      expect(moved.status).toBe(200);
      let rows = await people();
      expect(rowOf(rows, SEED_IDS.driverA1a)).toBeUndefined();
      expect(rowOf(rows, SEED_IDS.driverA1b)).toMatchObject({ entryCount: 1, durationMinutes: 570 });

      const dated = await correct(owner, id, {
        requestId: "x-2",
        version: 3,
        workType: "driver",
        workerPersonId: SEED_IDS.driverA1b,
        ...daily("2026-10-05"),
        receivedCents: "600000",
      });
      expect(dated.status).toBe(200);
      expect(await people()).toEqual([]);
      rows = await people(owner, "?period=month&date=2026-10-05");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ personId: SEED_IDS.driverA1b, entryCount: 1 });
    });

    it("2^53 üstü brüt toplam kesin metin olarak döner", async () => {
      const big = (extra: Record<string, unknown>) => ownerBody("x", DAY, { grossCents: "4503599627370496", fuelCents: "0", otherExpenseCents: "0", ...extra });
      expect((await post(owner, { ...big({}), requestId: "o-1" })).status).toBe(201);
      expect((await post(owner, { ...big({ grossCents: "4503599627370497" }), requestId: "o-2" })).status).toBe(201);
      const rows = await people();
      expect(rows[0]!.grossCents).toBe("9007199254740993");
    });

    it("negatif kalan negatif kalır", async () => {
      await seed(owner, ownerBody("o-1", DAY, { grossCents: "100000", fuelCents: "500000", otherExpenseCents: "0" }));
      expect((await people())[0]!.remainderCents).toMatch(/^-\d+$/u);
    });
  });

  describe("detay", () => {
    it("kişinin toplamları TÜM dönemi kapsar; kayıtlar en yeni önce, keyset sayfalı", async () => {
      const ids: string[] = [];
      for (const [i, date] of ["2026-09-10", "2026-09-11", "2026-09-12"].entries()) {
        ids.push(await seed(driver, driverBody(`d-${i}`, date)));
      }
      const first = await getPerson(owner, SEED_IDS.driverA1a, `?period=month&date=${DAY}&limit=2`);
      expect(first.status).toBe(200);
      const page1 = (await first.json()).report;
      expect(page1.person).toMatchObject({ personId: SEED_IDS.driverA1a, entryCount: 3, workDays: 3, durationMinutes: 1710 });
      expect(page1.entries.map((e: { id: string }) => e.id)).toEqual([ids[2], ids[1]]);
      expect(page1.entries[0]).toEqual({
        id: ids[2],
        workDate: "2026-09-12",
        startsAt: expect.any(String),
        endsAt: expect.any(String),
        durationMinutes: 570,
        grossCents: "1000000",
        shareCents: "200000",
        remainderCents: "620000",
        status: "pending",
      });
      expect(typeof page1.nextCursor).toBe("string");

      const second = await getPerson(owner, SEED_IDS.driverA1a, `?period=month&date=${DAY}&limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`);
      const page2 = (await second.json()).report;
      expect(page2.entries.map((e: { id: string }) => e.id)).toEqual([ids[0]]);
      expect(page2.nextCursor).toBeNull();
      expect(page2.person.entryCount).toBe(3);
    });

    it("kayıtsız/başka kapsamdaki kimlikler AYNI 404'ü alır", async () => {
      await seed(driver, driverBody("d-1"));
      await seed(ownerB, ownerBody("b-1"));
      const bodies: unknown[] = [];
      for (const id of ["no-such-person", SEED_IDS.ownerB, SEED_IDS.driverA2a, SEED_IDS.driverA1b]) {
        const response = await getPerson(owner, id, `?period=month&date=${DAY}`);
        expect(response.status).toBe(404);
        const body = await response.json();
        bodies.push({ ...body, request_id: undefined });
        expect(body.error.code).toBe("NOT_FOUND");
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
      // Kaydı var ama dönem dışı: 404.
      expect((await getPerson(owner, SEED_IDS.driverA1a, "?period=month&date=2026-10-20")).status).toBe(404);
    });

    it("şoför 403, oturumsuz 401, araç oturumu X-Target-Vehicle 403, ekip hedef aracı okur", async () => {
      await seed(driver, driverBody("d-1"));
      expect((await getPerson(driver, SEED_IDS.driverA1a)).status).toBe(403);
      expect((await getPerson(null, SEED_IDS.driverA1a)).status).toBe(401);
      expect((await getPerson(owner, SEED_IDS.driverA1a, "", SEED_IDS.vehicleB1)).status).toBe(403);
      const staff = await getPerson(admin, SEED_IDS.driverA1a, `?period=month&date=${DAY}`, SEED_IDS.vehicleA1);
      expect(staff.status).toBe(200);
      expect((await staff.json()).report.person.entryCount).toBe(1);
    });

    it.each([
      ["?period=day", "period"],
      ["?date=2026-02-30", "date"],
      ["?cursor=bozuk", "cursor"],
      ["?limit=0", "limit"],
      ["?limit=101", "limit"],
      ["?limit=5abc", "limit"],
    ])("%s → 422 yalnız %s alanı", async (query, field) => {
      const response = await getPerson(owner, SEED_IDS.driverA1a, query);
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(body.error.fields)).toEqual([field]);
    });
  });

  describe("kapsam ve yetki (liste)", () => {
    it("?vehicleId / ?businessId yok sayılır", async () => {
      await seed(owner, ownerBody("o-1"));
      await seed(ownerB, ownerBody("b-1"));
      const plain = await people();
      const withParams = await people(owner, `?period=month&date=${DAY}&vehicleId=${SEED_IDS.vehicleB1}&businessId=${SEED_IDS.businessB}`);
      expect(withParams).toEqual(plain);
      expect(plain).toHaveLength(1);
    });

    it("şoför 403, oturumsuz 401, araç oturumu X-Target-Vehicle 403", async () => {
      expect((await getPeople(driver)).status).toBe(403);
      expect((await getPeople(null)).status).toBe(401);
      const response = await getPeople(owner, "", SEED_IDS.vehicleB1);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("TARGET_HEADER_NOT_ALLOWED");
    });

    it("ekip X-Target-Vehicle ile hedef aracı okur; hedefsiz ekip işletme geneline düşmez", async () => {
      await seed(owner, ownerBody("o-1"));
      const untargeted = await getPeople(admin, `?period=month&date=${DAY}`);
      expect(untargeted.status).toBeGreaterThanOrEqual(400);
      const response = await getPeople(admin, `?period=month&date=${DAY}`, SEED_IDS.vehicleA1);
      expect(response.status).toBe(200);
      expect((await response.json()).report.people).toHaveLength(1);
    });

    it.each([
      ["?period=day", "period"],
      ["?date=2026-9-1", "date"],
    ])("%s → 422 yalnız %s alanı", async (query, field) => {
      const response = await getPeople(owner, query);
      expect(response.status).toBe(422);
      expect(Object.keys((await response.json()).error.fields)).toEqual([field]);
    });

    it("yanıt Cache-Control private, no-store", async () => {
      const response = await getPeople(owner);
      expect(response.headers.get("cache-control")).toMatch(/private/u);
      expect(response.headers.get("cache-control")).toMatch(/no-store/u);
    });
  });
});
