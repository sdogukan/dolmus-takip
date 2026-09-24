/**
 * S5.5 rapor testlerinin ortak kurulumu (gerçek geçici SQLite + gerçek migration + seed;
 * mock/`:memory:` yok). `setupReportHarness()` bir `describe` içinde çağrılır ve
 * `beforeEach`/`afterEach` kancalarını kendisi kaydeder. Testler route modüllerini
 * doğrudan `Request` ile çağırır.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, expect } from "vitest";
import { seedDevData, SEED_IDS, SEED_RAW_PLATES, SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";
import { POST as logoutRoute } from "../../src/app/api/v1/auth/logout/route";
import { POST as platformLoginRoute } from "../../src/app/api/v1/auth/platform-login/route";
import { POST as vehicleLoginRoute } from "../../src/app/api/v1/auth/vehicle-login/route";
import { GET as peopleRoute } from "../../src/app/api/v1/reports/people/route";
import { GET as personRoute } from "../../src/app/api/v1/reports/people/[personId]/route";
import { GET as summaryRoute } from "../../src/app/api/v1/reports/summary/route";
import { GET as vehiclesRoute } from "../../src/app/api/v1/reports/vehicles/route";
import { GET as listWorkEntriesRoute, POST as postWorkEntry } from "../../src/app/api/v1/work-entries/route";
import { POST as confirmWorkEntryRoute } from "../../src/app/api/v1/work-entries/[id]/confirm/route";
import { POST as correctAndConfirmRoute } from "../../src/app/api/v1/work-entries/[id]/correct-and-confirm/route";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { resetHashQueueForTests } from "../../src/server/auth/hash-queue";
import { resetVehicleLoginRateLimitForTests } from "../../src/server/auth/rate-limit";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { createDb, openDatabaseConnection } from "../../src/server/data/db";

export { SEED_IDS };

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const API = "https://example.invalid/api/v1";

export interface Session {
  token: string;
  csrfToken: string;
}

function readSession(response: Response, body: { csrfToken: string }): Session {
  const match = /dolmus_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "");
  return { token: decodeURIComponent(match![1]!), csrfToken: body.csrfToken };
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

const writeHeaders = (session: Session, targetVehicle?: string) => ({
  cookie: `dolmus_session=${session.token}`,
  origin: SELF_ORIGIN,
  "x-csrf-token": session.csrfToken,
  "content-type": "application/json",
  ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
});

const readHeaders = (session: Session | null, targetVehicle?: string) => ({
  ...(session ? { cookie: `dolmus_session=${session.token}` } : {}),
  ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
});

/** Beş rapor okumasının her biri: oturum + sorgu + isteğe bağlı hedef araç. */
export type ReadKind = "summary" | "vehicles" | "people" | "person" | "workEntries";
export const READ_KINDS: ReadKind[] = ["summary", "vehicles", "people", "person", "workEntries"];

export function daily(date: string, extra: Record<string, unknown> = {}) {
  return {
    date,
    startTime: "08:00",
    endTime: "17:30",
    endsNextDay: false,
    grossCents: "1000000",
    fuelCents: "150000",
    otherExpenseCents: "30000",
    otherExpenseNote: "otopark",
    ...extra,
  };
}

export const DAY = "2026-09-15";

export const driverBody = (requestId: string, date = DAY, extra: Record<string, unknown> = {}, personId: string = SEED_IDS.driverA1a) => ({
  requestId,
  workType: "driver",
  workerPersonId: personId,
  ...daily(date, extra),
});

export const ownerBody = (requestId: string, date = DAY, extra: Record<string, unknown> = {}) => ({
  requestId,
  workType: "owner",
  ...daily(date, extra),
});

export interface ReportHarness {
  dbPath: string;
  owner: Session;
  driver: Session;
  admin: Session;
  ownerB: Session;
  create(session: Session, body: unknown, targetVehicle?: string): Promise<string>;
  confirm(session: Session, id: string, body: unknown): Promise<Response>;
  correct(session: Session, id: string, body: unknown): Promise<Response>;
  logout(session: Session): Promise<Response>;
  read(kind: ReadKind, session: Session | null, options?: { query?: string; targetVehicle?: string; personId?: string }): Promise<Response>;
}

export function setupReportHarness(prefix: string): ReportHarness {
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;
  let dir = "";
  const harness = {} as ReportHarness;

  harness.create = async (session, body, targetVehicle) => {
    const response = await postWorkEntry(
      new Request(`${API}/work-entries`, { method: "POST", headers: writeHeaders(session, targetVehicle), body: JSON.stringify(body) }),
    );
    expect(response.status).toBe(201);
    return (await response.json()).workEntry.id;
  };
  harness.confirm = (session, id, body) =>
    confirmWorkEntryRoute(new Request(`${API}/work-entries/${id}/confirm`, { method: "POST", headers: writeHeaders(session), body: JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    });
  harness.correct = (session, id, body) =>
    correctAndConfirmRoute(
      new Request(`${API}/work-entries/${id}/correct-and-confirm`, { method: "POST", headers: writeHeaders(session), body: JSON.stringify(body) }),
      { params: Promise.resolve({ id }) },
    );
  harness.logout = (session) =>
    logoutRoute(new Request(`${API}/auth/logout`, { method: "POST", headers: writeHeaders(session), body: "{}" }));
  harness.read = (kind, session, { query = "", targetVehicle, personId = SEED_IDS.driverA1a } = {}) => {
    const headers = readHeaders(session, targetVehicle);
    switch (kind) {
      case "summary":
        return Promise.resolve(summaryRoute(new Request(`${API}/reports/summary${query}`, { headers })));
      case "vehicles":
        return Promise.resolve(vehiclesRoute(new Request(`${API}/reports/vehicles${query}`, { headers })));
      case "people":
        return Promise.resolve(peopleRoute(new Request(`${API}/reports/people${query}`, { headers })));
      case "person":
        return Promise.resolve(personRoute(new Request(`${API}/reports/people/${personId}${query}`, { headers }), { params: Promise.resolve({ personId }) }));
      case "workEntries":
        return Promise.resolve(listWorkEntriesRoute(new Request(`${API}/work-entries${query}`, { headers })));
    }
  };

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), `dolmus-takip-${prefix}-`));
    harness.dbPath = path.join(dir, "test.sqlite");
    const setup = openDatabaseConnection(harness.dbPath, { createIfMissing: true });
    migrate(createDb(setup), { migrationsFolder });
    await seedDevData(setup);
    setup.close();
    process.env.DOLMUS_DB_PATH = harness.dbPath;
    resetAppDbForTests();

    harness.owner = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner);
    harness.driver = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver);
    harness.admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    harness.ownerB = await loginVehicle(SEED_RAW_PLATES.vehicleB1, SEED_TEST_PASSWORDS.owner);
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

  return harness;
}
