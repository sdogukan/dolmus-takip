import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS } from "../../scripts/db-seed-dev";
import {
  createDb,
  openDatabaseConnection,
  type SqliteConnection,
} from "../../src/server/data/db";
import {
  PLATFORM_SESSION_ABSOLUTE_MS,
  PLATFORM_SESSION_INACTIVITY_MS,
  VEHICLE_SESSION_ABSOLUTE_MS,
  VEHICLE_SESSION_INACTIVITY_MS,
  type Clock,
} from "../../src/server/auth/session";
import { createPlatformSession } from "../../src/server/usecases/session/create-platform-session";
import { createVehicleSession } from "../../src/server/usecases/session/create-vehicle-session";
import {
  PlatformUserNotFoundError,
  SessionExpiredError,
  SessionMissingError,
  SessionRevokedError,
  VehicleCredentialNotFoundError,
} from "../../src/server/usecases/session/errors";
import { resolveSession } from "../../src/server/usecases/session/resolve-session";
import {
  revokeSession,
  revokeSessionsForBusiness,
  revokeSessionsForCredential,
  revokeSessionsForPlatformUser,
  revokeSessionsForVehicle,
} from "../../src/server/usecases/session/revoke-session";

/**
 * Oturum kullanım durumları entegrasyon testleri — T1.4 ADIM 1/2, S1.4.
 *
 * QA-PLAN.md §1 — "Finansal DB testleri yalnız mock veya :memory: üzerinde
 * kabul edilmez." Her test kendi geçici gerçek SQLite dosyasını açar,
 * gerçek migration'ı uygular ve `scripts/db-seed-dev.ts`'teki QA-PLAN §2
 * ortak veri setini gerçek Argon2 hash'leriyle tohumlar. Zaman kontrolü
 * `Clock` enjeksiyonuyla yapılır (görev tanımı — "Saat enjekte edilebilir
 * ve zaman kontrollü testlerle doğrulanır").
 */

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");

function fixedClock(iso: string): Clock {
  return () => new Date(iso);
}

function offsetClock(iso: string, deltaMs: number): Clock {
  return () => new Date(new Date(iso).getTime() + deltaMs);
}

describe("oturum kullanım durumları (T1.4 ADIM 1/2)", () => {
  let dir: string;
  let sqlite: SqliteConnection;
  let db: ReturnType<typeof createDb>;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-session-"));
    sqlite = openDatabaseConnection(path.join(dir, "test.sqlite"), {
      createIfMissing: true,
    });
    db = createDb(sqlite);
    migrate(db, { migrationsFolder });
    await seedDevData(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------
  // createVehicleSession / createPlatformSession
  // ---------------------------------------------------------------------

  describe("createVehicleSession", () => {
    it("araç sahibi credential'ı için doğru kapsamla oturum üretir", async () => {
      const t0 = "2026-03-01T00:00:00.000Z";
      const result = await createVehicleSession(
        db,
        SEED_IDS.credA1Owner,
        fixedClock(t0),
      );

      expect(result.context.kind).toBe("vehicle");
      expect(result.context.role).toBe("owner");
      expect(result.context.businessId).toBe(SEED_IDS.businessA);
      expect(result.context.vehicleId).toBe(SEED_IDS.vehicleA1);
      expect(result.context.credentialId).toBe(SEED_IDS.credA1Owner);
      expect(result.context.platformUserId).toBeUndefined();
      expect(typeof result.context.csrfToken).toBe("string");
      expect(result.context.csrfToken.length).toBeGreaterThan(0);
      expect(result.expiresAt.toISOString()).toBe(
        new Date(new Date(t0).getTime() + VEHICLE_SESSION_ABSOLUTE_MS).toISOString(),
      );

      // DB satırı: token DÜZ yazılmaz, yalnız SHA-256 özeti.
      const row = sqlite
        .prepare("SELECT * FROM sessions WHERE id = ?")
        .get(result.context.sessionId) as Record<string, unknown>;
      expect(row.token_hash).not.toBe(result.token);
      expect(row.credential_id).toBe(SEED_IDS.credA1Owner);
      expect(row.platform_user_id).toBeNull();
      expect(row.issued_version).toBe(1);
      expect(row.revoked_at).toBeNull();
      expect(row.created_at).toBe(t0);
      expect(row.last_seen_at).toBe(t0);
    });

    it("var olmayan credential id için VehicleCredentialNotFoundError fırlatır", async () => {
      await expect(createVehicleSession(db, "yok-boyle-bir-id")).rejects.toThrow(
        VehicleCredentialNotFoundError,
      );
    });

    it("her çağrıda farklı ham token üretir (her giriş yeni token üretir)", async () => {
      const first = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const second = await createVehicleSession(db, SEED_IDS.credA1Owner);
      expect(first.token).not.toBe(second.token);
      expect(first.context.sessionId).not.toBe(second.context.sessionId);
    });
  });

  describe("createPlatformSession", () => {
    it("aktif platform admin için doğru kapsamla oturum üretir", async () => {
      const t0 = "2026-03-01T00:00:00.000Z";
      const result = await createPlatformSession(
        db,
        SEED_IDS.platformAdmin1,
        fixedClock(t0),
      );

      expect(result.context.kind).toBe("platform");
      expect(result.context.role).toBe("admin");
      expect(result.context.platformUserId).toBe(SEED_IDS.platformAdmin1);
      expect(result.context.businessId).toBeUndefined();
      expect(result.context.vehicleId).toBeUndefined();
      expect(result.expiresAt.toISOString()).toBe(
        new Date(
          new Date(t0).getTime() + PLATFORM_SESSION_ABSOLUTE_MS,
        ).toISOString(),
      );
    });

    it("var olmayan platform user id için PlatformUserNotFoundError fırlatır", async () => {
      await expect(
        createPlatformSession(db, "yok-boyle-bir-id"),
      ).rejects.toThrow(PlatformUserNotFoundError);
    });
  });

  // ---------------------------------------------------------------------
  // resolveSession — token_hash / revoked_at / expires_at / hareketsizlik /
  // issued_version / aktiflik denetimleri (görev tanımındaki BİREBİR sıra).
  // ---------------------------------------------------------------------

  describe("resolveSession — token_hash eşleşmesi", () => {
    it("hiç var olmayan token için SessionMissingError fırlatır", async () => {
      await expect(resolveSession(db, "hic-boyle-bir-token")).rejects.toThrow(
        SessionMissingError,
      );
    });

    it("gerçek token ile oluşturulan oturumu bulur ve çözer", async () => {
      const created = await createVehicleSession(db, SEED_IDS.credA1Driver);
      const context = await resolveSession(db, created.token);
      expect(context).toEqual(created.context);
    });

    it("sayfa yenileme gibi art arda çözümlemeler aynı kapsamı döner (yetki değişmez)", async () => {
      const created = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const first = await resolveSession(db, created.token);
      const second = await resolveSession(db, created.token);
      expect(second).toEqual(first);
    });
  });

  describe("resolveSession — revoked_at", () => {
    it("revokeSession sonrası SessionRevokedError fırlatır", async () => {
      const created = await createVehicleSession(db, SEED_IDS.credA1Owner);
      await revokeSession(db, created.context.sessionId);
      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );
    });

    it("logout sonrası eski token ile ikinci bir istek de reddedilir (tek kullanımlık iptal değil, kalıcı)", async () => {
      const created = await createVehicleSession(db, SEED_IDS.credA1Owner);
      await revokeSession(db, created.context.sessionId);
      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );
      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );
    });

    it("revokeSession bilinmeyen/zaten iptal edilmiş id için hata FIRLATMAZ (idempotent)", async () => {
      await expect(revokeSession(db, "yok-boyle-bir-id")).resolves.toBeUndefined();
      const created = await createVehicleSession(db, SEED_IDS.credA1Owner);
      await revokeSession(db, created.context.sessionId);
      await expect(
        revokeSession(db, created.context.sessionId),
      ).resolves.toBeUndefined();
    });
  });

  describe("resolveSession — expires_at (mutlak süre)", () => {
    // Mutlak sınırı hareketsizlik sınırından İZOLE test etmek için, oturum
    // periyodik olarak (hareketsizlik eşiğinden çok daha sık) "dokunularak"
    // canlı tutulur — aksi halde (görev tanımındaki "en fazla 30 gün, 7 gün
    // hareketsizlik" iki AYRI kısıt olduğundan) hiç dokunulmamış bir oturum
    // 30. günden çok önce, 7. günde hareketsizlikten düşer; bu da doğru
    // davranıştır (iki kısıttan en sıkısı bağlayıcıdır), mutlak sınırın
    // KENDİSİNİ izole test etmez.
    it("araç oturumu: periyodik etkileşimle 30. güne kadar geçerli kalır; tam sınırda (ve sonrasında) mutlak süreden dolayı SessionExpiredError", async () => {
      const t0 = "2026-01-01T00:00:00.000Z";
      const created = await createVehicleSession(db, SEED_IDS.credA1Owner, fixedClock(t0));
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000; // << 7 gün hareketsizlik sınırı
      for (let i = 1; i <= 9; i++) {
        await resolveSession(db, created.token, offsetClock(t0, i * threeDaysMs));
      }
      // Son dokunuş 27. gün; 30 gün - 1ms'te hareketsizlik süresi yalnız
      // ~3 gün (< 7 gün sınırı) — hâlâ geçerli.
      await expect(
        resolveSession(db, created.token, offsetClock(t0, VEHICLE_SESSION_ABSOLUTE_MS - 1)),
      ).resolves.toMatchObject({ kind: "vehicle" });
      // 30 gün + 1ms: son dokunuştan beri hâlâ ~3 gün (hareketsizlik
      // sınırının İÇİNDE) — yine de mutlak sınır aşıldığından geçersiz.
      await expect(
        resolveSession(db, created.token, offsetClock(t0, VEHICLE_SESSION_ABSOLUTE_MS + 1)),
      ).rejects.toThrow("Oturumun sona erdi. Yeniden giriş yap.");
    });

    // DÜZELTME TURU 2 (denetim bulgusu, "low"): yukarıdaki test yalnız
    // `limit - 1` (geçerli) ve `limit + 1` (geçersiz) noktalarını sınıyordu;
    // `now >= expiresAt` (yarı-açık aralık, ARCHITECTURE §3.5'ten
    // örnekseme — bkz. `../../src/server/auth/session.ts` üst notu) yerine
    // biri `>` yazsaydı (tam sınırda hâlâ geçerli sayılsaydı) bu iki nokta
    // TEK BAŞINA bunu YAKALAMAZDI. Bu test TAM sınırın (offset 0) kendisini
    // sınar; dokunuş YOKTUR (last_seen_at = t0) — mutlak kontrol
    // `resolveSession`'da hareketsizlik kontrolünden ÖNCE ve KOŞULSUZ
    // çalıştığından (bkz. `resolve-session.ts`), hareketsizlik sınırı
    // (7 gün < 30 gün) bu sonucu ETKİLEMEZ.
    it("araç oturumu: TAM 30 günde (offset 0) mutlak süreden dolayı SessionExpiredError (>= yarı-açık aralık ayrımı)", async () => {
      const t0 = "2026-01-01T00:00:00.000Z";
      const created = await createVehicleSession(db, SEED_IDS.credA1Owner, fixedClock(t0));
      await expect(
        resolveSession(db, created.token, offsetClock(t0, VEHICLE_SESSION_ABSOLUTE_MS)),
      ).rejects.toThrow(SessionExpiredError);
    });

    it("ekip oturumu: periyodik etkileşimle 12 saate kadar geçerli kalır; tam sınırda (ve sonrasında) mutlak süreden dolayı SessionExpiredError", async () => {
      const t0 = "2026-01-01T00:00:00.000Z";
      const created = await createPlatformSession(
        db,
        SEED_IDS.platformAdmin1,
        fixedClock(t0),
      );
      const twentyMinutesMs = 20 * 60 * 1000; // << 30 dk hareketsizlik sınırı
      for (let i = 1; i <= 35; i++) {
        await resolveSession(db, created.token, offsetClock(t0, i * twentyMinutesMs));
      }
      await expect(
        resolveSession(db, created.token, offsetClock(t0, PLATFORM_SESSION_ABSOLUTE_MS - 1)),
      ).resolves.toMatchObject({ kind: "platform" });
      await expect(
        resolveSession(db, created.token, offsetClock(t0, PLATFORM_SESSION_ABSOLUTE_MS + 1)),
      ).rejects.toThrow(SessionExpiredError);
    });

    // DÜZELTME TURU 2 (denetim bulgusu, "low") — yukarıdaki testin ekip
    // eşdeğeri: TAM sınırın (offset 0) kendisi, dokunuş OLMADAN.
    it("ekip oturumu: TAM 12 saatte (offset 0) mutlak süreden dolayı SessionExpiredError (>= yarı-açık aralık ayrımı)", async () => {
      const t0 = "2026-01-01T00:00:00.000Z";
      const created = await createPlatformSession(
        db,
        SEED_IDS.platformAdmin1,
        fixedClock(t0),
      );
      await expect(
        resolveSession(db, created.token, offsetClock(t0, PLATFORM_SESSION_ABSOLUTE_MS)),
      ).rejects.toThrow(SessionExpiredError);
    });
  });

  describe("resolveSession — hareketsizlik sınırı", () => {
    it("araç oturumu: last_seen_at'tan 7 gün + 1ms hareketsizlik sonrası SessionExpiredError", async () => {
      const t0 = "2026-01-01T00:00:00.000Z";
      const created = await createVehicleSession(db, SEED_IDS.credA1Driver, fixedClock(t0));
      // Hareketsizlik sınırının hemen öncesi: geçerli (ve last_seen_at'ı
      // ilerletir çünkü 5 dk eşiğini de aşıyor).
      await resolveSession(
        db,
        created.token,
        offsetClock(t0, VEHICLE_SESSION_INACTIVITY_MS - 1),
      );
      // O yeni last_seen_at'tan yine 7 gün + 1ms sonra: artık süresi geçmiş.
      const secondBoundary = new Date(t0).getTime() + (VEHICLE_SESSION_INACTIVITY_MS - 1) + VEHICLE_SESSION_INACTIVITY_MS + 1;
      await expect(
        resolveSession(db, created.token, () => new Date(secondBoundary)),
      ).rejects.toThrow(SessionExpiredError);
    });

    // DÜZELTME TURU 2 (denetim bulgusu, "low"): yukarıdaki test yalnız
    // `limit - 1`/`limit + 1` (dolaylı, `secondBoundary` üzerinden) sınıyor;
    // hareketsizlik sınırının TAM KENDİSİ (offset 0) hiç sınanmıyordu. Bu
    // test dokunuş OLMADAN (last_seen_at = t0) doğrudan TAM sınırı sınar —
    // mutlak sınır (30 gün) çok daha uzak olduğundan sonuç yalnız
    // hareketsizlik `>=` denetiminden gelir.
    it("araç oturumu: last_seen_at'tan TAM 7 günde (offset 0) hareketsizlikten dolayı SessionExpiredError (>= yarı-açık aralık ayrımı)", async () => {
      const t0 = "2026-01-01T00:00:00.000Z";
      const created = await createVehicleSession(db, SEED_IDS.credA1Driver, fixedClock(t0));
      await expect(
        resolveSession(db, created.token, offsetClock(t0, VEHICLE_SESSION_INACTIVITY_MS)),
      ).rejects.toThrow(SessionExpiredError);
    });

    it("ekip oturumu: 30 dk + 1ms hareketsizlik sonrası SessionExpiredError; mutlak süre (12 saat) henüz dolmamış olsa da geçersizdir", async () => {
      const t0 = "2026-01-01T00:00:00.000Z";
      const created = await createPlatformSession(
        db,
        SEED_IDS.platformSupport1,
        fixedClock(t0),
      );
      await expect(
        resolveSession(db, created.token, offsetClock(t0, PLATFORM_SESSION_INACTIVITY_MS + 1)),
      ).rejects.toThrow(SessionExpiredError);
    });

    // DÜZELTME TURU 2 (denetim bulgusu, "low") — yukarıdaki testin TAM
    // sınır (offset 0) eşdeğeri.
    it("ekip oturumu: TAM 30 dk'da (offset 0) hareketsizlikten dolayı SessionExpiredError (>= yarı-açık aralık ayrımı)", async () => {
      const t0 = "2026-01-01T00:00:00.000Z";
      const created = await createPlatformSession(
        db,
        SEED_IDS.platformSupport1,
        fixedClock(t0),
      );
      await expect(
        resolveSession(db, created.token, offsetClock(t0, PLATFORM_SESSION_INACTIVITY_MS)),
      ).rejects.toThrow(SessionExpiredError);
    });
  });

  describe("resolveSession — last_seen_at aralıklı yazım (5 dk eşik)", () => {
    it("5 dk'dan önce tekrar çözümleme last_seen_at'ı GÜNCELLEMEZ", async () => {
      const t0 = "2026-01-01T00:00:00.000Z";
      const created = await createVehicleSession(db, SEED_IDS.credA1Owner, fixedClock(t0));
      await resolveSession(db, created.token, offsetClock(t0, 2 * 60 * 1000)); // +2dk
      const row = sqlite
        .prepare("SELECT last_seen_at FROM sessions WHERE id = ?")
        .get(created.context.sessionId) as { last_seen_at: string };
      expect(row.last_seen_at).toBe(t0);
    });

    it("5 dk veya daha uzun süre sonra last_seen_at GÜNCELLENİR", async () => {
      const t0 = "2026-01-01T00:00:00.000Z";
      const created = await createVehicleSession(db, SEED_IDS.credA1Owner, fixedClock(t0));
      const t1 = new Date(new Date(t0).getTime() + 6 * 60 * 1000).toISOString(); // +6dk
      await resolveSession(db, created.token, fixedClock(t1));
      const row = sqlite
        .prepare("SELECT last_seen_at FROM sessions WHERE id = ?")
        .get(created.context.sessionId) as { last_seen_at: string };
      expect(row.last_seen_at).toBe(t1);
    });
  });

  describe("resolveSession — issued_version == güncel credential/platform sürümü", () => {
    it("credential_version elle artırılınca eski oturum SessionRevokedError ile reddedilir", async () => {
      const created = await createVehicleSession(db, SEED_IDS.credA1Driver);
      sqlite
        .prepare("UPDATE vehicle_credentials SET credential_version = 2 WHERE id = ?")
        .run(SEED_IDS.credA1Driver);
      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );
    });

    it("platform_users.credential_version elle artırılınca eski oturum SessionRevokedError ile reddedilir", async () => {
      const created = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      sqlite
        .prepare("UPDATE platform_users SET credential_version = 2 WHERE id = ?")
        .run(SEED_IDS.platformAdmin1);
      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );
    });
  });

  describe("resolveSession — aktiflik (businesses/vehicles/platform_users)", () => {
    it("pasif araç (seed: vehicleB2) için SessionRevokedError fırlatır", async () => {
      const created = await createVehicleSession(db, SEED_IDS.credB2Owner);
      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );
    });

    it("işletme pasifleşince o işletmenin araç oturumu SessionRevokedError ile reddedilir", async () => {
      const created = await createVehicleSession(db, SEED_IDS.credA1Owner);
      sqlite
        .prepare("UPDATE businesses SET active = 0 WHERE id = ?")
        .run(SEED_IDS.businessA);
      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );
    });

    it("pasif platform kullanıcısı (seed: platformAdminPassive1) için SessionRevokedError fırlatır", async () => {
      const created = await createPlatformSession(
        db,
        SEED_IDS.platformAdminPassive1,
      );
      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );
    });

    it("yeniden aktifleştirme, ÖNCEDEN İPTAL EDİLMİŞ (revoked_at dolu) oturumu diriltmez", async () => {
      const created = await createVehicleSession(db, SEED_IDS.credB2Owner);
      // Pasif araç zaten SessionRevokedError veriyor; oturumu AYRICA açıkça
      // iptal edelim (ör. admin pasifleştirme akışının yapacağı gibi).
      await revokeSession(db, created.context.sessionId);
      // Aracı yeniden aktifleştir.
      sqlite
        .prepare("UPDATE vehicles SET active = 1 WHERE id = ?")
        .run(SEED_IDS.vehicleB2);
      // revoked_at hâlâ dolu olduğundan oturum yine de kullanılamaz.
      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );
    });
  });

  describe("resolveSession — ekip yetkisi değişikliği anında uygulanır", () => {
    it("platformRole değişince YENİ istekte güncel rol döner (sürüm artışı/iptal gerekmez)", async () => {
      const created = await createPlatformSession(db, SEED_IDS.platformSupport1);
      expect(created.context.role).toBe("support");
      sqlite
        .prepare("UPDATE platform_users SET platform_role = 'admin' WHERE id = ?")
        .run(SEED_IDS.platformSupport1);
      const resolved = await resolveSession(db, created.token);
      expect(resolved.role).toBe("admin");
    });
  });

  // ---------------------------------------------------------------------
  // Şifre sıfırlaması yalnız ilgili rolü etkiler (S1.4 AC4).
  // ---------------------------------------------------------------------

  describe("revokeSessionsForCredential — yalnız ilgili rolü etkiler", () => {
    it("aynı araçta driver iptali owner'ı etkilemez", async () => {
      const owner = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const driver = await createVehicleSession(db, SEED_IDS.credA1Driver);

      await revokeSessionsForCredential(db, SEED_IDS.credA1Driver);

      await expect(resolveSession(db, driver.token)).rejects.toThrow(
        SessionRevokedError,
      );
      await expect(resolveSession(db, owner.token)).resolves.toMatchObject({
        role: "owner",
      });
    });
  });

  describe("revokeSessionsForVehicle", () => {
    it("bir aracın owner+driver oturumlarını iptal eder; aynı işletmedeki başka aracı etkilemez", async () => {
      const vehA1Owner = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const vehA1Driver = await createVehicleSession(db, SEED_IDS.credA1Driver);
      const vehA2Owner = await createVehicleSession(db, SEED_IDS.credA2Owner);

      await revokeSessionsForVehicle(db, SEED_IDS.vehicleA1);

      await expect(resolveSession(db, vehA1Owner.token)).rejects.toThrow(
        SessionRevokedError,
      );
      await expect(resolveSession(db, vehA1Driver.token)).rejects.toThrow(
        SessionRevokedError,
      );
      await expect(resolveSession(db, vehA2Owner.token)).resolves.toMatchObject(
        { vehicleId: SEED_IDS.vehicleA2 },
      );
    });
  });

  describe("revokeSessionsForBusiness", () => {
    it("bir işletmenin TÜM araç oturumlarını iptal eder; başka işletmeyi ve ekip oturumlarını etkilemez", async () => {
      const vehA1 = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const vehA2 = await createVehicleSession(db, SEED_IDS.credA2Owner);
      const vehB1 = await createVehicleSession(db, SEED_IDS.credB1Owner);
      const platform = await createPlatformSession(db, SEED_IDS.platformAdmin1);

      await revokeSessionsForBusiness(db, SEED_IDS.businessA);

      await expect(resolveSession(db, vehA1.token)).rejects.toThrow(SessionRevokedError);
      await expect(resolveSession(db, vehA2.token)).rejects.toThrow(SessionRevokedError);
      await expect(resolveSession(db, vehB1.token)).resolves.toMatchObject({
        businessId: SEED_IDS.businessB,
      });
      await expect(resolveSession(db, platform.token)).resolves.toMatchObject({
        kind: "platform",
      });
    });
  });

  describe("revokeSessionsForPlatformUser", () => {
    it("bir ekip hesabının oturumunu iptal eder; başka ekip hesabını ve araç oturumlarını etkilemez", async () => {
      const admin = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      const support = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const vehicle = await createVehicleSession(db, SEED_IDS.credA1Owner);

      await revokeSessionsForPlatformUser(db, SEED_IDS.platformAdmin1);

      await expect(resolveSession(db, admin.token)).rejects.toThrow(SessionRevokedError);
      await expect(resolveSession(db, support.token)).resolves.toMatchObject({
        role: "support",
      });
      await expect(resolveSession(db, vehicle.token)).resolves.toMatchObject({
        role: "owner",
      });
    });
  });
});
