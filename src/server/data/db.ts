/**
 * SQLite bağlantı modülü.
 *
 * ADIM 1/3 (S1.1): bağlantı, güvenli PRAGMA ayarları ve BEGIN IMMEDIATE
 * transaction yardımcısı. ADIM 2/3: gerçek Drizzle şeması (`./schema.ts`,
 * ARCHITECTURE.md §3.2) eklendi; `createDb` artık bu şemayla tipli bir
 * istemci döndürür — migration'lar `scripts/db-init.ts` üzerinden
 * `drizzle-orm/better-sqlite3/migrator` ile uygulanır (bkz. o dosyanın
 * başlığı). Ayrıca `assertMigrationsApplied` eklendi: "Uygulama açılışında
 * migration bekliyorsa hata ver, otomatik uygulama YOK" kapısı — henüz bu
 * modülü çağıran bir istek/instrumentation yolu yok (T1.2+ ile gelecek),
 * ama fonksiyonun kendisi burada hazır ve gerçek DB'ye karşı test edilir.
 *
 * Kaynaklar:
 * - ARCHITECTURE.md §3.4 — "Yazma transaction'ı için BEGIN IMMEDIATE
 *   davranışı seçilir; Drizzle/better-sqlite3 API karşılığı kilitlenen
 *   sürümde doğrulanır."
 * - ARCHITECTURE.md §3.6 — "Her bağlantıda foreign_keys=ON,
 *   synchronous=FULL; dosyada WAL doğrulanır. Başlangıç busy_timeout
 *   değeri 2000 ms." ve "Sürüm kapısı: Kullanılan better-sqlite3 içindeki
 *   gerçek SQLite sürümü SELECT sqlite_version() ile kayıt altına alınır.
 *   Resmî WAL-reset düzeltmesini içeren 3.51.3 veya daha yeni desteklenen
 *   sürüm seçilir... Yalnız npm paket sürümüne bakmak yeterli değildir."
 * - ARCHITECTURE.md §8.1 — "Uygulama DB dosyası bulunamazsa sessizce boş
 *   DB oluşturarak başlamaz. İlk şema kurulumuna yalnız açık migration/
 *   kurulum komutu izin verir."
 * - DECISIONS.md K9 — better-sqlite3 13.0.3'ün gömülü SQLite'ı 3.53.4
 *   olarak `SELECT sqlite_version()` ile doğrulandı (≥ 3.51.3).
 *
 * API doğrulaması (varsayım değil, kanıt):
 * - `better-sqlite3` `Database.Options.fileMustExist` ve
 *   `Database.Transaction.immediate(...)` — `node_modules/@types/
 *   better-sqlite3/index.d.ts`.
 * - `drizzle-orm/better-sqlite3` `drizzle(client)` dönüşünde `$client`
 *   alanıyla ham better-sqlite3 bağlantısına erişim —
 *   `node_modules/drizzle-orm/better-sqlite3/driver.d.ts`.
 * - Drizzle'ın kendi `db.transaction(fn, { behavior: "immediate" })`
 *   seçeneği de aynı native `client.transaction(fn).immediate()`
 *   çağrısına iner (`nativeTx[config.behavior ?? "deferred"](tx)`) —
 *   `node_modules/drizzle-orm/better-sqlite3/session.js`. Bu modülde şema
 *   henüz olmadığından ham better-sqlite3 API'si doğrudan kullanılır;
 *   ADIM 2'de Drizzle şeması eklenince `db.transaction(fn, { behavior:
 *   "immediate" })` biçimine geçilebilir.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
// Açık ".ts" uzantısı kasıtlıdır (bkz. `./package.json` — bu klasör
// `"type": "module"`): `scripts/db-init.ts` bu modülü doğrudan Node'un
// yerel ESM çözümleyicisiyle (uzantısız göreli import'u desteklemez)
// çalıştırır; Next.js/Vitest'in bundler tabanlı çözümleyicileri uzantılı
// import'u da sorunsuz kabul eder (`tsconfig.json`
// `allowImportingTsExtensions`).
import { schema, type Schema } from "./schema.ts";
import { readMigrationFiles } from "drizzle-orm/migrator";

export type SqliteConnection = InstanceType<typeof Database>;

/**
 * Veritabanı dosyası bulunamadığında fırlatılır. Uygulama bu durumda
 * sessizce boş bir DB oluşturmaz (ARCHITECTURE.md §8.1); yalnız açık
 * `db:init` kurulum komutu (`createIfMissing: true`) dosyayı oluşturabilir.
 */
export class MissingDatabaseFileError extends Error {
  constructor(dbPath: string) {
    super(
      `Veritabanı dosyası bulunamadı: "${dbPath}". Uygulama eksik bir ` +
        'veritabanını sessizce oluşturmaz. Önce açık kurulum komutunu ' +
        '(`npm run db:init`) çalıştırın.',
    );
    this.name = "MissingDatabaseFileError";
  }
}

export interface OpenDatabaseOptions {
  /**
   * Yalnız açık kurulum/migration komutları (ör. `db:init`) `true`
   * geçmelidir. Varsayılan `false`: dosya yoksa `MissingDatabaseFileError`
   * fırlatılır, sessizce yeni/boş DB açılmaz.
   */
  createIfMissing?: boolean;
}

/**
 * ARCHITECTURE.md §3.6 "Sürüm kapısı" — better-sqlite3'ün gömülü SQLite'ı
 * bu sürümden eski olamaz (resmî WAL-reset düzeltmesi). DECISIONS.md K9
 * bu eşiği `better-sqlite3@13.0.3` (gömülü SQLite 3.53.4) ile kanıtladı.
 */
export const MINIMUM_SQLITE_VERSION = "3.51.3";

/**
 * Açık bağlantının SQLite sürümü `MINIMUM_SQLITE_VERSION`'dan eskiyse
 * fırlatılır. "Yalnız npm paket sürümüne bakmak yeterli değildir" —
 * bu yüzden paket sürümü değil, çalışan `SELECT sqlite_version()` sonucu
 * denetlenir.
 */
export class UnsupportedSqliteVersionError extends Error {
  constructor(actualVersion: string, minimumVersion: string) {
    super(
      `Desteklenmeyen SQLite sürümü: "${actualVersion}" (gerekli en düşük ` +
        `sürüm: "${minimumVersion}"). ARCHITECTURE.md §3.6 — WAL-reset ` +
        "düzeltmesini içeren sürüm ailesi gereklidir.",
    );
    this.name = "UnsupportedSqliteVersionError";
  }
}

/** Yalnız "x.y.z" biçimli SQLite sürüm dizeleri için nokta bazlı sayısal karşılaştırma. */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * `minimumVersion` parametresi yalnız testlerin gerçek bir bağlantıya karşı
 * (mock DEĞİL) hem geçme hem reddetme yolunu doğrulayabilmesi için vardır;
 * `openDatabaseConnection` her zaman varsayılan `MINIMUM_SQLITE_VERSION`
 * ile çağırır (bkz. `tests/integration/schema.test.ts`).
 */
export function assertSupportedSqliteVersion(
  sqlite: SqliteConnection,
  minimumVersion: string = MINIMUM_SQLITE_VERSION,
): string {
  const row = sqlite
    .prepare("SELECT sqlite_version() AS version")
    .get() as { version: string };
  if (compareVersions(row.version, minimumVersion) < 0) {
    sqlite.close();
    throw new UnsupportedSqliteVersionError(row.version, minimumVersion);
  }
  return row.version;
}

/**
 * Ham better-sqlite3 bağlantısını açar; ARCHITECTURE.md §3.6'daki
 * PRAGMA'ları uygular ve SQLite sürüm kapısını denetler. `:memory:`
 * desteklenmez: mali/DB testleri gerçek geçici dosya kullanmalıdır
 * (QA-PLAN.md §1 — "Finansal DB testleri yalnız mock veya :memory:
 * üzerinde kabul edilmez").
 */
export function openDatabaseConnection(
  dbPath: string,
  options: OpenDatabaseOptions = {},
): SqliteConnection {
  const { createIfMissing = false } = options;

  if (dbPath === ":memory:") {
    throw new Error(
      '":memory:" veritabanı desteklenmez; gerçek geçici dosya kullanın.',
    );
  }

  if (!createIfMissing && !fs.existsSync(dbPath)) {
    throw new MissingDatabaseFileError(dbPath);
  }

  if (createIfMissing) {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }

  const sqlite = new Database(dbPath, { fileMustExist: !createIfMissing });
  assertSupportedSqliteVersion(sqlite);
  applyPragmas(sqlite);
  return sqlite;
}

function applyPragmas(sqlite: SqliteConnection): void {
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = FULL");
  sqlite.pragma("busy_timeout = 2000");
}

/**
 * `DOLMUS_DB_PATH` ortam değişkeninden DB dosya yolunu okur. Boş/eksikse
 * anlaşılır bir hata fırlatır; sessizce varsayılan bir yola düşmez.
 */
export function resolveDbPathFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env.DOLMUS_DB_PATH;
  if (!value || value.trim().length === 0) {
    throw new Error(
      'DOLMUS_DB_PATH ortam değişkeni tanımlı değil. Bkz. ".env.example".',
    );
  }
  return value;
}

/**
 * Şemalı Drizzle istemcisi (`./schema.ts` — ARCHITECTURE.md §3.2 tabloları).
 */
export function createDb(sqlite: SqliteConnection) {
  return drizzle<Schema>(sqlite, { schema });
}

/**
 * Görev tanımı — "Uygulama açılışında (instrumentation veya db modülü)
 * migration bekliyorsa hata ver, otomatik uygulama YOK" — fırlatılır.
 * `npm run db:init` bu hatayı asla görmemelidir (o, eksik migration'ları
 * bilerek uygular); bu yalnız İSTEK SUNAN uygulama tarafı için bir kapıdır.
 */
export class PendingMigrationsError extends Error {
  constructor(pendingCount: number) {
    super(
      `${pendingCount} migration henüz uygulanmamış. Uygulama açılışta ` +
        "migration'ı otomatik ÇALIŞTIRMAZ (ARCHITECTURE.md §8.1). Önce " +
        "`npm run db:init` çalıştırın.",
    );
    this.name = "PendingMigrationsError";
  }
}

/**
 * Diskteki `migrationsFolder`'da tanımlı migration'ların TAMAMININ bu
 * bağlantıdaki `__drizzle_migrations` tablosunda uygulanmış olarak
 * kayıtlı olduğunu doğrular. `drizzle-orm/migrator`'ın kendi
 * `readMigrationFiles`'ı kullanılır — migration hash'i burada yeniden
 * hesaplanmaz, `migrate()`'in DB'ye yazdığı `hash` sütunuyla birebir
 * karşılaştırılır (aynı algoritma, tek kaynak).
 *
 * Bu fonksiyon `openDatabaseConnection`/`createDb` içine OTOMATİK
 * bağlanmaz: `scripts/db-init.ts` da bu ikisini kullanır ve onun işi tam
 * olarak eksik migration'ları uygulamaktır — otomatik bağlansaydı ilk
 * kurulumun kendisi bu hatayla çökerdi. Bunun yerine, gerçek bir isteğe
 * hizmet etmeden önce DB'nin güncel olduğunu doğrulamak isteyen çağıran
 * (ör. ileride eklenecek `instrumentation.ts` veya ilk mali route) bunu
 * açıkça çağırır.
 */
export function assertMigrationsApplied(
  sqlite: SqliteConnection,
  migrationsFolder: string,
): void {
  const migrations = readMigrationFiles({ migrationsFolder });

  const migrationsTableExists = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();

  const appliedHashes = new Set<string>(
    migrationsTableExists
      ? (
          sqlite.prepare("SELECT hash FROM __drizzle_migrations").all() as {
            hash: string;
          }[]
        ).map((row) => row.hash)
      : [],
  );

  const pendingCount = migrations.filter(
    (migration) => !appliedHashes.has(migration.hash),
  ).length;

  if (pendingCount > 0) {
    throw new PendingMigrationsError(pendingCount);
  }
}

/**
 * ARCHITECTURE.md §3.4'teki BEGIN IMMEDIATE davranışını uygulayan yardımcı.
 * Kısa yazma transaction'ları (kayıt + revizyon + makbuz birlikte) bu
 * yardımcı üzerinden çalıştırılmalıdır. Henüz mali kullanım yoktur; bu
 * adımda yalnız mekanizma hazırlanır ve gerçek bir SQLite dosyasına karşı
 * test edilir (bkz. `tests/integration/db-connection.test.ts`).
 */
export function withImmediateTransaction<T>(
  sqlite: SqliteConnection,
  fn: () => T,
): T {
  return sqlite.transaction(fn).immediate();
}
