/**
 * `prepareWorkEntryCreate` — T3.3. Gerçek migrate edilmiş geçici SQLite +
 * seed: kim çalıştı / hangi tür çözümü, sunucu hesabı ve aktör bloğu; hiçbir
 * tabloya satır yazılmaz.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS } from "../../scripts/db-seed-dev";
import { WORK_ENTRY_MESSAGES as TEXT } from "../../src/lib/messages";
import {
  resolveStaffVehicleScopeFromHeader,
  scopeFromVehicleSession,
  TARGET_VEHICLE_HEADER,
  type Scope,
} from "../../src/server/auth/scope";
import { createDb, openDatabaseConnection, type SqliteConnection } from "../../src/server/data/db";
import type { SessionContext } from "../../src/server/usecases/session/types";
import {
  prepareWorkEntryCreate,
  readVehicleOwnerPerson,
  type PrepareWorkEntryCreateResult,
} from "../../src/server/usecases/work-entries";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");

const money = {
  date: "2026-09-14",
  startTime: "08:00",
  endTime: "17:30",
  endsNextDay: false,
  grossCents: "1000000",
  fuelCents: "150000",
  otherExpenseCents: "30000",
};

const vehicleContext = (role: "owner" | "driver"): SessionContext => ({
  kind: "vehicle",
  businessId: SEED_IDS.businessA,
  vehicleId: SEED_IDS.vehicleA1,
  role,
  credentialId: role === "owner" ? SEED_IDS.credA1Owner : SEED_IDS.credA1Driver,
  sessionId: `session-${role}`,
  csrfToken: "csrf",
});

const staffContext: SessionContext = {
  kind: "platform",
  role: "support",
  platformUserId: SEED_IDS.platformSupport1,
  sessionId: "session-staff",
  csrfToken: "csrf",
};

const WRITE_TABLES = ["work_entries", "work_entry_revisions", "mutation_receipts", "admin_audit", "sessions"];

describe("prepareWorkEntryCreate", () => {
  let dir: string;
  let sqlite: SqliteConnection;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-prepare-create-"));
    sqlite = openDatabaseConnection(path.join(dir, "test.sqlite"), { createIfMissing: true });
    migrate(createDb(sqlite), { migrationsFolder });
    await seedDevData(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const counts = () =>
    WRITE_TABLES.map(
      (table) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
    );

  function run(context: SessionContext, scope: Scope, body: unknown): PrepareWorkEntryCreateResult {
    const before = counts();
    const result = prepareWorkEntryCreate(createDb(sqlite), context, scope, body);
    expect(counts()).toEqual(before);
    return result;
  }

  const vehicleScope = (role: "owner" | "driver") => scopeFromVehicleSession(vehicleContext(role));

  async function staffScope(): Promise<Scope> {
    const resolved = await resolveStaffVehicleScopeFromHeader(
      staffContext,
      new Request("http://localhost/x", { headers: { [TARGET_VEHICLE_HEADER]: SEED_IDS.vehicleA1 } }),
      createDb(sqlite),
      "write",
    );
    if (!resolved.ok) throw new Error("staff kapsamı çözülemedi");
    return resolved.scope;
  }

  const driverBody = (workerPersonId: string) => ({ ...money, workType: "driver", workerPersonId });

  it("şoför oturumu owner türünde 403 alır", () => {
    const result = run(vehicleContext("driver"), vehicleScope("driver"), { ...money, workType: "owner" });
    expect(result).toEqual({ ok: false, status: 403, code: "FORBIDDEN" });
  });

  it("şoför oturumu sahip kişiyi workerPersonId ile veremez (422)", () => {
    const result = run(vehicleContext("driver"), vehicleScope("driver"), driverBody(SEED_IDS.ownerA));
    expect(result).toEqual({
      ok: false,
      status: 422,
      code: "VALIDATION_ERROR",
      fields: { workerPersonId: TEXT.personUnavailable },
    });
  });

  it("sahip oturumu owner türünde: araç sahibi kişi, sıfır pay, not_required, credential aktörü", () => {
    const result = run(vehicleContext("owner"), vehicleScope("owner"), {
      ...money,
      workType: "owner",
      workerPersonId: SEED_IDS.driverA1a, // yok sayılır
    });
    expect(result).toMatchObject({
      ok: true,
      input: {
        businessId: SEED_IDS.businessA,
        vehicleId: SEED_IDS.vehicleA1,
        personId: SEED_IDS.ownerA,
        workKind: "owner",
        status: "not_required",
        figures: { shareBps: 0, shareCents: 0 },
        actor: {
          actorKind: "vehicle_credential",
          actorSessionId: "session-owner",
          actorRole: "owner",
          actorCredentialId: SEED_IDS.credA1Owner,
          actorPlatformUserId: null,
          onBehalfOfKind: null,
          onBehalfOfPersonId: null,
        },
      },
    });
  });

  it("sahip oturumu driver türünde atanmış aktif şoför: 2000 bps, pending", () => {
    const result = run(vehicleContext("owner"), vehicleScope("owner"), driverBody(SEED_IDS.driverA1a));
    expect(result).toMatchObject({
      ok: true,
      input: {
        personId: SEED_IDS.driverA1a,
        workKind: "driver",
        status: "pending",
        figures: { shareBps: 2000 },
        actor: { actorKind: "vehicle_credential", actorRole: "owner", actorCredentialId: SEED_IDS.credA1Owner },
      },
    });
  });

  it("staff oturumu: gerçek platform kullanıcısı, sahip adına", async () => {
    const result = run(staffContext, await staffScope(), driverBody(SEED_IDS.driverA1a));
    expect(result).toMatchObject({
      ok: true,
      input: {
        workKind: "driver",
        actor: {
          actorKind: "platform_user",
          actorSessionId: "session-staff",
          actorRole: "support",
          actorCredentialId: null,
          actorPlatformUserId: SEED_IDS.platformSupport1,
          onBehalfOfKind: "owner",
          onBehalfOfPersonId: SEED_IDS.ownerA,
        },
      },
    });
  });

  it("aynı şoför gövdesi şoför, sahip ve staff oturumunda aynı rakamları verir", async () => {
    const body = driverBody(SEED_IDS.driverA1a);
    const results = [
      run(vehicleContext("driver"), vehicleScope("driver"), body),
      run(vehicleContext("owner"), vehicleScope("owner"), body),
      run(staffContext, await staffScope(), body),
    ];
    const figures = results.map((r) => (r.ok ? r.input.figures : null));
    expect(figures[0]).toMatchObject({ shareCents: 200000, remainderCents: 620000 });
    expect(figures[1]).toEqual(figures[0]);
    expect(figures[2]).toEqual(figures[0]);
  });

  it("başka işletme, pasif kişi, pasif atama, bilinmeyen kimlik ve eksik alan: 422, satır yok", () => {
    const db = createDb(sqlite);
    sqlite.prepare("UPDATE people SET active = 0 WHERE id = ?").run(SEED_IDS.driverA1b);
    sqlite
      .prepare("UPDATE vehicle_drivers SET active = 0 WHERE person_id = ? AND vehicle_id = ?")
      .run(SEED_IDS.driverA1c, SEED_IDS.vehicleA1);
    const ctx = vehicleContext("owner");
    const scope = vehicleScope("owner");
    for (const id of [
      SEED_IDS.driverB1a,
      SEED_IDS.driverA1b,
      SEED_IDS.driverA1c,
      SEED_IDS.driverA2a, // başka araca atanmış
      "yok-boyle-biri",
    ]) {
      const result = prepareWorkEntryCreate(db, ctx, scope, driverBody(id));
      expect(result).toEqual({
        ok: false,
        status: 422,
        code: "VALIDATION_ERROR",
        fields: { workerPersonId: TEXT.personUnavailable },
      });
    }
    const missing = run(ctx, scope, { ...money, workType: "driver" });
    expect(missing).toMatchObject({ ok: false, status: 422, fields: { workerPersonId: TEXT.personRequired } });
  });

  it("geçersiz workType 422; rakam hataları kişi hatasıyla birlikte döner", () => {
    const ctx = vehicleContext("owner");
    const scope = vehicleScope("owner");
    expect(run(ctx, scope, { ...money, workType: "x" })).toMatchObject({
      ok: false,
      status: 422,
      fields: { workType: TEXT.workTypeInvalid },
    });
    const both = run(ctx, scope, { ...driverBody("yok"), grossCents: "abc" });
    expect(both).toMatchObject({ ok: false, status: 422 });
    expect(!both.ok && both.status === 422 && Object.keys(both.fields).sort()).toEqual([
      "grossCents",
      "workerPersonId",
    ]);
  });

  it("istemcinin gönderdiği personId/businessId/role/workKind/shareBps sonucu değiştirmez", () => {
    const clean = run(vehicleContext("driver"), vehicleScope("driver"), driverBody(SEED_IDS.driverA1a));
    const dirty = run(vehicleContext("driver"), vehicleScope("driver"), {
      ...driverBody(SEED_IDS.driverA1a),
      personId: SEED_IDS.ownerA,
      businessId: SEED_IDS.businessB,
      role: "owner",
      workKind: "owner",
      shareBps: 0,
      shareCents: 0,
    });
    expect(dirty).toEqual(clean);
  });

  it("readVehicleOwnerPerson kapsamdaki aracın sahibini döner", () => {
    expect(readVehicleOwnerPerson(createDb(sqlite), vehicleScope("owner"))).toEqual({
      personId: SEED_IDS.ownerA,
      fullName: "Ali Kaya",
    });
  });
});
