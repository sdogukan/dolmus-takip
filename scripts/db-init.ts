/**
 * DB kurulum komutu — `npm run db:init` (ADIM 2/3, S1.1).
 *
 * Kaynak: ARCHITECTURE.md §8.1 — "Uygulama DB dosyası bulunamazsa sessizce
 * boş DB oluşturarak başlamaz. İlk şema kurulumuna yalnız açık migration/
 * kurulum komutu izin verir." Bu komut o "açık" kurulum yoludur: `DOLMUS_
 * DB_PATH` dizinini (yoksa) oluşturur, ARCHITECTURE.md §3.6 PRAGMA'larını
 * uygulayan `openDatabaseConnection(..., { createIfMissing: true })` ile
 * dosyayı açar, ardından `./schema.ts`'ten üretilmiş `./drizzle/*.sql`
 * migration'larını `drizzle-orm/better-sqlite3/migrator` ile uygular.
 *
 * Tekrar çalıştırma tanımları çoğaltmaz: `migrate()`, uyguladığı her
 * migration'ı `__drizzle_migrations` tablosuna (hash + klasör zaman damgası)
 * yazar ve yalnız daha yeni migration'ları çalıştırır (`node_modules/
 * drizzle-orm/sqlite-core/dialect.js` `SQLiteSyncDialect.migrate` —
 * ADIM 2 sırasında `SELECT id, hash, created_at ... ORDER BY created_at
 * DESC LIMIT 1` + `folderMillis` karşılaştırmasıyla doğrulandı). Bu script
 * ayrıca öncesi/sonrası satır sayısını karşılaştırıp "N yeni migration"
 * veya "zaten güncel" bilgisini yazdırır; STORIES.md S1.1 kabul kriteri
 * ("mevcut veride migration yeniden çalıştırıldığında tanımlar çoğalmaz")
 * bu davranışa dayanır ve `tests/integration/schema.test.ts` içinde gerçek
 * bir geçici dosyayla ayrıca doğrulanır.
 *
 * Çalıştırma: `.env`'den `DOLMUS_DB_PATH` okunması için `npm run db:init`
 * scripti `node --env-file-if-exists=.env scripts/db-init.ts` çağırır
 * (Node ≥20.6 yerleşik `--env-file-if-exists`; `.env` yoksa sessizce atlar,
 * hata vermez — `.env` opsiyoneldir, değişken kabuktan da gelebilir).
 *
 * Bu script doğrudan `node` ile (Next.js/Vitest bundler'ı OLMADAN) çalışır
 * ve `import`/`export` kullanır. Paket kökünde `"type": "module"` yok
 * (Next.js'in geri kalanının CJS varsayımını değiştirmemek için); onun
 * yerine yalnız `./package.json` (bu klasöre özel, `"type": "module"`)
 * Node'a bu script'i kesin ESM olarak yorumlatır — aksi halde Node yine de
 * `import` sözdizimini algılayıp ESM'e geçer, ama her çalıştırmada bir
 * performans uyarısı basar; bu dosya bazlı `package.json` o uyarıyı da
 * ortadan kaldırır. Komşu `.ts` dosyalarına yapılan importlarda uzantının
 * neden açık yazıldığı için bkz. `../src/server/data/db.ts` üstündeki not
 * ve `../src/server/data/package.json` (aynı desen).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  createDb,
  openDatabaseConnection,
  resolveDbPathFromEnv,
  type SqliteConnection,
} from "../src/server/data/db.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const migrationsFolder = path.join(projectRoot, "drizzle");

/**
 * `migrate()` çağrısından önce/sonra `__drizzle_migrations` satır sayısını
 * okur; tablo henüz yoksa (ilk kurulum) 0 döner. Yalnız bilgilendirme
 * amaçlıdır — idempotency'nin kendisi `migrate()`'in journal karşılaştırması
 * tarafından sağlanır.
 */
function countAppliedMigrations(sqlite: SqliteConnection): number {
  const tableExists = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  if (!tableExists) {
    return 0;
  }
  const row = sqlite
    .prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations")
    .get() as { count: number };
  return row.count;
}

function main(): void {
  const dbPath = resolveDbPathFromEnv();
  console.log(`[db:init] Veritabanı: "${dbPath}"`);
  console.log(`[db:init] Migration klasörü: "${migrationsFolder}"`);

  const sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
  try {
    const before = countAppliedMigrations(sqlite);
    const db = createDb(sqlite);
    migrate(db, { migrationsFolder });
    const after = countAppliedMigrations(sqlite);
    const applied = after - before;

    if (applied > 0) {
      console.log(
        `[db:init] ${applied} yeni migration uygulandı (toplam ${after}).`,
      );
    } else {
      console.log(`[db:init] Şema zaten güncel (${after} migration).`);
    }
  } finally {
    sqlite.close();
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[db:init] Kurulum başarısız: ${message}`);
  process.exitCode = 1;
}
