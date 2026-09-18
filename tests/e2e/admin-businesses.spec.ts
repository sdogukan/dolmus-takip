import { expect, test, type Page } from "@playwright/test";
import {
  SEED_IDS,
  SEED_RAW_PLATES,
  SEED_TEST_PASSWORDS,
  SEED_USERNAMES,
} from "../../scripts/db-seed-dev";

/**
 * İşletme/mal sahibi yönetimi uçtan uca testleri — T2.1, S2.1.
 *
 * `./platform-login.spec.ts`/`./vehicle-login.spec.ts` İLE AYNI altyapı
 * (gerçek standalone sunucu, gerçek DB, `../../scripts/db-seed-dev.ts`
 * `seedDevData`'nın tek kaynağı) — yeni bir `webServer`/config EKLENMEZ.
 *
 * `../../playwright.config.ts` `workers: 1` + `fullyParallel: false` —
 * bu dosyadaki testler PAYLAŞILAN seed verisine (İşletme B, T2.1
 * öncesinden var) dokunduğunda (bkz. "pasifleştirme etkisi" testi) aynı
 * test İÇİNDE `try/finally` ile eski duruma GERİ ALINIR; diğer testler
 * KENDİ oluşturdukları işletmelerle çalışır (paylaşılan veriye dokunmaz).
 */

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/yonetim/giris");
  await page.getByLabel("Kullanıcı adı").fill(SEED_USERNAMES.admin);
  await page.getByLabel("Şifre").fill(SEED_TEST_PASSWORDS.admin);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL("**/yonetim");
}

async function fetchCsrfToken(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/session");
    const body = (await response.json()) as { csrfToken: string };
    return body.csrfToken;
  });
}

test.describe("İşletme oluşturma (/yonetim/isletmeler/yeni)", () => {
  test("ekip kullanıcısı yeni işletme + sahip oluşturur, detay sayfası yeniden açıldığında ad ve sahibi gösterir", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.getByRole("link", { name: "+ İşletme aç" }).click();
    await page.waitForURL("**/yonetim/isletmeler/yeni");

    const name = `E2E İşletmesi ${Date.now()}`;
    await page.getByLabel("İşletme adı").fill(name);
    await page.getByLabel("Sahibin ad soyadı").fill("Ayşe Yılmaz");
    // "ilişki önizlemesi" — kaydetmeden önce isim + sahip ilişkisi görünür.
    await expect(page.getByText(`${name} işletmesinin sahibi: Ayşe Yılmaz`)).toBeVisible();
    await page.getByRole("button", { name: "İşletmeyi kaydet" }).click();

    await page.waitForURL(/\/yonetim\/isletmeler\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Mal sahibi: Ayşe Yılmaz")).toBeVisible();

    // Detay sayfası YENİDEN açıldığında (sunucudan taze okuma) aynı bilgi.
    await page.reload();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Mal sahibi: Ayşe Yılmaz")).toBeVisible();

    // Yeni işletme /yonetim listesinde de görünür.
    await page.goto("/yonetim");
    await expect(page.getByText(name)).toBeVisible();
  });

  test("boş işletme adı alan hatası gösterir, sahip adı değeri korunur", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/yonetim/isletmeler/yeni");

    await page.getByLabel("Sahibin ad soyadı").fill("Mehmet Demir");
    await page.getByRole("button", { name: "İşletmeyi kaydet" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "İşletme adını gir." })).toBeVisible();
    await expect(page.getByLabel("Sahibin ad soyadı")).toHaveValue("Mehmet Demir");
    await expect(page).toHaveURL(/\/yonetim\/isletmeler\/yeni$/);
  });

  test("aynı requestId ile tekrar gönderim ikinci işletme üretmez (409/idempotency)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/yonetim/isletmeler/yeni");
    const csrfToken = await fetchCsrfToken(page);
    const name = `İdempotent İşletme ${Date.now()}`;
    const requestId = crypto.randomUUID();

    const [first, second] = await page.evaluate(
      async ({ csrfToken, name, requestId }) => {
        async function post() {
          const response = await fetch("/api/v1/admin/businesses", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
            body: JSON.stringify({ requestId, name, owner: { fullName: "Tekrar Testi" } }),
          });
          const body = (await response.json()) as { business?: { id?: string } };
          return { status: response.status, businessId: body.business?.id };
        }
        return [await post(), await post()];
      },
      { csrfToken, name, requestId },
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.businessId).toBe(first.businessId);

    await page.goto("/yonetim");
    await expect(page.getByText(name)).toHaveCount(1);
  });

  test("araç (owner/driver) oturumu /yonetim/isletmeler sayfalarını açamaz", async ({ page }) => {
    await page.goto("/giris");
    await page.getByLabel("Plaka").fill(SEED_RAW_PLATES.vehicleA1);
    await page.getByLabel("Şifre").fill(SEED_TEST_PASSWORDS.owner);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/sahip");

    await page.goto("/yonetim/isletmeler/yeni");
    await page.waitForURL("**/sahip");

    await page.goto(`/yonetim/isletmeler/${SEED_IDS.businessA}`);
    await page.waitForURL("**/sahip");
  });
});

test.describe("İşletme detayı (/yonetim/isletmeler/:id)", () => {
  test("iki sekmeden eski sürümle kaydetme 'Bu kayıt değişmiş' metnini gösterir ve girilen değeri silmez", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/yonetim/isletmeler/yeni");
    const name = `Sürüm Testi ${Date.now()}`;
    await page.getByLabel("İşletme adı").fill(name);
    await page.getByLabel("Sahibin ad soyadı").fill("Sürüm Sahibi");
    await page.getByRole("button", { name: "İşletmeyi kaydet" }).click();
    await page.waitForURL(/\/yonetim\/isletmeler\/[0-9a-f-]{36}$/);
    const businessId = page.url().split("/").pop()!;

    // "Diğer sekme" — aynı işletmeyi UI'ın dışından (version 1 → 2) günceller.
    const csrfToken = await fetchCsrfToken(page);
    await page.evaluate(
      async ({ businessId, csrfToken }) => {
        await fetch(`/api/v1/admin/businesses/${businessId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            version: 1,
            name: "Başka Sekmeden Değiştirildi",
          }),
        });
      },
      { businessId, csrfToken },
    );

    // Bu sekme HÂLÂ version 1'i bildiğinden, kendi düzenlemesi 409 alır.
    // "Adı kaydet" hem işletme adı hem sahip adı formunda vardır (DESIGN §3
    // "her formda tek baskın işlem") — İLK'i (işletme adı formu, DOM'da
    // önce gelir) hedeflenir.
    await page.getByLabel("Ad", { exact: true }).fill("Bu Sekmeden Değişiklik");
    await page.getByRole("button", { name: "Adı kaydet" }).first().click();

    await expect(
      page.getByRole("alert").filter({ hasText: "Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et." }),
    ).toBeVisible();
    await expect(page.getByLabel("Ad", { exact: true })).toHaveValue("Bu Sekmeden Değişiklik");
    await expect(page.getByRole("button", { name: "Güncel halini aç" })).toBeVisible();
  });

  test("pasifleştirme: etkilenen araç plakaları ve erişim kesintisi gösterilir, araç oturumu reddedilir", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/yonetim/isletmeler/${SEED_IDS.businessB}`);
    // Aynı plaka onay penceresinin (henüz kapalı, DOM'da hazır) İÇİNDE de
    // geçer — İLK'i (araç listesi, DOM'da önce gelir) hedeflenir.
    await expect(page.getByText("06CCC003").first()).toBeVisible();

    try {
      await page.getByRole("button", { name: "İşletmeyi pasifleştir" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("06CCC003");
      await expect(dialog).toContainText("oturum açamaz");
      await dialog.getByRole("button", { name: "Pasifleştir", exact: true }).click();

      await expect(page.getByText("Pasif", { exact: true }).first()).toBeVisible();

      // Etkilenen araç artık giriş yapamaz.
      await page.goto("/giris");
      await page.getByLabel("Plaka").fill(SEED_RAW_PLATES.vehicleB1);
      await page.getByLabel("Şifre").fill(SEED_TEST_PASSWORDS.owner);
      await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "Plaka veya şifre yanlış." }),
      ).toBeVisible();
    } finally {
      // Paylaşılan seed işletmesini diğer testler için eski (aktif) haline
      // GERİ ALIR — bkz. dosya üstü notu.
      await page.goto(`/yonetim/isletmeler/${SEED_IDS.businessB}`);
      const reactivateButton = page.getByRole("button", { name: "İşletmeyi yeniden aktifleştir" });
      if (await reactivateButton.isVisible().catch(() => false)) {
        await reactivateButton.click();
        await expect(page.getByText("Aktif", { exact: true }).first()).toBeVisible();
      }
    }
  });
});
