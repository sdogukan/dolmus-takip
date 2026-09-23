import { expect, test, type Page } from "@playwright/test";
import {
  SEED_IDS,
  SEED_RAW_PLATES,
  SEED_TEST_PASSWORDS,
  SEED_USERNAMES,
} from "../../scripts/db-seed-dev";

/**
 * Sahip ve ekip çalışma kaydı formu uçtan uca testleri. Gerçek standalone
 * sunucu + seed (yalnız OKUNUR). Form kayıt YAZMAZ: hiçbir testte
 * "Kaydedildi" veya "Parayı aldım" görünmemelidir.
 *
 * Hydration: sayfa açılışında şoför listesi istenir; yanıt gelince React
 * hydrate olmuştur — etkileşimler bundan SONRA yapılır.
 */

const NOT_SAVED_TEXT =
  "Bilgiler geçerli. Kayıt henüz kaydedilmiyor; kaydetme bir sonraki aşamada açılacak.";
const INACTIVE_NOTICE = "Araç veya işletme pasif; bilgiler okunabilir, değişiklik yapılamaz.";
const DRIVERS_URL = "**/api/v1/drivers";

async function login(page: Page, plate: string, password: string, landing: string): Promise<void> {
  await page.goto("/giris");
  await page.getByLabel("Plaka").fill(plate);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL(`**${landing}`);
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/yonetim/giris");
  await page.getByLabel("Kullanıcı adı").fill(SEED_USERNAMES.admin);
  await page.getByLabel("Şifre").fill(SEED_TEST_PASSWORDS.admin);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL("**/yonetim");
}

/** Sayfayı açar ve ilk şoför listesi yanıtını (hydration) bekler. */
async function openHydrated(page: Page, url: string): Promise<void> {
  const firstRead = page.waitForResponse(DRIVERS_URL);
  await page.goto(url);
  await firstRead;
}

async function fillMoney(page: Page): Promise<void> {
  await page.getByLabel("Hasılat").fill("10.000");
  await page.getByLabel("Mazot").fill("1.500");
  await page.getByRole("button", { name: "+ Masraf ekle" }).click();
  await page.getByLabel("Diğer masraf").fill("300");
}

function summaryLine(page: Page, label: string) {
  return page.locator("#work-summary p", { hasText: label }).first();
}

test.describe("Sahip çalışma kaydı (/sahip/kayit/yeni)", () => {
  test("yalnız sahip açar: şoför → /sofor, ekip → /yonetim, oturumsuz → /giris", async ({ page, browser }, testInfo) => {
    await page.goto("/sahip/kayit/yeni");
    await page.waitForURL("**/giris");

    const driver = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(driver, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver, "/sofor");
    await driver.goto("/sahip/kayit/yeni");
    await driver.waitForURL("**/sofor");

    const staff = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await loginAsAdmin(staff);
    await staff.goto("/sahip/kayit/yeni");
    await staff.waitForURL("**/yonetim");
  });

  test("sahip ana ekranından açılır; plaka görünür, iki seçenek var ve hiçbiri seçili değil", async ({ page }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await page.getByRole("link", { name: "+ Çalışma kaydı gir" }).click();
    await page.waitForURL("**/sahip/kayit/yeni");

    await expect(page.getByText(SEED_RAW_PLATES.vehicleA1, { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Çalışma kaydı" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Kendim çalıştım" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Şoför adına" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText(/^Çalışan:/)).toHaveCount(0);
    await expect(page.locator("#work-summary")).toHaveCount(0);
    // Alınan tutar alanı/düğmesi hiçbir modda yok.
    await expect(page.getByText("Parayı aldım")).toHaveCount(0);
    await expect(page.getByLabel(/Alınan/)).toHaveCount(0);
  });

  test("Kendim çalıştım: sahip adı, şoför payı 0 ve kalan; Şoför adına: yalnız aktif şoförler ve %20 pay; tür değişince kişi temizlenir", async ({
    page,
  }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await openHydrated(page, "/sahip/kayit/yeni");
    await fillMoney(page);

    await page.getByRole("button", { name: "Kendim çalıştım" }).click();
    await expect(page.getByText("Çalışan: Ali Kaya · Mal sahibi")).toBeVisible();
    await expect(summaryLine(page, "Şoför payı")).toContainText("0,00 TL");
    await expect(summaryLine(page, "Giderlerden sonra kalan")).toContainText("8.200,00 TL");
    await expect(page.getByText("Kendi çalışmanda şoför payı ayrılmaz.")).toBeVisible();
    await expect(page.getByLabel("Kim çalıştı?")).toHaveCount(0);

    await page.getByRole("button", { name: "Şoför adına" }).click();
    await expect(page.getByText(/^Çalışan:/)).toHaveCount(0);
    await expect(summaryLine(page, "Şoför payı (%20)")).toContainText("2.000,00 TL");
    await expect(summaryLine(page, "Teslim edilecek tutar")).toContainText("6.200,00 TL");

    const person = page.getByLabel("Kim çalıştı?");
    await expect(person).toHaveValue("");
    const options = await person.locator("option").allTextContents();
    expect(options[0]).toBe("Şoförü seç");
    // Pasif atama, başka aracın şoförü ve sahibin kendisi listede YOK.
    expect(options.slice(1).sort()).toEqual(["Hüseyin Ak", "Mehmet Öz", "Mehmet Öz"]);
    expect(options).not.toContain("Kemal Şahin");
    expect(options).not.toContain("Zeynep Arslan");
    expect(options).not.toContain("Ali Kaya");

    // Kişi seçip sahip türüne geçip dönünce seçim temizlenmiş olmalı.
    await person.selectOption({ label: "Hüseyin Ak" });
    await page.getByRole("button", { name: "Kendim çalıştım" }).click();
    await page.getByRole("button", { name: "Şoför adına" }).click();
    await expect(page.getByLabel("Kim çalıştı?")).toHaveValue("");
  });

  test("tür seçilmeden kontrol edilemez; sahip türünde geçerli gönderim kayıt YAZMAZ", async ({ page }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await openHydrated(page, "/sahip/kayit/yeni");
    await page.getByLabel("Başlangıç saati").fill("08:00");
    await page.getByLabel("Bitiş saati").fill("17:00");
    await fillMoney(page);

    await page.getByRole("button", { name: "Kontrol et" }).click();
    await expect(page.getByText("Kayıt türünü seç.")).toBeVisible();
    await expect(page.getByText(NOT_SAVED_TEXT)).toHaveCount(0);

    await page.getByRole("button", { name: "Kendim çalıştım" }).click();
    await expect(page.getByText("Kayıt türünü seç.")).toHaveCount(0);
    await page.getByRole("button", { name: "Kontrol et" }).click();
    await expect(page.getByText(/^Ali Kaya · .*\. Bilgiler geçerli\./)).toBeVisible();
    await expect(page.getByText(NOT_SAVED_TEXT, { exact: false })).toBeVisible();
    await expect(page.getByText("Kaydedildi")).toHaveCount(0);
  });

  test("Şoför adına: kişi seçilmeden hata verir; seçilince taze okuma sonrası kayıt YAZMAZ", async ({ page }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await openHydrated(page, "/sahip/kayit/yeni");
    await page.getByLabel("Başlangıç saati").fill("08:00");
    await page.getByLabel("Bitiş saati").fill("17:00");
    await fillMoney(page);
    await page.getByRole("button", { name: "Şoför adına" }).click();

    await page.getByRole("button", { name: "Kontrol et" }).click();
    await expect(page.getByText("Şoförü seç.", { exact: true })).toBeVisible();

    await page.getByLabel("Kim çalıştı?").selectOption({ label: "Hüseyin Ak" });
    await page.getByRole("button", { name: "Kontrol et" }).click();
    await expect(page.getByText(/^Hüseyin Ak · .*\. Bilgiler geçerli\./)).toBeVisible();
    await expect(page.getByText("Kaydedildi")).toHaveCount(0);
  });
});

test.describe("Ekip çalışma kaydı (/yonetim/araclar/:id/kayit/yeni)", () => {
  test("destek ekranından açılır; hedef ve işlemi yapan görünür, şoför listesi X-Target-Vehicle ile okunur, iki tür sunulur", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/yonetim/araclar/${SEED_IDS.vehicleA1}/destek`);
    await page.getByRole("link", { name: "+ Çalışma kaydı gir" }).click();
    await page.waitForURL(`**/yonetim/araclar/${SEED_IDS.vehicleA1}/kayit/yeni`);

    const targetHeaders: Array<string | undefined> = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/drivers")) {
        targetHeaders.push(request.headers()["x-target-vehicle"]);
      }
    });
    await openHydrated(page, `/yonetim/araclar/${SEED_IDS.vehicleA1}/kayit/yeni`);
    expect(targetHeaders.length).toBeGreaterThan(0);
    expect(targetHeaders.every((value) => value === SEED_IDS.vehicleA1)).toBe(true);

    await expect(page.getByText("Destek: İşletme A")).toBeVisible();
    await expect(page.getByText("Araç: 34 AAA 001 · Sahip: Ali Kaya")).toBeVisible();
    await expect(page.getByText(`İşlemi yapan: ${SEED_USERNAMES.admin} (Yönetici)`)).toBeVisible();
    await expect(page.getByText(INACTIVE_NOTICE)).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Sahip çalıştı" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Şoför adına" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("Parayı aldım")).toHaveCount(0);

    await fillMoney(page);
    await page.getByRole("button", { name: "Şoför adına" }).click();
    const options = await page.getByLabel("Kim çalıştı?").locator("option").allTextContents();
    expect(options.slice(1).sort()).toEqual(["Hüseyin Ak", "Mehmet Öz", "Mehmet Öz"]);
    await expect(summaryLine(page, "Şoför payı (%20)")).toContainText("2.000,00 TL");
    await page.getByRole("button", { name: "Sahip çalıştı" }).click();
    await expect(page.getByText("Çalışan: Ali Kaya · Mal sahibi")).toBeVisible();
    await expect(summaryLine(page, "Giderlerden sonra kalan")).toContainText("8.200,00 TL");
    await expect(page.getByText("Sahibin çalışmasında şoför payı ayrılmaz.")).toBeVisible();
  });

  test("kirli formda Hedefi değiştir onay ister; temiz formda doğrudan çıkar", async ({ page }) => {
    await loginAsAdmin(page);
    await openHydrated(page, `/yonetim/araclar/${SEED_IDS.vehicleA1}/kayit/yeni`);

    await page.getByLabel("Hasılat").fill("100");
    await page.getByRole("button", { name: "Hedefi değiştir" }).click();
    await expect(page.getByText("Değişiklikleri bırakıp çık?")).toBeVisible();
    await page.getByRole("button", { name: "Vazgeç" }).click();
    await expect(page.getByLabel("Hasılat")).toHaveValue("100");

    await page.getByLabel("Hasılat").fill("");
    await page.getByRole("button", { name: "Hedefi değiştir" }).click();
    await page.waitForURL("**/yonetim");
  });

  test("pasif araçta form kilitli ve uyarı görünür; bilinmeyen araç 404; araç oturumu yönlendirilir", async ({
    page,
    browser,
  }, testInfo) => {
    await loginAsAdmin(page);
    await page.goto(`/yonetim/araclar/${SEED_IDS.vehicleB2}/kayit/yeni`);
    await expect(page.getByText(INACTIVE_NOTICE)).toBeVisible();
    await expect(page.getByRole("button", { name: "Kontrol et" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Şoför adına" })).toBeDisabled();
    await expect(page.getByLabel("Hasılat")).toBeDisabled();

    const unknown = await page.goto("/yonetim/araclar/00000000-0000-4000-8000-000000000000/kayit/yeni");
    expect(unknown?.status()).toBe(404);

    const owner = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(owner, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await owner.goto(`/yonetim/araclar/${SEED_IDS.vehicleA1}/kayit/yeni`);
    await owner.waitForURL("**/sahip");
  });
});
