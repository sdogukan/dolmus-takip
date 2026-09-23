import { expect, test, type Browser, type Page } from "@playwright/test";
import { SEED_RAW_PLATES, SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";

/**
 * Şoförlerim uçtan uca testleri — T2.5. `./admin-vehicles.spec.ts` İLE AYNI
 * altyapı (gerçek standalone sunucu + seed); yazan testler KENDİ işletme/
 * araçlarını açar, paylaşılan seed verisini DEĞİŞTİRMEZ (seed yalnız okunur).
 *
 * Hydration: ağ/navigasyon İÇERMEYEN yerel bir tıklamayı (`toPass` ile)
 * tekrarlayıp etkisini doğrulamak, sonraki gerçek isteklerin hazır bir
 * sayfada yapılmasını sağlar (bkz. `./vehicle-login.spec.ts`
 * `clickWhenHydrated` üst notu).
 */

const OWNER_PASSWORD = "sahip-e2e-sofor";
const DRIVER_PASSWORD = "sofor-e2e-sofor";
const SHARED_PASSWORD_WARNING =
  "Ortak şoför şifresi hâlâ geçerli. Erişimi tamamen kesmek için ekipten şifre sıfırlama isteyin.";
const RENAME_NOTE = "Bu kişinin eski kayıtları da yeni adıyla görünür.";
const EMPTY_TEXT = "Bu araç için şoför eklenmemiş.";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/yonetim/giris");
  await page.getByLabel("Kullanıcı adı").fill(SEED_USERNAMES.admin);
  await page.getByLabel("Şifre").fill(SEED_TEST_PASSWORDS.admin);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL("**/yonetim");
}

async function loginAsVehicle(page: Page, plate: string, password: string, landing: string): Promise<void> {
  await page.goto("/giris");
  await page.getByLabel("Plaka").fill(plate);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL(`**${landing}`);
}

function uniqueRawPlate(letters: string): string {
  return `34 ${letters} ${100 + (Date.now() % 900)}`;
}

async function createVehicleViaUi(page: Page, businessId: string, plate: string): Promise<string> {
  await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
  await page.getByLabel("Plaka").fill(plate);
  await page.getByLabel("Sahip şifresi").fill(OWNER_PASSWORD);
  await page.getByLabel("Şoför şifresi").fill(DRIVER_PASSWORD);
  await page.getByRole("button", { name: "Aracı kaydet" }).click();
  await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

/** Aynı işletmede iki yeni araç açar (ekip oturumuyla). */
async function createBusinessWithTwoVehicles(page: Page) {
  await loginAsAdmin(page);
  await page.goto("/yonetim/isletmeler/yeni");
  const businessName = `Şoför E2E ${Date.now()}`;
  await page.getByLabel("İşletme adı").fill(businessName);
  await page.getByLabel("Sahibin ad soyadı").fill("Sevim Sahip");
  await page.getByRole("button", { name: "İşletmeyi kaydet" }).click();
  await page.waitForURL(/\/yonetim\/isletmeler\/[0-9a-f-]{36}$/);
  const businessId = page.url().split("/").pop()!;
  const plateA = uniqueRawPlate("DRA");
  const plateB = uniqueRawPlate("DRB");
  const vehicleA = await createVehicleViaUi(page, businessId, plateA);
  const vehicleB = await createVehicleViaUi(page, businessId, plateB);
  return { businessName, plateA, plateB, vehicleA, vehicleB };
}

async function newOwnerPage(browser: Browser, baseURL: string | undefined, plate: string): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await loginAsVehicle(page, plate, OWNER_PASSWORD, "/sahip");
  return page;
}

async function openAddPanel(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "+ Şoför ekle" });
  await expect(async () => {
    await toggle.click();
    await expect(page.getByLabel("Ad soyad")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function showInactive(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Pasif şoförleri göster" });
  await expect(async () => {
    await toggle.click();
    await expect(page.getByRole("heading", { name: "Pasif şoförler" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

function activeSection(page: Page) {
  return page.locator("div").filter({ has: page.getByRole("heading", { name: "Aktif şoförler" }) }).last();
}

test.describe("Şoförlerim", () => {
  test("sahip: şoför ekler, yeniden adlandırır, pasife alır, geri açar; başka araçtan kişiyi bağlar; ekip tüm araçlarda pasife alır", async ({
    page,
    browser,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { businessName, plateA, plateB, vehicleA } = await createBusinessWithTwoVehicles(page);

    // --- Sahip (araç A) ---
    const owner = await newOwnerPage(browser, baseURL, plateA);
    await expect(owner.getByRole("heading", { name: "Özet" })).toBeVisible();
    await owner.getByRole("link", { name: "Şoförlerim" }).click();
    await owner.waitForURL("**/sahip/soforler");
    await expect(owner.getByText(EMPTY_TEXT)).toBeVisible();
    // Sahip arayüzünde küresel aktiflik kontrolü YOK.
    await expect(owner.getByRole("button", { name: /Tüm araçlarda/ })).toHaveCount(0);

    await openAddPanel(owner);
    await owner.getByLabel("Ad soyad").fill("Ali Veli");
    await owner.getByRole("button", { name: "Şoförü kaydet" }).click();
    const aliRow = owner.getByRole("listitem").filter({ hasText: "Ali Veli" });
    await expect(aliRow).toBeVisible();
    await expect(owner.getByText(EMPTY_TEXT)).toHaveCount(0);

    // Yeniden adlandırma — not görünür.
    await aliRow.getByRole("button", { name: "Düzenle" }).click();
    await expect(owner.getByText(RENAME_NOTE)).toBeVisible();
    await owner.getByLabel("Ad soyad").fill("Ali Veli Yıldız");
    await owner.getByRole("button", { name: "Kaydet", exact: true }).click();
    const renamedRow = owner.getByRole("listitem").filter({ hasText: "Ali Veli Yıldız" });
    await expect(renamedRow).toBeVisible();

    // Bu araçta pasife al → F3 uyarısı, liste boş.
    await renamedRow.getByRole("button", { name: "Bu araçta pasife al" }).click();
    await expect(owner.getByText(SHARED_PASSWORD_WARNING)).toBeVisible();
    await expect(owner.getByText(EMPTY_TEXT)).toBeVisible();

    // Pasif listeden yeniden aktifleştir.
    await showInactive(owner);
    await owner
      .getByRole("listitem")
      .filter({ hasText: "Ali Veli Yıldız" })
      .getByRole("button", { name: "Yeniden aktifleştir" })
      .click();
    await expect(owner.getByText(EMPTY_TEXT)).toHaveCount(0);
    await expect(
      activeSection(owner).getByRole("listitem").filter({ hasText: "Ali Veli Yıldız" }),
    ).toBeVisible();
    await expect(owner.getByText(SHARED_PASSWORD_WARNING)).toHaveCount(0);

    // --- Sahip (araç B): kişiyi ikinci kişi açmadan bağlar ---
    const ownerB = await newOwnerPage(browser, baseURL, plateB);
    await ownerB.goto("/sahip/soforler");
    await openAddPanel(ownerB);
    await expect(ownerB.getByRole("heading", { name: "Kayıtlı kişiyi bağla" })).toBeVisible();
    await ownerB.getByLabel("Ad soyad").fill("ali veli");
    await expect(ownerB.getByText(/Benzer adlı kayıtlı kişi var: Ali Veli Yıldız/)).toBeVisible();
    await ownerB.getByRole("button", { name: "Bu araca bağla" }).click();
    await expect(
      activeSection(ownerB).getByRole("listitem").filter({ hasText: "Ali Veli Yıldız" }),
    ).toBeVisible();
    await expect(ownerB.getByRole("heading", { name: "Kayıtlı kişiyi bağla" })).toHaveCount(0);

    // --- Ekip: bağlam, şifre sıfırlama bağlantısı, etkilenen araçlar ---
    await page.goto(`/yonetim/araclar/${vehicleA}/soforler`);
    await expect(page.getByText(new RegExp(`${plateA}.*${businessName}.*Sahip: Sevim Sahip`))).toBeVisible();
    await expect(page.getByText(SEED_USERNAMES.admin)).toBeVisible();
    const staffRow = page.getByRole("listitem").filter({ hasText: "Ali Veli Yıldız" });
    await expect(staffRow.getByRole("link", { name: "Şifre sıfırla" })).toHaveAttribute(
      "href",
      `/yonetim/araclar/${vehicleA}#sifre-sifirlama`,
    );
    await showInactive(page);
    await staffRow.getByRole("button", { name: "Tüm araçlarda pasife al" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(plateA)).toBeVisible();
    await expect(dialog.getByText(plateB)).toBeVisible();
    await dialog.getByRole("button", { name: "Pasife al" }).click();
    await expect(page.getByText("Kişi tüm araçlarda pasife alındı.")).toBeVisible();
    await expect(page.getByText(EMPTY_TEXT)).toBeVisible();
    await expect(page.getByText(SHARED_PASSWORD_WARNING)).toHaveCount(0);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Ali Veli Yıldız" }).getByRole("button", {
        name: "Kişiyi yeniden aktifleştir",
      }),
    ).toBeVisible();

    // Sahip tarafında kişi artık aktif listede değil.
    await owner.reload();
    await expect(owner.getByText(EMPTY_TEXT)).toBeVisible();
  });

  test("aynı adlı iki kişi iki ayrı satır olarak listelenir (seed 34 AAA 001)", async ({ page }) => {
    await loginAsVehicle(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await page.goto("/sahip/soforler");
    await expect(page.getByRole("listitem").filter({ hasText: "Mehmet Öz" })).toHaveCount(2);
    await expect(page.getByRole("listitem").filter({ hasText: "Hüseyin Ak" })).toHaveCount(1);
  });

  test("/sahip mevcut başlığı ve metni korur, Şoförlerim bağlantısı eklenir", async ({ page }) => {
    await loginAsVehicle(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await expect(page.getByRole("heading", { name: "Özet" })).toBeVisible();
    await expect(
      page.getByText("Sahip girişi başarılı. Özet ve raporlar bir sonraki aşamada"),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Şoförlerim" })).toHaveAttribute("href", "/sahip/soforler");
  });

  test("anonim, şoför ve sahip oturumları yetkisiz sayfaları açamaz", async ({ page, browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;

    // Anonim.
    await page.goto("/sahip/soforler");
    await page.waitForURL("**/giris");
    await page.goto("/yonetim/araclar/00000000-0000-4000-8000-000000000000/soforler");
    await page.waitForURL("**/yonetim/giris");

    // Şoför oturumu → /sahip/soforler /sofor'a döner.
    const driverContext = await browser.newContext({ baseURL });
    const driverPage = await driverContext.newPage();
    await loginAsVehicle(driverPage, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver, "/sofor");
    await driverPage.goto("/sahip/soforler");
    await driverPage.waitForURL("**/sofor");
    await driverPage.goto("/yonetim/araclar/00000000-0000-4000-8000-000000000000/soforler");
    await driverPage.waitForURL("**/sofor");

    // Sahip oturumu ekip sayfasına giremez.
    await loginAsVehicle(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await page.goto("/yonetim/araclar/00000000-0000-4000-8000-000000000000/soforler");
    await page.waitForURL("**/sahip");
  });
});
