import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";

/**
 * KVKK ad anonimleştirme arayüzü — ekip şoför ekranı
 * (`/yonetim/araclar/:id/soforler`) ve işletme sahibi bölümü
 * (`/yonetim/isletmeler/:id`). "Adı anonimleştir" yalnız yöneticide görünür,
 * ConfirmDialog ile onaylanır; sonrasında satır anonim adı gösterir ve ne
 * yeniden adlandırma ne anonimleştirme sunar. Belirsiz sonuç (ağ hatası/5xx)
 * AYNI requestId ve AYNI gövdeyle yeniden denenir. Testler KENDİ işletme ve
 * araçlarını açar; seed verisi yalnız okunur (`./drivers.spec.ts` deseni).
 */

const OWNER_PASSWORD = "sahip-e2e-anonim";
const DRIVER_PASSWORD = "sofor-e2e-anonim";
const ACTION = "Adı anonimleştir";
const ANONYMOUS_NAME = /Anonim kişi [0-9A-F]{6}/;
const ANONYMIZED_NOTE = "Ad, kişisel veri silme talebiyle anonimleştirildi; değiştirilemez.";
const CHECKING = "Kaydın sonucu kontrol ediliyor.";

async function loginAsStaff(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/yonetim/giris");
  await page.getByLabel("Kullanıcı adı").fill(username);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL("**/yonetim");
}

function uniqueRawPlate(letters: string): string {
  return `34 ${letters} ${100 + (Date.now() % 900)}`;
}

/** Yönetici oturumuyla yeni işletme (sahibiyle) ve bir araç açar. */
async function createBusinessWithVehicle(page: Page, ownerName: string, letters: string) {
  await loginAsStaff(page, SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
  await page.goto("/yonetim/isletmeler/yeni");
  await page.getByLabel("İşletme adı").fill(`Anonim E2E ${Date.now()}`);
  await page.getByLabel("Sahibin ad soyadı").fill(ownerName);
  await page.getByRole("button", { name: "İşletmeyi kaydet" }).click();
  await page.waitForURL(/\/yonetim\/isletmeler\/[0-9a-f-]{36}$/);
  const businessId = page.url().split("/").pop()!;
  const plate = uniqueRawPlate(letters);
  await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
  await page.getByLabel("Plaka").fill(plate);
  await page.getByLabel("Sahip şifresi").fill(OWNER_PASSWORD);
  await page.getByLabel("Şoför şifresi").fill(DRIVER_PASSWORD);
  await page.getByRole("button", { name: "Aracı kaydet" }).click();
  await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);
  const vehicleId = page.url().split("/").pop()!;
  return { businessId, vehicleId, plate };
}

async function addDriverOnStaffScreen(page: Page, vehicleId: string, fullName: string): Promise<Locator> {
  await page.goto(`/yonetim/araclar/${vehicleId}/soforler`);
  const toggle = page.getByRole("button", { name: "+ Şoför ekle" });
  await expect(async () => {
    await toggle.click();
    await expect(page.getByLabel("Ad soyad")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByLabel("Ad soyad").fill(fullName);
  await page.getByRole("button", { name: "Şoförü kaydet" }).click();
  const row = page.getByRole("listitem").filter({ hasText: fullName });
  await expect(row).toBeVisible();
  return row;
}

/** Yerel (ağsız) tıklama — hidrasyon tamamlanana dek tekrarlanır. */
async function openAnonymizeDialog(page: Page, trigger: Locator): Promise<Locator> {
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return dialog;
}

async function newPageIn(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  return context.newPage();
}

test.describe("KVKK ad anonimleştirme", () => {
  test("yönetici şoför ekranında onaylar; satır anonim adı gösterir, düzenleme/anonimleştirme kalmaz; sahip ekranında da işlem yok", async ({
    page,
    browser,
  }, testInfo) => {
    const { vehicleId, plate } = await createBusinessWithVehicle(page, "Selim Sahip", "ANA");
    const row = await addDriverOnStaffScreen(page, vehicleId, "Kemal Silinecek");
    await expect(row.getByRole("button", { name: "Düzenle" })).toBeVisible();

    const dialog = await openAnonymizeDialog(page, row.getByRole("button", { name: ACTION }));
    await expect(dialog.getByRole("heading", { name: "Kişinin adını anonimleştir" })).toBeVisible();
    await expect(dialog.getByText(/Kemal Silinecek adı kalıcı olarak/)).toBeVisible();
    await expect(dialog.getByText(/geri alınamaz/)).toBeVisible();
    // Vazgeç hiçbir şey göndermez; odak tetikleyen düğmeye döner.
    await dialog.getByRole("button", { name: "Vazgeç" }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByRole("button", { name: ACTION })).toBeFocused();

    const confirmDialog = await openAnonymizeDialog(page, row.getByRole("button", { name: ACTION }));
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/anonymize")),
      confirmDialog.getByRole("button", { name: "Anonimleştir", exact: true }).click(),
    ]);
    expect(response.status()).toBe(200);

    await expect(page.getByText("Kişinin adı anonimleştirildi.")).toBeVisible();
    await expect(page.getByText("Kemal Silinecek")).toHaveCount(0);
    const anonymizedRow = page.getByRole("listitem").filter({ hasText: ANONYMOUS_NAME });
    await expect(anonymizedRow).toBeVisible();
    await expect(anonymizedRow.getByText(ANONYMIZED_NOTE)).toBeVisible();
    await expect(anonymizedRow.getByRole("button", { name: "Düzenle" })).toHaveCount(0);
    await expect(anonymizedRow.getByRole("button", { name: ACTION })).toHaveCount(0);

    // Sahip ekranı (mode="owner") anonimleştirme sunmaz; anonim satır yeniden adlandırılamaz.
    const owner = await newPageIn(browser, testInfo.project.use.baseURL);
    await owner.goto("/giris");
    await owner.getByLabel("Plaka").fill(plate);
    await owner.getByLabel("Şifre").fill(OWNER_PASSWORD);
    await owner.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await owner.waitForURL("**/sahip");
    await owner.goto("/sahip/soforler");
    const ownerRow = owner.getByRole("listitem").filter({ hasText: ANONYMOUS_NAME });
    await expect(ownerRow).toBeVisible();
    await expect(owner.getByRole("button", { name: ACTION })).toHaveCount(0);
    await expect(ownerRow.getByRole("button", { name: "Düzenle" })).toHaveCount(0);
  });

  test("ağ hatasında sonuç belirsiz kalır; sayfa yenilense de 'Tekrar kontrol et' AYNI requestId ve AYNI gövdeyi gönderir", async ({
    page,
  }) => {
    const { businessId, vehicleId } = await createBusinessWithVehicle(page, "Nuri Sahip", "ANB");
    const row = await addDriverOnStaffScreen(page, vehicleId, "Hakan Belirsiz");

    const anonymizeGlob = `**/api/v1/admin/businesses/${businessId}/people/*/anonymize`;
    const abortedBodies: string[] = [];
    await page.route(anonymizeGlob, async (route) => {
      abortedBodies.push(route.request().postData() ?? "");
      await route.abort();
    });
    const dialog = await openAnonymizeDialog(page, row.getByRole("button", { name: ACTION }));
    await dialog.getByRole("button", { name: "Anonimleştir", exact: true }).click();
    await expect(page.getByText(CHECKING)).toBeVisible();
    expect(abortedBodies).toHaveLength(1);
    const firstBody = JSON.parse(abortedBodies[0]!) as Record<string, unknown>;
    expect(Object.keys(firstBody).sort()).toEqual(["requestId", "version"]);

    // Çözülene dek satırın ad işlemleri kilitli.
    await expect(row.getByRole("button", { name: "Düzenle" })).toBeDisabled();
    await expect(row.getByRole("button", { name: ACTION })).toBeDisabled();

    await page.unroute(anonymizeGlob);
    await page.reload();
    await expect(page.getByText(CHECKING)).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Hakan Belirsiz" }).getByRole("button", { name: "Düzenle" }),
    ).toBeDisabled();

    const [retried] = await Promise.all([
      page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/anonymize")),
      page.getByRole("button", { name: "Tekrar kontrol et" }).click(),
    ]);
    expect(retried.postData()).toBe(abortedBodies[0]);
    expect(retried.url()).toContain(`/api/v1/admin/businesses/${businessId}/people/`);

    await expect(page.getByRole("listitem").filter({ hasText: ANONYMOUS_NAME })).toBeVisible();
    await expect(page.getByText(CHECKING)).toHaveCount(0);
    await expect(page.getByText("Hakan Belirsiz")).toHaveCount(0);
  });

  test("işletme sahibi bölümü: 5xx sonrası aynı gövdeyle yeniden denenir; anonim sahip adı düzenlenemez", async ({
    page,
  }) => {
    const { businessId } = await createBusinessWithVehicle(page, "Leyla Sahipsilinir", "ANC");
    await page.goto(`/yonetim/isletmeler/${businessId}`);
    await expect(page.getByText("Mal sahibi: Leyla Sahipsilinir")).toBeVisible();

    const anonymizeGlob = `**/api/v1/admin/businesses/${businessId}/people/*/anonymize`;
    const failedBodies: string[] = [];
    await page.route(anonymizeGlob, async (route) => {
      failedBodies.push(route.request().postData() ?? "");
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    const dialog = await openAnonymizeDialog(page, page.getByRole("button", { name: ACTION }));
    await expect(dialog.getByText(/Leyla Sahipsilinir adı kalıcı olarak/)).toBeVisible();
    await dialog.getByRole("button", { name: "Anonimleştir", exact: true }).click();
    await expect(page.getByText(CHECKING)).toBeVisible();
    // Belirsizken sahip adı düzeltmesi ve anonimleştirme kilitli.
    await expect(page.locator("#owner-name-edit")).toBeDisabled();
    await expect(page.getByRole("button", { name: ACTION })).toBeDisabled();

    await page.unroute(anonymizeGlob);
    const [retried] = await Promise.all([
      page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/anonymize")),
      page.getByRole("button", { name: "Tekrar kontrol et" }).click(),
    ]);
    expect(failedBodies).toHaveLength(1);
    expect(retried.postData()).toBe(failedBodies[0]);

    await expect(page.getByText(/^Mal sahibi: Anonim kişi [0-9A-F]{6}$/)).toBeVisible();
    await expect(page.getByText(ANONYMIZED_NOTE)).toBeVisible();
    await expect(page.locator("#owner-name-edit")).toHaveCount(0);
    await expect(page.getByRole("button", { name: ACTION })).toHaveCount(0);

    // Sunucudan taze okuma da aynı durumu verir.
    await page.reload();
    await expect(page.getByText(/^Mal sahibi: Anonim kişi [0-9A-F]{6}$/)).toBeVisible();
    await expect(page.getByText("Leyla Sahipsilinir")).toHaveCount(0);
    await expect(page.locator("#owner-name-edit")).toHaveCount(0);
  });

  test("destek kullanıcısı şoför ekranında ve işletme sahibi bölümünde anonimleştirme görmez", async ({
    page,
    browser,
  }, testInfo) => {
    const { businessId, vehicleId } = await createBusinessWithVehicle(page, "Oya Sahip", "AND");
    await addDriverOnStaffScreen(page, vehicleId, "Cemil Destekgormez");
    await expect(page.getByRole("button", { name: ACTION })).toHaveCount(1);

    const support = await newPageIn(browser, testInfo.project.use.baseURL);
    await loginAsStaff(support, SEED_USERNAMES.support, SEED_TEST_PASSWORDS.support);
    await support.goto(`/yonetim/araclar/${vehicleId}/soforler`);
    const supportRow = support.getByRole("listitem").filter({ hasText: "Cemil Destekgormez" });
    await expect(supportRow.getByRole("button", { name: "Düzenle" })).toBeVisible();
    await expect(support.getByRole("button", { name: ACTION })).toHaveCount(0);

    await support.goto(`/yonetim/isletmeler/${businessId}`);
    await expect(support.getByText("Mal sahibi: Oya Sahip")).toBeVisible();
    await expect(support.locator("#owner-name-edit")).toBeVisible();
    await expect(support.getByRole("button", { name: ACTION })).toHaveCount(0);
  });
});
