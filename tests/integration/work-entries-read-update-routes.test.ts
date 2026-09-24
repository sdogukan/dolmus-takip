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
import { scopeFromVehicleSession } from "../../src/server/auth/scope";
import { updateWorkEntry } from "../../src/server/usecases/work-entries";
import type { SessionContext } from "../../src/server/usecases/session/types";
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

function post(session: Session, body: unknown, targetVehicle?: string): Promise<Response> {
  return postWorkEntry(
    new Request(URL_WORK_ENTRIES, { method: "POST", headers: writeHeaders(session, targetVehicle), body: JSON.stringify(body) }),
  );
}

function patch(session: Session, id: string, body: unknown, targetVehicle?: string): Promise<Response> {
  return patchWorkEntry(
    new Request(`${URL_WORK_ENTRIES}/${id}`, { method: "PATCH", headers: writeHeaders(session, targetVehicle), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

const readHeaders = (session: Session, targetVehicle?: string) => ({
  cookie: `dolmus_session=${session.token}`,
  ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
});

function getOne(session: Session, id: string, targetVehicle?: string): Promise<Response> {
  return getWorkEntry(new Request(`${URL_WORK_ENTRIES}/${id}`, { headers: readHeaders(session, targetVehicle) }), {
    params: Promise.resolve({ id }),
  });
}

function getList(session: Session, query = "", targetVehicle?: string): Promise<Response> {
  return listWorkEntries(new Request(`${URL_WORK_ENTRIES}${query}`, { headers: readHeaders(session, targetVehicle) }));
}

const TODAY = istanbulToday();
const YESTERDAY = new Date(Date.parse(`${TODAY}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

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
const createOwner = (requestId: string, extra: Record<string, unknown> = {}) => ({ requestId, workType: "owner", ...daily(extra) });
const edit = (requestId: string, version: number, extra: Record<string, unknown> = {}) => ({
  requestId,
  version,
  ...daily({ grossCents: "500000" }),
  ...extra,
});

describe("work-entries okuma ve düzenleme (T3.5)", () => {
  let dir: string;
  let dbPath: string;
  let owner: Session;
  let driver: Session;
  let admin: Session;
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

  async function seedDriverEntry(requestId = "c-1", extra: Record<string, unknown> = {}): Promise<string> {
    const response = await post(driver, createDriver(requestId, extra));
    expect(response.status).toBe(201);
    return (await response.json()).workEntry.id;
  }

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-work-entries-edit-"));
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

  describe("PATCH — başarılı düzenleme", () => {
    it("şoför bekleyen kaydı düzenler: 200, version+1, pending, yeniden hesap; tek UPDATE + revizyon(update) + makbuz, audit/onay yok", async () => {
      const id = await seedDriverEntry();
      const response = await patch(driver, id, edit("e-1", 1));
      expect(response.status).toBe(200);
      const { workEntry } = await response.json();
      expect(workEntry).toMatchObject({
        id,
        version: 2,
        status: "pending",
        workKind: "driver",
        grossCents: "500000",
        shareBps: 2000,
        shareCents: "100000",
        remainderCents: "220000",
        person: { id: SEED_IDS.driverA1a },
      });

      expect(counts()).toEqual({ work_entries: 1, work_entry_revisions: 2, mutation_receipts: 2, admin_audit: 0, cash_confirmations: 0 });
      expect(rows("SELECT version, action, actor_kind, actor_role FROM work_entry_revisions ORDER BY version")).toEqual([
        { version: 1, action: "create", actor_kind: "vehicle_credential", actor_role: "driver" },
        { version: 2, action: "update", actor_kind: "vehicle_credential", actor_role: "driver" },
      ]);
      expect(JSON.parse(rows("SELECT snapshot_json FROM work_entry_revisions WHERE version = 2")[0]!.snapshot_json as string)).toMatchObject({
        id,
        version: 2,
        grossCents: 500000,
        shareCents: 100000,
      });
      expect(rows("SELECT operation, request_id, entity_id, result_version, response_code FROM mutation_receipts WHERE request_id = 'e-1'")).toEqual([
        { operation: "work_entry.update", request_id: "e-1", entity_id: id, result_version: 2, response_code: 200 },
      ]);
      expect(rows("SELECT status, version, work_kind FROM work_entries")).toEqual([{ status: "pending", version: 2, work_kind: "driver" }]);
    });

    it("ekip düzenlemesi: tam bir admin_audit (before/after günlük alanlar + sürüm, gizli veri yok) ve platform_user revizyonu", async () => {
      const id = await seedDriverEntry();
      const response = await patch(admin, id, edit("e-staff", 1), SEED_IDS.vehicleA1);
      expect(response.status).toBe(200);
      expect(counts()).toEqual({ work_entries: 1, work_entry_revisions: 2, mutation_receipts: 2, admin_audit: 1, cash_confirmations: 0 });

      const audit = rows("SELECT * FROM admin_audit")[0]!;
      expect(audit).toMatchObject({
        action: "work_entry.update",
        entity_type: "work_entry",
        entity_id: id,
        business_id: SEED_IDS.businessA,
        vehicle_id: SEED_IDS.vehicleA1,
        actor_kind: "platform_user",
        actor_platform_user_id: SEED_IDS.platformAdmin1,
        on_behalf_of_kind: "owner",
        on_behalf_of_person_id: SEED_IDS.ownerA,
      });
      expect(JSON.parse(audit.before_json as string)).toMatchObject({ version: 1, grossCents: 1000000, status: "pending" });
      expect(JSON.parse(audit.after_json as string)).toMatchObject({ version: 2, grossCents: 500000, shareCents: 100000, status: "pending" });
      expect(`${audit.before_json}${audit.after_json}`).not.toMatch(/token|hash|cookie|csrf/iu);
      expect(rows("SELECT actor_kind, on_behalf_of_person_id FROM work_entry_revisions WHERE version = 2")).toEqual([
        { actor_kind: "platform_user", on_behalf_of_person_id: SEED_IDS.ownerA },
      ]);
    });

    it("sahip kaydı: owner oturumu düzenler; pay 0, not_required, kişi sabit; ekip de düzenler ve audit yazar", async () => {
      const created = await post(owner, createOwner("c-own"));
      const id = (await created.json()).workEntry.id;
      const response = await patch(owner, id, edit("e-own", 1, { workType: "owner", workerPersonId: SEED_IDS.driverA1a }));
      expect(response.status).toBe(200);
      const { workEntry } = await response.json();
      expect(workEntry).toMatchObject({
        version: 2,
        status: "not_required",
        workKind: "owner",
        shareBps: 0,
        shareCents: "0",
        remainderCents: "320000",
        person: { id: SEED_IDS.ownerA },
      });
      expect(counts().admin_audit).toBe(0);

      const staff = await patch(admin, id, edit("e-own-s", 2, { grossCents: "600000" }), SEED_IDS.vehicleA1);
      expect(staff.status).toBe(200);
      expect((await staff.json()).workEntry).toMatchObject({ version: 3, status: "not_required", shareCents: "0", person: { id: SEED_IDS.ownerA } });
      expect(counts().admin_audit).toBe(1);
    });

    it("istemcinin gönderdiği pay/durum/tür/işletme alanları atılır; sunucu değerleri kazanır", async () => {
      const id = await seedDriverEntry();
      const response = await patch(driver, id, edit("e-extra", 1, { shareCents: "1", shareBps: 0, status: "confirmed", workKind: "owner", businessId: "x", id: "baska" }));
      expect(response.status).toBe(200);
      const { workEntry } = await response.json();
      expect(workEntry).toMatchObject({ id, status: "pending", workKind: "driver", shareBps: 2000, shareCents: "100000" });
    });

    it("şoför kişiyi seçilebilir başka şoförle değiştirir; seçilemeyen kişi 422 workerPersonId", async () => {
      const id = await seedDriverEntry();
      const changed = await patch(driver, id, edit("e-p1", 1, { workerPersonId: SEED_IDS.driverA1b }));
      expect(changed.status).toBe(200);
      expect((await changed.json()).workEntry.person.id).toBe(SEED_IDS.driverA1b);

      for (const [n, person] of [SEED_IDS.driverA1d, SEED_IDS.driverA2a, SEED_IDS.ownerA, "yok-boyle-kisi"].entries()) {
        const rejected = await patch(driver, id, edit(`e-p-bad-${n}`, 2, { workerPersonId: person }));
        expect(rejected.status).toBe(422);
        expect(Object.keys((await rejected.json()).error.fields)).toEqual(["workerPersonId"]);
      }
      expect(rows("SELECT version FROM work_entries")).toEqual([{ version: 2 }]);
    });
  });

  describe("PATCH — sürüm, onay, tür, değişiklik yok", () => {
    it("bayat sürüm 409 VERSION_CONFLICT; satır ve tablolar değişmez; 'değişiklik yok'tan ÖNCE denetlenir", async () => {
      const id = await seedDriverEntry();
      expect((await patch(driver, id, edit("e-v1", 1))).status).toBe(200);
      const before = counts();

      const stale = await patch(driver, id, edit("e-v-stale", 1, { grossCents: "700000" }));
      expect(stale.status).toBe(409);
      expect((await stale.json()).error.code).toBe("VERSION_CONFLICT");
      const staleSame = await patch(driver, id, edit("e-v-stale-same", 1));
      expect(staleSame.status).toBe(409);
      expect(counts()).toEqual(before);
      expect(rows("SELECT version, gross_cents FROM work_entries")).toEqual([{ version: 2, gross_cents: 500000 }]);
    });

    it("onaylı kayıt 409 ENTRY_CONFIRMED (sürüm doğru olsa da); hiçbir şey yazılmaz", async () => {
      const id = await seedDriverEntry();
      withRaw((sqlite) => sqlite.prepare("UPDATE work_entries SET status = 'confirmed' WHERE id = ?").run(id));
      const before = counts();
      for (const session of [driver, owner]) {
        const response = await patch(session, id, edit(`e-conf-${session.token.slice(0, 6)}`, 1));
        expect(response.status).toBe(409);
        expect((await response.json()).error.code).toBe("ENTRY_CONFIRMED");
      }
      expect(counts()).toEqual(before);
    });

    it("workType kayıt türünden farklıysa 422 workType; eşitse yok sayılır; geçersiz değer 422 workType", async () => {
      const id = await seedDriverEntry();
      const mismatch = await patch(driver, id, edit("e-wt-1", 1, { workType: "owner" }));
      expect(mismatch.status).toBe(422);
      expect(Object.keys((await mismatch.json()).error.fields)).toEqual(["workType"]);
      const invalid = await patch(driver, id, edit("e-wt-2", 1, { workType: "boss" }));
      expect(invalid.status).toBe(422);
      expect(Object.keys((await invalid.json()).error.fields)).toEqual(["workType"]);
      expect(rows("SELECT work_kind, version FROM work_entries")).toEqual([{ work_kind: "driver", version: 1 }]);
      expect((await patch(driver, id, edit("e-wt-3", 1, { workType: "driver" }))).status).toBe(200);
    });

    it("mevcut kayıtla aynı değerler 422 fields.change; geçersiz alanlar 422 alan anahtarıyla; makbuz yazılmaz", async () => {
      const id = await seedDriverEntry();
      const same = await patch(driver, id, { requestId: "e-nochange", version: 1, ...daily() });
      expect(same.status).toBe(422);
      expect(Object.keys((await same.json()).error.fields)).toEqual(["change"]);

      const bad = await patch(driver, id, edit("e-bad", 1, { grossCents: "12,5" }));
      expect(bad.status).toBe(422);
      expect(Object.keys((await bad.json()).error.fields)).toEqual(["grossCents"]);

      const badEnvelope = await patch(driver, id, { ...edit("x", 0) });
      expect(badEnvelope.status).toBe(422);
      expect(Object.keys((await badEnvelope.json()).error.fields)).toEqual(["version"]);
      expect(counts()).toEqual({ work_entries: 1, work_entry_revisions: 1, mutation_receipts: 1, admin_audit: 0, cash_confirmations: 0 });
    });

    it("geçersiz gövde bilinmeyen kayıtta 422 değil 404 alır (kayıt araması önce)", async () => {
      const response = await patch(driver, "yok-boyle-kayit", edit("e-unknown", 1, { grossCents: "12,5" }));
      expect(response.status).toBe(404);
    });
  });

  describe("PATCH — idempotency", () => {
    it("aynı requestId + aynı gövde: 200 replay, ikinci revizyon/satır yok", async () => {
      const id = await seedDriverEntry();
      const first = await patch(driver, id, edit("e-replay", 1));
      const second = await patch(driver, id, edit("e-replay", 1));
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect((await second.json()).workEntry).toEqual((await first.json()).workEntry);
      expect(counts()).toEqual({ work_entries: 1, work_entry_revisions: 2, mutation_receipts: 2, admin_audit: 0, cash_confirmations: 0 });
    });

    it("replay, kişi pasifleşse ve kayıt sonradan onaylansa da commit edilmiş sonucu döner", async () => {
      const id = await seedDriverEntry();
      expect((await patch(driver, id, edit("e-late", 1))).status).toBe(200);
      withRaw((sqlite) => {
        sqlite.prepare("UPDATE people SET active = 0 WHERE id = ?").run(SEED_IDS.driverA1a);
        sqlite.prepare("UPDATE work_entries SET status = 'confirmed' WHERE id = ?").run(id);
      });
      const replay = await patch(driver, id, edit("e-late", 1));
      expect(replay.status).toBe(200);
      expect((await replay.json()).workEntry.version).toBe(2);
      expect(counts().work_entry_revisions).toBe(2);
    });

    it("aynı requestId + farklı gövde / başka sürüm / başka kayıt / create makbuzu: 409 REQUEST_ID_REUSED", async () => {
      const id = await seedDriverEntry("c-a");
      const otherId = await seedDriverEntry("c-b");
      expect((await patch(driver, id, edit("e-reuse", 1))).status).toBe(200);
      const before = counts();

      const differentBody = await patch(driver, id, edit("e-reuse", 1, { grossCents: "500001" }));
      expect(differentBody.status).toBe(409);
      expect((await differentBody.json()).error.code).toBe("REQUEST_ID_REUSED");
      expect((await patch(driver, id, edit("e-reuse", 2))).status).toBe(409);
      expect((await patch(driver, otherId, edit("e-reuse", 1))).status).toBe(409);
      const usedByCreate = await patch(driver, id, edit("c-a", 2));
      expect(usedByCreate.status).toBe(409);
      expect((await usedByCreate.json()).error.code).toBe("REQUEST_ID_REUSED");
      expect(counts()).toEqual(before);
    });

    it("aynı sürümde iki eşzamanlı düzenleme: biri 200, diğeri 409; tek revizyon", async () => {
      const id = await seedDriverEntry();
      const [a, b] = await Promise.all([
        patch(driver, id, edit("e-race-a", 1, { grossCents: "600000" })),
        patch(owner, id, edit("e-race-b", 1, { grossCents: "700000" })),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(rows("SELECT version FROM work_entries")).toEqual([{ version: 2 }]);
      expect(counts().work_entry_revisions).toBe(2);
    });
  });

  describe("PATCH — şoför sınırları ve kapsam", () => {
    it("şoför yalnız bugünün kaydını düzenler: dünkü kayıt 403; sahip/ekip düzenler", async () => {
      const oldId = (await (await post(owner, createDriver("c-old", { date: YESTERDAY }))).json()).workEntry.id;
      const forbidden = await patch(driver, oldId, edit("e-old-d", 1, { date: YESTERDAY }));
      expect(forbidden.status).toBe(403);
      expect((await forbidden.json()).error.code).toBe("FORBIDDEN");
      expect(rows("SELECT version FROM work_entries")).toEqual([{ version: 1 }]);

      expect((await patch(owner, oldId, edit("e-old-o", 1, { date: YESTERDAY }))).status).toBe(200);
      expect((await patch(admin, oldId, edit("e-old-s", 2, { date: YESTERDAY, grossCents: "400000" }), SEED_IDS.vehicleA1)).status).toBe(200);
    });

    it("şoför tarihi bugün dışına çekemez: 422 date; sahip çekebilir", async () => {
      const id = await seedDriverEntry();
      const rejected = await patch(driver, id, edit("e-date-d", 1, { date: YESTERDAY }));
      expect(rejected.status).toBe(422);
      expect(Object.keys((await rejected.json()).error.fields)).toEqual(["date"]);
      const ownerMoved = await patch(owner, id, edit("e-date-o", 1, { date: YESTERDAY }));
      expect(ownerMoved.status).toBe(200);
      expect((await ownerMoved.json()).workEntry.workDate).toBe(YESTERDAY);
    });

    it("şoför sahip kaydını düzenleyemez (404); başka aracın kaydı hiçbir oturumda düzenlenemez (404)", async () => {
      const ownerEntry = (await (await post(owner, createOwner("c-own"))).json()).workEntry.id;
      const other = await post(admin, { ...createDriver("c-a2", { date: TODAY }), workerPersonId: SEED_IDS.driverA2a }, SEED_IDS.vehicleA2);
      expect(other.status).toBe(201);
      const otherId = (await other.json()).workEntry.id;
      const before = counts();

      const asDriver = await patch(driver, ownerEntry, edit("e-x1", 1));
      expect(asDriver.status).toBe(404);
      expect((await asDriver.json()).error.code).toBe("WORK_ENTRY_NOT_FOUND");
      expect((await patch(driver, otherId, edit("e-x2", 1))).status).toBe(404);
      expect((await patch(owner, otherId, edit("e-x3", 1))).status).toBe(404);
      expect((await patch(admin, otherId, edit("e-x4", 1), SEED_IDS.vehicleA1)).status).toBe(404);
      expect((await patch(driver, "yok-boyle-kayit", edit("e-x5", 1))).status).toBe(404);
      expect(counts()).toEqual(before);
    });

    it("şoför kişisi pasifleşmiş kaydı düzenleyemez (K1, 404)", async () => {
      const id = await seedDriverEntry();
      withRaw((sqlite) => sqlite.prepare("UPDATE vehicle_drivers SET active = 0 WHERE person_id = ?").run(SEED_IDS.driverA1a));
      expect((await patch(driver, id, edit("e-k1", 1))).status).toBe(404);
      expect((await patch(owner, id, edit("e-k1-o", 1))).status).toBe(200);
    });

    it("araç oturumu X-Target-Vehicle gönderirse 403; oturum yok 401; ekip hedef araçsız reddedilir", async () => {
      const id = await seedDriverEntry();
      const header = await patch(driver, id, edit("e-h", 1), SEED_IDS.vehicleA2);
      expect(header.status).toBe(403);
      expect((await header.json()).error.code).toBe("TARGET_HEADER_NOT_ALLOWED");
      const anon = await patchWorkEntry(
        new Request(`${URL_WORK_ENTRIES}/${id}`, { method: "PATCH", headers: { origin: SELF_ORIGIN, "content-type": "application/json" }, body: JSON.stringify(edit("e-anon", 1)) }),
        { params: Promise.resolve({ id }) },
      );
      expect(anon.status).toBe(401);
      expect((await patch(admin, id, edit("e-nt", 1))).status).toBeGreaterThanOrEqual(400);
      expect(rows("SELECT version FROM work_entries")).toEqual([{ version: 1 }]);
    });
  });

  describe("PATCH — atomiklik (hata enjeksiyonu)", () => {
    const targets = [
      ["BEFORE UPDATE ON work_entries", "work_entries UPDATE"],
      ["BEFORE INSERT ON work_entry_revisions", "revizyon INSERT"],
      ["BEFORE INSERT ON admin_audit", "audit INSERT"],
      ["BEFORE INSERT ON mutation_receipts", "makbuz INSERT"],
    ] as const;
    for (const [event, label] of targets) {
      it(`${label} başarısız olursa eski tam kayıt kalır; aynı requestId sonra tek kez başarılı olur`, async () => {
        const id = await seedDriverEntry();
        const before = counts();
        const entryBefore = rows("SELECT * FROM work_entries");
        withRaw((sqlite) => sqlite.exec(`CREATE TRIGGER inject_fail ${event} BEGIN SELECT RAISE(ABORT, 'enjekte hata'); END`));
        await expect(patch(admin, id, edit("e-inject", 1), SEED_IDS.vehicleA1)).rejects.toThrow();
        expect(counts()).toEqual(before);
        expect(rows("SELECT * FROM work_entries")).toEqual(entryBefore);

        withRaw((sqlite) => sqlite.exec("DROP TRIGGER inject_fail"));
        const retry = await patch(admin, id, edit("e-inject", 1), SEED_IDS.vehicleA1);
        expect(retry.status).toBe(200);
        expect(counts()).toEqual({ ...before, work_entry_revisions: 2, mutation_receipts: 2, admin_audit: 1 });
      });
    }
  });

  describe("İstanbul gece yarısı (enjekte saat)", () => {
    it("şoför düzenlemesi gün sınırında: 23:59'da bugünün kaydı düzenlenir, 00:01'de (yeni gün) 403", async () => {
      const id = await seedDriverEntry();
      const sqlite = openDatabaseConnection(dbPath);
      try {
        const db = createDb(sqlite);
        const row = sqlite.prepare("SELECT id AS session_id FROM sessions WHERE credential_id = ?").get(SEED_IDS.credA1Driver) as { session_id: string };
        const context: SessionContext = {
          kind: "vehicle",
          businessId: SEED_IDS.businessA,
          vehicleId: SEED_IDS.vehicleA1,
          role: "driver",
          credentialId: SEED_IDS.credA1Driver,
          sessionId: row.session_id,
          csrfToken: "-",
        };
        const scope = scopeFromVehicleSession(context);
        const nextMidnight = Date.parse(`${TODAY}T00:00:00+03:00`) + 86_400_000;

        const late = updateWorkEntry(db, context, scope, { requestId: "m-1", entryId: id, version: 1, body: edit("m-1", 1) }, () => new Date(nextMidnight - 60_000));
        expect(late).toMatchObject({ ok: true, status: 200 });

        const after = updateWorkEntry(db, context, scope, { requestId: "m-2", entryId: id, version: 2, body: edit("m-2", 2, { grossCents: "450000" }) }, () => new Date(nextMidnight + 60_000));
        expect(after).toEqual({ ok: false, status: 403, code: "FORBIDDEN" });
      } finally {
        sqlite.close();
      }
      expect(rows("SELECT version FROM work_entries")).toEqual([{ version: 2 }]);
    });
  });

  describe("GET /work-entries/:id", () => {
    it("200 ve POST 201 gövdesiyle aynı anahtarlar; sahip ve ekip de okur", async () => {
      const created = await post(driver, createDriver("c-get"));
      const { workEntry } = await created.json();
      const asDriver = await getOne(driver, workEntry.id);
      expect(asDriver.status).toBe(200);
      const body = await asDriver.json();
      expect(body.workEntry).toEqual(workEntry);
      expect(Object.keys(body.workEntry)).not.toContain("businessId");
      expect((await getOne(owner, workEntry.id)).status).toBe(200);
      expect((await getOne(admin, workEntry.id, SEED_IDS.vehicleA1)).status).toBe(200);
    });

    it("başka aracın kaydı ve bilinmeyen kimlik AYNI 404 WORK_ENTRY_NOT_FOUND", async () => {
      const other = await post(admin, { ...createDriver("c-a2"), workerPersonId: SEED_IDS.driverA2a }, SEED_IDS.vehicleA2);
      const otherId = (await other.json()).workEntry.id;
      const foreign = await getOne(driver, otherId);
      const unknown = await getOne(driver, "yok-boyle-kayit");
      expect(foreign.status).toBe(404);
      expect(unknown.status).toBe(404);
      const strip = async (response: Response) => {
        const { request_id: _ignored, ...rest } = await response.json();
        return rest;
      };
      expect(await strip(foreign)).toEqual(await strip(unknown));
      expect((await getOne(owner, otherId)).status).toBe(404);
      expect((await getOne(admin, otherId, SEED_IDS.vehicleA1)).status).toBe(404);
      expect((await getOne(admin, otherId, SEED_IDS.vehicleA2)).status).toBe(200);
    });

    it("şoför sahip kaydını ve kişisi seçilemez olan kaydı göremez (K1); sahip görür", async () => {
      const ownerEntry = (await (await post(owner, createOwner("c-own"))).json()).workEntry.id;
      const driverEntry = await seedDriverEntry();
      expect((await getOne(driver, ownerEntry)).status).toBe(404);
      expect((await getOne(owner, ownerEntry)).status).toBe(200);

      withRaw((sqlite) => sqlite.prepare("UPDATE people SET active = 0 WHERE id = ?").run(SEED_IDS.driverA1a));
      expect((await getOne(driver, driverEntry)).status).toBe(404);
      expect((await getOne(owner, driverEntry)).status).toBe(200);
    });

    it("onaylayan özeti: ekip onayı platform_user + kullanıcı adı, sahip onayı vehicle_credential; şoför görünümü yalnız tür (kullanıcı adı yok); listede de aynı", async () => {
      const staffId = await seedDriverEntry("c-actor-s");
      const confirmAs = (session: Session, id: string, requestId: string, targetVehicle?: string) =>
        confirmWorkEntryRoute(
          new Request(`${URL_WORK_ENTRIES}/${id}/confirm`, {
            method: "POST",
            headers: writeHeaders(session, targetVehicle),
            body: JSON.stringify({ requestId, version: 1, receivedCents: "600000" }),
          }),
          { params: Promise.resolve({ id }) },
        );
      const confirmed = await confirmAs(admin, staffId, "k-actor-s", SEED_IDS.vehicleA1);
      expect(confirmed.status).toBe(200);
      const ownerConfirmedId = await seedDriverEntry("c-actor-o");
      expect((await confirmAs(owner, ownerConfirmedId, "k-actor-o")).status).toBe(200);
      const pendingId = await seedDriverEntry("c-actor-p");

      const staffActor = { kind: "platform_user", username: SEED_USERNAMES.admin };
      const ownerActor = { kind: "vehicle_credential" };
      const asOwner = async (id: string) => (await (await getOne(owner, id)).json()).workEntry.confirmation;
      expect(await asOwner(staffId)).toMatchObject({ actor: staffActor });
      expect(await asOwner(ownerConfirmedId)).toMatchObject({ actor: ownerActor });
      expect(await asOwner(pendingId)).toBeNull();
      expect((await (await getOne(admin, staffId, SEED_IDS.vehicleA1)).json()).workEntry.confirmation.actor).toEqual(staffActor);

      const ownerList = (await (await getList(owner)).json()).workEntries as { id: string; confirmation: { actor: unknown } | null }[];
      expect(ownerList.find((e) => e.id === staffId)!.confirmation!.actor).toEqual(staffActor);
      expect(ownerList.find((e) => e.id === ownerConfirmedId)!.confirmation!.actor).toEqual(ownerActor);
      expect(ownerList.find((e) => e.id === pendingId)!.confirmation).toBeNull();

      // Şoför: yalnız tür, ekip kullanıcı adı sızmaz (K1 listesi dahil).
      expect((await (await getOne(driver, staffId)).json()).workEntry.confirmation.actor).toEqual({ kind: "platform_user" });
      const driverList = await getList(driver, `?workerPersonId=${SEED_IDS.driverA1a}`);
      expect(driverList.status).toBe(200);
      const driverBody = await driverList.json();
      expect(JSON.stringify(driverBody)).not.toContain(SEED_USERNAMES.admin);
      const driverListed = driverBody.workEntries as { id: string; confirmation: { actor: unknown } | null }[];
      expect(driverListed.find((e) => e.id === staffId)!.confirmation!.actor).toEqual({ kind: "platform_user" });
      expect(driverListed.find((e) => e.id === ownerConfirmedId)!.confirmation!.actor).toEqual({ kind: "vehicle_credential" });
    });

    it("oturum yok: 401", async () => {
      const response = await getWorkEntry(new Request(`${URL_WORK_ENTRIES}/x`), { params: Promise.resolve({ id: "x" }) });
      expect(response.status).toBe(401);
    });
  });

  describe("GET /work-entries (liste)", () => {
    async function seedMany() {
      const ids: string[] = [];
      for (const [n, date] of [TODAY, TODAY, YESTERDAY, YESTERDAY].entries()) {
        const response = await post(owner, createDriver(`c-many-${n}`, { date }));
        ids.push((await response.json()).workEntry.id);
      }
      const b = await post(owner, { ...createDriver("c-b1"), workerPersonId: SEED_IDS.driverA1b });
      ids.push((await b.json()).workEntry.id);
      const ownerEntry = await post(owner, createOwner("c-own-l"));
      ids.push((await ownerEntry.json()).workEntry.id);
      const other = await post(admin, { ...createDriver("c-a2"), workerPersonId: SEED_IDS.driverA2a }, SEED_IDS.vehicleA2);
      return { ids, otherId: (await other.json()).workEntry.id as string };
    }

    it("şoför oturumu workerPersonId olmadan 422; seçilemeyen kişiyle 422 (aynı metin); geçerli kişiyle yalnız o kişinin şoför kayıtları", async () => {
      const { ids, otherId } = await seedMany();
      const missing = await getList(driver);
      expect(missing.status).toBe(422);
      expect(Object.keys((await missing.json()).error.fields)).toEqual(["workerPersonId"]);

      const messages = new Set<string>();
      for (const person of [SEED_IDS.driverA1d, SEED_IDS.driverA2a, SEED_IDS.ownerA, "yok-boyle-kisi"]) {
        const response = await getList(driver, `?workerPersonId=${person}`);
        expect(response.status).toBe(422);
        messages.add((await response.json()).error.fields.workerPersonId);
      }
      expect(messages.size).toBe(1);

      const ok = await getList(driver, `?workerPersonId=${SEED_IDS.driverA1a}`);
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body.nextCursor).toBeNull();
      expect(body.workEntries).toHaveLength(4);
      expect(body.workEntries.every((e: { person: { id: string }; workKind: string }) => e.person.id === SEED_IDS.driverA1a && e.workKind === "driver")).toBe(true);
      expect(body.workEntries.map((e: { id: string }) => e.id)).not.toContain(otherId);
      expect(ids).toEqual(expect.arrayContaining(body.workEntries.map((e: { id: string }) => e.id)));
    });

    it("sahip süzgeçsiz kendi aracının TÜM kayıtlarını (owner türü dahil) görür; başka aracın kaydı hiç gelmez; yeni gün önce", async () => {
      const { ids, otherId } = await seedMany();
      const response = await getList(owner);
      expect(response.status).toBe(200);
      const { workEntries } = await response.json();
      expect(workEntries.map((e: { id: string }) => e.id).sort()).toEqual([...ids].sort());
      expect(workEntries.map((e: { id: string }) => e.id)).not.toContain(otherId);
      const dates = workEntries.map((e: { workDate: string }) => e.workDate);
      expect(dates).toEqual([...dates].sort().reverse());

      const filtered = await (await getList(owner, `?workerPersonId=${SEED_IDS.driverA1b}`)).json();
      expect(filtered.workEntries).toHaveLength(1);
      const staff = await getList(admin, "", SEED_IDS.vehicleA2);
      expect((await staff.json()).workEntries.map((e: { id: string }) => e.id)).toEqual([otherId]);
    });

    it("keyset sayfalama: limit=2 ile sayfalar birleşince tekrar/atlama olmadan tüm kayıtlar; son sayfada nextCursor null", async () => {
      const { ids } = await seedMany();
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const response = await getList(owner, `?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
        expect(response.status).toBe(200);
        const body: { workEntries: { id: string }[]; nextCursor: string | null } = await response.json();
        seen.push(...body.workEntries.map((e) => e.id));
        cursor = body.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(ids.length);
      expect([...seen].sort()).toEqual([...ids].sort());
    });

    it("geçersiz limit/cursor/workerPersonId 422 alan anahtarlarıyla", async () => {
      for (const [query, field] of [
        ["?limit=0", "limit"],
        ["?limit=101", "limit"],
        ["?limit=abc", "limit"],
        ["?cursor=bozuk", "cursor"],
        ["?workerPersonId=", "workerPersonId"],
      ] as const) {
        const response = await getList(owner, query);
        expect(response.status).toBe(422);
        expect(Object.keys((await response.json()).error.fields)).toEqual([field]);
      }
    });

    it("boş liste 200 ve nextCursor null; oturum yok 401", async () => {
      const empty = await getList(owner);
      expect(await empty.json()).toMatchObject({ workEntries: [], nextCursor: null });
      const anon = await listWorkEntries(new Request(URL_WORK_ENTRIES));
      expect(anon.status).toBe(401);
    });
  });
});
