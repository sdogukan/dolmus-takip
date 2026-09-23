import { expect, test, type Page } from "@playwright/test";
import {
  SEED_RAW_PLATES,
  SEED_TEST_PASSWORDS,
  SEED_USERNAMES,
} from "../../scripts/db-seed-dev";
import { PLATFORM_ROLE_LABELS } from "../../src/lib/messages";

/**
 * Ekip girişi uçtan uca testleri (Chromium + WebKit) — T1.3 ADIM 2/2,
 * S1.3, görev tanımı (d).
 *
 * `../../tests/e2e/vehicle-login.spec.ts`'İN AYNI altyapısı (gerçek
 * standalone sunucu, gerçek DB, `../../scripts/db-seed-dev.ts`
 * `seedDevData`'nın tek kaynağı — burada `SEED_USERNAMES`/
 * `SEED_TEST_PASSWORDS` DOĞRUDAN içe aktarılır, plaka/kullanıcı adı/şifre
 * TEKRAR YAZILMAZ) — yeni bir `webServer`/config eklenmez
 * (`../../playwright.config.ts` zaten iki projeyi de [chromium/webkit]
 * çalıştırır).
 *
 * S1.3 kabul kriterleri (STORIES.md) ile eşleme (`ac_coverage`'da tekrar
 * özetlenir):
 * - AC3 (aktif hesap açar, kimlik ekranda görünür) → "admin girişi",
 *   "support girişi".
 * - AC4 (araç şifresi geçmez; genel hata; hız sınırı) → "araç şifresiyle
 *   ekip girişi", "pasif hesap".
 * - AC6 (başarı/başarısızlık açık; sır URL'de/ekranda yok) →
 *   "oturum sırrı URL'de yok ve cookie HttpOnly".
 */

async function fillTeamLoginForm(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/yonetim/giris");
  await page.getByLabel("Kullanıcı adı").fill(username);
  await page.getByLabel("Şifre").fill(password);
}

async function submitTeamLogin(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
}

test.describe("Ekip girişi (/yonetim/giris)", () => {
  test("admin girişi → /yonetim, kullanıcı adı ve 'Yönetici' görünür", async ({ page }) => {
    await fillTeamLoginForm(page, SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    await submitTeamLogin(page);

    await page.waitForURL("**/yonetim");
    // Kimlik yalnız üst başlıkta aranır: paylaşılan E2E DB'sindeki işletme/
    // araç bağlantıları aynı alt dizgiyi içerebilir.
    await expect(page.locator("header")).toContainText(
      `${SEED_USERNAMES.admin} · ${PLATFORM_ROLE_LABELS.admin}`,
    );
    // T2.1, S2.1 — M1'in dürüst yer tutucu metni yerini GERÇEK işe
    // (işletme açma + mevcut liste) bıraktı (bkz. `../../src/app/yonetim/
    // page.tsx` üst notu).
    await expect(page.getByRole("link", { name: "+ İşletme aç" })).toBeVisible();
  });

  test("support girişi → 'Destek' görünür", async ({ page }) => {
    await fillTeamLoginForm(page, SEED_USERNAMES.support, SEED_TEST_PASSWORDS.support);
    await submitTeamLogin(page);

    await page.waitForURL("**/yonetim");
    await expect(page.locator("header")).toContainText(
      `${SEED_USERNAMES.support} · ${PLATFORM_ROLE_LABELS.support}`,
    );
  });

  test("pasif hesap → genel hata, form korunur", async ({ page }) => {
    // STORIES.md S1.3 AC4 — "Geçersiz giriş kullanıcı adının varlığını
    // ifşa etmeden genel hata verir." Pasif hesap doğru şifreyle bile
    // AYNI genel mesajı üretir (bkz. `../../src/server/usecases/auth/
    // platform-login.ts` "isUsableUser" — pasiflik dummy-hash yoluna
    // düşürür).
    await fillTeamLoginForm(page, SEED_USERNAMES.adminPassive, SEED_TEST_PASSWORDS.admin);
    await submitTeamLogin(page);

    const formAlert = page
      .getByRole("alert")
      .filter({ hasText: "Kullanıcı adı veya şifre yanlış." });
    await expect(formAlert).toHaveText("Kullanıcı adı veya şifre yanlış.");
    await expect(page.getByLabel("Kullanıcı adı")).toHaveValue(SEED_USERNAMES.adminPassive);
    await expect(page.getByLabel("Şifre")).toHaveValue(SEED_TEST_PASSWORDS.admin);
    await expect(page).toHaveURL(/\/yonetim\/giris$/);
  });

  test("araç şifresiyle ekip girişi → genel hata", async ({ page }) => {
    // Görev tanımı (d) — "araç şifresiyle ekip girişi → genel hata."
    // `platformLogin` yalnız `platform_users` tablosunu sorgular
    // (`../../src/server/usecases/auth/platform-login.ts` üst notu);
    // bir araç şifresi (owner "sahip-1234") burada YAPISAL OLARAK
    // eşleşmez — bilinmeyen kullanıcı adıyla AYNI genel mesaj döner.
    await fillTeamLoginForm(page, SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.owner);
    await submitTeamLogin(page);

    const formAlert = page
      .getByRole("alert")
      .filter({ hasText: "Kullanıcı adı veya şifre yanlış." });
    await expect(formAlert).toHaveText("Kullanıcı adı veya şifre yanlış.");
    await expect(page).toHaveURL(/\/yonetim\/giris$/);
  });

  test("320 px viewport'ta yatay kaydırma yok", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });

    await page.goto("/yonetim/giris");
    await expect
      .poll(() => page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0))
      .toBeLessThanOrEqual(320);

    await fillTeamLoginForm(page, SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    await submitTeamLogin(page);
    await page.waitForURL("**/yonetim");
    await expect
      .poll(() => page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0))
      .toBeLessThanOrEqual(320);
  });

  test("oturum sırrı URL'de yok ve çerez HttpOnly", async ({ page, context }) => {
    await fillTeamLoginForm(page, SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    await submitTeamLogin(page);
    await page.waitForURL("**/yonetim");

    // Adreste yalnız yol vardır — hiçbir sorgu/hash parametresi yok
    // (görev tanımı d: "oturum sırrı URL'de yok").
    expect(new URL(page.url()).search).toBe("");
    expect(new URL(page.url()).hash).toBe("");

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name === "dolmus_session");
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie?.httpOnly).toBe(true);
    // ARCHITECTURE §6 "Oturum" — token URL/localStorage'a yazılmaz.
    const localStorageKeys = await page.evaluate(() => Object.keys(window.localStorage));
    for (const key of localStorageKeys) {
      const value = await page.evaluate((k) => window.localStorage.getItem(k), key);
      expect(value ?? "").not.toContain(sessionCookie!.value);
    }
  });
});

test.describe("Çıkış (/yonetim)", () => {
  test("'Çıkış' sonrası /yonetim/giris ve /yonetim tekrar girişe yönlendirir", async ({
    page,
  }) => {
    await fillTeamLoginForm(page, SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
    await submitTeamLogin(page);
    await page.waitForURL("**/yonetim");

    await page.getByRole("button", { name: "Çıkış", exact: true }).click();
    await page.waitForURL("**/yonetim/giris");

    // Oturum gerçekten İPTAL edildi — sunucu artık geçerli çerezi olmayan
    // bu tarayıcıyı /yonetim'den /yonetim/giris'e geri yönlendirir.
    await page.goto("/yonetim");
    await page.waitForURL("**/yonetim/giris");
  });
});

test.describe("Araç/ekip oturum karışması (/yonetim)", () => {
  test("şoför oturumuyla /yonetim'e gidince /sofor'a yönlenir", async ({ page }) => {
    const driverPlate = SEED_RAW_PLATES.vehicleA1;
    await page.goto("/giris");
    await page.getByLabel("Plaka").fill(driverPlate);
    await page.getByLabel("Şifre").fill(SEED_TEST_PASSWORDS.driver);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/sofor");

    await page.goto("/yonetim");
    await page.waitForURL("**/sofor");
  });
});
