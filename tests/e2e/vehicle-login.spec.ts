import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  SEED_RAW_PLATES,
  SEED_TEST_PASSWORDS,
} from "../../scripts/db-seed-dev";

/**
 * Araç girişi uçtan uca testleri (Chromium) — T1.2 ADIM 2/2,
 * S1.2, görev tanımı (3).
 *
 * Gerçek Node arka ucu (`../../playwright.config.ts` `webServer` — gerçek
 * standalone çıktısı `node .next/standalone/server.js`), gerçek HTTP/
 * cookie/oturum ve
 * `../../tests/e2e/global-setup.ts`'in hazırladığı AYRI geçici test DB'si
 * kullanılır (mock YOK). Test verisi `../../scripts/db-seed-dev.ts`
 * `seedDevData`'nın tek kaynağıdır — plaka/şifre burada TEKRAR
 * YAZILMAZ, doğrudan `SEED_RAW_PLATES`/`SEED_TEST_PASSWORDS` içe
 * aktarılır. `İşletme A`'nın birinci aracı (`vehicleA1`,
 * "34 AAA 001") hem owner hem driver credential'ı taşır (bkz. o
 * dosyanın "Üretilen veri" bölümü).
 *
 * S1.2 kabul kriterleri ile eşleme (`ac_coverage`'da tekrar
 * özetlenir):
 * - AC1 (doğru rol alanı açılır, plaka görünür) → "sahip girişi", "şoför
 *   girişi", "şoför şifresiyle /sahip'e gidince /sofor'a yönlenir".
 * - AC4 (bilinmeyen/yanlış → aynı genel mesaj, form silinmez) →
 *   "yanlış şifre".
 * - AC6 (429/bekleme anlaşılır) → birim/entegrasyon testlerinde kanıtlı
 *   (`../../src/server/auth/rate-limit.test.ts`,
 *   `../../tests/integration/vehicle-login-route.test.ts`); burada
 *   yalnız "beklerken düğme" (paralel gönderim yok) E2E ile kanıtlanır.
 * - AC7 (Göster/Gizle) → "Göster/Gizle".
 *
 * `APP_ORIGIN=http://127.0.0.1:<port>` (düz HTTP) olduğundan Set-Cookie
 * `Secure` bayrağı TAŞIMAZ (`../../src/server/auth/cookie.ts`
 * `isSecureCookieOrigin` — APP_ORIGIN şemasına göre, NODE_ENV'den
 * BAĞIMSIZ; bkz. `../../playwright.config.ts` üst notu) ve oturum çerezi
 * burada saklanır/gönderilir; her
 * `test()` KENDİ izole tarayıcı bağlamını (temiz `localStorage`/cookie
 * jar) alır (Playwright varsayılanı) — testler arası oturum SIZMAZ.
 */

const OWNER_PLATE = SEED_RAW_PLATES.vehicleA1;

async function fillLoginForm(page: Page, plate: string, password: string): Promise<void> {
  await page.goto("/giris");
  await page.getByLabel("Plaka").fill(plate);
  await page.getByLabel("Şifre").fill(password);
}

/**
 * Denetim bulgusu, düzeltme turu 1 — "'Göster/Gizle' E2E testi soğuk
 * başlangıçta kararsız (flaky) — hydration beklemeden tıklıyor". KÖK
 * NEDEN (gerçek, izole bir koşuyla KANITLANDI): bir sayfa YÜKLENDİĞİNDE
 * (`page.goto`/tam sayfa yönlendirme) DOM SUNUCUDAN ZATEN görünür/etkin
 * gelir (React sayfayı SUNUCUDA render eder), ama React'in KENDİSİ
 * (`onClick` handler'ları) istemcide HENÜZ hydrate OLMAMIŞ olabilir.
 * Playwright'ın `locator.click()` aktifleşme denetimleri (görünür,
 * kararlı, etkin, tıklamayı ALABİLİR — DOM düzeyinde) bunu YAKALAMAZ;
 * hydration TAMAMLANMADAN yapılan bir tıklama DOM'a ULAŞIR ama React'in
 * handler'ı henüz BAĞLANMADIĞINDAN SESSİZCE hiçbir şey YAPMAZ.
 *
 * Playwright'ın KENDİ `waitForLoadState('networkidle')` belgesi bunu
 * "DISCOURAGED ... rely on web assertions to assess readiness instead"
 * diyerek YASAKLAR (`node_modules/playwright-core/types/types.d.ts`,
 * doğrulandı) — bu yüzden ağ boşta kalma SÜRESİNE (hydration'ın KENDİSİYLE
 * doğrudan İLİŞKİSİZ bir sinyal) güvenmek yerine, "tıkla + hemen ardından
 * YEREL/idempotent bir etkiyi doğrula" çiftini `expect(...).toPass()` ile
 * TEKRARLANABİLİR yapıyoruz.
 *
 * KAPSAM SINIRI (KANITA DAYALI — bu paketin KENDİ E2E koşusuyla
 * DOĞRULANDI): bu yardımcı yalnız AĞ/NAVİGASYON İÇERMEYEN, tamamen
 * idempotent tıklamalar (ör. "Göster/Gizle" — yalnız yerel React state
 * değiştirir) için GÜVENLİDİR. İlk uygulamada bu, "Giriş yap"/"Çıkış"
 * gibi GERÇEK bir HTTP isteği başlatan düğmelere de uygulanmıştı; gerçek
 * bir `npm run test:e2e` koşusu bunun YANLIŞ olduğunu KANITLADI (12/16
 * test BAŞARISIZ oldu): yerel sunucuya giden gerçek istek/yanıt turu
 * (özellikle Argon2 doğrulaması içermeyen/başarısız yollarda) `toBeDisabled`
 * doğrulamasının 500 ms'lik örnekleme penceresinden DAHA HIZLI
 * tamamlanabiliyor — bu yüzden "devre dışı" ara durumu HİÇ
 * YAKALANAMIYORDU (`toPass` sürekli "enabled" görüp YENİDEN tıklamayı
 * DENİYORDU); başarılı girişte ise İLK tıklama zaten GERÇEK bir
 * navigasyon BAŞLATTIĞINDAN, sonraki "yeniden dene" turları artık VAR
 * OLMAYAN bir düğmeyi ARAYIP zaman aşımına takılıyordu. Bu yüzden bu
 * yardımcı BİLEREK yalnız ağ/navigasyon İÇERMEYEN etkileşimlerde
 * kullanılır; "Giriş yap"/"Çıkış" düğmeleri düz `.click()` İLE kalır
 * (S1.2/S1.4 kapsamındaki gerçek E2E koşularının halihazırda 16/16 geçtiği,
 * yalnız Göster/Gizle'nin tek bir izole koşuda kararsız çıktığı — bu
 * paketin denetim bulgusunun KENDİSİ — göz önüne alındığında, KANITLANMAMIŞ
 * bir riski TÜM düğmelere GENİŞLETMEK yerine yalnız KANITLANMIŞ olan
 * noktaya ODAKLANILDI).
 */
async function clickWhenHydrated(
  button: Locator,
  verifySynchronousEffect: () => Promise<void>,
): Promise<void> {
  await expect(async () => {
    await button.click();
    await verifySynchronousEffect();
  }).toPass({ timeout: 15_000 });
}

test.describe("Araç girişi (/giris)", () => {
  test("sahip girişi → /sahip ve plaka görünür", async ({ page }) => {
    await fillLoginForm(page, OWNER_PLATE, SEED_TEST_PASSWORDS.owner);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();

    await page.waitForURL("**/sahip");
    // Ekranın üst başlığı — "35 ABC 123 · ...": plaka görüntü
    // biçiminde (boşluklu) görünür.
    await expect(page.getByText(OWNER_PLATE, { exact: false })).toBeVisible();
    // T5.5 — yer tutucu metin yerine sahip özeti açılır.
    await expect(page.getByRole("heading", { name: "Özet" })).toBeAttached();
    await expect(page.getByRole("link", { name: "+ Çalışma kaydı gir" })).toBeVisible();
    await expect(page.getByText("Sahip girişi başarılı. Özet ve raporlar bir sonraki aşamada")).toHaveCount(0);
  });

  test("şoför girişi → /sofor", async ({ page }) => {
    await fillLoginForm(page, OWNER_PLATE, SEED_TEST_PASSWORDS.driver);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();

    await page.waitForURL("**/sofor");
    await expect(page.getByText(OWNER_PLATE, { exact: false })).toBeVisible();
    // T3.1 — yer tutucu metin yerine günlük kayıt formu açılır.
    await expect(page.getByRole("heading", { name: "Günlük kayıt" })).toBeVisible();
    await expect(page.getByLabel("Kim çalıştı?")).toBeVisible();
    await expect(page.getByText("Günlük kayıt formu bir sonraki aşamada")).toHaveCount(0);
  });

  test("şoför şifresiyle /sahip'e gidince /sofor'a yönlenir", async ({ page }) => {
    // K2 / görev tanımı (2, birebir) — "şoför şifresi /sahip'i AÇMAZ."
    await fillLoginForm(page, OWNER_PLATE, SEED_TEST_PASSWORDS.driver);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/sofor");

    // Aynı (artık sürücü) oturumuyla doğrudan /sahip'e git — sunucu
    // (`../../src/app/sahip/page.tsx`) rol uyuşmazlığında /sofor'a geri
    // yönlendirir; URL'i gizlemek/düğme saklamak DEĞİL, gerçek bir sunucu
    // `redirect()`'idir.
    await page.goto("/sahip");
    await page.waitForURL("**/sofor");
  });

  test("yanlış şifre → 'Plaka veya şifre yanlış.' ve form korunur", async ({ page }) => {
    await fillLoginForm(page, OWNER_PLATE, "yanlis-sifre-xyz");
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();

    // S1.2 AC4 — bilinmeyen plaka/yanlış şifre AYNI genel
    // mesajı verir; hata renk DIŞINDA da (role="alert") bildirilir.
    // `.filter({ hasText })` gerekir: Next.js App Router her sayfaya kendi
    // (bu testte boş kalan) `role="alert"` rota anons `<div>`'ini
    // (`#__next-route-announcer__`) ekler; iki eşleşme arasından metni
    // taşıyanı seçilir (bkz. gerçek Chromium/WebKit koşusuyla KANITLANDI
    // — düzeltme turu, "strict mode violation: resolved to 2 elements").
    const formAlert = page
      .getByRole("alert")
      .filter({ hasText: "Plaka veya şifre yanlış." });
    await expect(formAlert).toHaveText("Plaka veya şifre yanlış.");
    // Görev tanımı (1, birebir) — "form silinmeden (plaka korunur, şifre
    // alanı korunur)".
    await expect(page.getByLabel("Plaka")).toHaveValue(OWNER_PLATE);
    await expect(page.getByLabel("Şifre")).toHaveValue("yanlis-sifre-xyz");
    // Hâlâ /giris'te — başarısız girişte yönlendirme YOK.
    await expect(page).toHaveURL(/\/giris$/);
  });

  test("beklerken düğme 'Giriş yapılıyor…' olur ve devre dışı kalır", async ({ page }) => {
    // Gerçek sunucu yanıtını yapay olarak geciktir (route interception) —
    // "beklerken" durumunu gözlemlemek için gerçek bir gecikme gerekir
    // (yerel ağda POST genelde göz açıp kapayana kadar sürer).
    await page.route("**/api/v1/auth/vehicle-login", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });

    await fillLoginForm(page, OWNER_PLATE, SEED_TEST_PASSWORDS.owner);
    const submitButton = page.getByRole("button", { name: "Giriş yap", exact: true });
    await submitButton.click();

    const pendingButton = page.getByRole("button", { name: "Giriş yapılıyor…", exact: true });
    await expect(pendingButton).toBeVisible();
    await expect(pendingButton).toBeDisabled();

    // Bekleme sırasında ikinci bir tıklama paralel gönderim ÜRETMEZ
    // (`../../src/app/giris/login-form.tsx` `isSubmitting` erken çıkışı) —
    // düğme zaten devre dışı olduğundan gerçek bir tarayıcı bu tıklamayı
    // hiç DOM'a iletmez; bu davranışın kendisi disabled denetimiyle
    // yukarıda zaten kanıtlanmıştır.

    await page.waitForURL("**/sahip");
  });

  test("Göster/Gizle yalnız girilen şifreyi etkiler", async ({ page }) => {
    await fillLoginForm(page, OWNER_PLATE, "gizli-sifre-123");
    const passwordInput = page.getByLabel("Şifre");
    await expect(passwordInput).toHaveAttribute("type", "password");

    const showButton = page.getByRole("button", { name: "Göster", exact: true });
    await clickWhenHydrated(showButton, () =>
      expect(passwordInput).toHaveAttribute("type", "text", { timeout: 500 }),
    );
    await expect(passwordInput).toHaveValue("gizli-sifre-123");

    // Hydration bu noktada zaten KANITLANDI (yukarıdaki "Göster" tıklaması
    // gerçek bir etki ÜRETTİ) — bu ikinci tıklama için AYNI korumaya
    // gerek yoktur.
    await page.getByRole("button", { name: "Gizle", exact: true }).click();
    await expect(passwordInput).toHaveAttribute("type", "password");
    // Değer, görünürlük değişse de AYNI kalır — yalnız görüntü değişir.
    await expect(passwordInput).toHaveValue("gizli-sifre-123");
  });

  test("320 px viewport'ta yatay kaydırma yok", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });

    await page.goto("/giris");
    await expect
      .poll(() => page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0))
      .toBeLessThanOrEqual(320);

    // Sahip/şoför ekranlarının üst başlığı da ürün genelindeki aynı 320 px
    // (responsive yerleşim) kuralına tabidir — bu ekranlar da aynı
    // viewport'ta doğrulanır.
    await fillLoginForm(page, OWNER_PLATE, SEED_TEST_PASSWORDS.owner);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/sahip");
    await expect
      .poll(() => page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0))
      .toBeLessThanOrEqual(320);
  });
});

test.describe("Çıkış (/sofor, /sahip)", () => {
  test("'Çıkış' sonrası /giris ve /sahip tekrar /giris'e yönlendirir", async ({ page }) => {
    await fillLoginForm(page, OWNER_PLATE, SEED_TEST_PASSWORDS.owner);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/sahip");

    await page.getByRole("button", { name: "Çıkış", exact: true }).click();
    await page.waitForURL("**/giris");

    // Oturum gerçekten İPTAL edildi (yalnız istemci durumu temizlenmedi) —
    // sunucu artık geçerli çerezi olmayan bu tarayıcıyı /sahip'ten
    // /giris'e geri yönlendirir.
    await page.goto("/sahip");
    await page.waitForURL("**/giris");
  });
});
