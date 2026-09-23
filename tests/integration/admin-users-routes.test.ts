/**
 * /api/v1/admin/users — S2.6 (ekip hesabı yönetimi, yalnız admin).
 *
 * Gerçek geçici SQLite dosyası + gerçek migration + seed (mock/`:memory:` YOK).
 * `argon2.verify` GEÇİŞLİ casus olarak mock'lanır (`reset-vehicle-password-
 * route.test.ts` ile AYNI gerekçe): sonucu değiştirmez, yalnız Argon2
 * TAMAMLANDIKTAN sonra araya gerçek bir eşzamanlı yazma sokmayı sağlar.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("argon2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("argon2")>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

import * as argon2 from "argon2";
import { seedDevData, SEED_IDS, SEED_RAW_PLATES, SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { createDb, openDatabaseConnection, type SqliteConnection } from "../../src/server/data/db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import { resetHashQueueForTests } from "../../src/server/auth/hash-queue";
import { resetVehicleLoginRateLimitForTests } from "../../src/server/auth/rate-limit";
import { GET as getAuditRoute } from "../../src/app/api/v1/admin/audit/route";
import { GET as listUsersRoute, POST as createUserRoute } from "../../src/app/api/v1/admin/users/route";
import { GET as getUserRoute, PATCH as patchUserRoute } from "../../src/app/api/v1/admin/users/[userId]/route";
import { POST as resetUserPasswordRoute } from "../../src/app/api/v1/admin/users/[userId]/reset-password/route";
import { POST as platformLoginRoute } from "../../src/app/api/v1/auth/platform-login/route";
import { POST as vehicleLoginRoute } from "../../src/app/api/v1/auth/vehicle-login/route";
import { GET as getSessionRoute } from "../../src/app/api/v1/session/route";
import { AdminUserForbiddenError, updatePlatformUser } from "../../src/server/usecases/admin-users";
import * as recordReceiptModule from "../../src/server/usecases/receipts/record-receipt";
import { createPlatformSession } from "../../src/server/usecases/session/create-platform-session";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const ORIGIN = "https://example.invalid";
const BASE = `${ORIGIN}/api/v1/admin/users`;

interface Login {
  token: string;
  csrfToken: string;
}

function headers(login: Login, write: boolean): Record<string, string> {
  return write
    ? {
        cookie: `dolmus_session=${login.token}`,
        origin: ORIGIN,
        "x-csrf-token": login.csrfToken,
        "content-type": "application/json",
      }
    : { cookie: `dolmus_session=${login.token}` };
}

async function loginPlatformRaw(username: string, password: string) {
  const response = await platformLoginRoute(
    new Request(`${ORIGIN}/api/v1/auth/platform-login`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  );
  const match = /dolmus_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "");
  const body = await response.json();
  return {
    status: response.status,
    body,
    login: match ? ({ token: decodeURIComponent(match[1]!), csrfToken: body.csrfToken } as Login) : undefined,
  };
}

async function loginPlatform(username: string, password: string): Promise<Login> {
  const result = await loginPlatformRaw(username, password);
  expect(result.status).toBe(201);
  return result.login!;
}

async function loginVehicle(password: string): Promise<Login> {
  const response = await vehicleLoginRoute(
    new Request(`${ORIGIN}/api/v1/auth/vehicle-login`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ plate: SEED_RAW_PLATES.vehicleA1, password }),
    }),
  );
  expect(response.status).toBe(201);
  const match = /dolmus_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "");
  const body = await response.json();
  return { token: decodeURIComponent(match![1]!), csrfToken: body.csrfToken };
}

async function json(response: Response) {
  return { status: response.status, body: await response.json() };
}

const listUsers = (login: Login) => listUsersRoute(new Request(BASE, { headers: headers(login, false) })).then(json);
const getUser = (login: Login, id: string) =>
  getUserRoute(new Request(`${BASE}/${id}`, { headers: headers(login, false) }), {
    params: Promise.resolve({ userId: id }),
  }).then(json);
const createUser = (login: Login, body: Record<string, unknown>) =>
  createUserRoute(
    new Request(BASE, { method: "POST", headers: headers(login, true), body: JSON.stringify(body) }),
  ).then(json);
const patchUser = (login: Login, id: string, body: Record<string, unknown>) =>
  patchUserRoute(
    new Request(`${BASE}/${id}`, { method: "PATCH", headers: headers(login, true), body: JSON.stringify(body) }),
    { params: Promise.resolve({ userId: id }) },
  ).then(json);
const resetPassword = (login: Login, id: string, body: Record<string, unknown>) =>
  resetUserPasswordRoute(
    new Request(`${BASE}/${id}/reset-password`, {
      method: "POST",
      headers: headers(login, true),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ userId: id }) },
  ).then(json);
const sessionStatus = (login: Login) =>
  getSessionRoute(new Request(`${ORIGIN}/api/v1/session`, { headers: headers(login, false) })).then(json);

let requestCounter = 0;
const rid = () => `req-${(requestCounter += 1)}`;

describe("/api/v1/admin/users (S2.6)", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  function raw(): SqliteConnection {
    return openDatabaseConnection(dbPath);
  }

  function count(table: string, where = "1=1"): number {
    const sqlite = raw();
    try {
      return (sqlite.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${where}`).get() as { c: number }).c;
    } finally {
      sqlite.close();
    }
  }

  function rows<T>(sql: string, ...params: unknown[]): T[] {
    const sqlite = raw();
    try {
      return sqlite.prepare(sql).all(...params) as T[];
    } finally {
      sqlite.close();
    }
  }

  /** Bir yönetici + bir destek hesabı oluşturmak için kısayol. */
  async function createAs(admin: Login, username: string, platformRole: "admin" | "support", password: string) {
    const created = await createUser(admin, {
      requestId: rid(),
      username,
      fullName: "Ayşe Yılmaz",
      platformRole,
      password,
    });
    expect(created.status).toBe(201);
    return created.body.user as { id: string; version: number };
  }

  beforeEach(async () => {
    process.env.APP_ORIGIN = ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();
    vi.mocked(argon2.verify).mockClear();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-admin-users-"));
    dbPath = path.join(dir, "test.sqlite");
    const setupSqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    migrate(createDb(setupSqlite), { migrationsFolder });
    await seedDevData(setupSqlite);
    setupSqlite.close();
    process.env.DOLMUS_DB_PATH = dbPath;
    resetAppDbForTests();
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

  // ---------------------------------------------------------------------
  // Yetki: yalnız admin.
  // ---------------------------------------------------------------------

  it("support, owner ve driver oturumları TÜM uçlarda 403 FORBIDDEN alır ve hiçbir satır değişmez", async () => {
    const logins = [
      await loginPlatform(SEED_USERNAMES.support, SEED_TEST_PASSWORDS.support),
      await loginVehicle(SEED_TEST_PASSWORDS.owner),
      await loginVehicle(SEED_TEST_PASSWORDS.driver),
    ];
    const before = rows("SELECT * FROM platform_users ORDER BY id");
    const targetId = SEED_IDS.platformSupport1;

    for (const login of logins) {
      const results = [
        await listUsers(login),
        await getUser(login, targetId),
        await createUser(login, { requestId: rid(), username: "yeni.kisi", fullName: "Yeni Kişi", platformRole: "support", password: "x1" }),
        await patchUser(login, targetId, { requestId: rid(), version: 1, active: false }),
        await resetPassword(login, targetId, { requestId: rid(), newPassword: "yeni-1234" }),
      ];
      for (const result of results) {
        expect(result.status).toBe(403);
        expect(result.body.error.code).toBe("FORBIDDEN");
      }
    }
    expect(rows("SELECT * FROM platform_users ORDER BY id")).toEqual(before);
    expect(count("admin_audit", "entity_type = 'platform_user'")).toBe(0);
    expect(count("mutation_receipts")).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Okuma
  // ---------------------------------------------------------------------

  it("GET liste pasifler dahil tüm hesapları döner; sır alanı yok; bilinmeyen kimlik 404", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const { status, body } = await listUsers(admin);
    expect(status).toBe(200);
    expect(body.users).toHaveLength(4);
    expect(body.users.map((u: { username: string }) => u.username)).toContain(SEED_USERNAMES.supportPassive);
    expect(body.users[0]).toEqual({
      id: expect.any(String),
      username: expect.any(String),
      fullName: null,
      platformRole: expect.stringMatching(/^(admin|support)$/),
      active: expect.any(Boolean),
      version: 1,
    });
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|credentialVersion|argon2/i);

    const detail = await getUser(admin, SEED_IDS.platformSupport1);
    expect(detail.status).toBe(200);
    expect(detail.body.user.username).toBe(SEED_USERNAMES.support);

    expect((await getUser(admin, "yok-boyle-bir-kimlik")).status).toBe(404);
  });

  // ---------------------------------------------------------------------
  // Oluşturma
  // ---------------------------------------------------------------------

  it("POST hesabı kanonik (küçük harf) kullanıcı adıyla oluşturur; audit/makbuz yazılır, sır sızmaz, yeni hesap giriş yapabilir", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const requestId = rid();
    const { status, body } = await createUser(admin, {
      requestId,
      username: "  Destek.Ayse ",
      fullName: "  Ayşe   Yılmaz ",
      platformRole: "support",
      password: "ayse-parola-1",
    });
    expect(status).toBe(201);
    expect(body.user).toEqual({
      id: expect.any(String),
      username: "destek.ayse",
      fullName: "Ayşe Yılmaz",
      platformRole: "support",
      active: true,
      version: 1,
    });
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|credentialVersion|ayse-parola-1/);

    const audit = rows<{ entity_type: string; entity_id: string; business_id: string | null; vehicle_id: string | null; before_json: string | null; after_json: string; actor_platform_user_id: string; action: string }>(
      "SELECT * FROM admin_audit WHERE action = 'platform_user.create'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entity_type: "platform_user",
      entity_id: body.user.id,
      business_id: null,
      vehicle_id: null,
      before_json: null,
      actor_platform_user_id: SEED_IDS.platformAdmin1,
    });
    expect(JSON.parse(audit[0]!.after_json)).toEqual({
      username: "destek.ayse",
      fullName: "Ayşe Yılmaz",
      platformRole: "support",
      active: true,
    });
    expect(audit[0]!.after_json).not.toMatch(/ayse-parola-1|hash|credential/i);
    expect(count("mutation_receipts", `request_id = '${requestId}' AND response_code = 201`)).toBe(1);

    const login = await loginPlatformRaw("destek.ayse", "ayse-parola-1");
    expect(login.status).toBe(201);
    expect(login.body.role).toBe("support");
  });

  it("aynı kullanıcı adı herhangi bir harf biçimiyle (CLI'nin karışık harfli satırı dahil) 422 fields.username verir ve hiçbir şey yazmaz", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const sqlite = raw();
    sqlite
      .prepare(
        "INSERT INTO platform_users (id, username, password_hash, platform_role, active, credential_version) VALUES ('cli-mixed', 'Karisik.Ad', 'x', 'support', 1, 1)",
      )
      .run();
    sqlite.close();
    const usersBefore = count("platform_users");
    const auditBefore = count("admin_audit");

    for (const username of ["ADMIN.TEST", "karisik.ad", "Admin.Test"]) {
      const result = await createUser(admin, {
        requestId: rid(),
        username,
        fullName: "Aynı Ad",
        platformRole: "support",
        password: "parola-1",
      });
      expect(result.status).toBe(422);
      expect(result.body.error.fields.username).toBeTypeOf("string");
    }
    expect(count("platform_users")).toBe(usersBefore);
    expect(count("admin_audit")).toBe(auditBefore);
    expect(count("mutation_receipts")).toBe(0);
  });

  it("geçersiz platformRole, kullanıcı adı ve ad-soyad 422 alan hatası verir", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const base = { fullName: "Ad Soyad", platformRole: "support", password: "parola-1" };

    const badRole = await createUser(admin, { ...base, requestId: rid(), username: "rol.hatasi", platformRole: "owner" });
    expect(badRole.status).toBe(422);
    expect(badRole.body.error.fields.platformRole).toBeTypeOf("string");

    const badUsername = await createUser(admin, { ...base, requestId: rid(), username: "a b" });
    expect(badUsername.status).toBe(422);
    expect(badUsername.body.error.fields.username).toBeTypeOf("string");

    const badName = await createUser(admin, { ...base, requestId: rid(), username: "ad.hatasi", fullName: "   " });
    expect(badName.status).toBe(422);
    expect(badName.body.error.fields.fullName).toBeTypeOf("string");

    expect(count("platform_users")).toBe(4);
  });

  it("aynı requestId + aynı parola tekrar gönderimi ikinci hesap üretmez; farklı parola 409 REQUEST_ID_REUSED", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const body = { requestId: rid(), username: "tekrar.kisi", fullName: "Tekrar Kişi", platformRole: "support", password: "tekrar-1234" };
    const first = await createUser(admin, body);
    const second = await createUser(admin, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(count("platform_users", "username = 'tekrar.kisi'")).toBe(1);

    const wrongPassword = await createUser(admin, { ...body, password: "baska-parola" });
    expect(wrongPassword.status).toBe(409);
    expect(wrongPassword.body.error.code).toBe("REQUEST_ID_REUSED");
  });

  // ---------------------------------------------------------------------
  // Güncelleme
  // ---------------------------------------------------------------------

  it("PATCH active:false hesabın oturumlarını aynı transaction'da iptal eder; yeniden aktifleştirme onları diriltmez; sürüm/çakışma kuralları", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const target = await createAs(admin, "pasif.olacak", "support", "pasif-1234");
    const targetLogin = await loginPlatform("pasif.olacak", "pasif-1234");
    expect((await sessionStatus(targetLogin)).status).toBe(200);

    const deactivated = await patchUser(admin, target.id, { requestId: rid(), version: target.version, active: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.user).toMatchObject({ active: false, version: 2 });
    const revoked = await sessionStatus(targetLogin);
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe("SESSION_REVOKED");
    expect((await loginPlatformRaw("pasif.olacak", "pasif-1234")).status).toBe(401);

    const reactivated = await patchUser(admin, target.id, { requestId: rid(), version: 2, active: true });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.user).toMatchObject({ active: true, version: 3 });
    expect((await sessionStatus(targetLogin)).status).toBe(401);
    expect((await loginPlatformRaw("pasif.olacak", "pasif-1234")).status).toBe(201);

    const actions = rows<{ action: string }>(
      "SELECT action FROM admin_audit WHERE entity_id = ? AND action LIKE 'platform_user.%' ORDER BY occurred_at, rowid",
      target.id,
    ).map((r) => r.action);
    expect(actions).toEqual(["platform_user.create", "platform_user.deactivate", "platform_user.reactivate"]);

    // bayat / eksik sürüm → 409; aynı değer → 422 change
    const stale = await patchUser(admin, target.id, { requestId: rid(), version: 1, fullName: "Yeni Ad" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const missing = await patchUser(admin, target.id, { requestId: rid(), fullName: "Yeni Ad" });
    expect(missing.status).toBe(409);
    const same = await patchUser(admin, target.id, { requestId: rid(), version: 3, active: true, fullName: "Ayşe Yılmaz" });
    expect(same.status).toBe(422);
    expect(same.body.error.fields.change).toBeTypeOf("string");
  });

  it("PATCH ad ve rol değişimi audit yazar, credential_version'ı artırmaz ve oturum iptal etmez", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const target = await createAs(admin, "rol.degisir", "support", "rol-1234");
    const targetLogin = await loginPlatform("rol.degisir", "rol-1234");

    const patched = await patchUser(admin, target.id, {
      requestId: rid(),
      version: 1,
      fullName: "Mehmet   Demir",
      platformRole: "admin",
    });
    expect(patched.status).toBe(200);
    expect(patched.body.user).toMatchObject({ fullName: "Mehmet Demir", platformRole: "admin", version: 2 });
    expect(count("platform_users", `id = '${target.id}' AND credential_version = 1`)).toBe(1);
    expect((await sessionStatus(targetLogin)).status).toBe(200);
    const actions = rows<{ action: string; before_json: string }>(
      "SELECT action, before_json FROM admin_audit WHERE entity_id = ? AND action IN ('platform_user.update','platform_user.role_change')",
      target.id,
    );
    expect(actions.map((a) => a.action).sort()).toEqual(["platform_user.role_change", "platform_user.update"]);
    expect(actions[0]!.before_json).not.toMatch(/hash|credential|password/i);
  });

  it("yöneticilikten indirilen hesabın SONRAKİ /admin/users isteği 403 olur; oturumu iptal edilmez", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const second = await createAs(admin, "ikinci.yonetici", "admin", "ikinci-1234");
    const secondLogin = await loginPlatform("ikinci.yonetici", "ikinci-1234");
    expect((await listUsers(secondLogin)).status).toBe(200);

    expect((await patchUser(admin, second.id, { requestId: rid(), version: 1, platformRole: "support" })).status).toBe(200);
    const denied = await listUsers(secondLogin);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
    const session = await sessionStatus(secondLogin);
    expect(session.status).toBe(200);
    expect(session.body.role).toBe("support");
  });

  it("guard ile yazma arasında yöneticilikten indirilen aktör yazmayı tamamlayamaz (rol TOCTOU) — 403 ve geri alma", async () => {
    const sqlite = raw();
    const db = createDb(sqlite);
    try {
      const { context } = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      sqlite.prepare("UPDATE platform_users SET platform_role = 'support' WHERE id = ?").run(SEED_IDS.platformAdmin1);
      expect(() =>
        updatePlatformUser(db, context, { requestId: rid(), userId: SEED_IDS.platformSupport1, version: 1, fullName: "Yetkisiz" }),
      ).toThrow(AdminUserForbiddenError);
      expect(sqlite.prepare("SELECT full_name FROM platform_users WHERE id = ?").get(SEED_IDS.platformSupport1)).toEqual({ full_name: null });
      expect((sqlite.prepare("SELECT COUNT(*) c FROM mutation_receipts").get() as { c: number }).c).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it("son aktif yönetici kendini (ya da tek yöneticiyken başkasını) pasifleştiremez/indiremez — 422, hiçbir şey değişmez", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const demote = await patchUser(admin, SEED_IDS.platformAdmin1, { requestId: rid(), version: 1, platformRole: "support" });
    expect(demote.status).toBe(422);
    expect(demote.body.error.fields.platformRole).toBeTypeOf("string");
    const deactivate = await patchUser(admin, SEED_IDS.platformAdmin1, { requestId: rid(), version: 1, active: false });
    expect(deactivate.status).toBe(422);
    expect(deactivate.body.error.fields.active).toBeTypeOf("string");
    expect(count("platform_users", `id = '${SEED_IDS.platformAdmin1}' AND platform_role = 'admin' AND active = 1 AND version = 1`)).toBe(1);
    expect((await sessionStatus(admin)).status).toBe(200);
    expect(count("mutation_receipts")).toBe(0);

    // İkinci bir aktif yönetici varken aynı işlem serbesttir.
    const second = await createAs(admin, "yedek.yonetici", "admin", "yedek-1234");
    expect((await patchUser(admin, second.id, { requestId: rid(), version: 1, active: false })).status).toBe(200);
  });

  it("transaction içinde araya giren hata platform_users, sessions, admin_audit ve mutation_receipts'i DEĞİŞTİRMEZ", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const target = await createAs(admin, "geri.alinacak", "support", "geri-1234");
    const targetLogin = await loginPlatform("geri.alinacak", "geri-1234");
    const snapshot = () => ({
      users: rows("SELECT * FROM platform_users ORDER BY id"),
      sessions: rows("SELECT * FROM sessions ORDER BY id"),
      audit: rows("SELECT * FROM admin_audit ORDER BY id"),
      receipts: rows("SELECT * FROM mutation_receipts ORDER BY request_id"),
    });
    const before = snapshot();

    const spy = vi.spyOn(recordReceiptModule, "recordReceipt").mockImplementationOnce(() => {
      throw new Error("simüle edilmiş yazma hatası");
    });
    try {
      await expect(
        patchUserRoute(
          new Request(`${BASE}/${target.id}`, {
            method: "PATCH",
            headers: headers(admin, true),
            body: JSON.stringify({ requestId: rid(), version: 1, active: false }),
          }),
          { params: Promise.resolve({ userId: target.id }) },
        ),
      ).rejects.toThrow("simüle edilmiş yazma hatası");
    } finally {
      spy.mockRestore();
    }
    expect(snapshot()).toEqual(before);
    expect((await sessionStatus(targetLogin)).status).toBe(200);
  });

  // ---------------------------------------------------------------------
  // Parola sıfırlama
  // ---------------------------------------------------------------------

  it("reset-password hash'i değiştirir, oturumları iptal eder, sürümü değiştirmez; yanıt yalnız id+username; audit sır içermez", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const targetLogin = await loginPlatform(SEED_USERNAMES.support, SEED_TEST_PASSWORDS.support);

    const result = await resetPassword(admin, SEED_IDS.platformSupport1, { requestId: rid(), newPassword: "yeni-destek-9999" });
    expect(result.status).toBe(200);
    expect(result.body.user).toEqual({ id: SEED_IDS.platformSupport1, username: SEED_USERNAMES.support });
    expect(JSON.stringify(result.body)).not.toMatch(/yeni-destek-9999|hash|credential/i);

    expect(count("platform_users", `id = '${SEED_IDS.platformSupport1}' AND credential_version = 2 AND version = 1`)).toBe(1);
    const revoked = await sessionStatus(targetLogin);
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe("SESSION_REVOKED");
    expect((await loginPlatformRaw(SEED_USERNAMES.support, SEED_TEST_PASSWORDS.support)).status).toBe(401);
    expect((await loginPlatformRaw(SEED_USERNAMES.support, "yeni-destek-9999")).status).toBe(201);

    const audit = rows<{ before_json: string; after_json: string; actor_platform_user_id: string }>(
      "SELECT * FROM admin_audit WHERE entity_id = ? AND action = 'platform_user.reset_password' AND actor_platform_user_id = ?",
      SEED_IDS.platformSupport1,
      SEED_IDS.platformAdmin1,
    );
    expect(audit).toHaveLength(1);
    expect(`${audit[0]!.before_json}${audit[0]!.after_json}`).not.toMatch(/yeni-destek-9999|hash|credential|password/i);
  });

  it("reset-password tekrar gönderimi ikinci sıfırlama yapmaz; farklı hedef 409 REQUEST_ID_REUSED; bilinmeyen hesap 404", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const body = { requestId: rid(), newPassword: "tekrar-9999" };
    expect((await resetPassword(admin, SEED_IDS.platformSupport1, body)).status).toBe(200);
    expect((await resetPassword(admin, SEED_IDS.platformSupport1, body)).status).toBe(200);
    expect(count("platform_users", `id = '${SEED_IDS.platformSupport1}' AND credential_version = 2`)).toBe(1);

    const otherTarget = await resetPassword(admin, SEED_IDS.platformSupportPassive1, body);
    expect(otherTarget.status).toBe(409);
    expect(otherTarget.body.error.code).toBe("REQUEST_ID_REUSED");

    expect((await resetPassword(admin, "yok-boyle-bir-kimlik", { requestId: rid(), newPassword: "x-1234" })).status).toBe(404);
  });

  it("yönetici kendi parolasını sıfırlarsa kendi oturumu da iptal olur; yanıt yine döner", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const result = await resetPassword(admin, SEED_IDS.platformAdmin1, { requestId: rid(), newPassword: "kendi-yeni-9999" });
    expect(result.status).toBe(200);
    expect((await listUsers(admin)).status).toBe(401);
    expect((await loginPlatformRaw(SEED_USERNAMES.admin, "kendi-yeni-9999")).status).toBe(201);
  });

  // ---------------------------------------------------------------------
  // Giriş yarışları
  // ---------------------------------------------------------------------

  it("parola eşleştikten hemen SONRA sıfırlama gelirse giriş 401 INVALID_CREDENTIALS olur ve oturum satırı oluşmaz", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const sessionsBefore = count("sessions", `platform_user_id = '${SEED_IDS.platformSupport1}'`);

    vi.mocked(argon2.verify).mockImplementationOnce(async (digest, password) => {
      const actual = await vi.importActual<typeof import("argon2")>("argon2");
      const matched = await actual.verify(digest, password);
      expect((await resetPassword(admin, SEED_IDS.platformSupport1, { requestId: rid(), newPassword: "yaris-yeni-9999" })).status).toBe(200);
      return matched;
    });
    const raced = await loginPlatformRaw(SEED_USERNAMES.support, SEED_TEST_PASSWORDS.support);
    expect(raced.status).toBe(401);
    expect(raced.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(count("sessions", `platform_user_id = '${SEED_IDS.platformSupport1}'`)).toBe(sessionsBefore);
  });

  it("parola eşleştikten hemen SONRA pasifleştirme gelirse giriş 401 INVALID_CREDENTIALS olur ve oturum satırı oluşmaz", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const sessionsBefore = count("sessions", `platform_user_id = '${SEED_IDS.platformSupport1}'`);

    vi.mocked(argon2.verify).mockImplementationOnce(async (digest, password) => {
      const actual = await vi.importActual<typeof import("argon2")>("argon2");
      const matched = await actual.verify(digest, password);
      expect((await patchUser(admin, SEED_IDS.platformSupport1, { requestId: rid(), version: 1, active: false })).status).toBe(200);
      return matched;
    });
    const raced = await loginPlatformRaw(SEED_USERNAMES.support, SEED_TEST_PASSWORDS.support);
    expect(raced.status).toBe(401);
    expect(raced.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(count("sessions", `platform_user_id = '${SEED_IDS.platformSupport1}'`)).toBe(sessionsBefore);
  });

  // ---------------------------------------------------------------------
  // Audit: targetUser
  // ---------------------------------------------------------------------

  it("GET /admin/audit satırları targetUser taşır (hedef pasifleşse de); platform_user olmayan satırlarda null", async () => {
    const admin = await loginPlatform(SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    const target = await createAs(admin, "denetim.hedefi", "support", "denetim-1234");
    expect((await patchUser(admin, target.id, { requestId: rid(), version: 1, active: false })).status).toBe(200);

    const response = await getAuditRoute(new Request(`${ORIGIN}/api/v1/admin/audit?limit=100`, { headers: headers(admin, false) }));
    const { status, body } = await json(response);
    expect(status).toBe(200);
    const entries = body.entries as { action: string; entityType: string; targetUser: { id: string; username: string } | null; actor: { username: string } }[];
    const userEntries = entries.filter((e) => e.entityType === "platform_user");
    expect(userEntries.map((e) => e.action).sort()).toEqual(["platform_user.create", "platform_user.deactivate"]);
    for (const entry of userEntries) {
      expect(entry.targetUser).toEqual({ id: target.id, username: "denetim.hedefi" });
      expect(entry.actor.username).toBe(SEED_USERNAMES.admin);
    }
    expect(entries.filter((e) => e.entityType !== "platform_user").every((e) => e.targetUser === null)).toBe(true);
  });
});
