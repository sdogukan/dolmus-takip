/**
 * Uygulama (istek sunma) DB tekil bağlantısı — T1.4 ADIM 1/2, S1.4.
 *
 * Görev tanımı: "İlk DB tüketen kod bu pakette geldiği için
 * assertMigrationsApplied'ı uygulama açılış yoluna (instrumentation.ts
 * register veya db singleton ilk açılışı) bağla: migration bekliyorsa
 * açıklı hata, otomatik migration yok." Bu modül o "db singleton"dır;
 * `../../instrumentation.ts` `register()` onu EAGER (sunucu ayağa
 * kalkarken) açar, herhangi bir route handler onu LAZY (ilk istekte, ör.
 * Vitest'in route modülünü doğrudan çağırdığı testlerde — orada
 * `register()` hiç çalışmaz) açabilir; ikisi de aynı önbelleğe düşer.
 *
 * `openDatabaseConnection`/`assertMigrationsApplied` (bkz. `./db.ts`)
 * burada YENİDEN YAZILMAZ, yalnız BİR KEZ (süreç başına) çağrılıp
 * sonucu önbelleğe alınır.
 */
import path from "node:path";
import {
  assertMigrationsApplied,
  createDb,
  openDatabaseConnection,
  resolveDbPathFromEnv,
  type AppDatabase,
  type SqliteConnection,
} from "./db";

/**
 * `process.cwd()` temelli — Next.js "standalone" üretim çıktısı `node
 * server.js` ile kendi kök dizininden çalıştırılır (bu yüzden dizin,
 * derlenmiş dosyanın KENDİ konumuna değil, ÇALIŞMA dizinine göre
 * hesaplanır; `import.meta.url` tabanlı bir hesap, bundler'ın çıktı
 * dosyasını nereye taşıdığına bağlı kalırdı). `next.config.ts`
 * `outputFileTracingIncludes` bu paketle birlikte `drizzle/**` klasörünü
 * de standalone çıktısına dahil eder (bkz. o dosyadaki not) — aksi halde
 * bu yol üretimde var olmayan bir klasörü gösterirdi.
 */
function defaultMigrationsFolder(): string {
  return path.join(process.cwd(), "drizzle");
}

interface CachedAppDb {
  sqlite: SqliteConnection;
  db: AppDatabase;
}

let cached: CachedAppDb | null = null;

function openAppDb(): CachedAppDb {
  const dbPath = resolveDbPathFromEnv();
  const sqlite = openDatabaseConnection(dbPath);
  try {
    assertMigrationsApplied(sqlite, defaultMigrationsFolder());
  } catch (error) {
    sqlite.close();
    throw error;
  }
  return { sqlite, db: createDb(sqlite) };
}

/**
 * İstek sunma yolunun kullanacağı tekil Drizzle istemcisi. İlk çağrıda
 * bağlantıyı açar (ve migration kapısını denetler — `PendingMigrationsError`/
 * `MissingDatabaseFileError`/`UnsupportedSqliteVersionError` burada
 * fırlayabilir, route handler bunu 503'e çevirir); sonraki çağrılar aynı
 * bağlantıyı döner.
 *
 * Dönüş tipi `AppDatabase` (`= ReturnType<typeof createDb>`, `$client`
 * ALANINI İÇEREN geniş tip) — denetim bulgusu (düzeltme turu 1, "medium"):
 * önceki sürüm bunu açıkça `BetterSQLite3Database<Schema>` olarak
 * DARALTIYORDU (`$client` OLMADAN), oysa `../usecases/access/*` (M2'nin
 * gerçek kullanacağı revoke/aktiflik kullanım durumları) `AppDatabase`
 * ister (`db.$client` üzerinden HAM `sqlite.transaction(fn).immediate()`
 * çağırırlar — bkz. `./db.ts` `AppDatabase`/`withImmediateTransaction` üst
 * notu). Gerçek `getAppDb()` çıktısının o kullanım durumlarına
 * derlenebilir şekilde geçilebildiği `tests/integration/app-db-access.test.ts`
 * ile kanıtlanmıştır.
 */
export function getAppDb(): AppDatabase {
  cached ??= openAppDb();
  return cached.db;
}

/**
 * Yalnız testler içindir: `DOLMUS_DB_PATH` her testte farklı bir geçici
 * dosyayı gösterdiğinden, önbelleğe alınmış tekil bağlantı testler arası
 * paylaşılamaz. Testler her `beforeEach`/`afterEach`'te bunu çağırıp eski
 * bağlantıyı kapatır; bir sonraki `getAppDb()` güncel `DOLMUS_DB_PATH`
 * ile yeniden açar. Üretim kodu bunu ÇAĞIRMAZ.
 */
export function resetAppDbForTests(): void {
  if (cached) {
    cached.sqlite.close();
    cached = null;
  }
}
