/**
 * POST /api/v1/work-entries/:id/correct-and-confirm — T4.3 onaylı kaydı tek
 * işlemde düzelt ve yeniden onayla. Gerçek geçici SQLite dosyası + gerçek
 * migration + seed (mock/`:memory:` YOK). Kapsam: başarılı düzeltme (sahip/ekip),
 * eski satırların değişmemesi, yetki/kapsam, durum ve doğrulama hataları,
 * replay/REQUEST_ID_REUSED, eşzamanlılık, atomiklik (hata enjeksiyonu) ve PATCH'in
 * onaylı kayda hâlâ kapalı olması.
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

const getList = (session: Session): Promise<Response> =>
  listWorkEntries(new Request(URL_WORK_ENTRIES, { headers: readHeaders(session) }));

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
const correctBody = (requestId: string, version = 2, receivedCents: unknown = "610000", extra: Record<string, unknown> = {}) => ({
  requestId,
  version,
  ...daily(),
  receivedCents,
  ...extra,
});

describe("onaylı kaydı düzelt ve onayla (T4.3)", () => {
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

  const counts = () =>
    withRaw((sqlite) =>
      Object.fromEntries(
        WRITE_TABLES.map((table) => [table, (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]),
      ),
    );
  const rows = (sql: string, ...args: unknown[]) => withRaw((sqlite) => sqlite.prepare(sql).all(...args)) as Record<string, unknown>[];
  const errorOf = async (response: Response) => (await response.json()).error as { code: string; message: string; fields?: Record<string, string> };
  const entryRow = () => rows("SELECT * FROM work_entries")[0]!;

  /** Şoför kaydı oluşturur ve 6.000 TL alınan tutarla onaylar (sürüm 2). */
  async function seedConfirmedEntry(requestId = "c-1"): Promise<string> {
    const created = await post(driver, createDriver(requestId));
    expect(created.status).toBe(201);
    const id = (await created.json()).workEntry.id as string;
    expect((await confirm(owner, id, confirmBody(`${requestId}-k`, 1, "600000"))).status).toBe(200);
    return id;
  }

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-work-entries-correct-"));
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

  describe("başarılı düzeltme", () => {
    it("yalnız alınan tutar 6.000 → 6.100: hasılat/pay/beklenen aynı, sürüm 3, yeni revizyon + yeni onay; eski satırlar bayt bayt aynı; güncel görünümde tek onay", async () => {
      const id = await seedConfirmedEntry();
      const oldRevisions = rows("SELECT * FROM work_entry_revisions ORDER BY version");
      const oldConfirmations = rows("SELECT * FROM cash_confirmations");
      expect(oldConfirmations).toHaveLength(1);
      const before = counts();

      const response = await correct(owner, id, correctBody("x-1"));
      expect(response.status).toBe(200);
      const { workEntry } = await response.json();
      expect(workEntry).toMatchObject({
        id,
        status: "confirmed",
        version: 3,
        grossCents: "1000000",
        shareCents: "200000",
        remainderCents: "620000",
        confirmation: { receivedCents: "610000", entryVersion: 3, actor: { kind: "vehicle_credential" } },
      });
      expect(Object.keys(workEntry.confirmation).sort()).toEqual(["actor", "confirmedAt", "entryVersion", "receivedCents"]);

      expect(counts()).toEqual({
        ...before,
        work_entry_revisions: before.work_entry_revisions! + 1,
        cash_confirmations: 2,
        mutation_receipts: before.mutation_receipts! + 1,
      });
      expect(rows("SELECT status, version FROM work_entries")).toEqual([{ status: "confirmed", version: 3 }]);
      // Eski revizyon ve onay satırları DEĞİŞMEDİ.
      expect(rows("SELECT * FROM work_entry_revisions WHERE version <= 2 ORDER BY version")).toEqual(oldRevisions);
      expect(rows("SELECT * FROM cash_confirmations WHERE entry_version = 2")).toEqual(oldConfirmations);
      expect(rows("SELECT entry_version, received_cents, actor_kind, actor_role FROM cash_confirmations ORDER BY entry_version")).toEqual([
        { entry_version: 2, received_cents: 600000, actor_kind: "vehicle_credential", actor_role: "owner" },
        { entry_version: 3, received_cents: 610000, actor_kind: "vehicle_credential", actor_role: "owner" },
      ]);
      expect(rows("SELECT version, action FROM work_entry_revisions ORDER BY version")).toEqual([
        { version: 1, action: "create" },
        { version: 2, action: "confirm" },
        { version: 3, action: "correct_and_confirm" },
      ]);
      const snapshot = JSON.parse(rows("SELECT snapshot_json FROM work_entry_revisions WHERE version = 3")[0]!.snapshot_json as string);
      expect(snapshot).toMatchObject({ id, status: "confirmed", version: 3, grossCents: 1000000, shareCents: 200000, remainderCents: 620000, receivedCents: "610000" });
      expect(rows("SELECT operation, entity_id, result_version, response_code FROM mutation_receipts WHERE request_id = 'x-1'")).toEqual([
        { operation: "work_entry.correct_and_confirm", entity_id: id, result_version: 3, response_code: 200 },
      ]);
      expect(counts().admin_audit).toBe(before.admin_audit);

      const one = (await (await getOne(owner, id)).json()).workEntry;
      expect(one).toMatchObject({ version: 3, remainderCents: "620000", confirmation: { receivedCents: "610000", entryVersion: 3 } });
      const listed = (await (await getList(owner)).json()).workEntries.filter((e: { id: string }) => e.id === id);
      expect(listed).toHaveLength(1);
      expect(listed[0].confirmation.receivedCents).toBe("610000");
    });

    it("kişi ve tarih değişimi: GET ve workerPersonId listesinde yeni kişi/tarihle görünür; pay yeniden hesaplanır", async () => {
      const id = await seedConfirmedEntry();
      const yesterday = istanbulToday(new Date(Date.now() - 86_400_000));
      const response = await correct(
        owner,
        id,
        correctBody("x-p", 2, "600000", { workerPersonId: SEED_IDS.driverA1b, date: yesterday, grossCents: "800000" }),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).workEntry).toMatchObject({
        version: 3,
        status: "confirmed",
        workDate: yesterday,
        grossCents: "800000",
        person: { id: SEED_IDS.driverA1b },
        confirmation: { receivedCents: "600000", entryVersion: 3 },
      });
      const one = (await (await getOne(owner, id)).json()).workEntry;
      expect(one).toMatchObject({ workDate: yesterday, person: { id: SEED_IDS.driverA1b } });
      const byNew = await (await listWorkEntries(new Request(`${URL_WORK_ENTRIES}?workerPersonId=${SEED_IDS.driverA1b}`, { headers: readHeaders(owner) }))).json();
      expect(byNew.workEntries.map((e: { id: string }) => e.id)).toEqual([id]);
      const byOld = await (await listWorkEntries(new Request(`${URL_WORK_ENTRIES}?workerPersonId=${SEED_IDS.driverA1a}`, { headers: readHeaders(owner) }))).json();
      expect(byOld.workEntries).toEqual([]);
    });

    it("ekip (admin ve destek) düzeltir: platform_user aktörü, sahip adına, tam bir admin_audit (gizli veri yok)", async () => {
      const id = await seedConfirmedEntry();
      const byAdmin = await correct(admin, id, correctBody("x-a"), SEED_IDS.vehicleA1);
      expect(byAdmin.status).toBe(200);
      expect(counts().admin_audit).toBe(1);
      const audit = rows("SELECT * FROM admin_audit")[0]!;
      expect(audit).toMatchObject({ entity_type: "work_entry", entity_id: id, action: "work_entry.correct_and_confirm", actor_kind: "platform_user", on_behalf_of_kind: "owner" });
      expect(JSON.parse(audit.before_json as string)).toMatchObject({ status: "confirmed", version: 2, grossCents: 1000000, receivedCents: "600000" });
      expect(JSON.parse(audit.after_json as string)).toMatchObject({ status: "confirmed", version: 3, grossCents: 1000000, receivedCents: "610000" });
      expect(JSON.stringify(audit)).not.toMatch(new RegExp(admin.token));
      expect(rows("SELECT actor_kind, actor_role, on_behalf_of_kind FROM cash_confirmations WHERE entry_version = 3")).toEqual([
        { actor_kind: "platform_user", actor_role: "admin", on_behalf_of_kind: "owner" },
      ]);
      expect(rows("SELECT actor_kind, actor_role FROM work_entry_revisions WHERE version = 3")).toEqual([{ actor_kind: "platform_user", actor_role: "admin" }]);

      const bySupport = await correct(support, id, correctBody("x-s", 3, "620000"), SEED_IDS.vehicleA1);
      expect(bySupport.status).toBe(200);
      expect(counts().admin_audit).toBe(2);
      expect(rows("SELECT entry_version, received_cents FROM cash_confirmations ORDER BY entry_version")).toEqual([
        { entry_version: 2, received_cents: 600000 },
        { entry_version: 3, received_cents: 610000 },
        { entry_version: 4, received_cents: 620000 },
      ]);
    });

    it("ekip düzeltmesi: GÜNCEL sürümün aktörü ekip kullanıcısıdır (önceki sahip onayı değil); sahip GET'i aynı, şoför GET'i actor null, kimlik sızmaz", async () => {
      const id = await seedConfirmedEntry();
      const response = await correct(support, id, correctBody("x-actor", 2, "610000"), SEED_IDS.vehicleA1);
      expect(response.status).toBe(200);
      const { workEntry } = await response.json();
      expect(workEntry).toMatchObject({
        version: 3,
        grossCents: "1000000",
        shareCents: "200000",
        remainderCents: "620000",
        confirmation: { receivedCents: "610000", entryVersion: 3, actor: { kind: "platform_user", username: SEED_USERNAMES.support } },
      });
      expect((await (await getOne(owner, id)).json()).workEntry.confirmation).toEqual(workEntry.confirmation);
      expect((await (await getOne(driver, id)).json()).workEntry.confirmation).toMatchObject({ entryVersion: 3, actor: null });
      const [confirmation] = rows("SELECT actor_session_id, actor_platform_user_id FROM cash_confirmations WHERE entry_version = 3");
      for (const value of Object.values(confirmation!)) expect(JSON.stringify(workEntry)).not.toContain(String(value));

      const replay = await correct(support, id, correctBody("x-actor", 2, "610000"), SEED_IDS.vehicleA1);
      expect(replay.status).toBe(200);
      expect((await replay.json()).workEntry).toEqual(workEntry);
      expect(rows("SELECT entry_version FROM cash_confirmations WHERE entry_version = 3")).toHaveLength(1);
      expect(counts().admin_audit).toBe(1);
    });

    it("başka aracın X-Target-Vehicle'ı ile ekip düzeltmesi 404 WORK_ENTRY_NOT_FOUND, hiçbir yazım yok", async () => {
      const id = await seedConfirmedEntry();
      const before = counts();
      const response = await correct(support, id, correctBody("x-actor-x"), SEED_IDS.vehicleB1);
      expect(response.status).toBe(404);
      expect((await errorOf(response)).code).toBe("WORK_ENTRY_NOT_FOUND");
      expect(counts()).toEqual(before);
    });

    it("istemcinin gönderdiği status/share/kind alanları yok sayılır; hesaplama sunucudadır", async () => {
      const id = await seedConfirmedEntry();
      const response = await correct(owner, id, correctBody("x-t", 2, "610000", { status: "pending", shareCents: "1", remainderCents: "1", workKind: "owner", businessId: SEED_IDS.businessB }));
      expect([200, 422]).toContain(response.status);
      const row = entryRow();
      expect(row).toMatchObject({ business_id: SEED_IDS.businessA, work_kind: "driver", share_cents: 200000, remainder_cents: 620000 });
      expect(row.status).toBe("confirmed");
    });
  });

  describe("yetki ve kapsam", () => {
    it("şoför oturumu 403, hiçbir yazım yok; oturum yok 401; araç oturumu X-Target-Vehicle ile 403", async () => {
      const id = await seedConfirmedEntry();
      const before = counts();
      const asDriver = await correct(driver, id, correctBody("x-d"));
      expect(asDriver.status).toBe(403);
      expect((await errorOf(asDriver)).code).toBe("FORBIDDEN");
      const anon = await correctAndConfirmRoute(
        new Request(`${URL_WORK_ENTRIES}/${id}/correct-and-confirm`, { method: "POST", headers: { origin: SELF_ORIGIN, "content-type": "application/json" }, body: JSON.stringify(correctBody("x-n")) }),
        { params: Promise.resolve({ id }) },
      );
      expect(anon.status).toBe(401);
      const header = await correct(owner, id, correctBody("x-h"), SEED_IDS.vehicleA2);
      expect(header.status).toBe(403);
      expect((await errorOf(header)).code).toBe("TARGET_HEADER_NOT_ALLOWED");
      expect(counts()).toEqual(before);
    });

    it("başka aracın, başka işletmenin ve bilinmeyen kimlikli kayıt AYNI 404 gövdesini alır; hiçbir yazım yok", async () => {
      const otherVehicle = await post(admin, { ...createDriver("c-a2"), workerPersonId: SEED_IDS.driverA2a }, SEED_IDS.vehicleA2);
      expect(otherVehicle.status).toBe(201);
      const otherVehicleId = (await otherVehicle.json()).workEntry.id;
      const ownerB = await loginVehicle(SEED_RAW_PLATES.vehicleB1, SEED_TEST_PASSWORDS.owner);
      const otherBusiness = await post(ownerB, { ...createDriver("c-b1"), workerPersonId: SEED_IDS.driverB1a });
      expect(otherBusiness.status).toBe(201);
      const otherBusinessId = (await otherBusiness.json()).workEntry.id;
      const before = counts();

      const bodies: unknown[] = [];
      for (const [session, id, target] of [
        [owner, otherVehicleId, undefined],
        [owner, otherBusinessId, undefined],
        [owner, "yok-boyle-kayit", undefined],
        [admin, otherVehicleId, SEED_IDS.vehicleA1],
        [admin, otherBusinessId, SEED_IDS.vehicleA1],
      ] as const) {
        const response = await correct(session, id, correctBody(`x-404-${bodies.length}`), target);
        expect(response.status).toBe(404);
        bodies.push({ ...(await response.json()), request_id: undefined });
      }
      expect((bodies[0] as { error: { code: string } }).error.code).toBe("WORK_ENTRY_NOT_FOUND");
      for (const body of bodies) expect(body).toEqual(bodies[0]);
      expect(counts()).toEqual(before);
    });
  });

  describe("durum ve doğrulama hataları", () => {
    it("onaysız (bekleyen) şoför kaydı 409 ENTRY_NOT_CONFIRMED; hiçbir yazım yok", async () => {
      const created = await post(driver, createDriver("c-pend"));
      const id = (await created.json()).workEntry.id;
      const before = counts();
      const response = await correct(owner, id, correctBody("x-pend", 1));
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe("ENTRY_NOT_CONFIRMED");
      expect(counts()).toEqual(before);
      expect(rows("SELECT status, version FROM work_entries")).toEqual([{ status: "pending", version: 1 }]);
    });

    it("sahip (onay gerekmeyen) kaydı 422 CONFIRMATION_NOT_REQUIRED alır; hiçbir yazım yok", async () => {
      const created = await post(owner, createOwner("c-own"));
      const id = (await created.json()).workEntry.id;
      const before = counts();
      const response = await correct(owner, id, correctBody("x-own", 1));
      expect(response.status).toBe(422);
      expect((await errorOf(response)).code).toBe("CONFIRMATION_NOT_REQUIRED");
      expect(counts()).toEqual(before);
    });

    it("workType owner 422 fields.workType; kayıt türü değişmez, hiçbir yazım yok", async () => {
      const id = await seedConfirmedEntry();
      const before = counts();
      const response = await correct(owner, id, correctBody("x-wt", 2, "610000", { workType: "owner" }));
      expect(response.status).toBe(422);
      const error = await errorOf(response);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(error.fields!)).toEqual(["workType"]);
      expect(counts()).toEqual(before);
      expect(entryRow()).toMatchObject({ work_kind: "driver", version: 2 });
    });

    it("geçersiz kişi (pasif, başka araç, sahip, bilinmeyen) 422 fields.workerPersonId", async () => {
      const id = await seedConfirmedEntry();
      const before = counts();
      for (const [n, person] of [SEED_IDS.driverA1d, SEED_IDS.driverA2a, SEED_IDS.ownerA, "yok-boyle-kisi"].entries()) {
        const response = await correct(owner, id, correctBody(`x-wp-${n}`, 2, "610000", { workerPersonId: person }));
        expect(response.status).toBe(422);
        expect(Object.keys((await errorOf(response)).fields!)).toEqual(["workerPersonId"]);
      }
      expect(counts()).toEqual(before);
    });

    const invalidReceived: [string, unknown][] = [
      ["eksik", undefined],
      ["boş metin", ""],
      ["null", null],
      ["sayı tipi", 610000],
      ["negatif", "-5"],
      ["ondalık", "12.5"],
      ["baştaki sıfır", "0620"],
      ["üst sınırı aşan", "9007199254740993"],
    ];
    for (const [label, value] of invalidReceived) {
      it(`receivedCents ${label}: 422 fields.receivedCents, hiçbir yazım yok`, async () => {
        const id = await seedConfirmedEntry();
        const before = counts();
        const body: Record<string, unknown> = correctBody("x-rv", 2);
        if (value === undefined) delete body.receivedCents;
        else body.receivedCents = value;
        const response = await correct(owner, id, body);
        expect(response.status).toBe(422);
        const error = await errorOf(response);
        expect(error.code).toBe("VALIDATION_ERROR");
        expect(Object.keys(error.fields!)).toEqual(["receivedCents"]);
        expect(counts()).toEqual(before);
        expect(entryRow()).toMatchObject({ status: "confirmed", version: 2 });
      });
    }

    it("geçersiz günlük alan (hasılat, bozuk tarih) 422; sunucu alınan tutarı kalandan doldurmaz", async () => {
      const id = await seedConfirmedEntry();
      const before = counts();
      const badGross = await correct(owner, id, correctBody("x-g", 2, "610000", { grossCents: "-1" }));
      expect(badGross.status).toBe(422);
      expect(Object.keys((await errorOf(badGross)).fields!)).toContain("grossCents");
      const badDate = await correct(owner, id, correctBody("x-dt", 2, "610000", { date: "bozuk" }));
      expect(badDate.status).toBe(422);
      expect(Object.keys((await errorOf(badDate)).fields!)).toContain("date");
      expect(counts()).toEqual(before);
    });

    it("hiçbir şey değişmiyorsa (aynı alanlar, aynı alınan tutar) 422 fields.change; tutar değişirse düzeltme sayılır", async () => {
      const id = await seedConfirmedEntry();
      const before = counts();
      const same = await correct(owner, id, correctBody("x-same", 2, "600000"));
      expect(same.status).toBe(422);
      expect(Object.keys((await errorOf(same)).fields!)).toEqual(["change"]);
      expect(counts()).toEqual(before);
      expect((await correct(owner, id, correctBody("x-diff", 2, "600001"))).status).toBe(200);
    });

    it("geçersiz zarf (requestId/version) route'ta 422; bozuk JSON 4xx; hiçbir yazım yok", async () => {
      const id = await seedConfirmedEntry();
      const before = counts();
      const badVersion = await correct(owner, id, { ...correctBody("x-e"), version: "2" });
      expect(badVersion.status).toBe(422);
      expect(Object.keys((await errorOf(badVersion)).fields!)).toContain("version");
      const noRequestId = await correct(owner, id, { ...correctBody("x-e"), requestId: undefined });
      expect(noRequestId.status).toBe(422);
      const broken = await correctAndConfirmRoute(
        new Request(`${URL_WORK_ENTRIES}/${id}/correct-and-confirm`, { method: "POST", headers: writeHeaders(owner), body: "{" }),
        { params: Promise.resolve({ id }) },
      );
      expect(broken.status).toBeGreaterThanOrEqual(400);
      expect(counts()).toEqual(before);
    });

    it("bayat sürüm 409 VERSION_CONFLICT kanonik metinle; PATCH onaylı kayda hâlâ 409 ENTRY_CONFIRMED", async () => {
      const id = await seedConfirmedEntry();
      const before = counts();
      const stale = await correct(owner, id, correctBody("x-st", 1));
      expect(stale.status).toBe(409);
      const error = await errorOf(stale);
      expect(error.code).toBe("VERSION_CONFLICT");
      expect(error.message).toBe("Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.");
      const edited = await patch(owner, id, { requestId: "p-c", version: 2, ...daily({ grossCents: "500000" }) });
      expect(edited.status).toBe(409);
      expect((await errorOf(edited)).code).toBe("ENTRY_CONFIRMED");
      expect(counts()).toEqual(before);
    });
  });

  describe("replay", () => {
    it("aynı requestId + gövde tekrarı 200 döner, ikinci sürüm/onay yazılmaz; farklı gövde 409 REQUEST_ID_REUSED", async () => {
      const id = await seedConfirmedEntry();
      const first = await correct(owner, id, correctBody("x-r"));
      expect(first.status).toBe(200);
      const firstBody = (await first.json()).workEntry;
      const after = counts();

      const replay = await correct(owner, id, correctBody("x-r"));
      expect(replay.status).toBe(200);
      expect((await replay.json()).workEntry).toEqual(firstBody);
      expect(counts()).toEqual(after);
      expect(entryRow()).toMatchObject({ version: 3 });

      const differentAmount = await correct(owner, id, correctBody("x-r", 2, "610001"));
      expect(differentAmount.status).toBe(409);
      expect((await errorOf(differentAmount)).code).toBe("REQUEST_ID_REUSED");
      const differentField = await correct(owner, id, { ...correctBody("x-r"), grossCents: "900000" });
      expect(differentField.status).toBe(409);
      expect((await errorOf(differentField)).code).toBe("REQUEST_ID_REUSED");
      expect(counts()).toEqual(after);
    });

    it("aynı aktörün bir oluşturma/PATCH/onay makbuzunun requestId'si burada 409 REQUEST_ID_REUSED alır", async () => {
      const created = await post(owner, createDriver("o-create"));
      const id = (await created.json()).workEntry.id as string;
      expect((await patch(owner, id, { requestId: "o-patch", version: 1, ...daily({ grossCents: "900000" }) })).status).toBe(200);
      expect((await confirm(owner, id, confirmBody("o-confirm", 2, "600000"))).status).toBe(200);
      const before = counts();
      for (const used of ["o-create", "o-patch", "o-confirm"]) {
        const response = await correct(owner, id, correctBody(used, 3));
        expect(response.status).toBe(409);
        expect((await errorOf(response)).code).toBe("REQUEST_ID_REUSED");
      }
      expect(counts()).toEqual(before);
    });

    it("aynı requestId + gövde ile 20 eşzamanlı istek: hepsi 200, aynı sürüm, tek yeni onay ve tek makbuz", async () => {
      const id = await seedConfirmedEntry();
      const responses = await Promise.all(Array.from({ length: 20 }, () => correct(owner, id, correctBody("x-many"))));
      expect(responses.map((r) => r.status)).toEqual(Array(20).fill(200));
      const versions = await Promise.all(responses.map(async (r) => (await r.json()).workEntry.version));
      expect(new Set(versions)).toEqual(new Set([3]));
      expect(rows("SELECT COUNT(*) AS n FROM cash_confirmations")).toEqual([{ n: 2 }]);
      expect(rows("SELECT COUNT(*) AS n FROM mutation_receipts WHERE request_id = 'x-many'")).toEqual([{ n: 1 }]);
      expect(rows("SELECT COUNT(*) AS n FROM work_entry_revisions WHERE action = 'correct_and_confirm'")).toEqual([{ n: 1 }]);
    });
  });

  describe("eşzamanlılık", () => {
    it("aynı eski sürüme iki FARKLI düzeltme: biri 200, diğeri 409 VERSION_CONFLICT; tek yeni revizyon ve tek yeni onay", async () => {
      const id = await seedConfirmedEntry();
      const [a, b] = await Promise.all([
        correct(owner, id, correctBody("x-race-a", 2, "610000")),
        correct(admin, id, correctBody("x-race-b", 2, "620000"), SEED_IDS.vehicleA1),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const [winner, loser] = a.status === 200 ? [a, b] : [b, a];
      const error = await errorOf(loser);
      expect(error.code).toBe("VERSION_CONFLICT");
      expect(error.message).toBe("Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.");
      const won = (await winner.json()).workEntry;
      expect(rows("SELECT COUNT(*) AS n FROM work_entry_revisions WHERE version = 3")).toEqual([{ n: 1 }]);
      expect(rows("SELECT entry_version, received_cents FROM cash_confirmations ORDER BY entry_version")).toEqual([
        { entry_version: 2, received_cents: 600000 },
        { entry_version: 3, received_cents: Number(won.confirmation.receivedCents) },
      ]);
      expect(entryRow()).toMatchObject({ version: 3, status: "confirmed" });
    });
  });

  describe("atomiklik (hata enjeksiyonu)", () => {
    const targets = [
      ["BEFORE UPDATE ON work_entries", "work_entries UPDATE"],
      ["BEFORE INSERT ON work_entry_revisions", "revizyon INSERT"],
      ["BEFORE INSERT ON cash_confirmations", "onay INSERT"],
      ["BEFORE INSERT ON admin_audit", "audit INSERT"],
      ["BEFORE INSERT ON mutation_receipts", "makbuz INSERT"],
    ] as const;
    for (const [event, label] of targets) {
      it(`${label} başarısız olursa eski kayıt ve onay eksiksiz kalır; aynı requestId sonra tek kez başarılı olur`, async () => {
        const id = await seedConfirmedEntry();
        const before = counts();
        const entryBefore = rows("SELECT * FROM work_entries");
        const revisionsBefore = rows("SELECT * FROM work_entry_revisions ORDER BY version");
        const confirmationsBefore = rows("SELECT * FROM cash_confirmations");
        withRaw((sqlite) => sqlite.exec(`CREATE TRIGGER inject_fail ${event} BEGIN SELECT RAISE(ABORT, 'enjekte hata'); END`));
        await expect(correct(admin, id, correctBody("x-inject"), SEED_IDS.vehicleA1)).rejects.toThrow();
        expect(counts()).toEqual(before);
        expect(rows("SELECT * FROM work_entries")).toEqual(entryBefore);
        expect(rows("SELECT * FROM work_entry_revisions ORDER BY version")).toEqual(revisionsBefore);
        expect(rows("SELECT * FROM cash_confirmations")).toEqual(confirmationsBefore);

        withRaw((sqlite) => sqlite.exec("DROP TRIGGER inject_fail"));
        const retry = await correct(admin, id, correctBody("x-inject"), SEED_IDS.vehicleA1);
        expect(retry.status).toBe(200);
        expect(counts()).toEqual({
          ...before,
          work_entry_revisions: before.work_entry_revisions! + 1,
          cash_confirmations: 2,
          mutation_receipts: before.mutation_receipts! + 1,
          admin_audit: before.admin_audit! + 1,
        });
        expect(entryRow()).toMatchObject({ version: 3, status: "confirmed" });
      });
    }
  });
});
