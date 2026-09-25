/**
 * SQLite bağlantı modülü.
 *
 * ADIM 1/3 (S1.1): bağlantı, güvenli PRAGMA ayarları ve BEGIN IMMEDIATE
 * transaction yardımcısı. ADIM 2/3: gerçek Drizzle şeması (`./schema.ts`)
 * eklendi; `createDb` artık bu şemayla tipli bir
 * istemci döndürür — migration'lar `scripts/db-init.ts` üzerinden
 * `drizzle-orm/better-sqlite3/migrator` ile uygulanır (bkz. o dosyanın
 * başlığı). Ayrıca `assertMigrationsApplied` eklendi: "Uygulama açılışında
 * migration bekliyorsa hata ver, otomatik uygulama YOK" kapısı — henüz bu
 * modülü çağıran bir istek/instrumentation yolu yok (T1.2+ ile gelecek),
 * ama fonksiyonun kendisi burada hazır ve gerçek DB'ye karşı test edilir.
 *
 * Kurallar:
 * - Yazma transaction'ı için BEGIN IMMEDIATE davranışı seçilir;
 *   Drizzle/better-sqlite3 API karşılığı kilitlenen sürümde doğrulanır.
 * - Her bağlantıda foreign_keys=ON, synchronous=FULL; dosyada WAL
 *   doğrulanır. Başlangıç busy_timeout değeri 2000 ms.
 * - Sürüm kapısı: kullanılan better-sqlite3 içindeki gerçek SQLite sürümü
 *   SELECT sqlite_version() ile kayıt altına alınır. Resmî WAL-reset
 *   düzeltmesini içeren 3.51.3 veya daha yeni desteklenen sürüm seçilir;
 *   yalnız npm paket sürümüne bakmak yeterli değildir.
 * - Uygulama DB dosyası bulunamazsa sessizce boş DB oluşturarak başlamaz.
 *   İlk şema kurulumuna yalnız açık migration/kurulum komutu izin verir.
 * - K9 — better-sqlite3 13.0.3'ün gömülü SQLite'ı 3.53.4 olarak
 *   `SELECT sqlite_version()` ile doğrulandı (≥ 3.51.3).
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
 * sessizce boş bir DB oluşturmaz; yalnız açık
 * `db:init` kurulum komutu (`createIfMissing: true`) dosyayı oluşturabilir.
 */
export class MissingDatabaseFileError extends Error {
  constructor(dbPath: string) {
    super(
      `Veritabanı dosyası bulunamadı: "${dbPath}". Uygulama eksik bir ` +
        "veritabanını sessizce oluşturmaz. Mevcut bir kurulumsa " +
        "DOLMUS_DB_PATH'in mevcut veritabanı dosyasını gösterdiğini denetleyin " +
        "(yeni bir boş veritabanı OLUŞTURMAYIN). Yalnız ilk kurulumsa açık " +
        "kurulum komutunu (`node scripts/db-init.ts`) çalıştırın.",
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
 * Sürüm kapısı — better-sqlite3'ün gömülü SQLite'ı bu sürümden eski
 * olamaz (resmî WAL-reset düzeltmesi). K9 bu eşiği `better-sqlite3@13.0.3`
 * (gömülü SQLite 3.53.4) ile kanıtladı.
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
        `sürüm: "${minimumVersion}"). WAL-reset ` +
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
 * Ham better-sqlite3 bağlantısını açar; zorunlu PRAGMA'ları uygular ve
 * SQLite sürüm kapısını denetler. `:memory:` desteklenmez: mali/DB
 * testleri gerçek geçici dosya kullanmalıdır (finansal DB testleri yalnız
 * mock veya :memory: üzerinde kabul edilmez).
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
 * Şemalı Drizzle istemcisi (`./schema.ts` tabloları).
 */
export function createDb(sqlite: SqliteConnection) {
  return drizzle<Schema>(sqlite, { schema });
}

/**
 * `createDb`'nin döndürdüğü GERÇEK tip — T1.4 ADIM 2/2, S1.4. Açık dönüş
 * tipi OLMAYAN `createDb`'nin çıkarımı, `drizzle-orm/better-sqlite3`
 * `drizzle(client)` aşırı yüklemesinin `& { $client: Database }` ekini
 * KORUR (bkz. `node_modules/drizzle-orm/better-sqlite3/driver.d.ts`); oysa
 * `getAppDb(): BetterSQLite3Database<Schema>` gibi AÇIKÇA yazılmış dönüş
 * tipleri bu eki yapısal olarak DAR bir tipe (`$client` OLMADAN) keser.
 *
 * `../usecases/access/*` (T1.4 iş adımı 2 — "hepsi ilgili revoke ile aynı
 * BEGIN IMMEDIATE transaction'ında") bu eke ihtiyaç duyar: Drizzle'ın
 * kendi `db.transaction(fn, { behavior: "immediate" })` sarmalayıcısı HER
 * sorguyu `async execute()` (bkz. `node_modules/drizzle-orm/sqlite-core/
 * query-builders/update.js`) üzerinden çalıştırdığından, better-sqlite3'ün
 * "transaction fonksiyonu senkron olmalı, promise DÖNEMEZ" kısıtına
 * (`node_modules/better-sqlite3/lib/methods/transaction.js`) çarpar. Bu
 * yüzden o kullanım durumları HAM `withImmediateTransaction(sqlite, fn)` +
 * Drizzle'ın SENKRON `.run()/.all()` metotlarını (aynı builder'ların
 * `execute()` DIŞINDAKİ üyeleri) kullanır; ham bağlantıya erişim için bu
 * tipe (`AppDatabase`) ihtiyaç vardır.
 */
export type AppDatabase = ReturnType<typeof createDb>;

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
        "migration'ı otomatik ÇALIŞTIRMAZ. Mevcut " +
        "veritabanı için sunucuda `node scripts/db-init.ts --existing` " +
        "çalıştırın.",
    );
    this.name = "PendingMigrationsError";
  }
}

/**
 * Var olan dosyada HİÇ uygulanmış migration yoksa (boş/yabancı dosya, ya da
 * `__drizzle_migrations` tablosu var ama satırsız) fırlatılır. Bu, "bekleyen
 * migration" (`PendingMigrationsError`) durumundan ayrıdır: burada ilk şema
 * kurulumu önerilmemelidir — dosya yanlış yola işaret ediyor olabilir ve
 * mevcut bir kurulumun verisi üzerine ilk şema kurulumu çalıştırılmamalıdır.
 */
export class UninitializedDatabaseError extends Error {
  constructor(dbPath: string) {
    super(
      `Veritabanı dosyası "${dbPath}" var ama hiç migration uygulanmamış ` +
        "(boş veya başlatılmamış). Mevcut bir kurulumda DOLMUS_DB_PATH'in " +
        "doğru dosyayı gösterdiğini denetleyin ve ilk şema kurulumunu " +
        "(`node scripts/db-init.ts`) mevcut bir kurulumun üzerinde " +
        "ÇALIŞTIRMAYIN. Yalnız gerçekten yeni bir kurulumsa çalıştırın.",
    );
    this.name = "UninitializedDatabaseError";
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

  if (appliedHashes.size === 0) {
    throw new UninitializedDatabaseError(sqlite.name);
  }

  const pendingCount = migrations.filter(
    (migration) => !appliedHashes.has(migration.hash),
  ).length;

  if (pendingCount > 0) {
    throw new PendingMigrationsError(pendingCount);
  }
}

/**
 * Yazma transaction'ları için seçilen BEGIN IMMEDIATE davranışını
 * uygulayan yardımcı.
 * Kısa yazma transaction'ları (kayıt + revizyon + makbuz birlikte) bu
 * yardımcı üzerinden çalıştırılmalıdır. Henüz mali kullanım yoktur; bu
 * adımda yalnız mekanizma hazırlanır ve gerçek bir SQLite dosyasına karşı
 * test edilir (bkz. `tests/integration/db-connection.test.ts`).
 */
export function withImmediateTransaction<T>(
  sqlite: SqliteConnection,
  fn: () => T,
): T {
  // İç içe çağrı (açık transaction içinde) bir SAVEPOINT'tir, ayrı bir
  // yazma transaction'ı değildir: dış çağrının süresi onu zaten kapsar.
  if (sqlite.inTransaction) {
    return sqlite.transaction(fn).immediate();
  }
  const startedAt = performance.now();
  try {
    return sqlite.transaction(fn).immediate();
  } catch (error) {
    if (extractTransientSqliteLockError(error)) {
      writeTxLockFailures++;
    }
    throw error;
  } finally {
    recordWriteTransactionDuration(performance.now() - startedAt);
  }
}

// ---------------------------------------------------------------------------
// Yazma transaction'ı metrikleri — `../observability/runtime-metrics.ts`
// dakikada bir `takeWriteTransactionStats()` ile okuyup sıfırlar.
//
// Bu modül `scripts/release-build.ts` ile arşive KOPYALANIR ve sunucuda düz
// `node` ile çalışır: sayaçlar bilerek burada, YENİ bir import olmadan
// tutulur (`performance` Node'un global nesnesidir).
// ---------------------------------------------------------------------------

/** p99 için aralık başına saklanan en fazla süre örneği (rezervuar
 * örnekleme — bellek yazma hacminden bağımsız sınırlı kalır). */
export const WRITE_TX_SAMPLE_CAPACITY = 10_000;

let writeTxCount = 0;
let writeTxLockFailures = 0;
let writeTxMaxMs = 0;
let writeTxSamplesMs: number[] = [];

function recordWriteTransactionDuration(durationMs: number): void {
  writeTxCount++;
  if (durationMs > writeTxMaxMs) {
    writeTxMaxMs = durationMs;
  }
  if (writeTxSamplesMs.length < WRITE_TX_SAMPLE_CAPACITY) {
    writeTxSamplesMs.push(durationMs);
    return;
  }
  // Algorithm R: her örnek kapasite/sayı olasılıkla rezervuarda kalır.
  const slot = Math.floor(Math.random() * writeTxCount);
  if (slot < WRITE_TX_SAMPLE_CAPACITY) {
    writeTxSamplesMs[slot] = durationMs;
  }
}

export interface WriteTransactionStats {
  /** Aralıktaki dış yazma transaction'ı sayısı (başarısızlar dahil). */
  count: number;
  /** SQLITE_BUSY/SQLITE_LOCKED ile biten transaction sayısı. */
  lockFailures: number;
  /** Kilit beklemesi (busy_timeout) dahil süre; örnek yoksa `0`. */
  p99Ms: number;
  maxMs: number;
}

/**
 * Son okumadan beri biriken yazma transaction'ı istatistiklerini döner ve
 * sayaçları sıfırlar. Okuma ve sıfırlama aynı senkron adımdadır: arada
 * başka bir transaction kaydı giremez, hiçbir örnek kaybolmaz veya iki kez
 * sayılmaz.
 */
export function takeWriteTransactionStats(): WriteTransactionStats {
  const samples = writeTxSamplesMs;
  const stats: WriteTransactionStats = {
    count: writeTxCount,
    lockFailures: writeTxLockFailures,
    p99Ms: nearestRankPercentile(samples, 0.99),
    maxMs: writeTxMaxMs,
  };
  writeTxCount = 0;
  writeTxLockFailures = 0;
  writeTxMaxMs = 0;
  writeTxSamplesMs = [];
  return stats;
}

/** Nearest-rank yüzdelik; boş dizide `0`. */
function nearestRankPercentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1]!;
}

/**
 * DENETİM BULGUSU (düzeltme turu 2, "high", `guvenlik` merceği) — canlı bir
 * SQLITE_BUSY/SQLITE_LOCKED, `../auth/guard.ts` `requireSession`'ın
 * catch'inden (yalnız `SessionError | PendingMigrationsError |
 * MissingDatabaseFileError | UnsupportedSqliteVersionError` yakalar)
 * SIZIP genel Next.js 500'üne (API hata zarfı OLMADAN)
 * düşüyordu. Kanıt: aynı `DOLMUS_DB_PATH` dosyasına ikinci bir
 * better-sqlite3 bağlantısıyla `BEGIN IMMEDIATE` açılıp kilit
 * `busy_timeout`'tan (`applyPragmas` — 2000 ms) UZUN tutulunca, gerçek
 * `GET /api/v1/session` çağrısı (last_seen_at yazma eşiğini aşan bir
 * oturumla) ham `SqliteError: database is locked (code: SQLITE_BUSY)`
 * ile 500 dönüyordu — bkz. `tests/integration/session-routes.test.ts`
 * "DB kilitli (503, gerçek SQLITE_BUSY)" bloğu.
 *
 * Kural: kilitte sınırsız döngü yoktur — transaction geri alınır ve 503
 * döner; geçici DB kilidi/hazır olmama da 503'tür.
 *
 * Drizzle'ın asenkron `db.select()/db.update()` API'si (resolveSession'ın
 * kullandığı) bu hatayı ÇIPLAK fırlatmaz; `DrizzleQueryError` ile SARAR ve
 * orijinal `SqliteError`'ı `.cause`'a koyar (bkz.
 * `node_modules/drizzle-orm/sqlite-core/session.js` `catch (e) { throw new
 * DrizzleQueryError(queryString, params, e); }`) — bu yüzden hem hatanın
 * KENDİSİ hem `.cause`'u denetlenir.
 *
 * Yalnız GEÇİCİ kilit kodları (`SQLITE_BUSY`/`SQLITE_LOCKED`) yakalanır;
 * başka bir `SqliteError` (ör. bir CHECK/UNIQUE kısıt ihlali) BURADAN
 * GEÇMEZ ve kendi anlamlı durumuyla (409/422 vb.) ele alınmalıdır — bir
 * veri bütünlüğü hatasını sessizce "az sonra tekrar dene" 503'üne
 * GİZLEMEK yanlış olurdu.
 */
export function extractTransientSqliteLockError(
  error: unknown,
): InstanceType<typeof Database.SqliteError> | undefined {
  const isLockError = (
    candidate: unknown,
  ): candidate is InstanceType<typeof Database.SqliteError> =>
    candidate instanceof Database.SqliteError &&
    (candidate.code === "SQLITE_BUSY" || candidate.code === "SQLITE_LOCKED");

  if (isLockError(error)) {
    return error;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  return isLockError(cause) ? cause : undefined;
}
