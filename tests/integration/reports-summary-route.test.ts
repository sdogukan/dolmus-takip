/**
 * GET /api/v1/reports/summary: sahip özeti. Gerçek geçici SQLite dosyası + gerçek
 * migration + seed (mock/`:memory:` YOK). Araç başlığı (plaka + sahip adı), örnek
 * senaryo toplamları, onay sonrası alınan tutar, /reports/vehicles ile aynı
 * toplamlar, kapsam (query'den araç/işletme seçilemez) ve yetki sınırları.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS, SEED_RAW_PLATES, SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";
import { formatPlateForDisplay, normalizePlate } from "../../src/lib/plate";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { createDb, openDatabaseConnection, type SqliteConnection } from "../../src/server/data/db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { resetHashQueueForTests } from "../../src/server/auth/hash-queue";
import { resetVehicleLoginRateLimitForTests } from "../../src/server/auth/rate-limit";
import { POST as platformLoginRoute } from "../../src/app/api/v1/auth/platform-login/route";
import { POST as vehicleLoginRoute } from "../../src/app/api/v1/auth/vehicle-login/route";
import { POST as postWorkEntry } from "../../src/app/api/v1/work-entries/route";
import { GET as reportRoute } from "../../src/app/api/v1/reports/summary/route";
import { GET as vehiclesReportRoute } from "../../src/app/api/v1/reports/vehicles/route";
import { POST as confirmWorkEntryRoute } from "../../src/app/api/v1/work-entries/[id]/confirm/route";
import { POST as correctAndConfirmRoute } from "../../src/app/api/v1/work-entries/[id]/correct-and-confirm/route";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const URL_WORK_ENTRIES = "https://example.invalid/api/v1/work-entries";
const URL_REPORT = "https://example.invalid/api/v1/reports/summary";

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

const getReport = (session: Session | null, query = "", targetVehicle?: string): Promise<Response> =>
  reportRoute(
    new Request(`${URL_REPORT}${query}`, {
      headers: {
        ...(session ? { cookie: `dolmus_session=${session.token}` } : {}),
        ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
      },
    }),
  );

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
const driverBody = (requestId: string, date = DAY, extra: Record<string, unknown> = {}) => ({
  requestId,
  workType: "driver",
  workerPersonId: SEED_IDS.driverA1a,
  ...daily(date, extra),
});
const ownerBody = (requestId: string, date = DAY, extra: Record<string, unknown> = {}) => ({
  requestId,
  workType: "owner",
  ...daily(date, extra),
});

describe("sahip özeti", () => {
  let dir: string;
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
  const monthReport = async (session: Session = owner, query = `?period=month&date=${DAY}`) => {
    const response = await getReport(session, query);
    expect(response.status).toBe(200);
    return (await response.json()).summary;
  };

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-reports-summary-"));
    const dbPath = path.join(dir, "test.sqlite");
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

  describe("başlık ve toplamlar", () => {
    it("sahip: plaka, sahip adı, dönem ve örnek senaryo toplamları; onay öncesi 0, 6.000 onayı sonrası 600000", async () => {
      const id = await seed(driver, driverBody("d-1"));
      await seed(owner, ownerBody("o-1"));
      const before = await monthReport();
      expect(before).toEqual({
        period: { kind: "month", startDate: "2026-09-01", nextStartDate: "2026-10-01" },
        vehicle: { plate: before.vehicle.plate },
        owner: { fullName: "Ali Kaya" },
        entryCount: 2,
        workDays: 1,
        durationMinutes: 1140,
        grossCents: "2000000",
        fuelCents: "300000",
        otherExpenseCents: "60000",
        shareCents: "200000",
        remainderCents: "1440000",
        confirmedReceivedCents: "0",
      });
      expect(before.vehicle.plate).toBe(formatPlateForDisplay(normalizePlate(SEED_RAW_PLATES.vehicleA1)));
      expect((await confirm(owner, id, { requestId: "k-1", version: 1, receivedCents: "600000" })).status).toBe(200);
      const after = await monthReport();
      expect(after.confirmedReceivedCents).toBe("600000");
      expect(after.remainderCents).toBe("1440000");
    });

    it("aynı dönem için /reports/vehicles ile aynı toplamlar", async () => {
      const id = await seed(driver, driverBody("d-1"));
      await seed(owner, ownerBody("o-1"));
      expect((await confirm(owner, id, { requestId: "k-1", version: 1, receivedCents: "620000" })).status).toBe(200);
      const vehiclesResponse = await vehiclesReportRoute(
        new Request(`https://example.invalid/api/v1/reports/vehicles?period=month&date=${DAY}`, {
          headers: { cookie: `dolmus_session=${owner.token}` },
        }),
      );
      const { report } = await vehiclesResponse.json();
      const { vehicle: _vehicle, owner: _owner, ...totals } = await monthReport();
      expect(totals).toEqual(report);
    });

    it("boş dönem: sıfırlar ve başlık yine dolu", async () => {
      const summary = await monthReport(owner, "?period=year&date=2020-05-05");
      expect(summary).toMatchObject({ entryCount: 0, grossCents: "0", confirmedReceivedCents: "0", owner: { fullName: "Ali Kaya" } });
    });

    it("yanıt yalnız beklenen alanları taşır (kimlik/işletme alanı yok)", async () => {
      const summary = await monthReport();
      expect(Object.keys(summary).sort()).toEqual(
        ["confirmedReceivedCents", "durationMinutes", "entryCount", "fuelCents", "grossCents", "otherExpenseCents", "owner", "period", "remainderCents", "shareCents", "vehicle", "workDays"],
      );
      expect(Object.keys(summary.owner)).toEqual(["fullName"]);
      expect(Object.keys(summary.vehicle)).toEqual(["plate"]);
    });
  });

  describe("kapsam ve yetki", () => {
    it("?vehicleId / ?businessId başka araç veya işletmeyi seçemez", async () => {
      await seed(owner, ownerBody("o-1"));
      await seed(ownerB, ownerBody("b-1"));
      const plain = await monthReport();
      const withParams = await monthReport(owner, `?period=month&date=${DAY}&vehicleId=${SEED_IDS.vehicleB1}&businessId=${SEED_IDS.businessB}`);
      expect(withParams).toEqual(plain);
      expect(plain.entryCount).toBe(1);
      expect(plain.owner.fullName).toBe("Ali Kaya");
      expect((await monthReport(ownerB)).owner.fullName).toBe("Fatma Çelik");
    });

    it("şoför oturumu 403, oturumsuz 401", async () => {
      expect((await getReport(driver)).status).toBe(403);
      expect((await getReport(null)).status).toBe(401);
    });

    it("araç oturumu X-Target-Vehicle gönderirse 403", async () => {
      const response = await getReport(owner, "", SEED_IDS.vehicleB1);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("TARGET_HEADER_NOT_ALLOWED");
    });

    it("ekip X-Target-Vehicle ile hedef aracın özetini alır; bilinmeyen hedef 404", async () => {
      await seed(owner, ownerBody("o-1"));
      const response = await getReport(admin, `?period=month&date=${DAY}`, SEED_IDS.vehicleA1);
      expect(response.status).toBe(200);
      expect((await response.json()).summary).toMatchObject({ entryCount: 1, grossCents: "1000000", owner: { fullName: "Ali Kaya" } });
      const unknown = await getReport(admin, "", "no-such-vehicle");
      expect(unknown.status).toBe(404);
      expect((await unknown.json()).error.code).toBe("TARGET_VEHICLE_NOT_FOUND");
    });

    it("yanıt Cache-Control private, no-store", async () => {
      const response = await getReport(owner);
      expect(response.headers.get("cache-control")).toMatch(/private/u);
      expect(response.headers.get("cache-control")).toMatch(/no-store/u);
    });
  });

  describe("doğrulama", () => {
    it.each([
      ["?period=day", "period"],
      ["?period=", "period"],
      ["?date=2026-02-30", "date"],
      ["?date=2026-9-1", "date"],
      ["?date=", "date"],
    ])("%s → 422 alan %s", async (query, field) => {
      const response = await getReport(owner, query);
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(body.error.fields)).toEqual([field]);
    });

    it("parametresiz istek 200 (varsayılan ay, bugün)", async () => {
      const response = await getReport(owner);
      expect(response.status).toBe(200);
      expect((await response.json()).summary.period.kind).toBe("month");
    });
  });
});
