/**
 * POST /api/v1/work-entries — T3.4. Gerçek geçici SQLite dosyası + gerçek
 * migration + seed (mock/`:memory:` YOK). Kapsam: tek transaction'da entry +
 * revizyon v1 + makbuz (+ yalnız ekip için audit), replay/409, eşzamanlı aynı
 * requestId, her aşamada hata enjeksiyonu (tetikleyici ile) → dört tabloda
 * sıfır satır, tutulan yazma kilidi → 503 + aynı requestId ile tek başarılı
 * tekrar, yeniden açılışta kalıcılık ve kapsam/yetki sınırları.
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

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const URL_WORK_ENTRIES = "https://example.invalid/api/v1/work-entries";
const WRITE_TABLES = ["work_entries", "work_entry_revisions", "mutation_receipts", "admin_audit"] as const;

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

function post(session: Session, body: unknown, targetVehicle?: string): Promise<Response> {
  return postWorkEntry(
    new Request(URL_WORK_ENTRIES, {
      method: "POST",
      headers: {
        cookie: `dolmus_session=${session.token}`,
        origin: SELF_ORIGIN,
        "x-csrf-token": session.csrfToken,
        "content-type": "application/json",
        ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

const money = {
  date: "2026-09-14",
  startTime: "08:00",
  endTime: "17:30",
  endsNextDay: false,
  grossCents: "1000000",
  fuelCents: "150000",
  otherExpenseCents: "30000",
  otherExpenseNote: "otopark",
};

const driverBody = (requestId: string, extra: Record<string, unknown> = {}) => ({
  requestId,
  workType: "driver",
  workerPersonId: SEED_IDS.driverA1a,
  ...money,
  ...extra,
});

const ownerBody = (requestId: string, extra: Record<string, unknown> = {}) => ({
  requestId,
  workType: "owner",
  ...money,
  ...extra,
});

describe("POST /api/v1/work-entries (T3.4)", () => {
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
        [...WRITE_TABLES, "cash_confirmations"].map((table) => [
          table,
          (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
        ]),
      ),
    );

  const ZERO = { work_entries: 0, work_entry_revisions: 0, mutation_receipts: 0, admin_audit: 0, cash_confirmations: 0 };

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-work-entries-"));
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

  describe("başarılı oluşturma", () => {
    it("şoför oturumu: 201 + tek entry (pending, v1) + revizyon v1 + makbuz; audit ve cash_confirmations yok", async () => {
      const response = await post(driver, driverBody("r-driver-1"));
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.workEntry).toMatchObject({
        version: 1,
        status: "pending",
        workKind: "driver",
        workDate: "2026-09-14",
        durationMinutes: 570,
        grossCents: "1000000",
        fuelCents: "150000",
        otherExpenseCents: "30000",
        otherExpenseNote: "otopark",
        shareBps: 2000,
        calculationVersion: 1,
        person: { id: SEED_IDS.driverA1a },
      });
      expect(typeof body.workEntry.shareCents).toBe("string");
      expect(typeof body.workEntry.remainderCents).toBe("string");
      expect(Object.keys(body.workEntry)).not.toContain("businessId");

      expect(counts()).toEqual({ ...ZERO, work_entries: 1, work_entry_revisions: 1, mutation_receipts: 1 });
      withRaw((sqlite) => {
        const entry = sqlite.prepare("SELECT * FROM work_entries").get() as Record<string, unknown>;
        expect(entry).toMatchObject({ id: body.workEntry.id, status: "pending", version: 1, vehicle_id: SEED_IDS.vehicleA1 });
        const revision = sqlite.prepare("SELECT * FROM work_entry_revisions").get() as Record<string, unknown>;
        expect(revision).toMatchObject({
          entry_id: body.workEntry.id,
          version: 1,
          actor_kind: "vehicle_credential",
          actor_role: "driver",
          actor_credential_id: SEED_IDS.credA1Driver,
          on_behalf_of_person_id: null,
        });
        expect(JSON.parse(revision.snapshot_json as string)).toMatchObject({ id: body.workEntry.id, version: 1 });
        expect(sqlite.prepare("SELECT * FROM mutation_receipts").get()).toMatchObject({
          operation: "work_entry.create",
          request_id: "r-driver-1",
          entity_id: body.workEntry.id,
          result_version: 1,
          response_code: 201,
          scope_key: `${SEED_IDS.credA1Driver}:${SEED_IDS.businessA}:${SEED_IDS.vehicleA1}`,
        });
      });
    });

    it("sahip oturumu owner türü: not_required, sıfır pay, audit yok", async () => {
      const response = await post(owner, ownerBody("r-owner-1"));
      expect(response.status).toBe(201);
      const { workEntry } = await response.json();
      expect(workEntry).toMatchObject({ status: "not_required", workKind: "owner", shareBps: 0, shareCents: "0" });
      expect(workEntry.person.id).toBe(SEED_IDS.ownerA);
      expect(counts()).toEqual({ ...ZERO, work_entries: 1, work_entry_revisions: 1, mutation_receipts: 1 });
    });

    it("ekip oturumu: 201 + tam bir admin_audit satırı (platform_user, sahip adına) ve revizyon aktörü", async () => {
      const response = await post(admin, driverBody("r-staff-1"), SEED_IDS.vehicleA1);
      expect(response.status).toBe(201);
      const { workEntry } = await response.json();
      expect(counts()).toEqual({ ...ZERO, work_entries: 1, work_entry_revisions: 1, mutation_receipts: 1, admin_audit: 1 });
      withRaw((sqlite) => {
        expect(sqlite.prepare("SELECT * FROM admin_audit").get()).toMatchObject({
          action: "work_entry.create",
          entity_type: "work_entry",
          entity_id: workEntry.id,
          business_id: SEED_IDS.businessA,
          vehicle_id: SEED_IDS.vehicleA1,
          before_json: null,
          actor_kind: "platform_user",
          actor_platform_user_id: SEED_IDS.platformAdmin1,
          on_behalf_of_kind: "owner",
          on_behalf_of_person_id: SEED_IDS.ownerA,
        });
        expect(sqlite.prepare("SELECT * FROM work_entry_revisions").get()).toMatchObject({
          actor_kind: "platform_user",
          on_behalf_of_person_id: SEED_IDS.ownerA,
        });
      });
    });

    it("gövdedeki fazladan alanlar (pay, businessId, status) atılır; sunucu değerleri kazanır", async () => {
      const response = await post(driver, {
        ...driverBody("r-extra-1"),
        shareCents: "999999",
        shareBps: 0,
        status: "confirmed",
        workKind: "owner",
      });
      expect(response.status).toBe(201);
      const { workEntry } = await response.json();
      expect(workEntry).toMatchObject({ status: "pending", workKind: "driver", shareBps: 2000 });
      expect(workEntry.shareCents).not.toBe("999999");
    });
  });

  describe("idempotency", () => {
    it("aynı requestId + aynı içerik: replay aynı kaydı ve durumu döner, ikinci satır yok", async () => {
      const first = await post(driver, driverBody("r-replay"));
      const second = await post(driver, driverBody("r-replay"));
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect((await second.json()).workEntry).toEqual((await first.json()).workEntry);
      expect(counts()).toEqual({ ...ZERO, work_entries: 1, work_entry_revisions: 1, mutation_receipts: 1 });
    });

    it("hash normalleştirilmiş içerikten: ek alan/boşluk farkı ve owner'da workerPersonId farkı aynı sayılır", async () => {
      const a = await post(owner, ownerBody("r-norm"));
      const b = await post(owner, ownerBody("r-norm", { workerPersonId: SEED_IDS.driverA1a, otherExpenseNote: "  otopark ", extraneous: 1 }));
      expect(b.status).toBe(201);
      expect((await b.json()).workEntry.id).toBe((await a.json()).workEntry.id);
      expect(counts().work_entries).toBe(1);
    });

    it("100 eşzamanlı aynı istek: tek kayıt, hepsi 201 ve aynı entry id", async () => {
      const responses = await Promise.all(Array.from({ length: 100 }, () => post(driver, driverBody("r-burst"))));
      expect(responses.every((r) => r.status === 201)).toBe(true);
      const ids = new Set((await Promise.all(responses.map((r) => r.json()))).map((b) => b.workEntry.id));
      expect(ids.size).toBe(1);
      expect(counts()).toEqual({ ...ZERO, work_entries: 1, work_entry_revisions: 1, mutation_receipts: 1 });
    });

    it("aynı requestId + farklı gövde: 409 REQUEST_ID_REUSED, veri değişmez", async () => {
      expect((await post(driver, driverBody("r-reuse"))).status).toBe(201);
      const conflict = await post(driver, driverBody("r-reuse", { grossCents: "1000001" }));
      expect(conflict.status).toBe(409);
      expect((await conflict.json()).error.code).toBe("REQUEST_ID_REUSED");
      expect(counts()).toEqual({ ...ZERO, work_entries: 1, work_entry_revisions: 1, mutation_receipts: 1 });
    });

    it("farklı requestId + özdeş içerik: iki ayrı kayıt", async () => {
      const a = await post(driver, driverBody("r-same-a"));
      const b = await post(driver, driverBody("r-same-b"));
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect((await a.json()).workEntry.id).not.toBe((await b.json()).workEntry.id);
      expect(counts()).toEqual({ ...ZERO, work_entries: 2, work_entry_revisions: 2, mutation_receipts: 2 });
    });

    it("replay, şoför sonradan pasifleşse de commit edilmiş sonucu döner; yeni requestId 422 alır", async () => {
      const first = await post(driver, driverBody("r-late"));
      const id = (await first.json()).workEntry.id;
      withRaw((sqlite) => sqlite.prepare("UPDATE people SET active = 0 WHERE id = ?").run(SEED_IDS.driverA1a));

      const replay = await post(driver, driverBody("r-late"));
      expect(replay.status).toBe(201);
      expect((await replay.json()).workEntry.id).toBe(id);

      const fresh = await post(driver, driverBody("r-late-new"));
      expect(fresh.status).toBe(422);
      expect(counts().work_entries).toBe(1);
    });
  });

  describe("doğrulama ve yetki (makbuz yazılmaz)", () => {
    it("geçersiz alanlar 422 VALIDATION_ERROR ve alan anahtarları döner", async () => {
      const badMoney = await post(driver, driverBody("r-bad", { grossCents: "12,5" }));
      expect(badMoney.status).toBe(422);
      const body = await badMoney.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(body.error.fields)).toEqual(["grossCents"]);

      const badTime = await post(driver, driverBody("r-bad-time", { startTime: "08:00", endTime: "08:00" }));
      expect(badTime.status).toBe(422);
      expect(Object.keys((await badTime.json()).error.fields)).toEqual(["endTime"]);
      expect(counts()).toEqual(ZERO);
    });

    it("eksik/hatalı requestId 422 (requestId alanı)", async () => {
      const missing = await post(driver, { ...driverBody("x"), requestId: undefined });
      expect(missing.status).toBe(422);
      expect(Object.keys((await missing.json()).error.fields)).toEqual(["requestId"]);
      const tooLong = await post(driver, driverBody("x".repeat(201)));
      expect(tooLong.status).toBe(422);
      expect(counts()).toEqual(ZERO);
    });

    it("kişi eksik ya da başka araca ait: 422 workerPersonId", async () => {
      const missing = await post(driver, driverBody("r-nop", { workerPersonId: undefined }));
      expect(missing.status).toBe(422);
      expect(Object.keys((await missing.json()).error.fields)).toEqual(["workerPersonId"]);
      const other = await post(driver, driverBody("r-otherv", { workerPersonId: SEED_IDS.driverA2a }));
      expect(other.status).toBe(422);
      expect(counts()).toEqual(ZERO);
    });

    it("şoför oturumu owner türünde 403 FORBIDDEN", async () => {
      const response = await post(driver, ownerBody("r-forbid"));
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
      expect(counts()).toEqual(ZERO);
    });

    it("araç oturumu X-Target-Vehicle gönderirse 403 TARGET_HEADER_NOT_ALLOWED", async () => {
      const response = await post(driver, driverBody("r-hdr"), SEED_IDS.vehicleA2);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("TARGET_HEADER_NOT_ALLOWED");
    });

    it("ekip oturumu hedef araç olmadan / var olmayan araçla kayıt oluşturamaz", async () => {
      expect((await post(admin, driverBody("r-nt"))).status).toBeGreaterThanOrEqual(400);
      const unknown = await post(admin, driverBody("r-nf"), "yok-boyle-arac");
      expect(unknown.status).toBe(404);
      expect((await unknown.json()).error.code).toBe("TARGET_VEHICLE_NOT_FOUND");
      expect(counts()).toEqual(ZERO);
    });

    it("oturum yok: 401", async () => {
      const response = await postWorkEntry(
        new Request(URL_WORK_ENTRIES, {
          method: "POST",
          headers: { origin: SELF_ORIGIN, "content-type": "application/json" },
          body: JSON.stringify(driverBody("r-anon")),
        }),
      );
      expect(response.status).toBe(401);
      expect(counts()).toEqual(ZERO);
    });
  });

  describe("kapsam ve erişim iptali", () => {
    it("iptal edilen oturum eski sonucu okuyamaz (401)", async () => {
      expect((await post(driver, driverBody("r-rev"))).status).toBe(201);
      withRaw((sqlite) =>
        sqlite.prepare("UPDATE sessions SET revoked_at = ? WHERE credential_id = ?").run(new Date().toISOString(), SEED_IDS.credA1Driver),
      );
      const response = await post(driver, driverBody("r-rev"));
      expect(response.status).toBe(401);
      expect(counts().work_entries).toBe(1);
    });

    it("pasif araçta araç oturumu ne yeni kayıt ne replay alır (401); ekip 403 TARGET_INACTIVE_FOR_WRITE", async () => {
      expect((await post(driver, driverBody("r-inact"))).status).toBe(201);
      expect((await post(admin, driverBody("r-inact-s"), SEED_IDS.vehicleA1)).status).toBe(201);
      withRaw((sqlite) => sqlite.prepare("UPDATE vehicles SET active = 0 WHERE id = ?").run(SEED_IDS.vehicleA1));
      expect((await post(driver, driverBody("r-inact"))).status).toBe(401);
      expect((await post(driver, driverBody("r-inact-2"))).status).toBe(401);
      const staff = await post(admin, driverBody("r-inact-s"), SEED_IDS.vehicleA1);
      expect(staff.status).toBe(403);
      expect((await staff.json()).error.code).toBe("TARGET_INACTIVE_FOR_WRITE");
      expect(counts().work_entries).toBe(2);
    });

    it("pasif işletmede araç oturumu replay ile eski sonucu okuyamaz (401)", async () => {
      expect((await post(driver, driverBody("r-binact"))).status).toBe(201);
      withRaw((sqlite) => sqlite.prepare("UPDATE businesses SET active = 0 WHERE id = ?").run(SEED_IDS.businessA));
      expect((await post(driver, driverBody("r-binact"))).status).toBe(401);
      expect(counts().work_entries).toBe(1);
    });

    it("başka kimlik veya başka araç kapsamında aynı requestId yeni kapsam sayılır: eski sonuca erişilmez", async () => {
      const first = await post(driver, driverBody("r-scope"));
      const firstId = (await first.json()).workEntry.id;

      // Aynı araç, başka kimlik (sahip) → farklı scope_key.
      const asOwner = await post(owner, driverBody("r-scope"));
      expect(asOwner.status).toBe(201);
      expect((await asOwner.json()).workEntry.id).not.toBe(firstId);

      // Ekip: A1 ve A2 hedefleri ayrı kapsamdır.
      const staffA1 = await post(admin, driverBody("r-scope-s"), SEED_IDS.vehicleA1);
      const staffA2 = await post(admin, driverBody("r-scope-s", { workerPersonId: SEED_IDS.driverA2a }), SEED_IDS.vehicleA2);
      expect(staffA1.status).toBe(201);
      expect(staffA2.status).toBe(201);
      expect((await staffA1.json()).workEntry.id).not.toBe((await staffA2.json()).workEntry.id);
      expect(counts().work_entries).toBe(4);
    });
  });

  describe("atomiklik (hata enjeksiyonu)", () => {
    for (const table of ["work_entries", "work_entry_revisions", "admin_audit", "mutation_receipts"] as const) {
      it(`${table} INSERT'i başarısız olursa dört tabloda da satır kalmaz; aynı requestId sonra tek kez başarılı olur`, async () => {
        withRaw((sqlite) =>
          sqlite.exec(`CREATE TRIGGER inject_fail BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'enjekte hata'); END`),
        );
        await expect(post(admin, driverBody("r-inject"), SEED_IDS.vehicleA1)).rejects.toThrow();
        expect(counts()).toEqual(ZERO);

        withRaw((sqlite) => sqlite.exec("DROP TRIGGER inject_fail"));
        const retry = await post(admin, driverBody("r-inject"), SEED_IDS.vehicleA1);
        expect(retry.status).toBe(201);
        expect(counts()).toEqual({ ...ZERO, work_entries: 1, work_entry_revisions: 1, mutation_receipts: 1, admin_audit: 1 });
      });
    }
  });

  describe("yazma kilidi ve kalıcılık", () => {
    it("tutulan yazma kilidi busy_timeout içinde 503 SERVICE_UNAVAILABLE; kilit kalkınca aynı requestId ile tek kayıt", async () => {
      const holder = openDatabaseConnection(dbPath);
      let response: Response;
      let elapsed: number;
      try {
        holder.exec("BEGIN IMMEDIATE");
        const started = Date.now();
        response = await post(driver, driverBody("r-lock"));
        elapsed = Date.now() - started;
      } finally {
        holder.exec("ROLLBACK");
        holder.close();
      }
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("SERVICE_UNAVAILABLE");
      expect(elapsed).toBeLessThan(6000);
      expect(counts()).toEqual(ZERO);

      const retry = await post(driver, driverBody("r-lock"));
      expect(retry.status).toBe(201);
      expect(counts()).toEqual({ ...ZERO, work_entries: 1, work_entry_revisions: 1, mutation_receipts: 1 });
    });

    it("commit edilen kayıt, veritabanı kapatılıp yeniden açıldıktan sonra da okunur", async () => {
      const response = await post(driver, driverBody("r-durable"));
      const { workEntry } = await response.json();
      resetAppDbForTests();

      const reopened = openDatabaseConnection(dbPath);
      try {
        expect(reopened.pragma("journal_mode", { simple: true })).toBe("wal");
        expect(reopened.pragma("synchronous", { simple: true })).toBe(2);
        expect(reopened.prepare("SELECT id, version, status, gross_cents FROM work_entries").all()).toEqual([
          { id: workEntry.id, version: 1, status: "pending", gross_cents: 1000000 },
        ]);
        expect(reopened.prepare("SELECT COUNT(*) AS n FROM work_entry_revisions").get()).toEqual({ n: 1 });
        expect(reopened.prepare("SELECT COUNT(*) AS n FROM mutation_receipts").get()).toEqual({ n: 1 });
      } finally {
        reopened.close();
      }
    });
  });
});
