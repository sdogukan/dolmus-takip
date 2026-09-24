import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright uçtan uca test yapılandırması — T1.2 ADIM 2/2 + T1.2 EK
 * DÜZELTME (S1.2, docs/DECISIONS.md "T1.2 uygulama kararları").
 *
 * QA-PLAN.md §1 — "Uçtan uca | Playwright ...; gerçek Node backend ve
 * üretim derlemesi | Giriş → kayıt → teslim → düzeltme → rapor; gerçek
 * HTTP, cookie, oturum ve test DB'si." Tarayıcı projesi yalnız Chromium'dur
 * — WebKit 2026-09-24 kullanıcı kararıyla kaldırıldı (docs/DECISIONS.md
 * "E2E yalnız Chromium"). Bu ADIM yalnız GİRİŞ
 * zincirini (`./tests/e2e/vehicle-login.spec.ts`) kapsar; sonraki E2/E3+
 * paketleri aynı altyapıyı genişletir.
 *
 * ## Gerçek standalone sunucu (`node .next/standalone/server.js`)
 *
 * `next.config.ts` `output: "standalone"` ayarlıyor (DECISIONS.md F4).
 * `next start` bununla ÇALIŞMAZ (Next'in kendi uyarısı: "next start does
 * not work with output: standalone configuration. Use node .next/
 * standalone/server.js instead") — bu yüzden webServer artık standalone
 * çıktısını doğrudan çalıştırır. Bu, F4'ün asıl kaygısını (native modül/
 * `drizzle/**` paketleme bütünlüğü) de GERÇEKTEN doğrular; önceki sürümün
 * `next start` ile bıraktığı kapsam boşluğu (bkz. git geçmişi) artık YOK.
 * `.next/static` + `public` klasörleri standalone'a `../scripts/
 * prepare-standalone.ts` (Next'in KENDİ belgesindeki `cp -r` adımlarının
 * karşılığı — bkz. o script'in üst notu) ile kopyalanır; bu script
 * `package.json` `test:e2e`'de `next build`'den SONRA, `playwright test`'ten
 * ÖNCE çalışır (T6.1 üretim yayını da AYNI script'i kullanacak).
 *
 * Standalone'un KENDİ `server.js`'i koşulsuz `process.env.NODE_ENV =
 * 'production'` ile başlar (Next'in ÜRETTİĞİ dosya, kaynağı ne olursa
 * olsun) — bu artık bir SORUN DEĞİL: `../src/server/auth/cookie.ts`
 * `isSecureCookieOrigin` Secure bayrağını NODE_ENV'den DEĞİL, `APP_ORIGIN`
 * şemasından türetir (T1.2 ek düzeltme). Bu E2E paketi `APP_ORIGIN=http://
 * 127.0.0.1:<port>` (düz HTTP, gerçek TLS/Caddy kapsam dışı) kullandığından
 * Secure bayrağı EKLENMEZ ve tarayıcı çerezi normal şekilde saklar; NODE_ENV
 * production olsun ya da olmasın SONUÇ DEĞİŞMEZ.
 *
 * `NODE_ENV=test` yalnız `webServer.command`'ın İLK adımına (`tests/e2e/
 * global-setup.ts`) inline uygulanır — `../scripts/db-seed-dev.ts`
 * `assertSeedAllowedInEnv` tohumlamayı yalnız `NODE_ENV === "production"`
 * iken reddeder; ikinci adım (`node .next/standalone/server.js`) kendi
 * `NODE_ENV=production`'ıyla çalışır (yukarıdaki paragraf).
 *
 * ## `tests/e2e/global-setup.ts` NEDEN `globalSetup` config alanına
 * DEĞİL, `webServer.command`'a bağlı (kanıta dayalı, kaçınılmaz sıralama
 * kısıtı)
 *
 * Bkz. `./tests/e2e/global-setup.ts` dosya üstü notu — Playwright'ın
 * KENDİ kaynağı ve GERÇEK bir izole koşuyla KANITLANDI: `webServer` süreci
 * kullanıcının `globalSetup` dosyası HİÇ çalışmadan ÖNCE başlar. Bu yüzden
 * DB hazırlığı standalone sunucudan ÖNCE, AYNI `webServer.command`
 * zincirinin İLK adımı olarak çalıştırılır — yoksa sunucu (uygulama
 * açılışında DB'yi EAGER açan `../src/instrumentation.ts` `register()`
 * yüzünden) DB dosyası/migration henüz yokken ÇÖKER ve Playwright'ın
 * URL-hazır bekleyişi zaman aşımına uğrar.
 */

/** ARCHITECTURE.md §2 — "Next.js uygulaması ... Yalnız 127.0.0.1:3000."
 * Geliştiricinin `npm run dev`'i (varsayılan 3000) ile ÇAKIŞMAMASI için
 * E2E ayrı bir portta (3100) çalışır; `127.0.0.1` (KASITLI OLARAK
 * "localhost" DEĞİL) kullanılır çünkü `APP_ORIGIN`'in "aynı kaynak"
 * denetimi (`../src/server/auth/app-origin.ts`) tarayıcının GERÇEKTEN
 * gönderdiği `Origin` header'ıyla BİREBİR karakter eşleşmesi ister —
 * tarayıcılar "localhost" ile "127.0.0.1"i FARKLI origin sayar. */
const E2E_PORT = 3100;
const E2E_APP_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;

/** "Ayrı geçici test DB'si" — `os.tmpdir()` altında, geliştiricinin
 * gerçek `./data/dev.sqlite`'ından (DECISIONS.md/`.env.example`)
 * TAMAMEN AYRI bir dosya. `./tests/e2e/global-setup.ts` her koşuda bu
 * dosyayı silip yeniden oluşturur (fresh state). */
const E2E_DB_PATH = path.join(os.tmpdir(), "dolmus-takip-e2e", "test.sqlite");

/**
 * T1.6 ADIM 2/2, S1.6, görev tanımı (2) — "askının kök nedenini araştır:
 * bir test başarısız olduğunda Playwright'ın neden 30 sn'de kesmediğini
 * bul ve düzelt." Bu üst not KANITA DAYALI bulguyu özetler (CLAUDE.md
 * "asla varsayımda bulunma") — kaynak `node_modules/playwright/types/
 * test.d.ts`'in KENDİ belgesi, DOĞRUDAN alıntılanmıştır:
 *
 * 1. `use.actionTimeout` — "Default timeout for each Playwright action
 *    ... defaults to 0 (no timeout)." `use.navigationTimeout` — "Timeout
 *    for each navigation action ... Defaults to 0 (no timeout)." Bu iki
 *    alan önceki sürümde HİÇ VERİLMEMİŞTİ; yani `page.click()`,
 *    `page.waitForURL()` gibi TEK bir eylem/navigasyon, KENDİ başına
 *    SINIRSIZ bekleyebiliyordu — yalnız (yine BELİRTİLMEMİŞ, dolayısıyla
 *    Playwright'ın kendi varsayılanı olan ~30000 ms'lik) test-düzeyi
 *    zaman aşımına bağımlı kalıyordu.
 * 2. Üst düzey `globalTimeout` HİÇ VERİLMEMİŞTİ (varsayılan: sınırsız —
 *    `testConfig.globalTimeout` belgesi: "Use ... to change this option
 *    for all projects" örneği `undefined` bırakılabileceğini gösterir).
 *    Bu yüzden tek bir test 30 sn'de kesilse BİLE, KOŞUNUN TAMAMINI
 *    durduran bir tavan YOKTU: `retries: process.env.CI ? 2 : 0` ile CI'da
 *    HER başarısız test 3 kez (1 asıl + 2 tekrar) denenir; tarayıcı
 *    projesi sayısı ve `workers: 1` (seri çalıştırma) ile
 *    çarpıldığında, sistemik bir arıza (ör. `reuseExistingServer` yerelde
 *    ESKİ/BOZUK bir sunucuyu "hazır" sayması — sağlık ucu DB'ye hiç
 *    dokunmadığından bunu ayırt EDEMEZ) TÜM testleri başarısız/askıda
 *    bırakırsa toplam süre `test sayısı × deneme × ~30 sn` şeklinde
 *    ÖNGÖRÜLEMEZ biçimde büyür — görev tanımının bahsettiği "27 dakika"
 *    büyüklük mertebesi (ör. ~30 test × 3 deneme × ~30 sn ≈ 45 dk'ya kadar
 *    çıkabilen bir aralık) bu ikinci boşlukla TUTARLIDIR.
 * 3. `webServer.stdout` varsayılanı `"ignore"`dır (aynı dosya, `Default
 *    to "ignore"`) — önceki koşuda sunucunun KENDİ hata/çökme çıktısı
 *    HİÇ GÖRÜNMÜYORDU; bu, o "27 dakika"lık koşunun GERÇEK anlık nedenini
 *    (ör. sunucu tarafında donan bir istek) SONRADAN TEŞHİS ETMEYİ
 *    engelleyen, ayrı ama ilişkili bir boşluktur.
 *
 * DÜZELTME (bu paketin görev tanımının verdiği BİREBİR sayılar):
 * `globalTimeout` 15 dk (KOŞUNUN TAMAMI için AŞILAMAZ bir tavan — yukarıdaki
 * 2. madde artık YAPISAL OLARAK imkânsız), açık `timeout: 30_000` (test
 * başına — önceki ÖRTÜK varsayılanla AYNI DEĞER, ama artık KASITLI ve
 * okunur), `expect.timeout: 5_000` (Playwright'ın zaten ÖRTÜK varsayılanı
 * — açıkça yazılır), `use.actionTimeout: 15_000` / `use.
 * navigationTimeout: 30_000` (yukarıdaki 1. madde artık KAPALI — TEK bir
 * eylem/navigasyon artık KENDİ İÇİNDE de sınırlı, test'in geri kalanını
 * beklemeden net bir `TimeoutError`la başarısız olur) ve
 * `webServer.stdout`/`stderr: "pipe"` (yukarıdaki 3. madde KAPALI —
 * sunucunun kendi çıktısı artık HTML raporunda/`--reporter=list`
 * çıktısında GÖRÜNÜR). "askıda kalma" artık HER seviyede (eylem →
 * test → koşu) sınırlıdır; hata durumunda koşu HER ZAMAN sonlanır.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Yukarıdaki üst not, madde 2 — koşunun TAMAMI için aşılamaz tavan.
  globalTimeout: 15 * 60 * 1000,
  // Yukarıdaki üst not — Playwright'ın ÖRTÜK varsayılanıyla AYNI değer,
  // artık KASITLI/görünür (test başına zaman aşımı).
  timeout: 30_000,
  expect: {
    // Playwright'ın ÖRTÜK varsayılanıyla AYNI değer, artık KASITLI/görünür.
    timeout: 5_000,
  },
  // Tek paylaşılan arka uç süreci (`webServer`) ve bellek içi, TEK
  // süreçlik hız sınırı/hash kuyruğu durumu (`../src/server/auth/
  // rate-limit.ts`, `../src/server/auth/hash-queue.ts` — ARCH §2 "İlk
  // sürümde tek Node uygulama süreci") paylaşılır; testler arası
  // öngörülemez etkileşimi (ör. bir testin başarısız girişinin başka bir
  // testin hız sınırı sayacını etkilemesi) önlemek için bu ilk E2E
  // paketinde paralel çalıştırma KAPALI tutulur. Spec sayısı arttıkça
  // (T1.6+) bu karar yeniden değerlendirilebilir.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: E2E_APP_ORIGIN,
    trace: "on-first-retry",
    // Dosya üstü not, madde 1 — önceki sürümde İKİSİ de VERİLMEMİŞTİ
    // (Playwright varsayılanı: 0 = sınırsız). Artık TEK bir eylem/
    // navigasyon KENDİ İÇİNDE sınırlı; test'in geri kalan 30 sn'lik
    // tavanını TÜKETMEDEN net bir `TimeoutError`la başarısız olur.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    // Sıra KASITLIDIR (dosya üstü not): DB hazır OLMADAN standalone sunucu
    // ASLA başlamaz — `&&` ile zincirlenir, aynı shell içinde. `NODE_ENV=
    // test` yalnız global-setup'a inline uygulanır (dosya üstü not);
    // standalone `server.js` kendi `NODE_ENV=production`'ıyla çalışır —
    // `env` altında AYRICA NODE_ENV VERİLMEZ (standalone'un kendi ataması
    // zaten geçersiz kılar, karışıklığı önlemek için burada tekrarlanmaz).
    command: `NODE_ENV=test node tests/e2e/global-setup.ts && node .next/standalone/server.js`,
    // ARCHITECTURE.md §8.2 / bu dosyanın health/live rotası — DB'ye HİÇ
    // dokunmaz (yalnız sürecin ayakta olduğunu doğrular); bu yüzden "DB
    // hazır mı" değil "süreç gerçekten dinliyor mu" sorusuna net bir
    // 200 ile cevap verir (kök `/` bir redirect [307] üretir, bu da
    // Playwright'ın kabul ettiği kodlardan biridir ama health/live daha
    // az "örtük" bir sinyaldir).
    url: `${E2E_APP_ORIGIN}/api/v1/health/live`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Dosya üstü not, madde 3 — Playwright'ın ÖRTÜK varsayılanı `stdout:
    // "ignore"`dır; bu, sunucu tarafında oluşan bir çökme/donma/hata
    // çıktısını GÖRÜNMEZ kılar. İkisi de artık AÇIKÇA "pipe" (loglansın) —
    // gizli değer (parola/token/hash) bu çıktıya HİÇ YAZILMAZ (uygulama
    // kodu zaten bunları loglamaz), yalnız süreç stdout/stderr'i.
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DOLMUS_DB_PATH: E2E_DB_PATH,
      APP_ORIGIN: E2E_APP_ORIGIN,
      PORT: String(E2E_PORT),
      // Next'in standalone `server.js`'i `HOSTNAME`'i (`../src/server/
      // auth/app-origin.ts` üst notundaki next/dist/build/utils.js kanıtı)
      // dinleme adresi için kullanır; ARCHITECTURE §2 üretim topolojisiyle
      // (Caddy arkasında yalnız 127.0.0.1) AYNI değer burada da kullanılır.
      // TRUSTED_PROXY BİLEREK tanımsız bırakılır (görev tanımı) — bu E2E
      // paketi bir ters vekil ARKASINDA koşmaz.
      HOSTNAME: "127.0.0.1",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
