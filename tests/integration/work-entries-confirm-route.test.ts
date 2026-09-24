/**
 * POST /api/v1/work-entries/:id/confirm — T4.1 teslim onayı. Gerçek geçici SQLite
 * dosyası + gerçek migration + seed (mock/`:memory:` YOK). Kapsam: başarılı onay
 * (sahip/ekip), `receivedCents` doğrulaması, yetki, onay gerekmeyen kayıt,
 * replay/REQUEST_ID_REUSED, sürüm ve onaylı çakışmaları, kapsam dışı 404,
 * eşzamanlılık, atomiklik (hata enjeksiyonu) ve görünümdeki `confirmation`.
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

describe("teslim onayı (T4.1)", () => {
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
  const errorOf = async (response: Response) => (await response.json()).error as { code: string; fields?: Record<string, string> };

  async function seedDriverEntry(requestId = "c-1"): Promise<string> {
    const response = await post(driver, createDriver(requestId));
    expect(response.status).toBe(201);
    return (await response.json()).workEntry.id;
  }

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-work-entries-confirm-"));
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

  describe("başarılı onay", () => {
    it("sahip bekleyen şoför kaydını onaylar: 200, confirmed, version 2, alınan tutar açıkça gönderilen değer; bir revizyon + bir onay + bir makbuz, audit yok", async () => {
      const id = await seedDriverEntry();
      const before = counts();
      const response = await confirm(owner, id, confirmBody("k-1"));
      expect(response.status).toBe(200);
      const { workEntry } = await response.json();
      expect(workEntry).toMatchObject({
        id,
        status: "confirmed",
        version: 2,
        remainderCents: "620000",
        confirmation: { receivedCents: "620000", entryVersion: 2 },
      });
      expect(new Date(workEntry.confirmation.confirmedAt).toISOString()).toBe(workEntry.confirmation.confirmedAt);
      expect(Object.keys(workEntry.confirmation).sort()).toEqual(["confirmedAt", "entryVersion", "receivedCents"]);

      expect(counts()).toEqual({
        ...before,
        work_entry_revisions: before.work_entry_revisions! + 1,
        mutation_receipts: before.mutation_receipts! + 1,
        cash_confirmations: 1,
      });
      expect(rows("SELECT status, version FROM work_entries")).toEqual([{ status: "confirmed", version: 2 }]);
      expect(rows("SELECT version, action, actor_kind, actor_role FROM work_entry_revisions ORDER BY version")).toEqual([
        { version: 1, action: "create", actor_kind: "vehicle_credential", actor_role: "driver" },
        { version: 2, action: "confirm", actor_kind: "vehicle_credential", actor_role: "owner" },
      ]);
      expect(rows("SELECT entry_id, entry_version, received_cents, actor_kind, actor_role FROM cash_confirmations")).toEqual([
        { entry_id: id, entry_version: 2, received_cents: 620000, actor_kind: "vehicle_credential", actor_role: "owner" },
      ]);
      expect(rows("SELECT operation, entity_id, result_version, response_code FROM mutation_receipts WHERE request_id = 'k-1'")).toEqual([
        { operation: "work_entry.confirm", entity_id: id, result_version: 2, response_code: 200 },
      ]);
      const snapshot = JSON.parse(rows("SELECT snapshot_json FROM work_entry_revisions WHERE version = 2")[0]!.snapshot_json as string);
      expect(snapshot).toMatchObject({ id, status: "confirmed", version: 2, receivedCents: "620000" });
    });

    it("alınan tutar kalandan farklı olabilir ve sunucu onu asla kalandan doldurmaz (0 dahil)", async () => {
      const id = await seedDriverEntry();
      const response = await confirm(owner, id, confirmBody("k-zero", 1, "0"));
      expect(response.status).toBe(200);
      expect((await response.json()).workEntry.confirmation.receivedCents).toBe("0");
      expect(rows("SELECT received_cents FROM cash_confirmations")).toEqual([{ received_cents: 0 }]);
    });

    it("ekip (admin ve destek) X-Target-Vehicle ile onaylar: platform_user aktörü, sahip adına, tam bir admin_audit (gizli veri yok)", async () => {
      const id = await seedDriverEntry("c-s");
      const byAdmin = await confirm(admin, id, confirmBody("k-a"), SEED_IDS.vehicleA1);
      expect(byAdmin.status).toBe(200);
      expect(counts().admin_audit).toBe(1);
      const audit = rows("SELECT * FROM admin_audit")[0]!;
      expect(audit).toMatchObject({ entity_type: "work_entry", entity_id: id, action: "work_entry.confirm", actor_kind: "platform_user", on_behalf_of_kind: "owner" });
      expect(JSON.parse(audit.before_json as string)).toEqual({ status: "pending", version: 1 });
      expect(JSON.parse(audit.after_json as string)).toEqual({ status: "confirmed", version: 2, receivedCents: "620000" });
      expect(JSON.stringify(audit)).not.toMatch(new RegExp(admin.token));
      expect(rows("SELECT actor_kind, actor_role, on_behalf_of_kind FROM cash_confirmations")).toEqual([
        { actor_kind: "platform_user", actor_role: "admin", on_behalf_of_kind: "owner" },
      ]);

      const id2 = await seedDriverEntry("c-s2");
      expect((await confirm(support, id2, confirmBody("k-sup"), SEED_IDS.vehicleA1)).status).toBe(200);
      expect(counts().admin_audit).toBe(2);
    });
  });

  describe("receivedCents doğrulaması", () => {
    const invalid: [string, unknown][] = [
      ["eksik", undefined],
      ["boş metin", ""],
      ["null", null],
      ["sayı tipi", 620000],
      ["negatif", "-5"],
      ["ondalık", "12.5"],
      ["harf", "abc"],
      ["baştaki sıfır", "0620"],
      ["üst sınırı aşan", "9007199254740993"],
    ];
    for (const [label, value] of invalid) {
      it(`${label}: 422 fields.receivedCents, hiçbir yazım yok`, async () => {
        const id = await seedDriverEntry();
        const before = counts();
        const body: Record<string, unknown> = { requestId: "k-v", version: 1 };
        if (value !== undefined) body.receivedCents = value;
        const response = await confirm(owner, id, body);
        expect(response.status).toBe(422);
        const error = await errorOf(response);
        expect(error.code).toBe("VALIDATION_ERROR");
        expect(Object.keys(error.fields!)).toEqual(["receivedCents"]);
        expect(counts()).toEqual(before);
        expect(rows("SELECT status, version FROM work_entries")).toEqual([{ status: "pending", version: 1 }]);
      });
    }

    it("geçersiz zarf (requestId/version) route'ta 422; bozuk JSON 4xx; hiçbir yazım yok", async () => {
      const id = await seedDriverEntry();
      const before = counts();
      const badVersion = await confirm(owner, id, { requestId: "k-e", version: "1", receivedCents: "1" });
      expect(badVersion.status).toBe(422);
      expect(Object.keys((await errorOf(badVersion)).fields!)).toContain("version");
      const noRequestId = await confirm(owner, id, { version: 1, receivedCents: "1" });
      expect(noRequestId.status).toBe(422);
      expect(Object.keys((await errorOf(noRequestId)).fields!)).toContain("requestId");
      const broken = await confirmWorkEntryRoute(
        new Request(`${URL_WORK_ENTRIES}/${id}/confirm`, { method: "POST", headers: writeHeaders(owner), body: "{" }),
        { params: Promise.resolve({ id }) },
      );
      expect(broken.status).toBeGreaterThanOrEqual(400);
      expect(counts()).toEqual(before);
    });

    it("istemcinin gönderdiği status/share/businessId alanları yok sayılır ya da reddedilir; kayıt istemci değeriyle değişmez", async () => {
      const id = await seedDriverEntry();
      const response = await confirm(owner, id, { ...confirmBody("k-x"), status: "not_required", shareCents: "1", businessId: SEED_IDS.businessB });
      expect([200, 422]).toContain(response.status);
      const [row] = rows("SELECT status, share_cents, business_id FROM work_entries");
      expect(row!.business_id).toBe(SEED_IDS.businessA);
      expect(row!.share_cents).toBe(200000);
      expect(row!.status).not.toBe("not_required");
    });
  });

  describe("yetki ve kapsam", () => {
    it("şoför oturumu 403, hiçbir yazım yok; oturum yok 401; araç oturumu X-Target-Vehicle ile 403", async () => {
      const id = await seedDriverEntry();
      const before = counts();
      const asDriver = await confirm(driver, id, confirmBody("k-d"));
      expect(asDriver.status).toBe(403);
      expect((await errorOf(asDriver)).code).toBe("FORBIDDEN");
      const anon = await confirmWorkEntryRoute(
        new Request(`${URL_WORK_ENTRIES}/${id}/confirm`, { method: "POST", headers: { origin: SELF_ORIGIN, "content-type": "application/json" }, body: JSON.stringify(confirmBody("k-n")) }),
        { params: Promise.resolve({ id }) },
      );
      expect(anon.status).toBe(401);
      const header = await confirm(owner, id, confirmBody("k-h"), SEED_IDS.vehicleA2);
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
        const response = await confirm(session, id, confirmBody(`k-404-${bodies.length}`), target);
        expect(response.status).toBe(404);
        bodies.push({ ...(await response.json()), request_id: undefined });
      }
      expect((bodies[0] as { error: { code: string } }).error.code).toBe("WORK_ENTRY_NOT_FOUND");
      for (const body of bodies) expect(body).toEqual(bodies[0]);
      expect(counts()).toEqual(before);
    });

    it("sahip (onay gerekmeyen) kaydı 422 CONFIRMATION_NOT_REQUIRED alır; hiçbir yazım yok; geçersiz tutar bu hatayı gizlemez", async () => {
      const created = await post(owner, createOwner("c-own"));
      expect(created.status).toBe(201);
      const id = (await created.json()).workEntry.id;
      const before = counts();
      const response = await confirm(owner, id, confirmBody("k-own"));
      expect(response.status).toBe(422);
      const error = await errorOf(response);
      expect(error.code).toBe("CONFIRMATION_NOT_REQUIRED");
      expect(error.fields).toBeUndefined();
      expect((await errorOf(await confirm(owner, id, confirmBody("k-own2", 1, "abc")))).code).toBe("CONFIRMATION_NOT_REQUIRED");
      expect(counts()).toEqual(before);
      expect(rows("SELECT status, version FROM work_entries")).toEqual([{ status: "not_required", version: 1 }]);
    });
  });

  describe("replay, sürüm ve onaylı çakışmaları", () => {
    it("aynı requestId + gövde tekrarı 200 döner, ikinci onay yazılmaz; farklı gövde 409 REQUEST_ID_REUSED", async () => {
      const id = await seedDriverEntry();
      const first = await confirm(owner, id, confirmBody("k-r"));
      expect(first.status).toBe(200);
      const after = counts();
      const replay = await confirm(owner, id, confirmBody("k-r"));
      expect(replay.status).toBe(200);
      expect((await replay.json()).workEntry).toMatchObject({ status: "confirmed", version: 2, confirmation: { receivedCents: "620000" } });
      expect(counts()).toEqual(after);

      const different = await confirm(owner, id, confirmBody("k-r", 1, "600000"));
      expect(different.status).toBe(409);
      expect((await errorOf(different)).code).toBe("REQUEST_ID_REUSED");
      expect(counts()).toEqual(after);
    });

    it("bir PATCH/oluşturma makbuzunun requestId'si onayda 409 REQUEST_ID_REUSED alır", async () => {
      const created = await post(owner, createDriver("c-reuse"));
      expect(created.status).toBe(201);
      const id = (await created.json()).workEntry.id;
      const before = counts();
      const usedByCreate = await confirm(owner, id, confirmBody("c-reuse"));
      expect(usedByCreate.status).toBe(409);
      expect((await errorOf(usedByCreate)).code).toBe("REQUEST_ID_REUSED");
      const edited = await patch(owner, id, { requestId: "p-1", version: 1, ...daily({ grossCents: "500000" }) });
      expect(edited.status).toBe(200);
      const usedByPatch = await confirm(owner, id, confirmBody("p-1", 2));
      expect(usedByPatch.status).toBe(409);
      expect((await errorOf(usedByPatch)).code).toBe("REQUEST_ID_REUSED");
      expect(counts().cash_confirmations).toBe(before.cash_confirmations);
    });

    it("bayat sürüm 409 VERSION_CONFLICT (PATCH sonrası eski sürümle onay); güncel sürümle onay çalışır", async () => {
      const id = await seedDriverEntry();
      expect((await patch(owner, id, { requestId: "p-2", version: 1, ...daily({ grossCents: "500000" }) })).status).toBe(200);
      const before = counts();
      const stale = await confirm(owner, id, confirmBody("k-stale", 1));
      expect(stale.status).toBe(409);
      expect((await errorOf(stale)).code).toBe("VERSION_CONFLICT");
      expect(counts()).toEqual(before);
      expect((await confirm(owner, id, confirmBody("k-fresh", 2, "220000"))).status).toBe(200);
      expect(rows("SELECT entry_version, received_cents FROM cash_confirmations")).toEqual([{ entry_version: 3, received_cents: 220000 }]);
    });

    it("onaylı kayıtta güncel sürümle yeni onay 409 ENTRY_CONFIRMED; eski sürümle 409 VERSION_CONFLICT; PATCH 409 ENTRY_CONFIRMED", async () => {
      const id = await seedDriverEntry();
      expect((await confirm(owner, id, confirmBody("k-1"))).status).toBe(200);
      const after = counts();
      const again = await confirm(owner, id, confirmBody("k-2", 2));
      expect(again.status).toBe(409);
      expect((await errorOf(again)).code).toBe("ENTRY_CONFIRMED");
      const old = await confirm(owner, id, confirmBody("k-3", 1));
      expect(old.status).toBe(409);
      expect((await errorOf(old)).code).toBe("VERSION_CONFLICT");
      const edited = await patch(owner, id, { requestId: "p-3", version: 2, ...daily({ grossCents: "500000" }) });
      expect(edited.status).toBe(409);
      expect((await errorOf(edited)).code).toBe("ENTRY_CONFIRMED");
      expect(counts()).toEqual(after);
    });
  });

  describe("eşzamanlılık", () => {
    it("aynı sürümde iki farklı onay: biri 200, diğeri 409 VERSION_CONFLICT; tek onay satırı", async () => {
      const id = await seedDriverEntry();
      const [a, b] = await Promise.all([
        confirm(owner, id, confirmBody("k-race-a", 1, "620000")),
        confirm(admin, id, confirmBody("k-race-b", 1, "600000"), SEED_IDS.vehicleA1),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect((await errorOf(a.status === 409 ? a : b)).code).toBe("VERSION_CONFLICT");
      expect(counts().cash_confirmations).toBe(1);
      expect(rows("SELECT version, status FROM work_entries")).toEqual([{ version: 2, status: "confirmed" }]);
    });

    it("aynı requestId + gövde ile 20 eşzamanlı istek: hepsi 200, aynı sürüm, tek onay satırı", async () => {
      const id = await seedDriverEntry();
      const responses = await Promise.all(Array.from({ length: 20 }, () => confirm(owner, id, confirmBody("k-many"))));
      expect(responses.map((r) => r.status)).toEqual(Array(20).fill(200));
      const versions = await Promise.all(responses.map(async (r) => (await r.json()).workEntry.version));
      expect(new Set(versions)).toEqual(new Set([2]));
      expect(counts().cash_confirmations).toBe(1);
      expect(rows("SELECT COUNT(*) AS n FROM mutation_receipts WHERE request_id = 'k-many'")).toEqual([{ n: 1 }]);
    });

    it("aynı sürümde PATCH ve onay yarışı: biri kazanır, diğeri 409; onay yalnız onay kazandıysa vardır", async () => {
      const id = await seedDriverEntry();
      const [p, c] = await Promise.all([
        patch(owner, id, { requestId: "p-race", version: 1, ...daily({ grossCents: "500000" }) }),
        confirm(admin, id, confirmBody("k-race-p", 1), SEED_IDS.vehicleA1),
      ]);
      expect([p.status, c.status].sort()).toEqual([200, 409]);
      if (c.status === 200) expect((await errorOf(p)).code).toBe("ENTRY_CONFIRMED");
      else expect((await errorOf(c)).code).toBe("VERSION_CONFLICT");
      expect(counts().cash_confirmations).toBe(c.status === 200 ? 1 : 0);
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
      it(`${label} başarısız olursa kayıt 1. sürümde bekleyen kalır, satır kalmaz; aynı requestId sonra tek kez başarılı olur`, async () => {
        const id = await seedDriverEntry();
        const before = counts();
        const entryBefore = rows("SELECT * FROM work_entries");
        withRaw((sqlite) => sqlite.exec(`CREATE TRIGGER inject_fail ${event} BEGIN SELECT RAISE(ABORT, 'enjekte hata'); END`));
        await expect(confirm(admin, id, confirmBody("k-inject"), SEED_IDS.vehicleA1)).rejects.toThrow();
        expect(counts()).toEqual(before);
        expect(rows("SELECT * FROM work_entries")).toEqual(entryBefore);
        expect(rows("SELECT status, version FROM work_entries")).toEqual([{ status: "pending", version: 1 }]);

        withRaw((sqlite) => sqlite.exec("DROP TRIGGER inject_fail"));
        const retry = await confirm(admin, id, confirmBody("k-inject"), SEED_IDS.vehicleA1);
        expect(retry.status).toBe(200);
        expect(counts()).toEqual({
          ...before,
          work_entry_revisions: before.work_entry_revisions! + 1,
          mutation_receipts: before.mutation_receipts! + 1,
          admin_audit: before.admin_audit! + 1,
          cash_confirmations: 1,
        });
      });
    }
  });

  describe("görünümde confirmation", () => {
    it("GET /:id onaydan önce confirmation null, sonra nesne; liste de aynı; PATCH/oluşturma yanıtı null", async () => {
      const created = await post(driver, createDriver("c-view"));
      const createdBody = await created.json();
      expect(createdBody.workEntry.confirmation).toBeNull();
      const id = createdBody.workEntry.id;

      expect((await (await getOne(owner, id)).json()).workEntry.confirmation).toBeNull();
      const edited = await patch(owner, id, { requestId: "p-v", version: 1, ...daily({ grossCents: "500000" }) });
      expect((await edited.json()).workEntry.confirmation).toBeNull();

      expect((await confirm(owner, id, confirmBody("k-view", 2, "220000"))).status).toBe(200);
      const one = (await (await getOne(owner, id)).json()).workEntry;
      expect(one.confirmation).toMatchObject({ receivedCents: "220000", entryVersion: 3 });
      const listed = (await (await getList(owner)).json()).workEntries.find((e: { id: string }) => e.id === id);
      expect(listed.confirmation).toEqual(one.confirmation);
    });

    it("yalnız GÜNCEL sürümün onayı bağlanır: eski sürüm numaralı onay satırı görünmez", async () => {
      const id = await seedDriverEntry();
      expect((await confirm(owner, id, confirmBody("k-old"))).status).toBe(200);
      // Onay satırını sürüm 2'de bırakıp kaydın sürümünü ileri sarmak: eski sürümün onayı eşleşmemeli.
      withRaw((sqlite) => sqlite.prepare("UPDATE work_entries SET version = 3 WHERE id = ?").run(id));
      expect((await (await getOne(owner, id)).json()).workEntry.confirmation).toBeNull();
    });
  });
});
