/**
 * GET /api/v1/work-entries, GET/PATCH /api/v1/work-entries/:id — T3.5. Gerçek
 * geçici SQLite dosyası + gerçek migration + seed (mock/`:memory:` YOK). Kapsam:
 * düzenleme (şoför/sahip/ekip), sürüm/onay/tür/aynı-gün kuralları, replay ve
 * REQUEST_ID_REUSED, K1 görünürlüğü (GET /:id ve liste), kapsam dışı 404,
 * keyset sayfalama, atomiklik (hata enjeksiyonu), eşzamanlı düzenleme ve
 * İstanbul gece yarısı sınırı (enjekte saat ile use case doğrudan).
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
import { encodeCursor } from "../../src/server/usecases/list-cursor";

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

function post(session: Session, body: unknown, targetVehicle?: string): Promise<Response> {
  return postWorkEntry(
    new Request(URL_WORK_ENTRIES, { method: "POST", headers: writeHeaders(session, targetVehicle), body: JSON.stringify(body) }),
  );
}

const readHeaders = (session: Session, targetVehicle?: string) => ({
  cookie: `dolmus_session=${session.token}`,
  ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
});

function getList(session: Session, query = "", targetVehicle?: string): Promise<Response> {
  return listWorkEntries(new Request(`${URL_WORK_ENTRIES}${query}`, { headers: readHeaders(session, targetVehicle) }));
}

const TODAY = istanbulToday();

const createDriver = (requestId: string, workerPersonId: string) => ({
  requestId,
  workType: "driver",
  workerPersonId,
  date: TODAY,
  startTime: "08:00",
  endTime: "17:30",
  endsNextDay: false,
  grossCents: "1000000",
  fuelCents: "150000",
  otherExpenseCents: "30000",
  otherExpenseNote: "otopark",
});

interface ListBody {
  workEntries: { id: string; workDate: string; status: string; person: { id: string } }[];
  nextCursor: string | null;
}

describe("GET /work-entries dönem ve durum süzgeçleri", () => {
  let dir: string;
  let dbPath: string;
  let owner: Session;
  let driver: Session;
  let admin: Session;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  const A = SEED_IDS.driverA1a;
  const B = SEED_IDS.driverA1b;

  /** Gerçek bir kayıt oluşturup tarih/durum/kişiyi doğrudan satırda ayarlar (POST geçmiş tarih üretmez). */
  async function seedEntry(
    requestId: string,
    personId: string,
    workDate: string,
    status: "pending" | "confirmed" | "not_required" = "pending",
    session: Session = owner,
    vehicle?: string,
  ): Promise<string> {
    const response = await post(session, createDriver(requestId, personId), vehicle);
    expect(response.status).toBe(201);
    const id: string = (await response.json()).workEntry.id;
    const sqlite = openDatabaseConnection(dbPath);
    try {
      sqlite.prepare("UPDATE work_entries SET work_date = ?, status = ? WHERE id = ?").run(workDate, status, id);
    } finally {
      sqlite.close();
    }
    return id;
  }

  async function list(session: Session, query: string, vehicle?: string): Promise<ListBody> {
    const response = await getList(session, query, vehicle);
    expect(response.status).toBe(200);
    return response.json();
  }
  const ids = (body: ListBody) => body.workEntries.map((e) => e.id);

  async function walk(query: string, limit: number): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const body: ListBody = await list(owner, `${query}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...ids(body));
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor && pages < 30);
    return seen;
  }

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-work-entries-filters-"));
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

  it("period=month&date: yalnız [2026-09-01, 2026-10-01) aralığı, yeni gün önce; sınır günleri doğru", async () => {
    const sep1 = await seedEntry("f-1", A, "2026-09-01");
    const sep30 = await seedEntry("f-2", A, "2026-09-30");
    const sep10 = await seedEntry("f-3", B, "2026-09-10");
    await seedEntry("f-4", A, "2026-08-31");
    await seedEntry("f-5", A, "2026-10-01");
    const body = await list(owner, "?period=month&date=2026-09-10");
    expect(ids(body)).toEqual([sep30, sep10, sep1]);
    expect(body.nextCursor).toBeNull();
  });

  it("period=week (pazartesi başlar) ve period=year", async () => {
    // 2026-09-10 perşembe → hafta 2026-09-07 .. 2026-09-13
    const mon = await seedEntry("w-1", A, "2026-09-07");
    const sun = await seedEntry("w-2", A, "2026-09-13");
    const before = await seedEntry("w-3", A, "2026-09-06");
    const after = await seedEntry("w-4", A, "2026-09-14");
    expect(ids(await list(owner, "?period=week&date=2026-09-10"))).toEqual([sun, mon]);
    const jan = await seedEntry("y-1", A, "2026-01-01");
    await seedEntry("y-2", A, "2027-01-01");
    expect(ids(await list(owner, "?period=year&date=2026-09-10"))).toEqual([after, sun, mon, before, jan]);
  });

  it("yalnız period veya yalnız date verilince eksik olan varsayılanlanır; ikisi de yoksa tarih sınırı yok", async () => {
    const old = await seedEntry("d-1", A, "2020-05-05");
    const today = await seedEntry("d-2", A, TODAY);
    expect(ids(await list(owner, ""))).toEqual([today, old]);
    expect(ids(await list(owner, "?period=year"))).toEqual([today]);
    expect(ids(await list(owner, `?date=${TODAY}`))).toEqual([today]);
    expect(ids(await list(owner, "?date=2020-05-20"))).toEqual([old]);
  });

  it("status süzgeci workerPersonId ve dönemle birleşir", async () => {
    const pendingA = await seedEntry("s-1", A, "2026-09-10", "pending");
    const confirmedA = await seedEntry("s-2", A, "2026-09-09", "confirmed");
    const pendingB = await seedEntry("s-3", B, "2026-09-08", "pending");
    const augustA = await seedEntry("s-4", A, "2026-08-10", "pending");
    const base = "?period=month&date=2026-09-10";
    expect(ids(await list(owner, `${base}&status=pending`))).toEqual([pendingA, pendingB]);
    expect(ids(await list(owner, `${base}&status=confirmed`))).toEqual([confirmedA]);
    expect(ids(await list(owner, `${base}&status=pending&workerPersonId=${B}`))).toEqual([pendingB]);
    expect(ids(await list(owner, `${base}&workerPersonId=${A}`))).toEqual([pendingA, confirmedA]);
    expect(ids(await list(owner, `${base}&status=not_required`))).toEqual([]);
    expect(ids(await list(owner, `?status=pending&workerPersonId=${A}`))).toEqual([pendingA, augustA]);
  });

  it("aynı gün çok kayıtla limit=2 sayfaları, limit=100 ile aynı kümeyi her kayıttan tam bir kez verir", async () => {
    for (let n = 0; n < 5; n += 1) await seedEntry(`k-a-${n}`, A, "2026-09-10");
    for (let n = 0; n < 3; n += 1) await seedEntry(`k-b-${n}`, B, "2026-09-10");
    await seedEntry("k-c", A, "2026-09-02");
    await seedEntry("k-out", A, "2026-08-31");
    const query = "?period=month&date=2026-09-10";
    const paged = await walk(query, 2);
    const whole = await walk(query, 100);
    expect(paged).toHaveLength(9);
    expect(new Set(paged).size).toBe(9);
    expect(paged).toEqual(whole);
    const pagedPending = await walk(`${query}&status=pending&workerPersonId=${A}`, 2);
    expect(pagedPending).toHaveLength(6);
    expect(new Set(pagedPending).size).toBe(6);
  });

  it("dönem dışı bir günü gösteren cursor dönem dışı satır sızdırmaz", async () => {
    const newest = await seedEntry("c-1", A, "2026-09-10");
    const inside = await seedEntry("c-2", A, "2026-09-02");
    await seedEntry("c-3", A, "2026-08-20");
    const query = "?period=month&date=2026-09-10";
    // Dönem başlangıcından ÖNCEKİ bir güne işaret eden cursor: keyset tek başına 08-20'yi getirirdi.
    const before = await list(owner, `${query}&cursor=${encodeCursor(["2026-08-25", "zzz"])}`);
    expect(before.workEntries).toEqual([]);
    // Dönem sonrası bir günü gösteren cursor: dönem içindeki her şey hâlâ gelir, dışı gelmez.
    const after = await list(owner, `${query}&cursor=${encodeCursor(["2026-12-31", "zzz"])}`);
    expect(ids(after)).toEqual([newest, inside]);
  });

  it("geçersiz period/date/status 422 ve alanlar yalnız o anahtarı adlandırır", async () => {
    for (const [query, field] of [
      ["?period=decade", "period"],
      ["?period=", "period"],
      ["?date=2026-13-01", "date"],
      ["?date=2026-02-30", "date"],
      ["?date=", "date"],
      ["?status=paid", "status"],
      ["?status=", "status"],
      ["?period=month&date=2026-09-10&status=paid", "status"],
    ] as const) {
      const response = await getList(owner, query);
      expect(response.status, query).toBe(422);
      const { error } = await response.json();
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(error.fields)).toEqual([field]);
    }
  });

  it("başka araç/işletme kişisi 200 boş liste döner (varlık sızmaz); vehicleId parametresi yok sayılır", async () => {
    await seedEntry("o-1", A, "2026-09-10");
    await seedEntry("o-2", SEED_IDS.driverA2a, "2026-09-10", "pending", admin, SEED_IDS.vehicleA2);
    for (const person of [SEED_IDS.driverA2a, "yok-boyle-kisi"]) {
      const body = await list(owner, `?period=month&date=2026-09-10&workerPersonId=${person}`);
      expect(body).toMatchObject({ workEntries: [], nextCursor: null });
    }
    const widened = await list(owner, `?period=month&date=2026-09-10&vehicleId=${SEED_IDS.vehicleA2}`);
    expect(widened.workEntries).toHaveLength(1);
    expect(widened.workEntries[0]!.person.id).toBe(A);
  });

  it("şoför oturumu: workerPersonId hâlâ zorunlu; süzgeçlerle yalnız şoför türü kayıtları görür", async () => {
    const mine = await seedEntry("dr-1", A, "2026-09-10", "pending");
    const ownerEntry = await post(owner, {
      requestId: "dr-own",
      workType: "owner",
      date: TODAY,
      startTime: "08:00",
      endTime: "17:30",
      endsNextDay: false,
      grossCents: "1000000",
      fuelCents: "0",
      otherExpenseCents: "0",
    });
    expect(ownerEntry.status).toBe(201);
    const ownerId: string = (await ownerEntry.json()).workEntry.id;

    const missing = await getList(driver, "?period=month&date=2026-09-10&status=pending");
    expect(missing.status).toBe(422);
    expect(Object.keys((await missing.json()).error.fields)).toEqual(["workerPersonId"]);

    const body = await list(driver, `?period=month&date=2026-09-10&status=pending&workerPersonId=${A}`);
    expect(ids(body)).toEqual([mine]);
    const todayBody = await list(driver, `?period=month&date=${TODAY}&workerPersonId=${A}`);
    expect(ids(todayBody)).not.toContain(ownerId);
    const ownerVisible = await list(owner, `?period=month&date=${TODAY}`);
    expect(ids(ownerVisible)).toContain(ownerId);
  });
});
