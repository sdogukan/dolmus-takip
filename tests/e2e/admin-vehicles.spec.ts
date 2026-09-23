import { expect, test, type Page } from "@playwright/test";
import { SEED_RAW_PLATES, SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";

/**
 * Araç oluşturma/düzenleme/aktiflik uçtan uca testleri — T2.2, S2.2.
 *
 * `./admin-businesses.spec.ts` İLE AYNI altyapı (gerçek standalone sunucu,
 * gerçek DB, `../../scripts/db-seed-dev.ts` `seedDevData`'nın tek kaynağı)
 * — yeni bir `webServer`/config EKLENMEZ. `../../playwright.config.ts`
 * `workers: 1` + `fullyParallel: false` — bu dosyadaki testler HER BİRİ
 * KENDİ oluşturduğu işletme/plaka ile çalışır (paylaşılan seed verisine
 * dokunmaz), o yüzden `admin-businesses.spec.ts`'in "pasifleştirme etkisi"
 * testindeki `try/finally` geri alma deseni burada GEREKMEZ.
 */

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/yonetim/giris");
  await page.getByLabel("Kullanıcı adı").fill(SEED_USERNAMES.admin);
  await page.getByLabel("Şifre").fill(SEED_TEST_PASSWORDS.admin);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL("**/yonetim");
}

/** `0..899` arası saniyenin son üç hanesinden türetilen, format kurallarına
 * uyan (il kodu 34, harfler Q/W/X içermez) benzersiz-yeterli bir ham plaka
 * üretir — testler `workers: 1` altında sıralı çalıştığından iki ayrı
 * `test()` çağrısı arasında çakışma riski PRATİKTE yoktur. */
function uniqueRawPlate(letters: string): string {
  const suffix = String(100 + (Date.now() % 900));
  return `34 ${letters} ${suffix}`;
}

async function createBusinessViaUi(page: Page, name: string, ownerFullName: string): Promise<string> {
  await page.goto("/yonetim/isletmeler/yeni");
  await page.getByLabel("İşletme adı").fill(name);
  await page.getByLabel("Sahibin ad soyadı").fill(ownerFullName);
  await page.getByRole("button", { name: "İşletmeyi kaydet" }).click();
  await page.waitForURL(/\/yonetim\/isletmeler\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

interface NewVehicleOptions {
  plate: string;
  ownerPassword: string;
  driverPassword: string;
  brandModel?: string;
}

/** Yeni araç formunu doldurur, göndermez — testler kendi anını (submit/route
 * interception) kurduktan sonra kendi `click()`'ini çağırır. */
async function fillNewVehicleForm(page: Page, options: NewVehicleOptions): Promise<void> {
  await page.getByLabel("Plaka").fill(options.plate);
  if (options.brandModel) {
    await page.getByLabel("Marka / model").fill(options.brandModel);
  }
  await page.getByLabel("Sahip şifresi").fill(options.ownerPassword);
  await page.getByLabel("Şoför şifresi").fill(options.driverPassword);
}

test.describe("Araç oluşturma (/yonetim/isletmeler/:id/araclar/yeni)", () => {
  test("ekip kullanıcısı araç açar; yeni plaka sahip ve şoför şifresiyle ayrı ayrı giriş yapar", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `Araç E2E ${Date.now()}`, "Ayşe Sahip");

    await page.getByRole("link", { name: "+ Araç ekle" }).click();
    await page.waitForURL(`**/yonetim/isletmeler/${businessId}/araclar/yeni`);
    // Bağlı işletme/sahip başlığı — kaydetmeden önce görünür.
    await expect(page.getByText("Sahip: Ayşe Sahip")).toBeVisible();

    const plate = uniqueRawPlate("TST");
    await fillNewVehicleForm(page, {
      plate,
      ownerPassword: "sahip-e2e-1",
      driverPassword: "sofor-e2e-1",
    });
    await page.getByRole("button", { name: "Aracı kaydet" }).click();

    await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);
    const vehicleId = page.url().split("/").pop()!;
    await expect(page.getByRole("heading", { level: 1 })).toContainText("TST");

    // Şifreler kaydettikten sonra hiçbir yerde tekrar gösterilmez.
    await expect(page.getByLabel("Sahip şifresi")).toHaveCount(0);
    await expect(page.getByLabel("Şoför şifresi")).toHaveCount(0);

    // Yeni plaka sahip şifresiyle /sahip'e girer.
    await page.getByRole("button", { name: "Çıkış" }).click();
    await page.waitForURL("**/yonetim/giris");
    await page.goto("/giris");
    await page.getByLabel("Plaka").fill(plate);
    await page.getByLabel("Şifre").fill("sahip-e2e-1");
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/sahip");
    await page.getByRole("button", { name: "Çıkış" }).click();

    // Aynı plaka şoför şifresiyle /sofor'a girer.
    await page.goto("/giris");
    await page.getByLabel("Plaka").fill(plate);
    await page.getByLabel("Şifre").fill("sofor-e2e-1");
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/sofor");

    void vehicleId;
  });

  test("aynı plaka farklı boşluk/büyük-küçük harfle 'Bu plaka zaten kayıtlı.' alan hatası gösterir", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `Plaka Çakışma ${Date.now()}`, "Mehmet Sahip");
    const rawPlate = uniqueRawPlate("PLK");

    await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
    await fillNewVehicleForm(page, {
      plate: rawPlate,
      ownerPassword: "sahip-e2e-2",
      driverPassword: "sofor-e2e-2",
    });
    await page.getByRole("button", { name: "Aracı kaydet" }).click();
    await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);

    // Aynı normalize plakayı FARKLI boşluk/büyük-küçük harfle tekrar dener.
    const variantPlate = rawPlate.toLowerCase().replace(/\s+/g, "");
    await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
    await fillNewVehicleForm(page, {
      plate: variantPlate,
      ownerPassword: "sahip-e2e-3",
      driverPassword: "sofor-e2e-4",
    });
    await page.getByRole("button", { name: "Aracı kaydet" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "Bu plaka zaten kayıtlı." })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/araclar/yeni$`));
  });

  test("sahip ve şoför şifresi aynı olursa alan hatası gösterilir, araç oluşturulmaz", async ({ page }) => {
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `Eşit Şifre ${Date.now()}`, "Elif Sahip");
    const plate = uniqueRawPlate("EST");

    await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
    await fillNewVehicleForm(page, {
      plate,
      ownerPassword: "ayni-sifre-123",
      driverPassword: "ayni-sifre-123",
    });
    await page.getByRole("button", { name: "Aracı kaydet" }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "Sahip ve şoför şifreleri aynı olamaz." }),
    ).toHaveCount(2);
    // Kaydolmadı — hâlâ oluşturma sayfasında.
    await expect(page).toHaveURL(new RegExp(`/araclar/yeni$`));

    // İşletme sayfasında hiç araç yok — gerçekten oluşturulmadı.
    await page.goto(`/yonetim/isletmeler/${businessId}`);
    await expect(page.getByText("Bu işletmede araç yok.")).toBeVisible();
  });

  test("gönderim sırasında bağlantı koparsa sonucu kontrol ekranı çıkar; şifreler tekrar girilince kayıt tamamlanır", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `Belirsiz Sonuç ${Date.now()}`, "Kemal Sahip");
    const plate = uniqueRawPlate("AMB");

    await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
    await fillNewVehicleForm(page, {
      plate,
      ownerPassword: "sahip-amb-1",
      driverPassword: "sofor-amb-1",
    });

    await page.route("**/api/v1/admin/vehicles", async (route) => {
      await route.abort();
    });
    await page.getByRole("button", { name: "Aracı kaydet" }).click();
    await expect(page.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();

    // Sayfa yenilenir — dosya üstü notu — şifreler taslakta ASLA
    // saklanmaz, yalnız gizli olmayan alanlar (plaka vb.) hayatta kalır;
    // "ambiguous" ekranı BOŞ şifre alanlarıyla geri gelir.
    await page.unroute("**/api/v1/admin/vehicles");
    await page.reload();
    await expect(page.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();
    await expect(page.getByLabel("Plaka")).toHaveValue(plate);
    await expect(page.getByLabel("Sahip şifresi")).toHaveValue("");
    await expect(page.getByLabel("Şoför şifresi")).toHaveValue("");
    const retryButton = page.getByRole("button", { name: "Tekrar kontrol et" });
    await expect(retryButton).toBeDisabled();

    await page.getByLabel("Sahip şifresi").fill("sahip-amb-1");
    await page.getByLabel("Şoför şifresi").fill("sofor-amb-1");
    await expect(retryButton).toBeEnabled();
    await retryButton.click();

    await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);
  });

  test("araç (owner/driver) oturumu araç ekleme sayfasını açamaz", async ({ page }) => {
    await page.goto("/giris");
    await page.getByLabel("Plaka").fill(SEED_RAW_PLATES.vehicleA1);
    await page.getByLabel("Şifre").fill(SEED_TEST_PASSWORDS.owner);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/sahip");

    await page.goto("/yonetim/isletmeler/nonexistent-id/araclar/yeni");
    await page.waitForURL("**/sahip");
  });

  test("oturumsuz erişim /yonetim/giris'e yönlendirir", async ({ page }) => {
    await page.goto("/yonetim/isletmeler/nonexistent-id/araclar/yeni");
    await page.waitForURL("**/yonetim/giris");
  });

  test("şifreler localStorage/sessionStorage'a hiç yazılmaz", async ({ page }) => {
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `Depolama Kontrolü ${Date.now()}`, "Zeynep Sahip");
    const plate = uniqueRawPlate("DEP");

    await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
    await fillNewVehicleForm(page, {
      plate,
      ownerPassword: "gizli-sahip-sifre",
      driverPassword: "gizli-sofor-sifre",
    });

    const storageDump = await page.evaluate(() => {
      const dump: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) dump.push(window.localStorage.getItem(key) ?? "");
      }
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key) dump.push(window.sessionStorage.getItem(key) ?? "");
      }
      return dump.join("\n");
    });
    expect(storageDump).not.toContain("gizli-sahip-sifre");
    expect(storageDump).not.toContain("gizli-sofor-sifre");

    await page.getByRole("button", { name: "Aracı kaydet" }).click();
    await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);

    const storageDumpAfter = await page.evaluate(() => {
      const dump: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) dump.push(window.localStorage.getItem(key) ?? "");
      }
      return dump.join("\n");
    });
    expect(storageDumpAfter).not.toContain("gizli-sahip-sifre");
    expect(storageDumpAfter).not.toContain("gizli-sofor-sifre");
  });
});

test.describe("Araç detayı (/yonetim/araclar/:id)", () => {
  async function createVehicleViaUi(
    page: Page,
    businessId: string,
    options: NewVehicleOptions,
  ): Promise<string> {
    await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
    await fillNewVehicleForm(page, options);
    await page.getByRole("button", { name: "Aracı kaydet" }).click();
    await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);
    return page.url().split("/").pop()!;
  }

  test("marka/model, yıl, hat/durak notu ve not düzenlenir; sayfa yenilenince korunur", async ({ page }) => {
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `Düzenleme ${Date.now()}`, "Hasan Sahip");
    const vehicleId = await createVehicleViaUi(page, businessId, {
      plate: uniqueRawPlate("DZN"),
      ownerPassword: "sahip-dzn-1",
      driverPassword: "sofor-dzn-1",
    });

    await page.getByLabel("Marka / model").fill("Ford Transit");
    await page.getByLabel("Yıl").fill("2018");
    await page.getByLabel("Hat / durak notu").fill("Kadıköy - Beşiktaş");
    await page.getByLabel("Not", { exact: true }).fill("Klimalı araç");
    await page.getByRole("button", { name: "Bilgiyi kaydet" }).click();
    await expect(page.getByRole("button", { name: "Bilgiyi kaydet" })).toBeDisabled();

    await page.reload();
    await expect(page.getByLabel("Marka / model")).toHaveValue("Ford Transit");
    await expect(page.getByLabel("Yıl")).toHaveValue("2018");
    await expect(page.getByLabel("Hat / durak notu")).toHaveValue("Kadıköy - Beşiktaş");
    await expect(page.getByLabel("Not", { exact: true })).toHaveValue("Klimalı araç");

    void vehicleId;
  });

  test("iki sekmeden eski sürümle kaydetme 'Bu kayıt değişmiş' metnini gösterir", async ({ page }) => {
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `Araç Sürüm ${Date.now()}`, "Selin Sahip");
    const vehicleId = await createVehicleViaUi(page, businessId, {
      plate: uniqueRawPlate("VRS"),
      ownerPassword: "sahip-vrs-1",
      driverPassword: "sofor-vrs-1",
    });

    const csrfToken = await page.evaluate(async () => {
      const response = await fetch("/api/v1/session");
      const body = (await response.json()) as { csrfToken: string };
      return body.csrfToken;
    });
    await page.evaluate(
      async ({ vehicleId, csrfToken }) => {
        await fetch(`/api/v1/admin/vehicles/${vehicleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ requestId: crypto.randomUUID(), version: 1, note: "Başka sekmeden" }),
        });
      },
      { vehicleId, csrfToken },
    );

    await page.getByLabel("Not", { exact: true }).fill("Bu sekmeden değişiklik");
    await page.getByRole("button", { name: "Bilgiyi kaydet" }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et." }),
    ).toBeVisible();
    await expect(page.getByLabel("Not", { exact: true })).toHaveValue("Bu sekmeden değişiklik");
  });

  test("pasifleştirme: ConfirmDialog sonrası giriş reddedilir, araç işletme sayfasından hâlâ açılabilir", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `Araç Pasif ${Date.now()}`, "Burak Sahip");
    const plate = uniqueRawPlate("PSF");
    const vehicleId = await createVehicleViaUi(page, businessId, {
      plate,
      ownerPassword: "sahip-psf-1",
      driverPassword: "sofor-psf-1",
    });

    await page.getByRole("button", { name: "Aracı pasifleştir" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("oturum açamaz");
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.request().method() === "PATCH" &&
          candidate.url().includes(`/api/v1/admin/vehicles/${vehicleId}`),
      ),
      dialog.getByRole("button", { name: "Pasifleştir", exact: true }).click(),
    ]);
    expect(response.status()).toBe(200);
    await expect(page.getByRole("button", { name: "Aracı yeniden aktifleştir" })).toBeVisible();

    await page.getByRole("button", { name: "Çıkış" }).click();
    await page.waitForURL("**/yonetim/giris");
    await page.goto("/giris");
    await page.getByLabel("Plaka").fill(plate);
    await page.getByLabel("Şifre").fill("sahip-psf-1");
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Plaka veya şifre yanlış." })).toBeVisible();

    // Araç geçmişi silinmedi — işletme sayfasından hâlâ açılabilir.
    await loginAsAdmin(page);
    await page.goto(`/yonetim/isletmeler/${businessId}`);
    await page.getByRole("link", { name: new RegExp(plate.replace(/\s+/g, "")) }).click();
    await page.waitForURL(`**/yonetim/araclar/${vehicleId}`);
    await expect(page.getByRole("button", { name: "Aracı yeniden aktifleştir" })).toBeVisible();
  });

  test("bilinmeyen araç 404 gösterir", async ({ page }) => {
    await loginAsAdmin(page);
    const response = await page.goto("/yonetim/araclar/00000000-0000-4000-8000-000000000000");
    expect(response?.status()).toBe(404);
  });

  test("araç (owner/driver) oturumu araç detay sayfasını açamaz", async ({ page }) => {
    await page.goto("/giris");
    await page.getByLabel("Plaka").fill(SEED_RAW_PLATES.vehicleA1);
    await page.getByLabel("Şifre").fill(SEED_TEST_PASSWORDS.owner);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/sahip");

    await page.goto("/yonetim/araclar/00000000-0000-4000-8000-000000000000");
    await page.waitForURL("**/sahip");
  });
});
