/**
 * Geliştirme test verisi tohumlama komutu — `npm run db:seed-dev` (ADIM 3/3,
 * S1.1).
 *
 * Kaynak: STORIES.md S1.1 kabul kriteri — "E1'i E2 ekranlarını beklemeden
 * denemek için farklı işletmelere ait örnek araçlar, iki rolün girişleri ve
 * ekip hesapları içeren ayrı test verisi vardır. Test verisi gerçek müşteri
 * açma yöntemi veya canlı kurulum adımı değildir." QA-PLAN.md §2 "Ortak veri
 * seti" birebir şu kümeyi tanımlar: "A ve B adlı iki işletme; A'da iki, B'de
 * bir araç. Her araçta ayrı sahip/ortak şoför credential; kişisel yetkili
 * ekip hesabı ve pasif ekip hesabı bulunur... Her işletmede sahip kişi ve
 * şoförler; aynı araçta aynı ada sahip iki ayrı kişi ID'si, yeniden
 * adlandırılmış kişi ve pasif şoför bulunur. Pasif araç/işletme oturum
 * iptalinde kullanılır." Bu script birebir bu kümeyi kurar (bkz. aşağıdaki
 * "Üretilen veri" bölümü).
 *
 * Üretilen veri:
 * - İşletme A: sahip "Ali Kaya", iki araç (34AAA001 aktif, 34BBB002 aktif).
 *   34AAA001'in şoförleri: "Mehmet Öz" × 2 (aynı araçta aynı adlı iki ayrı
 *   kişi ID'si), "Hüseyin Ak" (version=2 — yeniden adlandırılmış kişi
 *   temsili; bu adımda ayrı bir ad geçmişi tablosu yok, gerçek yeniden
 *   adlandırma işlemi/audit T2.4'te eklenecek),
 *   "Kemal Şahin" (vehicle_drivers.active=0 — pasif şoför ataması).
 *   34BBB002'nin şoförü: "Zeynep Arslan".
 * - İşletme B: sahip "Fatma Çelik", bir aktif araç (06CCC003) ve QA-PLAN'ın
 *   "pasif araç/işletme oturum iptalinde kullanılır" senaryosu için EK bir
 *   pasif araç (06DDD004, vehicles.active=0). 06CCC003'ün şoförleri aynı
 *   desende: "Hasan Kurt" × 2, "Elif Kaplan" (version=2), "Mustafa Er"
 *   (pasif atama) — İşletme A'daki üç şoför senaryosu QA-PLAN'ın "Her
 *   işletmede ... bulunur" ifadesi gereği B'de de tekrarlanır.
 * - Her araçta (pasif 06DDD004 dahil, giriş reddinin CREDENTIAL eksikliği
 *   değil AKTİFLİK yüzünden olduğunu göstermek için) hem owner hem driver
 *   credential'ı: şifreler `SEED_TEST_PASSWORDS` (owner "sahip-1234", driver
 *   "sofor-1234") — ".env.example" içinde de belgelenir, GERÇEK KURULUMDA
 *   KULLANILMAZ.
 * - Ekip hesapları (platform_users): "aktif + pasif platform_users
 *   (platform_role admin ve support)" görev kapsamı iki boyutu (aktiflik ×
 *   rol) çaprazlayarak dört hesapla karşılanır — aktif admin, pasif admin,
 *   aktif support, pasif support.
 *
 * Tekrar çalıştırma çoğaltmaz: her satır `fixedId(...)` ile üretilen SABİT
 * (deterministic) bir kimlik taşır ve her INSERT `OR IGNORE` ile yazılır;
 * aynı script iki kez çalıştığında ikinci çalıştırma hiçbir satır eklemez
 * (bkz. `tests/integration/db-seed-dev.test.ts` — "iki kez çalıştırıldığında
 * satır sayıları aynı kalır").
 *
 * Argon2id hash'leri (memoryCost 19456 KiB = 19 MiB, timeCost 2,
 * parallelism 1 — ARCHITECTURE.md §6: "node-argon2 ile Argon2id; başlangıç
 * 19 MiB, t=2, p=1") görev tanımı gereği transaction DIŞINDA üretilir: bu
 * dosyada `await hash(...)` çağrıları `withImmediateTransaction(...)`
 * çağrısından ÖNCE tamamlanır; transaction callback'i (better-sqlite3'ün
 * gerektirdiği gibi) tamamen SENKRONDUR ve yalnız önceden üretilmiş hash
 * dizelerini INSERT eder.
 *
 * Üretim koruması: `NODE_ENV=production` iken `runSeed` DB dosyasına HİÇ
 * dokunmadan (bağlantı bile açmadan) reddeder — bkz. `assertSeedAllowedInEnv`
 * ve `tests/integration/db-seed-dev.test.ts` "NODE_ENV=production" testi.
 *
 * Bu script `../src/server/data/db.ts` gibi doğrudan `node` ile (Next.js/
 * Vitest bundler'ı OLMADAN) çalışır; komşu `.ts` importlarında uzantının
 * neden açık yazıldığı için bkz. o dosyanın başlığı ve
 * `scripts/package.json` ("type": "module"). `db-init.ts`'ten farklı olarak
 * buradaki `main`/CLI çalıştırma kısmı bir "doğrudan çalıştırma mı?" kapısı
 * (`isDirectRun`) ile korunur: bu dosya `tests/integration/db-seed-dev.test.ts`
 * tarafından da (Vitest'in bundler tabanlı çözümleyicisiyle, uzantısız
 * import'la) İÇE AKTARILIR; kapı olmasaydı import anında `runSeed()` yan
 * etkisi (gerçek `DOLMUS_DB_PATH`'i açmaya çalışmak) tetiklenirdi.
 */
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { argon2id, hash } from "argon2";
import { normalizePlate } from "../src/lib/plate.ts";
import {
  assertMigrationsApplied,
  openDatabaseConnection,
  resolveDbPathFromEnv,
  withImmediateTransaction,
  type SqliteConnection,
} from "../src/server/data/db.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const migrationsFolder = path.join(projectRoot, "drizzle");

/**
 * Yalnız yerel geliştirme test verisi; GERÇEK KURULUMDA KULLANILMAZ.
 * `.env.example` bu değerleri yalnız İNSAN tarafından okunan belge olarak
 * tekrarlar (env değişkeni olarak OKUNMAZ) — tek kaynak burasıdır.
 */
export const SEED_TEST_PASSWORDS = {
  owner: "sahip-1234",
  driver: "sofor-1234",
  admin: "yonetici-1234",
  support: "destek-1234",
} as const;

/**
 * ARCHITECTURE.md §6 — "node-argon2 ile Argon2id; başlangıç 19 MiB, t=2,
 * p=1" (19 MiB = 19456 KiB, node-argon2'nin `memoryCost` birimi KiB'dir).
 */
const ARGON2ID_OPTIONS = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Sabit oluşturma zamanı — seed verisinin her çalıştırmada bit bit aynı
 * içerikte üretildiğini garanti eder (yalnız id sabitliği değil).
 */
const SEED_CREATED_AT = "2026-01-01T00:00:00.000Z";

/**
 * Sabit (deterministic) kimlik üretir — `crypto.randomUUID()` DEĞİLDİR. Aynı
 * `label` her çalıştırmada birebir aynı UUID biçimli (v4 sürüm/varyant
 * bitleri sabitlenmiş) sonucu üretir; bu yüzden aşağıdaki her `INSERT OR
 * IGNORE` ikinci çalıştırmada aynı satırı hedefler ve çoğaltmaz.
 */
function fixedId(label: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`dolmus-takip-dev-seed:${label}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x40, 6); // version 4
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8); // variant 10
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Bu modülün ürettiği bütün sabit kimlikler. Dosya başındaki "Üretilen veri"
 * bölümüyle birebir eşleşir; testler (ve ileride T1.2+'nin gerçek giriş
 * denemeleri) bu kimlikleri/plakaları buradan alır — ikinci bir kopya
 * tutulmaz.
 */
export const SEED_IDS = {
  businessA: fixedId("business:A"),
  businessB: fixedId("business:B"),

  ownerA: fixedId("person:A:owner"),
  driverA1a: fixedId("person:A:v1:driver:mehmet-oz:1"),
  driverA1b: fixedId("person:A:v1:driver:mehmet-oz:2"),
  driverA1c: fixedId("person:A:v1:driver:huseyin-ak:renamed"),
  driverA1d: fixedId("person:A:v1:driver:kemal-sahin:passive"),
  driverA2a: fixedId("person:A:v2:driver:zeynep-arslan"),

  ownerB: fixedId("person:B:owner"),
  driverB1a: fixedId("person:B:v1:driver:hasan-kurt:1"),
  driverB1b: fixedId("person:B:v1:driver:hasan-kurt:2"),
  driverB1c: fixedId("person:B:v1:driver:elif-kaplan:renamed"),
  driverB1d: fixedId("person:B:v1:driver:mustafa-er:passive"),

  vehicleA1: fixedId("vehicle:A:1"),
  vehicleA2: fixedId("vehicle:A:2"),
  vehicleB1: fixedId("vehicle:B:1"),
  vehicleB2: fixedId("vehicle:B:2"),

  credA1Owner: fixedId("credential:A:1:owner"),
  credA1Driver: fixedId("credential:A:1:driver"),
  credA2Owner: fixedId("credential:A:2:owner"),
  credA2Driver: fixedId("credential:A:2:driver"),
  credB1Owner: fixedId("credential:B:1:owner"),
  credB1Driver: fixedId("credential:B:1:driver"),
  credB2Owner: fixedId("credential:B:2:owner"),
  credB2Driver: fixedId("credential:B:2:driver"),

  platformAdmin1: fixedId("platform-user:admin:1"),
  platformAdminPassive1: fixedId("platform-user:admin:passive:1"),
  platformSupport1: fixedId("platform-user:support:1"),
  platformSupportPassive1: fixedId("platform-user:support:passive:1"),
} as const;

/**
 * Ekip hesabı kullanıcı adları — T1.3, S1.3 platform-login testlerinin
 * (`tests/integration/platform-login-route.test.ts`,
 * `tests/integration/platform-admin-cli.test.ts`) DOĞRUDAN kullandığı tek
 * kaynak; önceden bu dizeler yalnız aşağıdaki `insertPlatformUser`
 * çağrılarında GÖMÜLÜYDÜ (T1.1'de henüz bir giriş akışı OLMADIĞINDAN dışa
 * aktarılmaya gerek yoktu).
 */
export const SEED_USERNAMES = {
  admin: "admin.test",
  adminPassive: "admin.pasif.test",
  support: "destek.test",
  supportPassive: "destek.pasif.test",
} as const;

/** İnsanların okuyacağı ham plaka biçimleri — `normalizePlate` ile saklanır. */
export const SEED_RAW_PLATES = {
  vehicleA1: "34 AAA 001",
  vehicleA2: "34 BBB 002",
  vehicleB1: "06 CCC 003",
  vehicleB2: "06 DDD 004",
} as const;

// ---------------------------------------------------------------------------
// Üretim koruması — görev tanımı: "yalnız NODE_ENV production DEĞİLKEN
// çalışır". Bu kontrol `runSeed` içinde, DB dosyası HİÇ açılmadan ÖNCE
// çalışır (bkz. `runSeed`).
// ---------------------------------------------------------------------------

export class ProductionSeedRejectedError extends Error {
  constructor() {
    super(
      "NODE_ENV=production iken test verisi tohumlanamaz. `db:seed-dev` " +
        "yalnız yerel geliştirme/test ortamı içindir; üretim veritabanına " +
        "dokunulmadı.",
    );
    this.name = "ProductionSeedRejectedError";
  }
}

/**
 * `env` parametresi `resolveDbPathFromEnv` ile aynı desendedir (bkz.
 * `../src/server/data/db.ts`): testlerin gerçek `process.env`'i değiştirmeden
 * hem "izinli" hem "reddedilir" yollarını sınayabilmesi içindir. `runSeed`
 * her zaman varsayılan `process.env` ile çağırır.
 */
export function assertSeedAllowedInEnv(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.NODE_ENV === "production") {
    throw new ProductionSeedRejectedError();
  }
}

// ---------------------------------------------------------------------------
// Satır sayıları — CLI özet çıktısı ve entegrasyon testinin
// "iki kez çalıştırıldığında satır sayıları aynı kalır" kontrolü için.
// ---------------------------------------------------------------------------

export interface SeedRowCounts {
  businesses: number;
  people: number;
  vehicles: number;
  vehicleCredentials: number;
  vehicleDrivers: number;
  platformUsers: number;
}

function countRows(sqlite: SqliteConnection, table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}

export function countSeedRows(sqlite: SqliteConnection): SeedRowCounts {
  return {
    businesses: countRows(sqlite, "businesses"),
    people: countRows(sqlite, "people"),
    vehicles: countRows(sqlite, "vehicles"),
    vehicleCredentials: countRows(sqlite, "vehicle_credentials"),
    vehicleDrivers: countRows(sqlite, "vehicle_drivers"),
    platformUsers: countRows(sqlite, "platform_users"),
  };
}

// ---------------------------------------------------------------------------
// Satır bazlı INSERT OR IGNORE yardımcıları (idempotency: sabit id + OR
// IGNORE — ikinci çalıştırma hiçbir satırı çoğaltmaz).
// ---------------------------------------------------------------------------

function insertBusiness(sqlite: SqliteConnection, id: string, name: string): void {
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)",
    )
    .run(id, name, SEED_CREATED_AT);
}

function insertPerson(
  sqlite: SqliteConnection,
  businessId: string,
  id: string,
  fullName: string,
  options: { version?: number } = {},
): void {
  const { version = 1 } = options;
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, ?)",
    )
    .run(businessId, id, fullName, version);
}

function insertVehicle(
  sqlite: SqliteConnection,
  params: {
    businessId: string;
    id: string;
    rawPlate: string;
    ownerPersonId: string;
    brandModel: string;
    year: number;
    routeStop: string;
    active: boolean;
  },
): void {
  const { businessId, id, rawPlate, ownerPersonId, brandModel, year, routeStop, active } =
    params;
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO vehicles (
        business_id, id, plate_normalized, owner_person_id, brand_model, year,
        route_stop, note, active, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 1)`,
    )
    .run(
      businessId,
      id,
      normalizePlate(rawPlate),
      ownerPersonId,
      brandModel,
      year,
      routeStop,
      active ? 1 : 0,
    );
}

function insertVehicleCredential(
  sqlite: SqliteConnection,
  businessId: string,
  id: string,
  vehicleId: string,
  role: "owner" | "driver",
  passwordHash: string,
): void {
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO vehicle_credentials (
        business_id, id, vehicle_id, role, password_hash, credential_version
      ) VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .run(businessId, id, vehicleId, role, passwordHash);
}

function insertVehicleDriver(
  sqlite: SqliteConnection,
  businessId: string,
  vehicleId: string,
  personId: string,
  active: boolean,
): void {
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO vehicle_drivers (business_id, vehicle_id, person_id, active, version) VALUES (?, ?, ?, ?, 1)",
    )
    .run(businessId, vehicleId, personId, active ? 1 : 0);
}

function insertPlatformUser(
  sqlite: SqliteConnection,
  id: string,
  username: string,
  passwordHash: string,
  platformRole: "admin" | "support",
  active: boolean,
): void {
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO platform_users (
        id, username, password_hash, platform_role, active, credential_version
      ) VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .run(id, username, passwordHash, platformRole, active ? 1 : 0);
}

/**
 * QA-PLAN.md §2 ortak veri setini seçili bağlantıya yazar. Bağlantının
 * migration'ları tamamlanmış olmalıdır (`assertMigrationsApplied` bunu
 * denetler). İki kez çağrılması güvenlidir (yukarı bkz. — sabit id + OR
 * IGNORE).
 */
export async function seedDevData(sqlite: SqliteConnection): Promise<SeedRowCounts> {
  assertMigrationsApplied(sqlite, migrationsFolder);

  // Argon2id hash'leri BEGIN IMMEDIATE'DEN ÖNCE, DB kilidi tutulmadan
  // üretilir (görev tanımı: "Argon2 hash'lerini transaction DIŞINDA üret").
  // Aynı düz metin birden çok credential'da kullanıldığından yalnız 4 ayrı
  // hash üretilir (owner/driver/admin/support); her biri kendi rastgele
  // salt'ını taşır.
  const ownerHash = await hash(SEED_TEST_PASSWORDS.owner, ARGON2ID_OPTIONS);
  const driverHash = await hash(SEED_TEST_PASSWORDS.driver, ARGON2ID_OPTIONS);
  const adminHash = await hash(SEED_TEST_PASSWORDS.admin, ARGON2ID_OPTIONS);
  const supportHash = await hash(SEED_TEST_PASSWORDS.support, ARGON2ID_OPTIONS);

  withImmediateTransaction(sqlite, () => {
    insertBusiness(sqlite, SEED_IDS.businessA, "İşletme A");
    insertBusiness(sqlite, SEED_IDS.businessB, "İşletme B");

    // İşletme A — sahip ve şoförler.
    insertPerson(sqlite, SEED_IDS.businessA, SEED_IDS.ownerA, "Ali Kaya");
    insertPerson(sqlite, SEED_IDS.businessA, SEED_IDS.driverA1a, "Mehmet Öz");
    // Aynı araçta aynı adlı İKİNCİ ayrı kişi (farklı id) — QA-PLAN §2.
    insertPerson(sqlite, SEED_IDS.businessA, SEED_IDS.driverA1b, "Mehmet Öz");
    // Yeniden adlandırılmış kişi temsili: version=2 (bu adımda ayrı bir ad
    // geçmişi tablosu yok; gerçek yeniden adlandırma işlemi/audit T2.4'te
    // eklenecek).
    insertPerson(sqlite, SEED_IDS.businessA, SEED_IDS.driverA1c, "Hüseyin Ak", {
      version: 2,
    });
    insertPerson(sqlite, SEED_IDS.businessA, SEED_IDS.driverA1d, "Kemal Şahin");
    insertPerson(sqlite, SEED_IDS.businessA, SEED_IDS.driverA2a, "Zeynep Arslan");

    // İşletme B — aynı üç senaryo (QA-PLAN §2: "Her işletmede ... bulunur").
    insertPerson(sqlite, SEED_IDS.businessB, SEED_IDS.ownerB, "Fatma Çelik");
    insertPerson(sqlite, SEED_IDS.businessB, SEED_IDS.driverB1a, "Hasan Kurt");
    insertPerson(sqlite, SEED_IDS.businessB, SEED_IDS.driverB1b, "Hasan Kurt");
    insertPerson(sqlite, SEED_IDS.businessB, SEED_IDS.driverB1c, "Elif Kaplan", {
      version: 2,
    });
    insertPerson(sqlite, SEED_IDS.businessB, SEED_IDS.driverB1d, "Mustafa Er");

    // Araçlar — İşletme A: iki aktif araç.
    insertVehicle(sqlite, {
      businessId: SEED_IDS.businessA,
      id: SEED_IDS.vehicleA1,
      rawPlate: SEED_RAW_PLATES.vehicleA1,
      ownerPersonId: SEED_IDS.ownerA,
      brandModel: "Ford Transit",
      year: 2019,
      routeStop: "Merkez - Sahil",
      active: true,
    });
    insertVehicle(sqlite, {
      businessId: SEED_IDS.businessA,
      id: SEED_IDS.vehicleA2,
      rawPlate: SEED_RAW_PLATES.vehicleA2,
      ownerPersonId: SEED_IDS.ownerA,
      brandModel: "Volkswagen Crafter",
      year: 2021,
      routeStop: "Merkez - Sanayi",
      active: true,
    });
    // İşletme B: bir aktif araç + QA-PLAN'ın "pasif araç ... oturum
    // iptalinde kullanılır" senaryosu için EK bir pasif araç.
    insertVehicle(sqlite, {
      businessId: SEED_IDS.businessB,
      id: SEED_IDS.vehicleB1,
      rawPlate: SEED_RAW_PLATES.vehicleB1,
      ownerPersonId: SEED_IDS.ownerB,
      brandModel: "Fiat Ducato",
      year: 2018,
      routeStop: "Garaj - Terminal",
      active: true,
    });
    insertVehicle(sqlite, {
      businessId: SEED_IDS.businessB,
      id: SEED_IDS.vehicleB2,
      rawPlate: SEED_RAW_PLATES.vehicleB2,
      ownerPersonId: SEED_IDS.ownerB,
      brandModel: "Fiat Ducato",
      year: 2015,
      routeStop: "Yedek",
      active: false,
    });

    // Araç credential'ları — HER araçta (pasif 06DDD004 dahil) hem owner hem
    // driver girişi vardır; pasif araç girişinin AKTİFLİK yüzünden
    // reddedildiğini (credential eksikliği değil) göstermek içindir.
    insertVehicleCredential(
      sqlite,
      SEED_IDS.businessA,
      SEED_IDS.credA1Owner,
      SEED_IDS.vehicleA1,
      "owner",
      ownerHash,
    );
    insertVehicleCredential(
      sqlite,
      SEED_IDS.businessA,
      SEED_IDS.credA1Driver,
      SEED_IDS.vehicleA1,
      "driver",
      driverHash,
    );
    insertVehicleCredential(
      sqlite,
      SEED_IDS.businessA,
      SEED_IDS.credA2Owner,
      SEED_IDS.vehicleA2,
      "owner",
      ownerHash,
    );
    insertVehicleCredential(
      sqlite,
      SEED_IDS.businessA,
      SEED_IDS.credA2Driver,
      SEED_IDS.vehicleA2,
      "driver",
      driverHash,
    );
    insertVehicleCredential(
      sqlite,
      SEED_IDS.businessB,
      SEED_IDS.credB1Owner,
      SEED_IDS.vehicleB1,
      "owner",
      ownerHash,
    );
    insertVehicleCredential(
      sqlite,
      SEED_IDS.businessB,
      SEED_IDS.credB1Driver,
      SEED_IDS.vehicleB1,
      "driver",
      driverHash,
    );
    insertVehicleCredential(
      sqlite,
      SEED_IDS.businessB,
      SEED_IDS.credB2Owner,
      SEED_IDS.vehicleB2,
      "owner",
      ownerHash,
    );
    insertVehicleCredential(
      sqlite,
      SEED_IDS.businessB,
      SEED_IDS.credB2Driver,
      SEED_IDS.vehicleB2,
      "driver",
      driverHash,
    );

    // Araç atamaları (vehicle_drivers) — driverA1d/driverB1d PASİF atamadır.
    insertVehicleDriver(sqlite, SEED_IDS.businessA, SEED_IDS.vehicleA1, SEED_IDS.driverA1a, true);
    insertVehicleDriver(sqlite, SEED_IDS.businessA, SEED_IDS.vehicleA1, SEED_IDS.driverA1b, true);
    insertVehicleDriver(sqlite, SEED_IDS.businessA, SEED_IDS.vehicleA1, SEED_IDS.driverA1c, true);
    insertVehicleDriver(
      sqlite,
      SEED_IDS.businessA,
      SEED_IDS.vehicleA1,
      SEED_IDS.driverA1d,
      false,
    );
    insertVehicleDriver(sqlite, SEED_IDS.businessA, SEED_IDS.vehicleA2, SEED_IDS.driverA2a, true);
    insertVehicleDriver(sqlite, SEED_IDS.businessB, SEED_IDS.vehicleB1, SEED_IDS.driverB1a, true);
    insertVehicleDriver(sqlite, SEED_IDS.businessB, SEED_IDS.vehicleB1, SEED_IDS.driverB1b, true);
    insertVehicleDriver(sqlite, SEED_IDS.businessB, SEED_IDS.vehicleB1, SEED_IDS.driverB1c, true);
    insertVehicleDriver(
      sqlite,
      SEED_IDS.businessB,
      SEED_IDS.vehicleB1,
      SEED_IDS.driverB1d,
      false,
    );

    // Ekip hesapları — aktiflik × rol çaprazı: aktif/pasif admin, aktif/pasif
    // support.
    insertPlatformUser(
      sqlite,
      SEED_IDS.platformAdmin1,
      SEED_USERNAMES.admin,
      adminHash,
      "admin",
      true,
    );
    insertPlatformUser(
      sqlite,
      SEED_IDS.platformAdminPassive1,
      SEED_USERNAMES.adminPassive,
      adminHash,
      "admin",
      false,
    );
    insertPlatformUser(
      sqlite,
      SEED_IDS.platformSupport1,
      SEED_USERNAMES.support,
      supportHash,
      "support",
      true,
    );
    insertPlatformUser(
      sqlite,
      SEED_IDS.platformSupportPassive1,
      SEED_USERNAMES.supportPassive,
      supportHash,
      "support",
      false,
    );
  });

  return countSeedRows(sqlite);
}

/**
 * `db:seed-dev`'in tam giriş noktası: üretim koruması → DB aç → tohumla →
 * bağlantıyı kapat. `env` parametresi yalnız testler içindir (bkz.
 * `assertSeedAllowedInEnv` notu); CLI her zaman varsayılanla (`process.env`)
 * çağırır.
 */
export async function runSeed(
  env: Record<string, string | undefined> = process.env,
): Promise<SeedRowCounts> {
  assertSeedAllowedInEnv(env);
  const dbPath = resolveDbPathFromEnv(env);
  const sqlite = openDatabaseConnection(dbPath);
  try {
    return await seedDevData(sqlite);
  } finally {
    sqlite.close();
  }
}

// ---------------------------------------------------------------------------
// CLI — yalnız bu dosya `node scripts/db-seed-dev.ts` ile DOĞRUDAN
// çalıştırıldığında tetiklenir. `tests/integration/db-seed-dev.test.ts` bu
// modülü Vitest'in bundler çözümleyicisiyle İÇE AKTARDIĞINDA (`isDirectRun`
// false olduğundan) hiçbir yan etki (gerçek DOLMUS_DB_PATH'i açma denemesi)
// tetiklenmez.
// ---------------------------------------------------------------------------

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  // Veritabanı yolu yalnız `runSeed()` BAŞARILI olduktan SONRA yazdırılır —
  // `NODE_ENV=production` reddi (veya başka bir erken hata) veritabanına hiç
  // dokunmadığından, bu yolu önceden yazdırmak yanıltıcı olurdu.
  runSeed()
    .then((counts) => {
      console.log(`[db:seed-dev] Veritabanı: "${resolveDbPathFromEnv()}"`);
      console.log(
        `[db:seed-dev] Test verisi hazır: ${counts.businesses} işletme, ` +
          `${counts.people} kişi, ${counts.vehicles} araç, ` +
          `${counts.vehicleCredentials} araç girişi, ` +
          `${counts.vehicleDrivers} araç ataması, ` +
          `${counts.platformUsers} ekip hesabı (satır sayıları toplamdır; ` +
          "tekrar çalıştırma çoğaltmaz).",
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[db:seed-dev] Tohumlama başarısız: ${message}`);
      process.exitCode = 1;
    });
}
