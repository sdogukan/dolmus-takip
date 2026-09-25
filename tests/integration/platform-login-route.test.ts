import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `argon2.verify` GEÇİŞLİ (passthrough) casus — `tests/integration/
 * vehicle-login-route.test.ts`'İN AYNI gerekçesi (bkz. o dosyanın üst
 * notu): sonucu ASLA DEĞİŞTİRMEZ, yalnız GERÇEK çağrı argümanlarını
 * kaydeder — dummy-hash yolunun GERÇEKTEN çalıştığını CANLI kanıtlamanın
 * tek yoludur.
 */
vi.mock("argon2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("argon2")>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

import {
  seedDevData,
  SEED_RAW_PLATES,
  SEED_TEST_PASSWORDS,
  SEED_USERNAMES,
} from "../../scripts/db-seed-dev";
import { resetAdminPassword } from "../../scripts/platform-admin";
import { resetAppDbForTests } from "../../src/server/data/app-db";
import { createDb, openDatabaseConnection } from "../../src/server/data/db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import {
  HASH_QUEUE_MAX_CONCURRENT,
  HASH_QUEUE_MAX_PENDING,
  resetHashQueueForTests,
  runInHashQueue,
} from "../../src/server/auth/hash-queue";
import { resetVehicleLoginRateLimitForTests } from "../../src/server/auth/rate-limit";
import { DUMMY_ARGON2ID_HASH } from "../../src/server/usecases/auth/vehicle-login";
import { POST as platformLoginRoute } from "../../src/app/api/v1/auth/platform-login/route";
import { GET as getSession } from "../../src/app/api/v1/session/route";
import * as argon2 from "argon2";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");

const SELF_ORIGIN = "https://example.invalid";
const LOGIN_URL = "https://example.invalid/api/v1/auth/platform-login";
const SESSION_URL = "https://example.invalid/api/v1/session";

function loginRequest(
  body: unknown,
  init: { headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("origin", SELF_ORIGIN);
  headers.set("content-type", "application/json");
  return new Request(LOGIN_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function setCookieToken(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  const match = /dolmus_session=([^;]+)/.exec(setCookie ?? "");
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1]!);
}

describe("POST /api/v1/auth/platform-login (T1.3 ADIM 1/2)", () => {
  let dir: string;
  let dbPath: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;

  beforeEach(async () => {
    process.env.APP_ORIGIN = SELF_ORIGIN;
    resetTrustedAppOriginForTests();
    resetVehicleLoginRateLimitForTests();
    resetHashQueueForTests();
    vi.mocked(argon2.verify).mockClear();

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-platform-login-"));
    dbPath = path.join(dir, "test.sqlite");
    const setupSqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    const setupDb = createDb(setupSqlite);
    migrate(setupDb, { migrationsFolder });
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

  // -------------------------------------------------------------------
  // Aktif admin/support girişi ve rol.
  // -------------------------------------------------------------------

  it("aktif admin girişi 201 döner; kind/role/username/izinler admin'e uygundur", async () => {
    const response = await platformLoginRoute(
      loginRequest({
        username: SEED_USERNAMES.admin,
        password: SEED_TEST_PASSWORDS.admin,
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.kind).toBe("platform");
    expect(body.role).toBe("admin");
    expect(body.username).toBe(SEED_USERNAMES.admin);
    expect(typeof body.csrfToken).toBe("string");
    expect(body.csrfToken.length).toBeGreaterThan(0);
    expect(typeof body.scopeKey).toBe("string");
    expect(body.permissions).toContain("platform_user.manage");
    expect(body.permissions).toContain("audit.read");
  });

  it("aktif support girişi 201 döner; role 'support' — platform_user.manage İÇERMEZ", async () => {
    const response = await platformLoginRoute(
      loginRequest({
        username: SEED_USERNAMES.support,
        password: SEED_TEST_PASSWORDS.support,
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.role).toBe("support");
    expect(body.username).toBe(SEED_USERNAMES.support);
    expect(body.permissions).not.toContain("platform_user.manage");
    expect(body.permissions).toContain("vehicle.manage");
  });

  it("GET /session platform oturumu için username döner", async () => {
    const login = await platformLoginRoute(
      loginRequest({
        username: SEED_USERNAMES.admin,
        password: SEED_TEST_PASSWORDS.admin,
      }),
    );
    const token = setCookieToken(login);
    const session = await getSession(
      new Request(SESSION_URL, {
        headers: { cookie: `dolmus_session=${token}` },
      }),
    );
    expect(session.status).toBe(200);
    const body = await session.json();
    expect(body.kind).toBe("platform");
    expect(body.role).toBe("admin");
    expect(body.username).toBe(SEED_USERNAMES.admin);
    // Ekip oturumunda businessId/vehicleId YOK (T1.5 notu).
    expect(body.businessId).toBeUndefined();
    expect(body.vehicleId).toBeUndefined();
  });

  // -------------------------------------------------------------------
  // Pasif hesap ve genel hata — S1.3 AC4.
  // -------------------------------------------------------------------

  it("pasif admin hesabı doğru şifreyle bile genel 401 INVALID_CREDENTIALS verir", async () => {
    const response = await platformLoginRoute(
      loginRequest({
        username: SEED_USERNAMES.adminPassive,
        password: SEED_TEST_PASSWORDS.admin,
      }),
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
    expect(body.error.message).toBe("Kullanıcı adı veya şifre yanlış.");
  });

  it("pasif support hesabı da doğru şifreyle bile genel 401 verir", async () => {
    const response = await platformLoginRoute(
      loginRequest({
        username: SEED_USERNAMES.supportPassive,
        password: SEED_TEST_PASSWORDS.support,
      }),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("INVALID_CREDENTIALS");
  });

  it("bilinmeyen kullanıcı adı ile GERÇEK bir hesabın yanlış şifresi AYNI gövdeyi (BİREBİR) üretir", async () => {
    const unknown = await platformLoginRoute(
      loginRequest({ username: "hic-yok-boyle-biri", password: "yanlis-sifre" }),
    );
    const knownWrong = await platformLoginRoute(
      loginRequest({ username: SEED_USERNAMES.admin, password: "yanlis-sifre" }),
    );
    expect(unknown.status).toBe(knownWrong.status);
    const [unknownBody, knownBody] = await Promise.all([
      unknown.json(),
      knownWrong.json(),
    ]);
    expect(unknownBody.error).toEqual(
      expect.objectContaining({
        code: "INVALID_CREDENTIALS",
        message: "Kullanıcı adı veya şifre yanlış.",
      }),
    );
    expect(knownBody.error).toEqual(unknownBody.error);
  });

  it("bilinmeyen kullanıcı adı denemesi GERÇEKTEN sabit dummy Argon2id özetine karşı doğrulama çalıştırır", async () => {
    vi.mocked(argon2.verify).mockClear();
    const response = await platformLoginRoute(
      loginRequest({ username: "hic-yok-boyle-biri", password: "her-hangi-bir-sifre" }),
    );
    expect(response.status).toBe(401);
    expect(argon2.verify).toHaveBeenCalledTimes(1);
    const call = vi.mocked(argon2.verify).mock.calls[0]!;
    expect(call[0]).toBe(DUMMY_ARGON2ID_HASH);
    expect(call[1]).toBe("her-hangi-bir-sifre");
  });

  it("GERÇEK aktif hesapta yanlış şifre GERÇEK özete karşı (dummy'e DEĞİL) TEK doğrulama çalıştırır", async () => {
    vi.mocked(argon2.verify).mockClear();
    const response = await platformLoginRoute(
      loginRequest({ username: SEED_USERNAMES.admin, password: "ne-admin-ne-baska-sifre" }),
    );
    expect(response.status).toBe(401);
    expect(argon2.verify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(argon2.verify).mock.calls[0]![0]).not.toBe(DUMMY_ARGON2ID_HASH);
  });

  // -------------------------------------------------------------------
  // Araç şifresi ekip girişini AÇMAZ — S1.3 AC4/AC5, görev tanımı.
  // -------------------------------------------------------------------

  it("gerçek bir ekip kullanıcı adına araç şifresi (owner) gönderilirse 401 (araç credential'ı eşleşmez)", async () => {
    const response = await platformLoginRoute(
      loginRequest({
        username: SEED_USERNAMES.admin,
        password: SEED_TEST_PASSWORDS.owner,
      }),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("INVALID_CREDENTIALS");
  });

  it("araç plakası kullanıcı adı olarak gönderilirse (böyle bir platform_users satırı YOK) genel 401 verir", async () => {
    const response = await platformLoginRoute(
      loginRequest({
        username: SEED_RAW_PLATES.vehicleA1,
        password: SEED_TEST_PASSWORDS.owner,
      }),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("INVALID_CREDENTIALS");
  });

  // -------------------------------------------------------------------
  // Gövdede role/personId gönderilse de yok sayılır (scopeSafeObject).
  // -------------------------------------------------------------------

  it("gövdede role gönderilse de YOK SAYILIR — GERÇEK eşleşen hesabın rolü döner", async () => {
    const response = await platformLoginRoute(
      loginRequest({
        username: SEED_USERNAMES.support,
        password: SEED_TEST_PASSWORDS.support,
        role: "admin",
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.role).toBe("support");
    expect(body.permissions).not.toContain("platform_user.manage");
  });

  // -------------------------------------------------------------------
  // 422 alan doğrulama.
  // -------------------------------------------------------------------

  it("boş kullanıcı adı için 'Kullanıcı adını gir.' alan hatası döner", async () => {
    const response = await platformLoginRoute(
      loginRequest({ username: "   ", password: "herhangi" }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.fields.username).toBe("Kullanıcı adını gir.");
  });

  it("boş şifre için 'Şifreyi gir.' alan hatası döner; DB/hash kuyruğuna DOKUNULMAZ", async () => {
    vi.mocked(argon2.verify).mockClear();
    const response = await platformLoginRoute(
      loginRequest({ username: SEED_USERNAMES.admin, password: "" }),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.fields.password).toBe("Şifreyi gir.");
    expect(argon2.verify).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // Hız sınırı — kullanıcı adı başına 20/15dk, IP başına 120/15dk.
  // -------------------------------------------------------------------

  it("aynı (bilinmeyen) kullanıcı adına 21. başarısız deneme 429 RATE_LIMITED + Retry-After döner", async () => {
    for (let i = 0; i < 20; i++) {
      const response = await platformLoginRoute(
        loginRequest({ username: "rl-test-kullanici", password: `yanlis-${i}` }),
      );
      expect(response.status).toBe(401);
    }
    const blocked = await platformLoginRoute(
      loginRequest({ username: "rl-test-kullanici", password: "yanlis-21" }),
    );
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    const retryAfter = blocked.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  }, 20_000);

  it("429 RATE_LIMITED tam BİR log satırı yazar: request_id var; kullanıcı adı, IP ve parola YOK", async () => {
    vi.stubEnv("TRUSTED_PROXY", "1");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const clientIp = "203.0.113.8";
      for (let i = 0; i < 20; i++) {
        await platformLoginRoute(
          loginRequest(
            { username: "rl-log-kullanici", password: `yanlis-${i}` },
            { headers: { "x-forwarded-for": clientIp } },
          ),
        );
      }
      expect(warnSpy).not.toHaveBeenCalled();
      const blocked = await platformLoginRoute(
        loginRequest(
          { username: "rl-log-kullanici", password: "log-parola-sizmamali" },
          { headers: { "x-forwarded-for": clientIp } },
        ),
      );
      expect(blocked.status).toBe(429);
      const { request_id: requestId } = await blocked.json();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const line = String(warnSpy.mock.calls[0]?.[0]);
      expect(line).toContain("RATE_LIMITED");
      expect(line).toContain(`request_id=${requestId}`);
      for (const secret of ["rl-log-kullanici", clientIp, "log-parola-sizmamali"]) {
        expect(line).not.toContain(secret);
      }
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  }, 20_000);

  it("429 HASH_QUEUE_FULL tam BİR log satırı yazar: request_id ve kuyruk alanları var; kullanıcı adı ve parola YOK", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const holders: Array<() => void> = [];
    try {
      // 4 aktif + 100 bekleyen kotayı, elle bırakılana dek tutan işlerle doldur.
      void Array.from(
        { length: HASH_QUEUE_MAX_CONCURRENT + HASH_QUEUE_MAX_PENDING },
        () =>
          runInHashQueue(
            () => new Promise<void>((resolve) => holders.push(resolve)),
          ),
      );
      const response = await platformLoginRoute(
        loginRequest({
          username: SEED_USERNAMES.admin,
          password: "log-parola-sizmamali",
        }),
      );
      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body.error.code).toBe("HASH_QUEUE_FULL");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const line = String(warnSpy.mock.calls[0]?.[0]);
      expect(line).toContain("HASH_QUEUE_FULL");
      expect(line).toContain(`request_id=${body.request_id}`);
      expect(line).toContain(`hash_active=${HASH_QUEUE_MAX_CONCURRENT}`);
      expect(line).toContain(`hash_pending=${HASH_QUEUE_MAX_PENDING}`);
      expect(line).toMatch(/hash_longest_wait_ms=\d+/);
      expect(line).not.toContain(SEED_USERNAMES.admin);
      expect(line).not.toContain("log-parola-sizmamali");
      resetHashQueueForTests();
    } finally {
      warnSpy.mockRestore();
    }
  }, 20_000);

  it("BAŞARILI giriş hız sınırı sayacını ARTIRMAZ", async () => {
    for (let i = 0; i < 10; i++) {
      const response = await platformLoginRoute(
        loginRequest({
          username: SEED_USERNAMES.admin,
          password: SEED_TEST_PASSWORDS.admin,
        }),
      );
      expect(response.status).toBe(201);
    }
    for (let i = 0; i < 20; i++) {
      const response = await platformLoginRoute(
        loginRequest({ username: SEED_USERNAMES.admin, password: `yanlis-${i}` }),
      );
      expect(response.status).toBe(401);
    }
    const blocked = await platformLoginRoute(
      loginRequest({ username: SEED_USERNAMES.admin, password: "yanlis-son" }),
    );
    expect(blocked.status).toBe(429);
  }, 20_000);

  // -------------------------------------------------------------------
  // S1.4 AC2 — ortak telefon: yeni giriş eski oturum çerezini iptal eder.
  // -------------------------------------------------------------------

  it("yeni başarılı ekip girişi, aynı tarayıcıdaki ESKİ oturum çerezini iptal eder", async () => {
    const first = await platformLoginRoute(
      loginRequest({
        username: SEED_USERNAMES.admin,
        password: SEED_TEST_PASSWORDS.admin,
      }),
    );
    const firstToken = setCookieToken(first);

    const second = await platformLoginRoute(
      loginRequest(
        { username: SEED_USERNAMES.support, password: SEED_TEST_PASSWORDS.support },
        { headers: { cookie: `dolmus_session=${firstToken}` } },
      ),
    );
    expect(second.status).toBe(201);
    const secondToken = setCookieToken(second);
    expect(secondToken).not.toBe(firstToken);

    const afterSecondLogin = await getSession(
      new Request(SESSION_URL, {
        headers: { cookie: `dolmus_session=${firstToken}` },
      }),
    );
    expect(afterSecondLogin.status).toBe(401);
    expect((await afterSecondLogin.json()).error.code).toBe("SESSION_REVOKED");
  });

  // -------------------------------------------------------------------
  // reset-admin-password sonrası eski oturum 401 SESSION_REVOKED; yeni
  // parola ile giriş çalışır (F11 — `bumpPlatformUserVersion`
  // yeniden kullanımı üzerinden). `scripts/platform-admin.ts`'in GERÇEK
  // `resetAdminPassword` fonksiyonu (CLI'ın kendisinin çağırdığı AYNI
  // kod) doğrudan çağrılır; `tests/integration/platform-admin-cli.test.ts`
  // AYRICA gerçek `child_process` ile script'in KENDİSİNİ (stdout/exit
  // kodu dahil) sınar.
  // -------------------------------------------------------------------

  it("reset-admin-password sonrası eski oturum SESSION_REVOKED olur; yeni şifreyle giriş 201 döner", async () => {
    const login = await platformLoginRoute(
      loginRequest({
        username: SEED_USERNAMES.admin,
        password: SEED_TEST_PASSWORDS.admin,
      }),
    );
    expect(login.status).toBe(201);
    const oldToken = setCookieToken(login);

    // Oturum HALA geçerli (sıfırlamadan ÖNCE).
    const beforeReset = await getSession(
      new Request(SESSION_URL, { headers: { cookie: `dolmus_session=${oldToken}` } }),
    );
    expect(beforeReset.status).toBe(200);

    const resetSqlite = openDatabaseConnection(dbPath);
    try {
      const result = await resetAdminPassword(
        resetSqlite,
        SEED_USERNAMES.admin,
        "yeni-cok-guclu-sifre-999",
      );
      expect(result.found).toBe(true);
    } finally {
      resetSqlite.close();
    }

    // ESKİ oturum ARTIK geçersiz.
    const afterReset = await getSession(
      new Request(SESSION_URL, { headers: { cookie: `dolmus_session=${oldToken}` } }),
    );
    expect(afterReset.status).toBe(401);
    expect((await afterReset.json()).error.code).toBe("SESSION_REVOKED");

    // ESKİ şifre ARTIK çalışmaz.
    const oldPasswordAttempt = await platformLoginRoute(
      loginRequest({
        username: SEED_USERNAMES.admin,
        password: SEED_TEST_PASSWORDS.admin,
      }),
    );
    expect(oldPasswordAttempt.status).toBe(401);

    // YENİ şifreyle giriş başarılı.
    const newLogin = await platformLoginRoute(
      loginRequest({
        username: SEED_USERNAMES.admin,
        password: "yeni-cok-guclu-sifre-999",
      }),
    );
    expect(newLogin.status).toBe(201);
    expect((await newLogin.json()).role).toBe("admin");
  });

  // -------------------------------------------------------------------
  // Gizli veri sızıntısı yok — yanıt gövdesi ve loglar.
  // -------------------------------------------------------------------

  it("başarılı giriş yanıtı parola/hash/ham token İÇERMEZ", async () => {
    const response = await platformLoginRoute(
      loginRequest({
        username: SEED_USERNAMES.admin,
        password: SEED_TEST_PASSWORDS.admin,
      }),
    );
    const raw = await response.text();
    expect(raw).not.toContain(SEED_TEST_PASSWORDS.admin);
    // "argon2id"/"password_hash" — GERÇEK hash/parola alanı belirteçleri.
    // ("vehicle.reset_password" gibi MEŞRU izin ADLARI "password" alt
    // dizesini taşıdığından, o genel alt dize BURADA kasıtlı olarak
    // KONTROL EDİLMEZ — yalnız GERÇEK sızıntı belirteçleri sınanır.)
    expect(raw).not.toContain("argon2id");
    expect(raw).not.toContain("password_hash");
    expect(raw).not.toContain("passwordHash");
  });

  it("hatalı giriş logları parola İÇERMEZ", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await platformLoginRoute(
        loginRequest({
          username: SEED_USERNAMES.admin,
          password: "gizli-sifre-loglanmamali",
        }),
      );
      const allCalls = [...errorSpy.mock.calls, ...logSpy.mock.calls].flat();
      for (const call of allCalls) {
        expect(String(call)).not.toContain("gizli-sifre-loglanmamali");
      }
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
