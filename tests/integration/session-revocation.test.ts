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
  type AppDatabase,
  type SqliteConnection,
} from "../../src/server/data/db";
import type { Clock } from "../../src/server/auth/session";
import {
  bumpCredentialVersion,
  bumpPlatformUserVersion,
  setBusinessActive,
  setPlatformUserActive,
  setPlatformUserRole,
  setVehicleActive,
} from "../../src/server/usecases/access";
import { createPlatformSession } from "../../src/server/usecases/session/create-platform-session";
import { createVehicleSession } from "../../src/server/usecases/session/create-vehicle-session";
import { SessionRevokedError } from "../../src/server/usecases/session/errors";
import { resolveSession } from "../../src/server/usecases/session/resolve-session";

/**
 * İptal yayılımı entegrasyon testleri — T1.4 ADIM 2/2, S1.4, görev tanımı
 * (a): "Yönetim ekranları henüz olmadığından test düzenekleri (tests/
 * integration/session-revocation.test.ts) doğrudan kullanım durumu/DB ile
 * değişiklik yapıp kanıtlar." Her senaryo `src/server/usecases/access/*`
 * kullanım durumunu GERÇEK bir kullanım durumu çağrısıyla (RAW SQL DEĞİL)
 * tetikler; gerçek geçici SQLite + migration + seed kullanılır.
 */

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");

function fixedClock(iso: string): Clock {
  return () => new Date(iso);
}

describe("iptal yayılımı — src/server/usecases/access/* (T1.4 ADIM 2/2)", () => {
  let dir: string;
  let sqlite: SqliteConnection;
  let db: AppDatabase;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-revocation-"));
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
  // S1.4 AC4 — "Araç şifresi sıfırlaması yalnız ilgili rolün girişlerini
  // iptal eder; diğer rolün şifresi değişmez."
  // ---------------------------------------------------------------------

  describe("bumpCredentialVersion — parola sıfırlama simülasyonu", () => {
    it("owner credential_version artınca YALNIZ owner oturumları reddedilir; aynı aracın driver oturumu ÇALIŞMAYA DEVAM eder", async () => {
      const owner = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const driver = await createVehicleSession(db, SEED_IDS.credA1Driver);

      bumpCredentialVersion(db, SEED_IDS.credA1Owner);

      await expect(resolveSession(db, owner.token)).rejects.toThrow(
        SessionRevokedError,
      );
      await expect(resolveSession(db, driver.token)).resolves.toMatchObject({
        role: "driver",
        vehicleId: SEED_IDS.vehicleA1,
      });
    });

    it("credential_version DB'de gerçekten +1 artar (mutlak değer atanmaz)", () => {
      const before = sqlite
        .prepare("SELECT credential_version FROM vehicle_credentials WHERE id = ?")
        .get(SEED_IDS.credA1Owner) as { credential_version: number };
      expect(before.credential_version).toBe(1);

      bumpCredentialVersion(db, SEED_IDS.credA1Owner);

      const after = sqlite
        .prepare("SELECT credential_version FROM vehicle_credentials WHERE id = ?")
        .get(SEED_IDS.credA1Owner) as { credential_version: number };
      expect(after.credential_version).toBe(2);
    });

    it("yeni giriş (bumpCredentialVersion SONRASI createVehicleSession) normal çalışır", async () => {
      bumpCredentialVersion(db, SEED_IDS.credA1Owner);
      const freshLogin = await createVehicleSession(db, SEED_IDS.credA1Owner);
      await expect(resolveSession(db, freshLogin.token)).resolves.toMatchObject(
        { role: "owner" },
      );
    });
  });

  // ---------------------------------------------------------------------
  // S1.4 AC3 — "Araç/işletme pasifliği ... mevcut oturumları etkiler.
  // Yeniden aktifleştirmek önceden iptal edilmiş oturumu diriltmez; yeni
  // giriş gerekir."
  // ---------------------------------------------------------------------

  describe("setVehicleActive — pasiflik ve yeniden aktifleşme", () => {
    it("active=false → o aracın TÜM (owner+driver) oturumları reddedilir; aynı işletmedeki BAŞKA araç etkilenmez", async () => {
      const owner = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const driver = await createVehicleSession(db, SEED_IDS.credA1Driver);
      const otherVehicle = await createVehicleSession(db, SEED_IDS.credA2Owner);

      setVehicleActive(db, SEED_IDS.vehicleA1, false);

      await expect(resolveSession(db, owner.token)).rejects.toThrow(
        SessionRevokedError,
      );
      await expect(resolveSession(db, driver.token)).rejects.toThrow(
        SessionRevokedError,
      );
      await expect(
        resolveSession(db, otherVehicle.token),
      ).resolves.toMatchObject({ vehicleId: SEED_IDS.vehicleA2 });
    });

    it("active=1 → active=0 → active=1: ESKİ oturum yeniden active=1 sonrasında da DİRİLMEZ (kalıcı revoke)", async () => {
      const created = await createVehicleSession(db, SEED_IDS.credA1Owner);

      setVehicleActive(db, SEED_IDS.vehicleA1, false);
      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );

      setVehicleActive(db, SEED_IDS.vehicleA1, true);
      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );

      // Ama araç GERÇEKTEN yeniden aktiftir — YENİ bir giriş normal çalışır
      // (aktiflik değil, YALNIZ bu belirli eski oturum diriltilmiyor).
      const freshLogin = await createVehicleSession(db, SEED_IDS.credA1Owner);
      await expect(resolveSession(db, freshLogin.token)).resolves.toMatchObject(
        { vehicleId: SEED_IDS.vehicleA1 },
      );
    });

    it("active=true (basit aktifleştirme) hiçbir oturumu ETKİLEMEZ/iptal ETMEZ", async () => {
      const created = await createVehicleSession(db, SEED_IDS.credA1Owner);
      setVehicleActive(db, SEED_IDS.vehicleA1, true);
      await expect(resolveSession(db, created.token)).resolves.toMatchObject({
        vehicleId: SEED_IDS.vehicleA1,
      });
    });
  });

  describe("setBusinessActive — pasiflik ve yeniden aktifleşme", () => {
    it("active=false → İŞLETMENİN TÜM araç oturumları reddedilir; BAŞKA işletme ve EKİP oturumları etkilenmez", async () => {
      const vehA1 = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const vehA2 = await createVehicleSession(db, SEED_IDS.credA2Owner);
      const vehB1 = await createVehicleSession(db, SEED_IDS.credB1Owner);
      const platform = await createPlatformSession(db, SEED_IDS.platformAdmin1);

      setBusinessActive(db, SEED_IDS.businessA, false);

      await expect(resolveSession(db, vehA1.token)).rejects.toThrow(
        SessionRevokedError,
      );
      await expect(resolveSession(db, vehA2.token)).rejects.toThrow(
        SessionRevokedError,
      );
      await expect(resolveSession(db, vehB1.token)).resolves.toMatchObject({
        businessId: SEED_IDS.businessB,
      });
      await expect(resolveSession(db, platform.token)).resolves.toMatchObject({
        kind: "platform",
      });
    });

    it("yeniden active=true sonrasında ESKİ oturum diriltilmez; yeni giriş normal çalışır", async () => {
      const created = await createVehicleSession(db, SEED_IDS.credA1Owner);

      setBusinessActive(db, SEED_IDS.businessA, false);
      setBusinessActive(db, SEED_IDS.businessA, true);

      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );
      const freshLogin = await createVehicleSession(db, SEED_IDS.credA1Owner);
      await expect(resolveSession(db, freshLogin.token)).resolves.toMatchObject(
        { businessId: SEED_IDS.businessA },
      );
    });
  });

  // ---------------------------------------------------------------------
  // S1.4 — "platform_users.active=0 veya credential_version artışı → ekip
  // oturumu reddedilir."
  // ---------------------------------------------------------------------

  describe("setPlatformUserActive — ekip hesabı pasifliği", () => {
    it("active=false → o ekip hesabının oturumu reddedilir; BAŞKA ekip hesabı ve araç oturumları etkilenmez", async () => {
      const support = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const otherAdmin = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      const vehicle = await createVehicleSession(db, SEED_IDS.credA1Owner);

      setPlatformUserActive(db, SEED_IDS.platformSupport1, false);

      await expect(resolveSession(db, support.token)).rejects.toThrow(
        SessionRevokedError,
      );
      await expect(resolveSession(db, otherAdmin.token)).resolves.toMatchObject(
        { role: "admin" },
      );
      await expect(resolveSession(db, vehicle.token)).resolves.toMatchObject({
        role: "owner",
      });
    });

    it("yeniden active=true sonrasında ESKİ oturum diriltilmez", async () => {
      const created = await createPlatformSession(db, SEED_IDS.platformSupport1);

      setPlatformUserActive(db, SEED_IDS.platformSupport1, false);
      setPlatformUserActive(db, SEED_IDS.platformSupport1, true);

      await expect(resolveSession(db, created.token)).rejects.toThrow(
        SessionRevokedError,
      );
      const freshLogin = await createPlatformSession(
        db,
        SEED_IDS.platformSupport1,
      );
      await expect(resolveSession(db, freshLogin.token)).resolves.toMatchObject(
        { role: "support" },
      );
    });
  });

  describe("bumpPlatformUserVersion — ekip parola sıfırlama simülasyonu", () => {
    it("credential_version artınca o ekip hesabının oturumu reddedilir; BAŞKA ekip hesabı etkilenmez", async () => {
      const admin = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      const support = await createPlatformSession(db, SEED_IDS.platformSupport1);

      bumpPlatformUserVersion(db, SEED_IDS.platformAdmin1);

      await expect(resolveSession(db, admin.token)).rejects.toThrow(
        SessionRevokedError,
      );
      await expect(resolveSession(db, support.token)).resolves.toMatchObject({
        role: "support",
      });
    });
  });

  // ---------------------------------------------------------------------
  // S1.4 AC5 — "Ekip yetkisi değiştirildiğinde sonraki istekte güncel
  // yetki uygulanır; eski oturum eski yönetici hakkını kullanamaz."
  // ---------------------------------------------------------------------

  describe("setPlatformUserRole — anında uygulanır, revoke GEREKTİRMEZ", () => {
    it("rol değişince AYNI (iptal edilmemiş) oturum bir sonraki istekte GÜNCEL rolü döner", async () => {
      const created = await createPlatformSession(db, SEED_IDS.platformSupport1);
      expect(created.context.role).toBe("support");

      setPlatformUserRole(db, SEED_IDS.platformSupport1, "admin");

      const resolved = await resolveSession(db, created.token);
      expect(resolved.role).toBe("admin");
      // Oturumun KENDİSİ iptal edilmedi — SessionRevokedError FIRLAMADI.
    });

    it("rolü DÜŞÜRMEK de aynı şekilde anında uygulanır (admin → support)", async () => {
      const created = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      setPlatformUserRole(db, SEED_IDS.platformAdmin1, "support");
      const resolved = await resolveSession(db, created.token);
      expect(resolved.role).toBe("support");
    });
  });

  // ---------------------------------------------------------------------
  // Zaman kontrollü: revoke edilmiş bir oturumun last_seen/expires alanları
  // dokunulmamış kalır (yalnız revoked_at yazılır) — denetim izinin geri
  // kalanı bozulmaz.
  // ---------------------------------------------------------------------

  it("bumpCredentialVersion sonrası revoked_at, ENJEKTE EDİLEN clock ile yazılır", () => {
    const t0 = "2026-05-01T12:00:00.000Z";
    return (async () => {
      await createVehicleSession(db, SEED_IDS.credA1Owner, fixedClock("2026-01-01T00:00:00.000Z"));
      bumpCredentialVersion(db, SEED_IDS.credA1Owner, fixedClock(t0));
      const row = sqlite
        .prepare(
          "SELECT revoked_at FROM sessions WHERE credential_id = ? AND revoked_at IS NOT NULL",
        )
        .get(SEED_IDS.credA1Owner) as { revoked_at: string };
      expect(row.revoked_at).toBe(t0);
    })();
  });
});
