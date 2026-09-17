/**
 * E2E test veritabanı hazırlığı — T1.2 ADIM 2/2, S1.2, görev tanımı (3);
 * T1.2 EK DÜZELTME ile webServer artık gerçek standalone sunucuyu
 * (`node .next/standalone/server.js`) çalıştırır (bkz. `../../playwright.
 * config.ts` üst notu) — bu dosyanın SORUMLULUĞU/SIRALAMA GEREKÇESİ
 * DEĞİŞMEDİ, yalnız zincirlendiği komut güncellendi.
 *
 * ## Neden Playwright'ın KENDİ `globalSetup` config alanına BAĞLANMADI
 * (kanıta dayalı mühendislik kararı — CLAUDE.md "asla varsayımda bulunma")
 *
 * Bu dosya `playwright.config.ts`'nin `globalSetup` alanına VERİLMEDİ;
 * bunun yerine `webServer.command`'ın BİRİNCİ adımı olarak zincirlenir
 * (`NODE_ENV=test node tests/e2e/global-setup.ts && node .next/standalone/
 * server.js`). Gerekçe — Playwright Test'in KENDİ kaynağı (`node_modules/
 * playwright/lib/runner/index.js` `createGlobalSetupTasks`) `webServer`'ı
 * bir "plugin" olarak, kullanıcının `globalSetup` dosyasından ÖNCE listeler:
 *
 *   [removeOutputDirs, ...pluginSetupTasks (webServer BURADA), ...
 *    globalTeardowns, ...globalSetups (kullanıcı dosyası BURADA)]
 *
 * TaskRunner bu diziyi SIRAYLA (`setup()`) çalıştırır — yani `webServer`
 * süreci, kullanıcının `globalSetup` dosyası HİÇ çalışmadan ÖNCE
 * başlatılır ve hazır (URL 2xx/3xx) olana kadar beklenir. Bu, KANITLANDI:
 * izole bir Playwright projesinde (webServer = basit bir HTTP sunucusu,
 * globalSetup = bir log satırı yazan gecikmeli fonksiyon) gerçek
 * çalıştırma çıktısı ŞÖYLEdir (zaman damgalı log, artan sırayla):
 *   1. server-process-start
 *   2. server-listening
 *   3. global-setup-start
 *   4. global-setup-end
 *   5. test-start
 *
 * Yani `globalSetup`'a bağlansaydık, bu dosyanın DB'yi oluşturması sunucu
 * ZATEN başlamış OLDUKTAN SONRA gerçekleşirdi — ama uygulama açılışı
 * (`../../src/instrumentation.ts` `register()`) DB'yi EAGER açar
 * (`getAppDb()`) ve dosya/migration eksikse HEMEN fırlatıp süreci
 * ÇÖKERTİR (bkz. o dosyanın üst notu). Sonuç: sunucu süreci DB henüz
 * yokken çöker, Playwright'ın URL-hazır bekleyişi asla karşılanmaz ve
 * `webServer` zaman aşımıyla başarısız olur.
 *
 * Bu yüzden DB hazırlığı sunucunun KENDİSİNDEN ÖNCE, AYNI shell
 * komutunun (`webServer.command`) İLK adımı olarak çalıştırılır — bu,
 * ordering garantisini Playwright'ın plugin/globalSetup sırasına
 * BAĞIMLI KILMADAN sağlar. Dosya adı/sorumluluğu görev tanımıyla
 * BİREBİR aynıdır ("ayrı geçici test DB'si oluştur, db:init + seed");
 * yalnız Playwright'a NASIL BAĞLANDIĞI (config alanı yerine `webServer.
 * command` zinciri) bu kanıta göre düzeltilmiştir.
 *
 * ## Yaptığı iş
 *
 * `../../scripts/db-init.ts` (migration) + `../../scripts/db-seed-dev.ts`
 * (`seedDevData` — QA-PLAN.md §2 "Ortak veri seti") ile AYNI, zaten VAR
 * OLAN mantığı çağırır; hiçbir SQL/seed kuralı BURADA TEKRARLANMAZ
 * (CLAUDE.md "var olan modülleri yeniden yazma; genişlet"). Tek fark:
 * `DOLMUS_DB_PATH` (bu betiği çalıştıran `webServer.command`'ın `env`'i
 * — `../../playwright.config.ts`) HER ÇALIŞTIRMADA silinip yeniden
 * oluşturulur ("ayrı geçici test DB'si" — E2E koşusu, geliştirmecinin
 * gerçek `./data/dev.sqlite`'ına ASLA dokunmaz; dosya yolu `os.tmpdir()`
 * altındadır, bkz. `../../playwright.config.ts`).
 *
 * Bağımsız çalıştırılabilir Node betiğidir (`scripts/db-seed-dev.ts`
 * "isDirectRun" deseniyle AYNI ESM/uzantı kuralları — bkz. o dosyanın üst
 * notu ve `./package.json` [`"type": "module"`]).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  createDb,
  openDatabaseConnection,
  resolveDbPathFromEnv,
} from "../../src/server/data/db.ts";
import { seedDevData } from "../../scripts/db-seed-dev.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const migrationsFolder = path.join(projectRoot, "drizzle");

/** `fs.rmSync`'in "ENOENT ise sorun değil" biçimi — WAL/SHM/journal yan
 * dosyaları çoğu zaman YOKTUR (önceki koşu düzgün kapanmışsa); bu normal
 * bir durumdur, hataya ÇEVRİLMEZ. */
function removeIfExists(filePath: string): void {
  try {
    fs.rmSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function main(): Promise<void> {
  const dbPath = resolveDbPathFromEnv();
  console.log(`[e2e:global-setup] Test veritabanı: "${dbPath}"`);

  // "Ayrı geçici test DB'si" — her E2E koşusu TEMİZ bir dosyayla başlar;
  // önceki koşudan kalan WAL/SHM/journal yan dosyaları da silinir (better-
  // sqlite3 `journal_mode = WAL` kullanır, bkz. `../../src/server/data/
  // db.ts` `applyPragmas`).
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    removeIfExists(`${dbPath}${suffix}`);
  }

  const sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
  try {
    // `scripts/db-init.ts` ile AYNI migration çağrısı.
    migrate(createDb(sqlite), { migrationsFolder });

    // `scripts/db-seed-dev.ts` `seedDevData` ile AYNI seed — QA-PLAN.md §2
    // "Ortak veri seti" (İşletme A/B, araçlar, iki rol credential'ı, ekip
    // hesapları). `runSeed()` (CLI sarmalayıcısı) DEĞİL doğrudan
    // `seedDevData(sqlite)` çağrılır: `runSeed` kendi `openDatabaseConnection`
    // çağrısını yapar (bağlantıyı BURADA zaten açtık, ikinci bir bağlantıya
    // gerek yok) ve `NODE_ENV=production` denetimi (`assertSeedAllowedInEnv`)
    // yalnız CLI girişi içindir — E2E ortamı zaten `NODE_ENV=test` ile
    // çalışır (`../../playwright.config.ts`), bu denetim BURADA anlamsızdır.
    const counts = await seedDevData(sqlite);
    console.log(
      `[e2e:global-setup] Test verisi hazır: ${counts.businesses} işletme, ` +
        `${counts.vehicles} araç, ${counts.vehicleCredentials} araç girişi, ` +
        `${counts.platformUsers} ekip hesabı.`,
    );
  } finally {
    sqlite.close();
  }
}

main().catch((error: unknown) => {
  console.error("[e2e:global-setup] Hazırlık başarısız:", error);
  process.exitCode = 1;
});
