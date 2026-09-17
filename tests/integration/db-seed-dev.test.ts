import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verify } from "argon2";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  openDatabaseConnection,
  type SqliteConnection,
} from "../../src/server/data/db";
import {
  countSeedRows,
  ProductionSeedRejectedError,
  runSeed,
  seedDevData,
  SEED_IDS,
  SEED_TEST_PASSWORDS,
} from "../../scripts/db-seed-dev";

/**
 * `db:seed-dev` entegrasyon testleri (S1.1 ADIM 3/3).
 *
 * QA-PLAN.md §1 — "Finansal DB testleri yalnız mock veya :memory: üzerinde
 * kabul edilmez." Her test kendi geçici gerçek SQLite dosyasını açar, gerçek
 * migration'ı uygular ve gerçek `argon2` paketiyle (mock YOK) hash/verify
 * dener.
 *
 * Görev tanımının bu adımdaki üç kapısı:
 * 1. "seed iki kez → satır sayıları aynı" — bkz. "çoğaltmaz" describe'ı.
 * 2. "seed'lenen credential'ın Argon2 doğrulaması geçer" — bkz. "Argon2id
 *    doğrulaması" describe'ı.
 * 3. "production'da seed reddedilir" — bkz. "NODE_ENV kapısı" describe'ı.
 */

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");

describe("seedDevData (S1.1 ADIM 3)", () => {
  let dir: string;
  let dbPath: string;
  let sqlite: SqliteConnection;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-seed-"));
    dbPath = path.join(dir, "test.sqlite");
    sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    const db = createDb(sqlite);
    migrate(db, { migrationsFolder });
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("QA-PLAN.md §2 ortak veri setinin beklenen satır sayılarını üretir", async () => {
    const counts = await seedDevData(sqlite);
    // 2 işletme (A, B).
    expect(counts.businesses).toBe(2);
    // A: sahip + 5 şoför (2 aynı adlı + 1 yeniden adlandırılmış + 1 pasif +
    // 1 ikinci araç şoförü) = 6. B: sahip + 4 şoför (aynı desen, ikinci
    // araca şoför atanmadı) = 5. Toplam 11.
    expect(counts.people).toBe(11);
    // A: 2 aktif araç. B: 1 aktif + 1 ek pasif araç. Toplam 4.
    expect(counts.vehicles).toBe(4);
    // 4 araç × (owner + driver) = 8.
    expect(counts.vehicleCredentials).toBe(8);
    // A: 4 (vehA1) + 1 (vehA2) = 5. B: 4 (vehB1) + 0 (pasif vehB2) = 4.
    // Toplam 9.
    expect(counts.vehicleDrivers).toBe(9);
    // Aktiflik × rol çaprazı: aktif/pasif admin + aktif/pasif support.
    expect(counts.platformUsers).toBe(4);
  });

  it("iki kez çalıştırıldığında satır sayıları aynı kalır (çoğaltmaz)", async () => {
    const first = await seedDevData(sqlite);
    const second = await seedDevData(sqlite);
    expect(second).toEqual(first);
    // Doğrudan DB'den de doğrula — countSeedRows'un kendisi de aynı
    // bağlantıyı okur, bu yüzden ayrıca ham SQL ile çapraz kontrol.
    const rawBusinessCount = sqlite
      .prepare("SELECT COUNT(*) AS count FROM businesses")
      .get() as { count: number };
    expect(rawBusinessCount.count).toBe(first.businesses);
  });

  it("aynı araçta aynı adlı iki ayrı kişi ID'si üretir (QA-PLAN §2)", async () => {
    await seedDevData(sqlite);
    const rows = sqlite
      .prepare(
        "SELECT id, full_name FROM people WHERE business_id = ? AND full_name = ?",
      )
      .all(SEED_IDS.businessA, "Mehmet Öz") as { id: string; full_name: string }[];
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    // İkisi de aynı araca (vehA1) atanmış.
    const assignments = sqlite
      .prepare(
        "SELECT person_id FROM vehicle_drivers WHERE business_id = ? AND vehicle_id = ? AND person_id IN (?, ?)",
      )
      .all(
        SEED_IDS.businessA,
        SEED_IDS.vehicleA1,
        SEED_IDS.driverA1a,
        SEED_IDS.driverA1b,
      );
    expect(assignments).toHaveLength(2);
  });

  it("pasif şoför ataması ve ek pasif araç üretir", async () => {
    await seedDevData(sqlite);
    const passiveAssignment = sqlite
      .prepare(
        "SELECT active FROM vehicle_drivers WHERE business_id = ? AND vehicle_id = ? AND person_id = ?",
      )
      .get(SEED_IDS.businessA, SEED_IDS.vehicleA1, SEED_IDS.driverA1d) as {
      active: number;
    };
    expect(passiveAssignment.active).toBe(0);

    const passiveVehicle = sqlite
      .prepare("SELECT active FROM vehicles WHERE id = ?")
      .get(SEED_IDS.vehicleB2) as { active: number };
    expect(passiveVehicle.active).toBe(0);
    // Pasif araçta da credential vardır (giriş reddinin credential
    // eksikliğinden değil aktiflikten kaynaklandığını sonraki adımlarda
    // (T1.2) gösterebilmek için).
    const passiveVehicleCredentials = sqlite
      .prepare("SELECT COUNT(*) AS count FROM vehicle_credentials WHERE vehicle_id = ?")
      .get(SEED_IDS.vehicleB2) as { count: number };
    expect(passiveVehicleCredentials.count).toBe(2);
  });

  it("restart sonrası (DB kapatılıp yeniden açılınca) seed verisi korunur", async () => {
    await seedDevData(sqlite);
    sqlite.close();

    const reopened = openDatabaseConnection(dbPath);
    try {
      const counts = countSeedRows(reopened);
      expect(counts.businesses).toBe(2);
      expect(counts.vehicles).toBe(4);
    } finally {
      reopened.close();
    }
  });

  describe("Argon2id doğrulaması (memoryCost 19456/timeCost 2/parallelism 1)", () => {
    it("araç sahibi (owner) credential'ının doğrulaması belgelenen şifreyle geçer", async () => {
      await seedDevData(sqlite);
      const row = sqlite
        .prepare("SELECT password_hash FROM vehicle_credentials WHERE id = ?")
        .get(SEED_IDS.credA1Owner) as { password_hash: string };

      expect(row.password_hash).toMatch(/^\$argon2id\$/);
      await expect(
        verify(row.password_hash, SEED_TEST_PASSWORDS.owner),
      ).resolves.toBe(true);
      await expect(verify(row.password_hash, "yanlis-sifre")).resolves.toBe(
        false,
      );
    });

    it("ortak şoför (driver) credential'ının doğrulaması belgelenen şifreyle geçer", async () => {
      await seedDevData(sqlite);
      const row = sqlite
        .prepare("SELECT password_hash FROM vehicle_credentials WHERE id = ?")
        .get(SEED_IDS.credA1Driver) as { password_hash: string };

      await expect(
        verify(row.password_hash, SEED_TEST_PASSWORDS.driver),
      ).resolves.toBe(true);
      // Sahip şifresi şoför credential'ını açmamalı (farklı hash/salt).
      await expect(
        verify(row.password_hash, SEED_TEST_PASSWORDS.owner),
      ).resolves.toBe(false);
    });

    it("ekip hesabı (platform_users) credential'larının doğrulaması geçer", async () => {
      await seedDevData(sqlite);
      const admin = sqlite
        .prepare("SELECT password_hash, active FROM platform_users WHERE id = ?")
        .get(SEED_IDS.platformAdmin1) as { password_hash: string; active: number };
      const passiveAdmin = sqlite
        .prepare("SELECT password_hash, active FROM platform_users WHERE id = ?")
        .get(SEED_IDS.platformAdminPassive1) as {
        password_hash: string;
        active: number;
      };
      const passiveSupport = sqlite
        .prepare("SELECT password_hash, active FROM platform_users WHERE id = ?")
        .get(SEED_IDS.platformSupportPassive1) as {
        password_hash: string;
        active: number;
      };

      expect(admin.active).toBe(1);
      expect(passiveAdmin.active).toBe(0);
      expect(passiveSupport.active).toBe(0);
      await expect(
        verify(admin.password_hash, SEED_TEST_PASSWORDS.admin),
      ).resolves.toBe(true);
      // Pasif hesapların şifresi de (aktiflik ayrı bir kapıdır) hâlâ doğru
      // hash'lenmiştir; T1.3/T1.4 pasiflik kontrolünü ayrıca uygulayacaktır.
      await expect(
        verify(passiveAdmin.password_hash, SEED_TEST_PASSWORDS.admin),
      ).resolves.toBe(true);
      await expect(
        verify(passiveSupport.password_hash, SEED_TEST_PASSWORDS.support),
      ).resolves.toBe(true);
    });
  });
});

describe("runSeed — NODE_ENV kapısı", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-seed-prod-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("NODE_ENV=production iken reddedilir ve DB dosyasına hiç dokunmaz", async () => {
    const missingDbPath = path.join(dir, "should-not-be-created.sqlite");

    await expect(
      runSeed({ NODE_ENV: "production", DOLMUS_DB_PATH: missingDbPath }),
    ).rejects.toThrow(ProductionSeedRejectedError);
    await expect(
      runSeed({ NODE_ENV: "production", DOLMUS_DB_PATH: missingDbPath }),
    ).rejects.toThrow(/NODE_ENV=production/);

    expect(fs.existsSync(missingDbPath)).toBe(false);
  });

  it("NODE_ENV=production DIŞINDA (development/test/tanımsız) çalışır", async () => {
    const dbPath = path.join(dir, "dev.sqlite");
    const sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    const db = createDb(sqlite);
    migrate(db, { migrationsFolder });
    sqlite.close();

    const counts = await runSeed({ NODE_ENV: "development", DOLMUS_DB_PATH: dbPath });
    expect(counts.businesses).toBe(2);

    const testEnvCounts = await runSeed({ NODE_ENV: "test", DOLMUS_DB_PATH: dbPath });
    expect(testEnvCounts).toEqual(counts);

    const undefinedEnvCounts = await runSeed({ DOLMUS_DB_PATH: dbPath });
    expect(undefinedEnvCounts).toEqual(counts);
  });
});
