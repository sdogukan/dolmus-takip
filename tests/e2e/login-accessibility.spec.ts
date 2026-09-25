import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  SEED_RAW_PLATES,
  SEED_TEST_PASSWORDS,
  SEED_USERNAMES,
} from "../../scripts/db-seed-dev";

/**
 * Giriş erişilebilirliği ve zaman aşımı sağlamlığı — T1.6 ADIM 2/2, S1.6.
 *
 * Bu dosya S1.6'nın YEDİ kabul kriterini
 * DOĞRUDAN E2E ile kanıtlar (Chromium — `../../playwright.config.ts`
 * `projects`). Diğer giriş E2E dosyalarıyla (`./vehicle-
 * login.spec.ts`, `./platform-login.spec.ts`) AYNI altyapıyı (gerçek
 * standalone sunucu, gerçek DB, `../../scripts/db-seed-dev.ts`
 * `seedDevData`'nın tek kaynağı) paylaşır; yeni bir `webServer`/config
 * EKLENMEZ.
 *
 * Her iki giriş varyantı (`/giris` araç, `/yonetim/giris` ekip) AYNI
 * ortak `../../src/app/_components/login-form.tsx` bileşenini kullandığı
 * için (bkz. o dosyanın üst notu) bu paketin verdiği KONTROL LİSTESİ
 * (320 px, %200 yakınlaştırma, Tab/odak, boş alan hatası, ağ hatası, 5xx,
 * çift tıklama, alan/düğme ölçüsü, Enter, "Giriş yapılıyor…") AŞAĞIDAKİ
 * `VARIANTS` dizisi üzerinden HER İKİ sayfa için TEKRARLANIR — kod tekrarı
 * yok, tek bir test gövdesi iki veriyle çalışır.
 *
 * "Yanlış şifrede plaka korunur" (S1.6 AC4, birebir "plaka") YALNIZ araç
 * varyantı içindir — ekip varyantının KARŞILIĞI ("kullanıcı adı korunur")
 * zaten `./platform-login.spec.ts` "pasif hesap" testinde kanıtlıdır;
 * burada TEKRAR EDİLMEZ (gereksiz başarısız kimlik doğrulama denemesi
 * `../../src/server/auth/rate-limit.ts` sayacını GEREKSİZ YERE artırmaz).
 *
 * Gerçek başarısız kimlik doğrulama denemesi (rate-limit sayacını
 * artıran) bu dosyada YALNIZ o tek testte yapılır; ağ hatası/5xx
 * testleri `page.route` ile isteği sunucuya ULAŞTIRMADAN keser (bkz.
 * `../../src/server/auth/rate-limit.ts` üst notu — "yalnız GERÇEK bir
 * kimlik doğrulama denemesinin ... SONUCUNA göre artırılır"), bu yüzden
 * sayacı HİÇ ETKİLEMEZ.
 */

interface LoginVariant {
  readonly label: string;
  readonly path: string;
  readonly identifierLabel: string;
  readonly identifierValue: string;
  readonly password: string;
  readonly endpointGlob: string;
  readonly successUrlPattern: RegExp;
  readonly toggleShowLabel: string;
  readonly toggleHideLabel: string;
}

const VARIANTS: readonly LoginVariant[] = [
  {
    label: "araç girişi (/giris)",
    path: "/giris",
    identifierLabel: "Plaka",
    identifierValue: SEED_RAW_PLATES.vehicleA1,
    password: SEED_TEST_PASSWORDS.owner,
    endpointGlob: "**/api/v1/auth/vehicle-login",
    successUrlPattern: /\/sahip$/,
    toggleShowLabel: "Göster",
    toggleHideLabel: "Gizle",
  },
  {
    label: "ekip girişi (/yonetim/giris)",
    path: "/yonetim/giris",
    identifierLabel: "Kullanıcı adı",
    identifierValue: SEED_USERNAMES.admin,
    password: SEED_TEST_PASSWORDS.admin,
    endpointGlob: "**/api/v1/auth/platform-login",
    successUrlPattern: /\/yonetim$/,
    toggleShowLabel: "Göster",
    toggleHideLabel: "Gizle",
  },
];

async function fillForm(page: Page, variant: LoginVariant): Promise<void> {
  await page.goto(variant.path);
  await page.getByLabel(variant.identifierLabel).fill(variant.identifierValue);
  await page.getByLabel("Şifre").fill(variant.password);
}

function submitButtonOf(page: Page): Locator {
  return page.getByRole("button", { name: "Giriş yap", exact: true });
}

/**
 * Bir DOM düğümünün klavye odağı GÖRÜNÜR mü — klavye odağı görünür
 * olmalıdır. `outline` VEYA `box-shadow`'dan EN AZ
 * biri "yok" değilse odak görünür sayılır (bu bileşen `focus-visible:
 * ring-*` — Tailwind'in `box-shadow` tabanlı halka — kullanır; çıplak
 * `outline` KALDIRILMIŞTIR, bu yüzden yalnız `outline` denetlemek YANLIŞ
 * NEGATİF üretir).
 */
async function assertActiveElementHasVisibleFocus(page: Page): Promise<void> {
  const style = await page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) {
      return null;
    }
    const computed = window.getComputedStyle(el);
    return {
      tag: el.tagName,
      outlineStyle: computed.outlineStyle,
      outlineWidth: computed.outlineWidth,
      boxShadow: computed.boxShadow,
    };
  });
  expect(style, "document.activeElement bir HTMLElement olmalı").not.toBeNull();
  const hasOutline =
    style!.outlineStyle !== "none" && style!.outlineWidth !== "0px";
  const hasBoxShadow = style!.boxShadow !== "none" && style!.boxShadow.trim() !== "";
  expect(
    hasOutline || hasBoxShadow,
    `${style!.tag} için görünür odak (outline veya box-shadow) bekleniyordu`,
  ).toBe(true);
}

for (const variant of VARIANTS) {
  test.describe(`${variant.label} — erişilebilirlik ve zaman aşımı sağlamlığı`, () => {
    test("320×568 viewport'ta yatay kaydırma yok ve tüm etkileşimli öğeler görünür", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(variant.path);

      await expect
        .poll(() => page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0))
        .toBeLessThanOrEqual(320);

      await expect(page.getByLabel(variant.identifierLabel)).toBeVisible();
      await expect(page.getByLabel("Şifre")).toBeVisible();
      await expect(
        page.getByRole("button", { name: variant.toggleShowLabel, exact: true }),
      ).toBeVisible();
      await expect(submitButtonOf(page)).toBeVisible();
    });

    test("%200 yakınlaştırma benzetiminde (640×1136, deviceScaleFactor 2) temel giriş yapılabilir", async ({
      browser,
    }) => {
      // 640 fiziksel px / deviceScaleFactor 2 = 320 CSS px — "font büyütme
      // ve %200 yakınlaştırmada ana işlemler erişilebilir kalır" kuralının
      // benzetimi.
      const context = await browser.newContext({
        viewport: { width: 640, height: 1136 },
        deviceScaleFactor: 2,
      });
      try {
        const page = await context.newPage();
        await fillForm(page, variant);
        await submitButtonOf(page).click();
        await page.waitForURL(variant.successUrlPattern);
      } finally {
        await context.close();
      }
    });

    test("Tab sırası ve odak görünürlüğü (kimlik → şifre → göster/gizle → gönder)", async ({
      page,
    }) => {
      await page.goto(variant.path);

      const identifierInput = page.getByLabel(variant.identifierLabel);
      const passwordInput = page.getByLabel("Şifre");
      const toggleButton = page.getByRole("button", {
        name: variant.toggleShowLabel,
        exact: true,
      });
      const submitButton = submitButtonOf(page);

      await page.keyboard.press("Tab");
      await expect(identifierInput).toBeFocused();
      await assertActiveElementHasVisibleFocus(page);

      await page.keyboard.press("Tab");
      await expect(passwordInput).toBeFocused();
      await assertActiveElementHasVisibleFocus(page);

      await page.keyboard.press("Tab");
      await expect(toggleButton).toBeFocused();
      await assertActiveElementHasVisibleFocus(page);

      await page.keyboard.press("Tab");
      await expect(submitButton).toBeFocused();
      await assertActiveElementHasVisibleFocus(page);

      // Asıl ürün gereksinimi ("klavye odağı görünür") motordan
      // BAĞIMSIZDIR: düğmeler HANGİ mekanizmayla odaklanırsa odaklansın
      // (Tab, ekran okuyucu rotoru, Full Keyboard Access) odak GÖRÜNÜR
      // olmalı — bu, programatik `.focus()` ile AYRICA ve doğrudan
      // sınanır.
      await toggleButton.focus();
      await expect(toggleButton).toBeFocused();
      await assertActiveElementHasVisibleFocus(page);

      await submitButton.focus();
      await expect(submitButton).toBeFocused();
      await assertActiveElementHasVisibleFocus(page);
    });

    test("S1.6 AC7 yardım metni görünür (kayıt/uygulama indirme zorunluluğu yok)", async ({
      page,
    }) => {
      // S1.6 AC7 (birebir) — "'Giriş yapamıyorsan hesabını açan ekipten
      // yardım al.' metni görünür." S1.6 AC1 kapsamı "Araç ve ekip
      // girişleri" olarak tanımladığından ve AC7 bunu tek bir varyantla
      // sınırlamadığından (düzeltme turu 1 denetim bulgusu — önceki
      // sürüm bu metni yalnız `/giris`'te gösteriyordu) bu test HER İKİ
      // `VARIANTS` girdisi için (döngü üzerinden) çalışır.
      await page.goto(variant.path);
      await expect(
        page.getByText("Giriş yapamıyorsan hesabını açan ekipten yardım al."),
      ).toBeVisible();
    });

    test("boş gönderimde alan hataları görünür, aria-invalid ve odak ilk hatalı alanda", async ({
      page,
    }) => {
      await page.goto(variant.path);

      const identifierInput = page.getByLabel(variant.identifierLabel);
      const passwordInput = page.getByLabel("Şifre");

      // Form `noValidate` taşır (bkz. `../../src/app/_components/
      // login-form.tsx`) — tarayıcının kendi doğrulama balonu yerine
      // gerçek sunucu 422 yanıtı beklenir; bu, 422 alan hatası
      // `../../src/server/auth/rate-limit.ts` sayacını HİÇ ETKİLEMEZ
      // (dosya üstü notu).
      await submitButtonOf(page).click();

      await expect(identifierInput).toHaveAttribute("aria-invalid", "true");
      await expect(passwordInput).toHaveAttribute("aria-invalid", "true");
      await expect(identifierInput).toBeFocused();

      // Hata metni ilgili alana `aria-describedby` ile bağlıdır — yalnız
      // renk DEĞİL, metinle de bildirilir.
      const describedBy = await identifierInput.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      await expect(page.locator(`#${describedBy}`)).toBeVisible();
      await expect(page.locator("#password-error")).toBeVisible();
    });

    test("ağ hatası simülasyonu → hata metni gösterilir, sonra route kaldırılıp tekrar deneme başarılı", async ({
      page,
    }) => {
      await fillForm(page, variant);

      await page.route(variant.endpointGlob, async (route) => {
        await route.abort();
      });

      await submitButtonOf(page).click();

      const networkErrorAlert = page
        .getByRole("alert")
        .filter({ hasText: "Bağlantı kurulamadı. Tekrar dene." });
      await expect(networkErrorAlert).toBeVisible();
      // Form silinmedi — kimlik alanı korunur.
      await expect(page.getByLabel(variant.identifierLabel)).toHaveValue(
        variant.identifierValue,
      );
      await expect(page).toHaveURL(new RegExp(variant.path.replace(/\//g, "\\/") + "$"));

      // Bağlantı "geri geldiğinde" (route kaldırılınca) AYNI form, AYNI
      // düğmeyle anlaşılır biçimde tekrar denenebilir.
      await page.unroute(variant.endpointGlob);
      await submitButtonOf(page).click();
      await page.waitForURL(variant.successUrlPattern);
    });

    test("5xx simülasyonu → anlaşılır hata gösterilir, başarı yok, teknik ayrıntı sızmaz", async ({
      page,
    }) => {
      await fillForm(page, variant);

      const technicalDetail = "TypeError: Cannot read properties at Object.<anonymous>";
      await page.route(variant.endpointGlob, async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "INTERNAL", message: technicalDetail },
          }),
        });
      });

      await submitButtonOf(page).click();

      const networkErrorAlert = page
        .getByRole("alert")
        .filter({ hasText: "Bağlantı kurulamadı. Tekrar dene." });
      await expect(networkErrorAlert).toBeVisible();
      // Sunucunun 5xx gövdesindeki mesaj KASITLI olarak GÖRMEZDEN
      // gelinir (bkz. `../../src/app/_components/login-form.tsx` üst
      // notu) — hiçbir yığın izi/teknik ayrıntı ekranda YOKTUR.
      await expect(page.getByText(technicalDetail)).toHaveCount(0);
      // Başarı YOK — hâlâ giriş sayfasındayız.
      await expect(page).toHaveURL(new RegExp(variant.path.replace(/\//g, "\\/") + "$"));
    });

    test("çift tıkta yalnız tek istek gönderilir", async ({ page }) => {
      await fillForm(page, variant);

      let requestCount = 0;
      await page.route(variant.endpointGlob, async (route) => {
        requestCount += 1;
        await route.continue();
      });

      const submitButton = submitButtonOf(page);
      // Gerçek bir çift tıklamayı benzetir: iki tıklama neredeyse AYNI
      // anda başlatılır. `force: true` — ilk tıklamanın senkron
      // `setIsSubmitting(true)`'ı düğmeyi `disabled` yaptıktan SONRA
      // Playwright'ın kendi "etkin mi" denetiminin ikinci tıklamayı
      // zaman aşımına düşürmesini ÖNLER; tarayıcı yine de `disabled` bir
      // düğmede `click` olayını ÜRETMEZ (native davranış) — bu yüzden
      // `force: true` sonucu DEĞİŞTİRMEZ, yalnız Playwright'ın kendi ön
      // denetimini atlar.
      await Promise.allSettled([
        submitButton.click({ force: true }),
        submitButton.click({ force: true }),
      ]);

      await page.waitForURL(variant.successUrlPattern);
      expect(requestCount).toBe(1);
    });

    test("düğme yüksekliği ≥ 56 px ve alanlar ≥ 48 px", async ({ page }) => {
      await page.goto(variant.path);

      const identifierBox = await page.getByLabel(variant.identifierLabel).boundingBox();
      const passwordBox = await page.getByLabel("Şifre").boundingBox();
      const toggleBox = await page
        .getByRole("button", { name: variant.toggleShowLabel, exact: true })
        .boundingBox();
      const submitBox = await submitButtonOf(page).boundingBox();

      expect(identifierBox?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(passwordBox?.height ?? 0).toBeGreaterThanOrEqual(48);
      // Dokunulan küçük bağlantı/simge alanı da 48×48 px hedeflenir.
      expect(toggleBox?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(submitBox?.height ?? 0).toBeGreaterThanOrEqual(56);
    });

    test("Enter tuşuyla gönderim başarılı girişi tamamlar", async ({ page }) => {
      await fillForm(page, variant);
      await page.getByLabel("Şifre").press("Enter");
      await page.waitForURL(variant.successUrlPattern);
    });

    test("istek sürerken 'Giriş yapılıyor…' gösterilir ve düğme devre dışı kalır", async ({
      page,
    }) => {
      await page.route(variant.endpointGlob, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.continue();
      });

      await fillForm(page, variant);
      await submitButtonOf(page).click();

      const pendingButton = page.getByRole("button", {
        name: "Giriş yapılıyor…",
        exact: true,
      });
      await expect(pendingButton).toBeVisible();
      await expect(pendingButton).toBeDisabled();
      // Ekran okuyucuya da (yalnız görsel düğme metniyle değil, AYRI bir
      // `aria-live="polite"` duyurusuyla) bildirilir — bkz. `../../src/
      // app/_components/login-form.tsx` üst notu ("role=alert ile
      // KARIŞTIRILMAZ"). İki düğüm de AYNI metni taşıdığından
      // (düğme + duyuru) `getByText` burada KASITLI olarak duyuru
      // düğümüne (`aria-live`) daraltılır — strict-mode ihlali YOK.
      await expect(page.locator('[aria-live="polite"]')).toHaveText("Giriş yapılıyor…");

      await page.waitForURL(variant.successUrlPattern);
    });
  });
}

test.describe("araç girişi (/giris) — yanlış şifreye özgü kural", () => {
  test("yanlış şifrede plaka korunur ve hata role=alert ile bildirilir", async ({ page }) => {
    // S1.6 AC4 (birebir) — "Yanlış şifre mesajı rol veya plakanın
    // varlığını açıklamaz; girilen plaka korunur." Bu, GERÇEK bir
    // başarısız kimlik doğrulama denemesidir (rate-limit sayacını
    // artırır) — bu dosyada YALNIZ bu tek testte yapılır (dosya üstü
    // notu).
    const plate = SEED_RAW_PLATES.vehicleA1;
    await page.goto("/giris");
    await page.getByLabel("Plaka").fill(plate);
    await page.getByLabel("Şifre").fill("yanlis-sifre-e2e-a11y");
    await submitButtonOf(page).click();

    const formAlert = page.getByRole("alert").filter({ hasText: "Plaka veya şifre yanlış." });
    await expect(formAlert).toHaveText("Plaka veya şifre yanlış.");
    await expect(page.getByLabel("Plaka")).toHaveValue(plate);
    await expect(page).toHaveURL(/\/giris$/);
  });
});
