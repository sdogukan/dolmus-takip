/**
 * GET /api/v1/admin/vehicles ve /admin/businesses — q/active/cursor/limit
 * arama ve keyset sayfalama.
 *
 * QA-PLAN §1 — gerçek geçici SQLite dosyası + gerçek migration + seed.
 * Kapsam: plaka farklı boşluk/harf biçimiyle, işletme ve sahip adıyla (Türkçe
 * ö/ı/İ/ş katlaması) arama; active filtresi; nextCursor ile tekrarsız
 * sayfalama; geçersiz parametre 422; araç oturumu 403; mevcut anahtarlar
 * (`vehicles`/`businesses`) korunur.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS, SEED_RAW_PLATES, SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { createDb, openDatabaseConnection } from "../../src/server/data/db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { resetHashQueueForTests } from "../../src/server/auth/hash-queue";
import { resetVehicleLoginRateLimitForTests } from "../../src/server/auth/rate-limit";
import { POST as platformLoginRoute } from "../../src/app/api/v1/auth/platform-login/route";
import { POST as vehicleLoginRoute } from "../../src/app/api/v1/auth/vehicle-login/route";
import { GET as getBusinesses, POST as postBusiness } from "../../src/app/api/v1/admin/businesses/route";
import { GET as getVehicles, POST as postVehicle } from "../../src/app/api/v1/admin/vehicles/route";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const SELF_ORIGIN = "https://example.invalid";
const API = "https://example.invalid/api/v1";

interface Session {
  token: string;
  csrfToken: string;
}

function readSession(response: Response, body: { csrfToken: string }): Session {
  const match = /dolmus_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "");
  return { token: decodeURIComponent(match![1]!), csrfToken: body.csrfToken };
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

function writeRequest(
  session: Session,
  method: string,
  body: unknown,
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method,
    headers: {
      cookie: `dolmus_session=${session.token}`,
      origin: SELF_ORIGIN,
      "x-csrf-token": session.csrfToken,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function listRequest(session: Session, resource: "vehicles" | "businesses", query = ""): Request {
  return new Request(`${API}/admin/${resource}${query}`, {
    headers: { cookie: `dolmus_session=${session.token}` },
  });
}

interface VehicleItem {
  id: string;
  plateNormalized: string;
  active: boolean;
  businessName: string;
  owner: { fullName: string };
  business: { id: string; name: string; active: boolean };
}
interface BusinessItem {
  id: string;
  name: string;
  active: boolean;
  owner: { fullName: string } | null;
}

async function vehiclesList(session: Session, query = ""): Promise<{ status: number; body: { vehicles: VehicleItem[]; nextCursor: string | null; error?: { fields?: Record<string, string> } } }> {
  const response = await getVehicles(listRequest(session, "vehicles", query));
  return { status: response.status, body: await response.json() };
}

async function businessesList(session: Session, query = ""): Promise<{ status: number; body: { businesses: BusinessItem[]; nextCursor: string | null; error?: { fields?: Record<string, string> } } }> {
  const response = await getBusinesses(listRequest(session, "businesses", query));
  return { status: response.status, body: await response.json() };
}

describe("admin liste arama ve sayfalama", () => {
  let dir: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;
  let admin: Session;

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-admin-list-"));
    const dbPath = path.join(dir, "test.sqlite");
    const setupSqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    migrate(createDb(setupSqlite), { migrationsFolder });
    await seedDevData(setupSqlite);
    setupSqlite.close();
    process.env.DOLMUS_DB_PATH = dbPath;
    resetAppDbForTests();
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

  async function createBusiness(name: string, ownerFullName: string): Promise<string> {
    const response = await postBusiness(
      writeRequest(admin, "POST", { requestId: `b-${crypto.randomUUID()}`, name, owner: { fullName: ownerFullName } }, `${API}/admin/businesses`),
    );
    expect(response.status).toBe(201);
    return (await response.json()).business.id as string;
  }

  async function createVehicle(businessId: string, plate: string): Promise<string> {
    const response = await postVehicle(
      writeRequest(
        admin,
        "POST",
        { requestId: `v-${crypto.randomUUID()}`, businessRef: businessId, plate, ownerPassword: "sahip-parola-1", driverPassword: "sofor-parola-1" },
        `${API}/admin/vehicles`,
      ),
    );
    expect(response.status).toBe(201);
    return (await response.json()).vehicle.id as string;
  }

  it("araç listesi mevcut anahtarları korur; işletme/sahip/aktiflik ekler ve nextCursor döner", async () => {
    const { status, body } = await vehiclesList(admin);
    expect(status).toBe(200);
    expect(body.vehicles).toHaveLength(4);
    expect(body.nextCursor).toBeNull();
    const a1 = body.vehicles.find((v) => v.id === SEED_IDS.vehicleA1)!;
    expect(a1).toMatchObject({
      businessName: "İşletme A",
      active: true,
      owner: { fullName: "Ali Kaya" },
      business: { id: SEED_IDS.businessA, name: "İşletme A", active: true },
    });
  });

  it("plaka farklı boşluk/harf biçiminde yazılsa da araç bulunur", async () => {
    for (const q of ["34 aaa 001", "34AAA001", " 34aAa001 ", "aaa"]) {
      const { body } = await vehiclesList(admin, `?q=${encodeURIComponent(q)}`);
      expect(body.vehicles.map((v) => v.id), `q=${q}`).toEqual([SEED_IDS.vehicleA1]);
    }
    expect((await vehiclesList(admin, "?q=99ZZZ999")).body.vehicles).toEqual([]);
  });

  it("işletme adı ve sahip adıyla Türkçe harf katlamasıyla araç bulunur", async () => {
    const businessId = await createBusiness("Şişli Dolmuş", "Görkem Işık");
    const vehicleId = await createVehicle(businessId, "34 SIS 100");

    for (const q of ["şişli", "ŞİŞLİ", "Şişli dolmuş", "GÖRKEM", "görkem ışık", "IŞIK", "ışık"]) {
      const { body } = await vehiclesList(admin, `?q=${encodeURIComponent(q)}`);
      expect(body.vehicles.map((v) => v.id), `q=${q}`).toEqual([vehicleId]);
    }
    // Seed işletmeleri "İşletme A/B": İ/I/i/ı aynı harf sayılır.
    const seedBusinessMatch = await vehiclesList(admin, `?q=${encodeURIComponent("işletme a")}`);
    expect(seedBusinessMatch.body.vehicles.map((v) => v.businessName)).toEqual(["İşletme A", "İşletme A"]);
    expect((await vehiclesList(admin, `?q=${encodeURIComponent("IŞLETME B")}`)).body.vehicles).toHaveLength(2);
  });

  it("q içindeki LIKE joker karakterleri düz metin sayılır", async () => {
    for (const q of ["%", "_", "\\"]) {
      expect((await vehiclesList(admin, `?q=${encodeURIComponent(q)}`)).body.vehicles).toEqual([]);
      expect((await businessesList(admin, `?q=${encodeURIComponent(q)}`)).body.businesses).toEqual([]);
    }
  });

  it("araç active filtresi ve nextCursor ile tekrarsız sayfalama", async () => {
    const inactive = await vehiclesList(admin, "?active=inactive");
    expect(inactive.body.vehicles.map((v) => v.id)).toEqual([SEED_IDS.vehicleB2]);
    const active = await vehiclesList(admin, "?active=active");
    expect(active.body.vehicles).toHaveLength(3);
    expect(active.body.vehicles.every((v) => v.active)).toBe(true);
    expect((await vehiclesList(admin, "?active=all")).body.vehicles).toHaveLength(4);

    const full = (await vehiclesList(admin, "?limit=100")).body.vehicles.map((v) => v.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = await vehiclesList(admin, query);
      expect(page.status).toBe(200);
      expect(page.body.vehicles.length).toBeLessThanOrEqual(1);
      seen.push(...page.body.vehicles.map((v) => v.id));
      cursor = page.body.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(20);
    } while (cursor);
    expect(seen).toEqual(full);
    expect(new Set(seen).size).toBe(4);
  });

  it("q ile filtrelenmiş sonuçlar da tekrarsız sayfalanır", async () => {
    const first = await vehiclesList(admin, `?q=${encodeURIComponent("işletme")}&limit=3`);
    expect(first.body.vehicles).toHaveLength(3);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await vehiclesList(admin, `?q=${encodeURIComponent("işletme")}&limit=3&cursor=${encodeURIComponent(first.body.nextCursor!)}`);
    expect(second.body.vehicles).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    const ids = [...first.body.vehicles, ...second.body.vehicles].map((v) => v.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("işletme listesi: yeni işletme ilk sırada, mevcut anahtarlar korunur, Türkçe arama çalışır", async () => {
    const isparta = await createBusiness("Isparta Turizm", "Ayşe Yıldız");
    const izmir = await createBusiness("İzmir Ekspres", "Öznur Şahin");

    const all = await businessesList(admin);
    expect(all.status).toBe(200);
    expect(all.body.businesses).toHaveLength(4);
    expect(all.body.businesses[0]).toHaveProperty("vehicleCount");
    expect(all.body.businesses.slice(0, 2).map((b) => b.id)).toEqual(expect.arrayContaining([isparta, izmir]));

    const cases: [string, string][] = [
      ["ısparta", isparta],
      ["ISPARTA", isparta],
      ["izmir", izmir],
      ["İZMİR", izmir],
      ["ÖZNUR", izmir],
      ["öznur şahin", izmir],
      ["yıldız", isparta],
    ];
    for (const [q, expectedId] of cases) {
      const { body } = await businessesList(admin, `?q=${encodeURIComponent(q)}`);
      expect(body.businesses.map((b) => b.id), `q=${q}`).toEqual([expectedId]);
    }
  });

  it("işletme active filtresi ve nextCursor ile tekrarsız sayfalama", async () => {
    await createBusiness("Ek Bir", "Ek Sahip Bir");
    await createBusiness("Ek İki", "Ek Sahip İki");

    expect((await businessesList(admin, "?active=inactive")).body.businesses).toEqual([]);
    expect((await businessesList(admin, "?active=active")).body.businesses).toHaveLength(4);

    const full = (await businessesList(admin, "?limit=100")).body.businesses.map((b) => b.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = await businessesList(admin, query);
      seen.push(...page.body.businesses.map((b) => b.id));
      cursor = page.body.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(20);
    } while (cursor);
    expect(seen).toEqual(full);
    expect(new Set(seen).size).toBe(4);
  });

  it("geçersiz q/active/cursor/limit 422 döner", async () => {
    const bad: [string, string][] = [
      ["active=hepsi", "active"],
      ["limit=0", "limit"],
      ["limit=101", "limit"],
      ["limit=abc", "limit"],
      ["cursor=bozuk", "cursor"],
      [`q=${"a".repeat(101)}`, "q"],
      // Araç imleci tek bileşen, işletme imleci iki bileşendir: çapraz kullanım reddedilir.
      [`cursor=${Buffer.from('["a","b"]').toString("base64url")}`, "cursor"],
    ];
    for (const [query, field] of bad) {
      const vehicles = await vehiclesList(admin, `?${query}`);
      expect(vehicles.status, query).toBe(422);
      expect(vehicles.body.error?.fields).toHaveProperty(field);
    }
    const crossCursor = Buffer.from('["tek"]').toString("base64url");
    const businesses = await businessesList(admin, `?cursor=${crossCursor}`);
    expect(businesses.status).toBe(422);
    expect(businesses.body.error?.fields).toHaveProperty("cursor");
  });

  it("araç oturumları liste uçlarında 403 alır", async () => {
    const owner = await loginVehicle(SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner);
    expect((await getVehicles(listRequest(owner, "vehicles"))).status).toBe(403);
    expect((await getBusinesses(listRequest(owner, "businesses"))).status).toBe(403);
  });
});
