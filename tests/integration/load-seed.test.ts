import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  LoadSeedRefusedError,
  migrationHashList,
  runLoadSeed,
  type LoadSeedOptions,
} from "../../scripts/load-seed";
import { assertMigrationsApplied, openDatabaseConnection, type SqliteConnection } from "../../src/server/data/db";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { resetHashQueueForTests } from "../../src/server/auth/hash-queue";
import { resetVehicleLoginRateLimitForTests } from "../../src/server/auth/rate-limit";
import { POST as vehicleLoginRoute } from "../../src/app/api/v1/auth/vehicle-login/route";
import { POST as platformLoginRoute } from "../../src/app/api/v1/auth/platform-login/route";

/**
 * `npm run load:seed` (S6.6) — KÜÇÜK ölçekli kurulum (2 araç, 5 yıl): tam
 * ölçekli seed ve `load:run` rutin paketlerde koşmaz. Sabitlenenler: taze ve
 * migration'ı uygulanmış DB, ≥ 5 yıllık geçmiş ve boş yük penceresi, yan
 * dosyadaki sayıların DB ile aynı olması, 0600 kimlik bilgisi dosyası, bu
 * kimlik bilgilerinin GERÇEK vehicle-login / platform-login route'larından
 * girebilmesi ve var olan yol / üretim ortamı reddi.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const FAKE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

function options(dir: string, over: Partial<LoadSeedOptions> = {}): LoadSeedOptions {
  return {
    dbPath: path.join(dir, "load.sqlite"),
    credentialsPath: path.join(dir, "credentials.json"),
    countsPath: path.join(dir, "load.sqlite.counts.json"),
    vehicles: 2,
    platformUsers: 2,
    loadWindowMonth: "2026-09",
    randomSeed: 7,
    sourceCommit: FAKE_COMMIT,
    sourceTreeDirty: false,
    env: {},
    log: () => {},
    ...over,
  };
}

function loginRequest(route: string, body: unknown): Request {
  return new Request(`${SELF_ORIGIN}/api/v1/auth/${route}`, {
    method: "POST",
    headers: { origin: SELF_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface Credentials {
  vehicles: { plate: string; vehicleId: string; driverPersonIds: string[]; ownerPassword: string; driverPassword: string }[];
  platformUsers: { username: string; role: string; password: string }[];
}

describe("load:seed — kurulan veri seti", () => {
  let dir: string;
  let sqlite: SqliteConnection;
  let credentials: Credentials;
  let sidecarText: string;
  let walLeftBySeed: boolean;
  const env = { DOLMUS_DB_PATH: process.env.DOLMUS_DB_PATH, APP_ORIGIN: process.env.APP_ORIGIN };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-load-seed-"));
    await runLoadSeed(options(dir));
    walLeftBySeed = fs.existsSync(path.join(dir, "load.sqlite-wal"));
    sqlite = openDatabaseConnection(path.join(dir, "load.sqlite"));
    credentials = JSON.parse(fs.readFileSync(path.join(dir, "credentials.json"), "utf8")) as Credentials;
    sidecarText = fs.readFileSync(path.join(dir, "load.sqlite.counts.json"), "utf8");

    process.env.DOLMUS_DB_PATH = path.join(dir, "load.sqlite");
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetAppDbForTests();
  });

  afterAll(() => {
    sqlite.close();
    resetAppDbForTests();
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetTrustedAppOriginForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();
  });

  const count = (sql: string) => Number((sqlite.prepare(sql).get() as { n: number }).n);

  it("migration'ları uygulanmış, en az beş yıllık geçmiş yük penceresinden önce biter", () => {
    expect(() => assertMigrationsApplied(sqlite, migrationsFolder)).not.toThrow();
    const range = sqlite.prepare("SELECT MIN(work_date) AS first, MAX(work_date) AS last FROM work_entries").get() as {
      first: string;
      last: string;
    };
    expect(range.first >= "2021-09-01").toBe(true);
    expect(range.last <= "2026-08-31").toBe(true);
    const spanDays = (Date.parse(range.last) - Date.parse(range.first)) / 86_400_000 + 1;
    expect(spanDays).toBeGreaterThanOrEqual(5 * 365);
    expect(count("SELECT COUNT(*) AS n FROM work_entries WHERE work_date >= '2026-09-01'")).toBe(0);
    expect(walLeftBySeed).toBe(false); // tek dosya: kopyalanıp hedef makineye taşınabilir
  });

  it("yan dosyadaki sayılar, commit ve migration hash'leri DB ve depo ile aynıdır", () => {
    const sidecar = JSON.parse(sidecarText) as {
      sourceCommit: string;
      schema: unknown;
      history: { startDate: string; endDate: string; years: number };
      loadWindow: { firstMonth: string };
      counts: Record<string, number | string>;
    };
    expect(sidecar.sourceCommit).toBe(FAKE_COMMIT);
    expect(sidecar.schema).toEqual(migrationHashList());
    expect(sidecar.history).toEqual({ startDate: "2021-09-01", endDate: "2026-08-31", years: 5 });
    expect(sidecar.loadWindow.firstMonth).toBe("2026-09");
    expect(sidecar.counts).toMatchObject({
      vehicles: 2,
      vehicleCredentials: 4,
      platformUsers: 2,
      calendarDays: 1826,
      people: count("SELECT COUNT(*) AS n FROM people"),
      workDays: count("SELECT COUNT(DISTINCT work_date) AS n FROM work_entries"),
      workEntries: count("SELECT COUNT(*) AS n FROM work_entries"),
      revisions: count("SELECT COUNT(*) AS n FROM work_entry_revisions"),
      confirmations: count("SELECT COUNT(*) AS n FROM cash_confirmations"),
    });
    for (const key of ["workEntries", "revisions", "confirmations", "correctedEntries", "pendingEntries", "ownerEntries"]) {
      expect(sidecar.counts[key]).toBeGreaterThan(0);
    }
  });

  it("kayıtlar uygulamanın yazdığı biçimde: her sürümün revizyonu, onaylı sürümün teslim onayı, hesap kuralı", () => {
    expect(
      count(`SELECT COUNT(*) AS n FROM work_entries e
             WHERE (SELECT COUNT(*) FROM work_entry_revisions r WHERE r.entry_id = e.id) <> e.version`),
    ).toBe(0);
    expect(
      count(`SELECT COUNT(*) AS n FROM work_entries e WHERE e.status = 'confirmed' AND NOT EXISTS (
               SELECT 1 FROM cash_confirmations c WHERE c.entry_id = e.id AND c.entry_version = e.version)`),
    ).toBe(0);
    expect(
      count(`SELECT COUNT(*) AS n FROM work_entries e WHERE e.status <> 'confirmed' AND EXISTS (
               SELECT 1 FROM cash_confirmations c WHERE c.entry_id = e.id)`),
    ).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM work_entries WHERE work_kind = 'owner' AND status <> 'not_required'")).toBe(0);
    expect(
      count(`SELECT COUNT(*) AS n FROM work_entries
             WHERE share_cents <> (gross_cents * share_bps + 5000) / 10000
                OR remainder_cents <> gross_cents - fuel_cents - other_expense_cents - share_cents
                OR share_bps <> CASE work_kind WHEN 'driver' THEN 2000 ELSE 0 END`),
    ).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM vehicle_drivers WHERE active = 0")).toBe(2);
  });

  it("kimlik bilgisi dosyası 0600; parolalar yan dosyada yok", () => {
    expect(fs.statSync(path.join(dir, "credentials.json")).mode & 0o777).toBe(0o600);
    expect(credentials.vehicles).toHaveLength(2);
    expect(credentials.platformUsers).toHaveLength(2);
    for (const v of credentials.vehicles) {
      expect(v.ownerPassword).not.toBe(v.driverPassword);
      expect(sidecarText).not.toContain(v.ownerPassword);
      expect(sidecarText).not.toContain(v.driverPassword);
      expect(v.driverPersonIds).toHaveLength(3); // ayrılan şoför listede yok
    }
  });

  it("araç sahibi ve şoför kimlik bilgileri gerçek vehicle-login route'undan girer; yanlış parola 401", async () => {
    for (const v of credentials.vehicles) {
      for (const [role, password] of [["owner", v.ownerPassword], ["driver", v.driverPassword]] as const) {
        const response = await vehicleLoginRoute(loginRequest("vehicle-login", { plate: v.plate, password }));
        expect(response.status).toBe(201);
        const body = (await response.json()) as { role: string; vehicleId: string };
        expect(body).toMatchObject({ role, vehicleId: v.vehicleId });
        expect(response.headers.get("set-cookie")).toMatch(/dolmus_session=/u);
      }
    }
    const wrong = await vehicleLoginRoute(loginRequest("vehicle-login", { plate: credentials.vehicles[0]!.plate, password: "yanlis-parola" }));
    expect(wrong.status).toBe(401);
  });

  it("ekip kimlik bilgileri gerçek platform-login route'undan girer", async () => {
    for (const u of credentials.platformUsers) {
      const response = await platformLoginRoute(loginRequest("platform-login", { username: u.username, password: u.password }));
      expect(response.status).toBe(201);
      expect(((await response.json()) as { role: string }).role).toBe(u.role);
    }
  });
});

describe("load:seed — korumalar", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-load-seed-guard-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("var olan DB dosyasının üzerine yazmaz ve hiçbir dosya oluşturmaz", async () => {
    const dbPath = path.join(dir, "load.sqlite");
    fs.writeFileSync(dbPath, "mevcut-veri");
    await expect(runLoadSeed(options(dir))).rejects.toThrow(LoadSeedRefusedError);
    expect(fs.readFileSync(dbPath, "utf8")).toBe("mevcut-veri");
    expect(fs.readdirSync(dir)).toEqual(["load.sqlite"]);
  });

  it("var olan WAL, kimlik bilgisi veya yan dosya yolunu da reddeder", async () => {
    for (const name of ["load.sqlite-wal", "credentials.json", "load.sqlite.counts.json"]) {
      fs.writeFileSync(path.join(dir, name), "x");
      await expect(runLoadSeed(options(dir))).rejects.toThrow(/zaten var/u);
      fs.rmSync(path.join(dir, name));
    }
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("NODE_ENV=production iken hiçbir dosyaya dokunmadan reddeder", async () => {
    await expect(runLoadSeed(options(dir, { env: { NODE_ENV: "production" } }))).rejects.toThrow(/production/u);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("kimlik bilgisi dosyası depo içinde olamaz", async () => {
    const inside = path.join(projectRoot, "load-credentials.test-never-created.json");
    await expect(runLoadSeed(options(dir, { credentialsPath: inside }))).rejects.toThrow(/depo dışında/u);
    expect(fs.existsSync(inside)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
