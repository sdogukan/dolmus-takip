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

    // Şifreler kaydettikten sonra hiçbir yerde tekrar gösterilmez. `input[type=password]`
    // ile daraltılır — araç detay sayfasındaki şifre sıfırlama bölümü (S2.3) AYNI "Şoför
    // şifresi" metnini kendi erişim seçimi radio düğmesi için KULLANIR (S2.3 AC1 birebir
    // etiket); bu radio düğmesi FARKLI bir alan (`input[type=radio]`), gönderilen şifreyi
    // TAŞIMAZ/göstermez.
    await expect(
      page.getByLabel("Sahip şifresi").and(page.locator('input[type="password"]')),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Şoför şifresi").and(page.locator('input[type="password"]')),
    ).toHaveCount(0);

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

  test("sayfa yenilendikten sonra şifreler karakter karakter tam yazılabilir; kısaltılmış şifreyle giriş başarısız olur (C4)", async ({
    page,
  }) => {
    // C4 review bulgusu — kilit ESKİDEN girdinin ANLIK DEĞERİNE bakıyordu:
    // sayfa yenilenip alanlar BOŞ döndüğünde ekip üyesinin yazdığı İLK
    // karakter değeri boş-olmayan yapıp alanı ANINDA kilitliyordu; geri
    // kalan karakterler hiç yazılamıyor, "Tekrar kontrol et" 1 karakterlik
    // şifreyle aracı oluşturuyordu. Kilit artık bellekteki GÖNDERİLMİŞ
    // çiftin varlığına bakar; sayfa yenilendiğinde bu çift YOKTUR. `fill()`
    // DEĞİL `pressSequentially()` kullanılır — `fill()` tüm değeri TEK
    // olayda yazıp bu hatayı GİZLERDİ.
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `C4 Regresyon ${Date.now()}`, "Cem Sahip");
    const plate = uniqueRawPlate("CDR");
    const ownerPassword = "sahip-c4-reg-12";
    const driverPassword = "sofor-c4-reg-34";

    await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
    await fillNewVehicleForm(page, { plate, ownerPassword, driverPassword });

    await page.route("**/api/v1/admin/vehicles", async (route) => {
      await route.abort();
    });
    await page.getByRole("button", { name: "Aracı kaydet" }).click();
    await expect(page.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();

    // Sayfa yenilenir — bellekteki gönderilmiş çift kaybolur, alanlar BOŞ
    // ve DÜZENLENEBİLİR döner (dosya üstü notu).
    await page.unroute("**/api/v1/admin/vehicles");
    await page.reload();
    await expect(page.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();
    const ownerPasswordInput = page.getByLabel("Sahip şifresi");
    const driverPasswordInput = page.getByLabel("Şoför şifresi");
    await expect(ownerPasswordInput).toHaveValue("");
    await expect(driverPasswordInput).toHaveValue("");
    await expect(ownerPasswordInput).toBeEnabled();
    await expect(driverPasswordInput).toBeEnabled();

    // Karakter karakter yazılır — `fill()` bu regresyonu GİZLERDİ.
    await ownerPasswordInput.pressSequentially(ownerPassword);
    await driverPasswordInput.pressSequentially(driverPassword);
    await expect(ownerPasswordInput).toHaveValue(ownerPassword);
    await expect(driverPasswordInput).toHaveValue(driverPassword);
    await expect(ownerPasswordInput).toBeEnabled();
    await expect(driverPasswordInput).toBeEnabled();

    const retryButton = page.getByRole("button", { name: "Tekrar kontrol et" });
    await expect(retryButton).toBeEnabled();
    await retryButton.click();
    await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);

    await page.getByRole("button", { name: "Çıkış" }).click();
    await page.waitForURL("**/yonetim/giris");

    // Aracın oluşturulduğu tam şifreyle giriş BAŞARILI olur.
    await page.goto("/giris");
    await page.getByLabel("Plaka").fill(plate);
    await page.getByLabel("Şifre").fill(ownerPassword);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/sahip");
    await page.getByRole("button", { name: "Çıkış" }).click();

    // Şifrenin yalnız İLK karakteriyle giriş BAŞARISIZ olur — C4 önceden
    // tam bu kısaltılmış şifreyle aracı oluşturuyordu.
    await page.goto("/giris");
    await page.getByLabel("Plaka").fill(plate);
    await page.getByLabel("Şifre").fill(ownerPassword.charAt(0));
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Plaka veya şifre yanlış." })).toBeVisible();
  });

  test("sayfa yenilendikten sonra retry'ın yanıtı da kaybolursa şifre alanları kilitli kalır, yeniden gir metni çıkmaz; sonraki retry aynı şifreleri gönderir (C5)", async ({
    page,
  }) => {
    // C5 review bulgusu — bellekteki gönderilmiş çift ESKİDEN yalnız
    // `handleSubmit`te kuruluyordu; sayfa yenilendikten sonraki bir
    // "Tekrar kontrol et" bu çifti KAYDETMEDEN gönderiyordu. O retry'ın
    // yanıtı da kaybolursa (`route.fetch` + `route.abort` — istek sunucuya
    // ULAŞIR, araç gerçekten oluşur, ama yanıt tarayıcıya hiç DÖNMEZ)
    // bellekte hâlâ hiçbir çift yoktu: alanlar YANLIŞLIKLA açılıyor,
    // "yeniden gir" metni tekrar çıkıyor ve bir SONRAKİ deneme aynı
    // requestId'yi FARKLI bir şifreyle gönderebiliyordu.
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `C5 Regresyon ${Date.now()}`, "Fatma Sahip");
    const plate = uniqueRawPlate("CVR");
    const ownerPassword = "sahip-c5-reg-12";
    const driverPassword = "sofor-c5-reg-34";

    await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
    await fillNewVehicleForm(page, { plate, ownerPassword, driverPassword });

    // 1) İlk gönderim — yanıt hiç dönmeden kopar.
    await page.route("**/api/v1/admin/vehicles", async (route) => {
      await route.abort();
    });
    await page.getByRole("button", { name: "Aracı kaydet" }).click();
    await expect(page.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();

    // 2) Sayfa yenilenir — bellekteki çift kaybolur, alanlar BOŞ döner.
    await page.unroute("**/api/v1/admin/vehicles");
    await page.reload();
    await expect(page.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();
    const ownerPasswordInput = page.getByLabel("Sahip şifresi");
    const driverPasswordInput = page.getByLabel("Şoför şifresi");
    await expect(ownerPasswordInput).toHaveValue("");
    await expect(driverPasswordInput).toHaveValue("");

    // Karakter karakter yazılır — `fill()` C4 tipi hataları GİZLERDİ.
    await ownerPasswordInput.pressSequentially(ownerPassword);
    await driverPasswordInput.pressSequentially(driverPassword);

    const seenBodies: { requestId: string; ownerPassword: string; driverPassword: string }[] = [];
    let retryCallCount = 0;
    await page.route("**/api/v1/admin/vehicles", async (route) => {
      const body = route.request().postDataJSON() as {
        requestId: string;
        ownerPassword: string;
        driverPassword: string;
      };
      seenBodies.push(body);
      retryCallCount += 1;
      if (retryCallCount === 1) {
        // İstek SUNUCUYA ulaşır (araç gerçekten oluşturulur, makbuz
        // yazılır) ama yanıt tarayıcıya hiç DÖNMEZ.
        await route.fetch();
        await route.abort();
        return;
      }
      await route.continue();
    });

    const retryButton = page.getByRole("button", { name: "Tekrar kontrol et" });
    await expect(retryButton).toBeEnabled();
    await retryButton.click();

    // Kaybolan retry'dan sonra: hâlâ "ambiguous", ama bu sefer bellekte
    // ÇİFT VAR (C5 düzeltmesi) — alanlar kilitli kalmalı, "yeniden gir"
    // metni ÇIKMAMALI.
    await expect(page.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();
    await expect(page.getByText("Devam etmek için sahip ve şoför şifresini tekrar gir.")).toHaveCount(0);
    await expect(ownerPasswordInput).toBeDisabled();
    await expect(driverPasswordInput).toBeDisabled();
    await expect(ownerPasswordInput).toHaveValue(ownerPassword);
    await expect(driverPasswordInput).toHaveValue(driverPassword);

    // Bir sonraki retry GEÇER — aynı requestId + aynı şifre replay (201).
    await expect(retryButton).toBeEnabled();
    await retryButton.click();
    await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);
    const vehicleId = page.url().split("/").pop()!;

    expect(seenBodies).toHaveLength(2);
    const [lostBody, replayBody] = seenBodies as [
      (typeof seenBodies)[number],
      (typeof seenBodies)[number],
    ];
    expect(lostBody.requestId).toBe(replayBody.requestId);
    expect(lostBody.ownerPassword).toBe(replayBody.ownerPassword);
    expect(lostBody.driverPassword).toBe(replayBody.driverPassword);
    expect(replayBody.ownerPassword).toBe(ownerPassword);
    expect(replayBody.driverPassword).toBe(driverPassword);

    // Kaybolan retry ile aracı GERÇEKTEN oluşturmuştu — replay ikinci bir
    // araç DOĞURMADI, işletmede TEK araç var.
    await page.goto(`/yonetim/isletmeler/${businessId}`);
    await expect(page.getByRole("heading", { name: "Araçlar (1)" })).toBeVisible();
    await expect(page.locator(`a[href="/yonetim/araclar/${vehicleId}"]`)).toBeVisible();

    await page.getByRole("button", { name: "Çıkış" }).click();
    await page.waitForURL("**/yonetim/giris");

    // Aracın oluşturulduğu TAM şifrelerle giriş BAŞARILI olur.
    await page.goto("/giris");
    await page.getByLabel("Plaka").fill(plate);
    await page.getByLabel("Şifre").fill(ownerPassword);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/sahip");
    await page.getByRole("button", { name: "Çıkış" }).click();

    await page.goto("/giris");
    await page.getByLabel("Plaka").fill(plate);
    await page.getByLabel("Şifre").fill(driverPassword);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/sofor");
  });

  test("gönderim belirsizken (sayfa yenilenmeden) şifre alanları kilitlenir; aynı şifrelerle yeniden denenir", async ({
    page,
  }) => {
    // C2 (istemci yarısı) review bulgusu — sayfa YENİLENMEDEN, "ambiguous"
    // durumdayken şifre alanları hâlâ DOLU (bellekte); bu alanlar
    // düzenlenebilir kalırsa "Tekrar kontrol et" YANLIŞLIKLA farklı bir
    // şifreyle aynı requestId'yi gönderebilir (409 REQUEST_ID_REUSED).
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `Kilit ${Date.now()}`, "Derya Sahip");
    const plate = uniqueRawPlate("KLT");

    await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
    await fillNewVehicleForm(page, {
      plate,
      ownerPassword: "sahip-klt-1",
      driverPassword: "sofor-klt-1",
    });

    await page.route("**/api/v1/admin/vehicles", async (route) => {
      await route.abort();
    });
    await page.getByRole("button", { name: "Aracı kaydet" }).click();
    await expect(page.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();

    // Bellekteki ORİJİNAL şifreler görünür kalır ama artık KİLİTLİDİR.
    const ownerPasswordInput = page.getByLabel("Sahip şifresi");
    const driverPasswordInput = page.getByLabel("Şoför şifresi");
    await expect(ownerPasswordInput).toHaveValue("sahip-klt-1");
    await expect(driverPasswordInput).toHaveValue("sofor-klt-1");
    await expect(ownerPasswordInput).toBeDisabled();
    await expect(driverPasswordInput).toBeDisabled();

    await page.unroute("**/api/v1/admin/vehicles");
    // Yeniden yazmaya gerek yok — kilitli alanlar zaten doğru değeri taşır.
    await page.getByRole("button", { name: "Tekrar kontrol et" }).click();

    await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);
  });

  test("409 REQUEST_ID_REUSED 'zaten oluşturulmuş olabilir' metnini işletme bağlantısıyla gösterir; sonraki gönderim yeni requestId kullanır", async ({
    page,
  }) => {
    // C3 review bulgusu — requestId rotasyonu yalnız 422 alan hatasına
    // değil, 409/403/429 gibi alan dışı (banner) kesin sonuçlara da bağlı
    // olmalı; aksi halde aynı requestId 24 saatlik taslakta kalır ve HER
    // sonraki gönderim yine 409'a düşer.
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `Tekrar Kullanım ${Date.now()}`, "Emre Sahip");
    const plate = uniqueRawPlate("RID");

    await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
    await fillNewVehicleForm(page, {
      plate,
      ownerPassword: "sahip-rid-1",
      driverPassword: "sofor-rid-1",
    });

    const seenRequestIds: string[] = [];
    let callCount = 0;
    await page.route("**/api/v1/admin/vehicles", async (route) => {
      const body = route.request().postDataJSON() as { requestId: string };
      seenRequestIds.push(body.requestId);
      callCount += 1;
      if (callCount === 1) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "REQUEST_ID_REUSED",
              message: "Bu istek kimliği farklı bir işlem türü için zaten kullanılmış.",
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: "Aracı kaydet" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Bu araç zaten oluşturulmuş olabilir." }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "İşletmeye dön" })).toHaveAttribute(
      "href",
      `/yonetim/isletmeler/${businessId}`,
    );

    // Bir alanı değiştirip tekrar gönderir — YENİ bir requestId kullanılmalı.
    await page.getByLabel("Marka / model").fill("Renault Kangoo");
    await page.getByRole("button", { name: "Aracı kaydet" }).click();
    await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);

    expect(seenRequestIds).toHaveLength(2);
    expect(seenRequestIds[0]).not.toBe(seenRequestIds[1]);
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

  test("bayat taslak: ikinci bir tarayıcı bağlamı araya kaydedince, taslağı gönderilmeden bırakılan ilk bağlam sayfa yenilenince güncel sunucu değerlerini gösterir", async ({
    page,
    browser,
  }) => {
    // C1 review bulgusu — taslak, hangi `version`'a dayandığı bilgisi
    // OLMADAN saklanıyordu; PATCH'in TAZE `detail.vehicle.version`'ı
    // göndermesi bayat alan değerleriyle iyimser sürüm denetimini
    // ATLATIYORDU (başka bir ekip üyesinin değişikliği SESSİZCE üzerine
    // yazılıyordu). Burada gerçekten AYRI bir tarayıcı bağlamı (kendi
    // localStorage'ı, kendi oturumu) kullanılır — `iki sekmeden eski
    // sürümle kaydetme` testinin AKSİNE, ilk bağlamın taslağı GÖNDERİLMEDEN
    // (yalnız yazılıp) sayfa YENİLENİR.
    await loginAsAdmin(page);
    const businessId = await createBusinessViaUi(page, `Bayat Taslak ${Date.now()}`, "Deniz Sahip");
    const vehicleId = await createVehicleViaUi(page, businessId, {
      plate: uniqueRawPlate("BYT"),
      ownerPassword: "sahip-byt-1",
      driverPassword: "sofor-byt-1",
    });

    // İlk bağlam — bir alanı değiştirir ama GÖNDERMEZ (taslak version 1
    // tabanıyla localStorage'a yazılır).
    await page.goto(`/yonetim/araclar/${vehicleId}`);
    await page.getByLabel("Marka / model").fill("Fiat Doblo");
    await expect(page.getByLabel("Marka / model")).toHaveValue("Fiat Doblo");

    // İkinci, TAMAMEN AYRI bir tarayıcı bağlamı — aynı araç için AYRI bir
    // alanı kaydeder (version 1 -> 2).
    const secondContext = await browser.newContext();
    try {
      const secondPage = await secondContext.newPage();
      await loginAsAdmin(secondPage);
      await secondPage.goto(`/yonetim/araclar/${vehicleId}`);
      await secondPage.getByLabel("Not", { exact: true }).fill("İkinci bağlamdan not");
      await secondPage.getByRole("button", { name: "Bilgiyi kaydet" }).click();
      await expect(secondPage.getByRole("button", { name: "Bilgiyi kaydet" })).toBeDisabled();
    } finally {
      await secondContext.close();
    }

    // İlk bağlam sayfayı yeniler — bayat taslak (version 1, "Fiat Doblo")
    // artık sunucunun version 2'siyle uyuşmuyor: taslak atılır, GÜNCEL
    // sunucu değerleri (ikinci bağlamın notu dahil) gösterilir; ilk
    // bağlamın hiç göndermediği "Fiat Doblo" hiçbir yerde KALICI OLMAZ.
    await page.reload();
    await expect(page.getByLabel("Not", { exact: true })).toHaveValue("İkinci bağlamdan not");
    await expect(page.getByLabel("Marka / model")).not.toHaveValue("Fiat Doblo");
    await expect(page.getByLabel("Marka / model")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Bilgiyi kaydet" })).toBeDisabled();
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

  test.describe("Şifre sıfırlama bölümü (S2.3)", () => {
    test("işletme adı ve plakayı gösterir; sahip şifresi sıfırlanınca eski şifre çalışmaz, yeni şifre çalışır, şoför şifresi etkilenmez", async ({
      page,
    }) => {
      await loginAsAdmin(page);
      const businessName = `Sıfırlama ${Date.now()}`;
      const businessId = await createBusinessViaUi(page, businessName, "Gül Sahip");
      const plate = uniqueRawPlate("RST");
      const ownerPassword = "sahip-rst-1";
      const driverPassword = "sofor-rst-1";
      await createVehicleViaUi(page, businessId, { plate, ownerPassword, driverPassword });

      const section = page.locator("#sifre-sifirlama");
      await expect(section.getByText(businessName)).toBeVisible();
      await expect(section.getByText(plate)).toBeVisible();
      await expect(section.getByLabel("Mal sahibi şifresi")).toBeVisible();
      await expect(section.getByLabel("Şoför şifresi")).toBeVisible();

      const newOwnerPassword = "yeni-sahip-rst-1";
      await section.getByLabel("Mal sahibi şifresi").check();
      await section.getByLabel("Yeni şifre").fill(newOwnerPassword);
      await section.getByRole("button", { name: "Şifreyi sıfırla" }).click();

      const successBanner = section.getByRole("status").filter({ hasText: "değiştirildi" });
      await expect(successBanner).toBeVisible();
      await expect(successBanner).toContainText(plate);
      await expect(successBanner).toContainText("Mal sahibi şifresi");
      await expect(successBanner).toContainText("WhatsApp");
      await expect(section.getByLabel("Yeni şifre")).toHaveValue("");

      // Eski sahip şifresi artık çalışmaz.
      await page.getByRole("button", { name: "Çıkış" }).click();
      await page.waitForURL("**/yonetim/giris");
      await page.goto("/giris");
      await page.getByLabel("Plaka").fill(plate);
      await page.getByLabel("Şifre").fill(ownerPassword);
      await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Plaka veya şifre yanlış." })).toBeVisible();

      // Yeni sahip şifresi çalışır.
      await page.getByLabel("Şifre").fill(newOwnerPassword);
      await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
      await page.waitForURL("**/sahip");
      await page.getByRole("button", { name: "Çıkış" }).click();

      // Şoför şifresi hiç etkilenmedi.
      await page.goto("/giris");
      await page.getByLabel("Plaka").fill(plate);
      await page.getByLabel("Şifre").fill(driverPassword);
      await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
      await page.waitForURL("**/sofor");
    });

    test("diğer rolün mevcut şifresiyle aynı yeni şifre girilince alan hatası gösterilir, hiçbir şey değişmez", async ({
      page,
    }) => {
      await loginAsAdmin(page);
      const businessId = await createBusinessViaUi(page, `Aynı Şifre Sıfırlama ${Date.now()}`, "Nur Sahip");
      const plate = uniqueRawPlate("SMS");
      const ownerPassword = "sahip-sms-1";
      const driverPassword = "sofor-sms-1";
      await createVehicleViaUi(page, businessId, { plate, ownerPassword, driverPassword });

      const section = page.locator("#sifre-sifirlama");
      await section.getByLabel("Mal sahibi şifresi").check();
      await section.getByLabel("Yeni şifre").fill(driverPassword);
      await section.getByRole("button", { name: "Şifreyi sıfırla" }).click();

      await expect(section.getByRole("alert").filter({ hasText: "aynı olamaz" })).toBeVisible();
      await expect(section.getByRole("status").filter({ hasText: "değiştirildi" })).toHaveCount(0);

      // Hiçbir şey değişmedi — eski sahip şifresi hâlâ çalışıyor.
      await page.getByRole("button", { name: "Çıkış" }).click();
      await page.waitForURL("**/yonetim/giris");
      await page.goto("/giris");
      await page.getByLabel("Plaka").fill(plate);
      await page.getByLabel("Şifre").fill(ownerPassword);
      await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
      await page.waitForURL("**/sahip");
    });

    test("gönderim sırasında bağlantı koparsa sonucu kontrol ekranı çıkar; sayfa yenilenmeden seçim ve şifre kilitli kalır, aynı şifreyle tekrar denenince tamamlanır", async ({
      page,
    }) => {
      await loginAsAdmin(page);
      const businessId = await createBusinessViaUi(page, `Sıfırlama Belirsiz ${Date.now()}`, "Onur Sahip");
      const plate = uniqueRawPlate("AMS");
      const ownerPassword = "sahip-ams-1";
      const driverPassword = "sofor-ams-1";
      const vehicleId = await createVehicleViaUi(page, businessId, { plate, ownerPassword, driverPassword });

      const section = page.locator("#sifre-sifirlama");
      await section.getByLabel("Şoför şifresi").check();
      const newDriverPassword = "yeni-sofor-ams-1";
      await section.getByLabel("Yeni şifre").fill(newDriverPassword);

      await page.route(`**/api/v1/admin/vehicles/${vehicleId}/reset-password`, async (route) => {
        await route.abort();
      });
      await section.getByRole("button", { name: "Şifreyi sıfırla" }).click();
      await expect(section.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();
      await expect(section.getByLabel("Şoför şifresi")).toBeDisabled();
      await expect(section.getByLabel("Yeni şifre")).toBeDisabled();
      await expect(section.getByLabel("Yeni şifre")).toHaveValue(newDriverPassword);

      await page.unroute(`**/api/v1/admin/vehicles/${vehicleId}/reset-password`);
      await section.getByRole("button", { name: "Tekrar kontrol et" }).click();
      await expect(section.getByRole("status").filter({ hasText: "değiştirildi" })).toBeVisible();

      await page.getByRole("button", { name: "Çıkış" }).click();
      await page.waitForURL("**/yonetim/giris");
      await page.goto("/giris");
      await page.getByLabel("Plaka").fill(plate);
      await page.getByLabel("Şifre").fill(newDriverPassword);
      await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
      await page.waitForURL("**/sofor");
    });

    test("gönderim sırasında bağlantı koparsa ve sayfa yenilenirse erişim seçimi korunur, şifre boş ve düzenlenebilir döner; yeniden yazılınca tamamlanır", async ({
      page,
    }) => {
      await loginAsAdmin(page);
      const businessId = await createBusinessViaUi(page, `Sıfırlama Yenileme ${Date.now()}`, "Pelin Sahip");
      const plate = uniqueRawPlate("RLD");
      const ownerPassword = "sahip-rld-1";
      const driverPassword = "sofor-rld-1";
      const vehicleId = await createVehicleViaUi(page, businessId, { plate, ownerPassword, driverPassword });

      const section = page.locator("#sifre-sifirlama");
      await section.getByLabel("Mal sahibi şifresi").check();
      const newOwnerPassword = "yeni-sahip-rld-1";
      await section.getByLabel("Yeni şifre").fill(newOwnerPassword);

      await page.route(`**/api/v1/admin/vehicles/${vehicleId}/reset-password`, async (route) => {
        await route.abort();
      });
      await section.getByRole("button", { name: "Şifreyi sıfırla" }).click();
      await expect(section.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();

      await page.unroute(`**/api/v1/admin/vehicles/${vehicleId}/reset-password`);
      await page.reload();

      const reloadedSection = page.locator("#sifre-sifirlama");
      await expect(reloadedSection.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();
      await expect(reloadedSection.getByText("Devam etmek için yeni şifreyi tekrar gir.")).toBeVisible();
      await expect(reloadedSection.getByLabel("Mal sahibi şifresi")).toBeChecked();
      await expect(reloadedSection.getByLabel("Mal sahibi şifresi")).toBeDisabled();
      const passwordInput = reloadedSection.getByLabel("Yeni şifre");
      await expect(passwordInput).toHaveValue("");
      await expect(passwordInput).toBeEnabled();
      const retryButton = reloadedSection.getByRole("button", { name: "Tekrar kontrol et" });
      await expect(retryButton).toBeDisabled();

      await passwordInput.pressSequentially(newOwnerPassword);
      await expect(retryButton).toBeEnabled();
      await retryButton.click();

      await expect(reloadedSection.getByRole("status").filter({ hasText: "değiştirildi" })).toBeVisible();

      await page.getByRole("button", { name: "Çıkış" }).click();
      await page.waitForURL("**/yonetim/giris");
      await page.goto("/giris");
      await page.getByLabel("Plaka").fill(plate);
      await page.getByLabel("Şifre").fill(newOwnerPassword);
      await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
      await page.waitForURL("**/sahip");
    });

    test("belirsiz sonuçtan sonra aynı erişim başka bir ekip bağlamında sıfırlanırsa tekrar kontrol 409 verir; sayfa yenilenince yeni sıfırlama başarılı olur ve yeni şifre girişte çalışır", async ({
      page,
      browser,
    }) => {
      // C1 review bulgusu — kesin (non-2xx) bir yanıttan sonra taslakta AYNI
      // requestId kalıyordu; yenilemede bellekteki rotasyon durumu kayboluyor
      // ve sunucunun makbuz tuttuğu requestId yalnız 409 alıyordu.
      await loginAsAdmin(page);
      const businessId = await createBusinessViaUi(page, `Sıfırlama Yarış ${Date.now()}`, "Cem Sahip");
      const plate = uniqueRawPlate("YRS");
      const vehicleId = await createVehicleViaUi(page, businessId, {
        plate,
        ownerPassword: "sahip-yrs-1",
        driverPassword: "sofor-yrs-1",
      });

      const section = page.locator("#sifre-sifirlama");
      await section.getByLabel("Mal sahibi şifresi").check();
      await section.getByLabel("Yeni şifre").fill("yeni-sahip-yrs-1");

      // İstek sunucuya ULAŞIR (sıfırlama + makbuz yazılır) ama yanıt kaybolur.
      const resetUrl = `**/api/v1/admin/vehicles/${vehicleId}/reset-password`;
      await page.route(resetUrl, async (route) => {
        await route.fetch();
        await route.abort();
      });
      await section.getByRole("button", { name: "Şifreyi sıfırla" }).click();
      await expect(section.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();
      await page.unroute(resetUrl);

      // Başka bir ekip bağlamı AYNI erişimi sıfırlar — ilk makbuz geçersiz kalır.
      const secondContext = await browser.newContext();
      try {
        const secondPage = await secondContext.newPage();
        await loginAsAdmin(secondPage);
        await secondPage.goto(`/yonetim/araclar/${vehicleId}`);
        const secondSection = secondPage.locator("#sifre-sifirlama");
        await secondSection.getByLabel("Mal sahibi şifresi").check();
        await secondSection.getByLabel("Yeni şifre").fill("diger-sahip-yrs-2");
        await secondSection.getByRole("button", { name: "Şifreyi sıfırla" }).click();
        await expect(secondSection.getByRole("status").filter({ hasText: "değiştirildi" })).toBeVisible();
      } finally {
        await secondContext.close();
      }

      await section.getByRole("button", { name: "Tekrar kontrol et" }).click();
      await expect(section.getByRole("button", { name: "Güncel halini aç" })).toBeVisible();

      // Yenileme: taslak KESİN yanıttan SONRA yeni requestId ile yazılmıştı.
      await page.reload();
      const reloaded = page.locator("#sifre-sifirlama");
      await expect(reloaded.getByText("Kaydın sonucu kontrol ediliyor.")).toHaveCount(0);
      await expect(reloaded.getByLabel("Mal sahibi şifresi")).toBeChecked();
      await expect(reloaded.getByLabel("Mal sahibi şifresi")).toBeEnabled();
      const finalPassword = "son-sahip-yrs-3";
      await reloaded.getByLabel("Yeni şifre").fill(finalPassword);
      await reloaded.getByRole("button", { name: "Şifreyi sıfırla" }).click();
      await expect(reloaded.getByRole("status").filter({ hasText: "değiştirildi" })).toBeVisible();

      await page.getByRole("button", { name: "Çıkış" }).click();
      await page.waitForURL("**/yonetim/giris");
      await page.goto("/giris");
      await page.getByLabel("Plaka").fill(plate);
      await page.getByLabel("Şifre").fill(finalPassword);
      await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
      await page.waitForURL("**/sahip");
    });

    test("belirsiz sonuçtan sonra farklı şifreyle tekrar kontrol REQUEST_ID_REUSED form-özgü metnini gösterir; yenilemeden sonraki gönderim başarılı olur", async ({
      page,
    }) => {
      await loginAsAdmin(page);
      const businessId = await createBusinessViaUi(page, `Sıfırlama Farklı Şifre ${Date.now()}`, "Defne Sahip");
      const plate = uniqueRawPlate("FRK");
      const vehicleId = await createVehicleViaUi(page, businessId, {
        plate,
        ownerPassword: "sahip-frk-1",
        driverPassword: "sofor-frk-1",
      });

      const section = page.locator("#sifre-sifirlama");
      await section.getByLabel("Şoför şifresi").check();
      await section.getByLabel("Yeni şifre").fill("yeni-sofor-frk-1");

      const resetUrl = `**/api/v1/admin/vehicles/${vehicleId}/reset-password`;
      await page.route(resetUrl, async (route) => {
        await route.fetch();
        await route.abort();
      });
      await section.getByRole("button", { name: "Şifreyi sıfırla" }).click();
      await expect(section.getByText("Kaydın sonucu kontrol ediliyor.")).toBeVisible();
      await page.unroute(resetUrl);

      // Yenileme sonrası personel İLK girilenden FARKLI bir şifre yazar.
      await page.reload();
      const reloaded = page.locator("#sifre-sifirlama");
      await reloaded.getByLabel("Yeni şifre").pressSequentially("baska-sofor-frk-2");
      await reloaded.getByRole("button", { name: "Tekrar kontrol et" }).click();

      const banner = reloaded.getByRole("alert").filter({ hasText: "zaten sıfırlanmış olabilir" });
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("ilk girdiğin şifreyle");
      await expect(banner).toContainText("yeni bir şifre belirle");
      await expect(banner).not.toContainText("yenile");

      // Yenileme: taslak yeni requestId ile yazılmıştı — sonraki gönderim başarılı.
      await page.reload();
      const afterReload = page.locator("#sifre-sifirlama");
      await expect(afterReload.getByText("Kaydın sonucu kontrol ediliyor.")).toHaveCount(0);
      await expect(afterReload.getByLabel("Şoför şifresi")).toBeChecked();
      const finalPassword = "son-sofor-frk-3";
      await afterReload.getByLabel("Yeni şifre").fill(finalPassword);
      await afterReload.getByRole("button", { name: "Şifreyi sıfırla" }).click();
      await expect(afterReload.getByRole("status").filter({ hasText: "değiştirildi" })).toBeVisible();

      await page.getByRole("button", { name: "Çıkış" }).click();
      await page.waitForURL("**/yonetim/giris");
      await page.goto("/giris");
      await page.getByLabel("Plaka").fill(plate);
      await page.getByLabel("Şifre").fill(finalPassword);
      await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
      await page.waitForURL("**/sofor");
    });

    test("yeni şifre localStorage/sessionStorage'a hiç yazılmaz", async ({ page }) => {
      await loginAsAdmin(page);
      const businessId = await createBusinessViaUi(page, `Sıfırlama Depolama ${Date.now()}`, "Kader Sahip");
      const plate = uniqueRawPlate("DPS");
      await createVehicleViaUi(page, businessId, {
        plate,
        ownerPassword: "sahip-dps-1",
        driverPassword: "sofor-dps-1",
      });

      const section = page.locator("#sifre-sifirlama");
      await section.getByLabel("Mal sahibi şifresi").check();
      const secretNewPassword = "gizli-yeni-sifre-dps";
      await section.getByLabel("Yeni şifre").fill(secretNewPassword);

      const dumpStorage = () =>
        page.evaluate(() => {
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

      expect(await dumpStorage()).not.toContain(secretNewPassword);

      await section.getByRole("button", { name: "Şifreyi sıfırla" }).click();
      await expect(section.getByRole("status").filter({ hasText: "değiştirildi" })).toBeVisible();

      expect(await dumpStorage()).not.toContain(secretNewPassword);
    });

    test("pasif araçta şifre sıfırlama bölümü kullanılamaz mesajı gösterir", async ({ page }) => {
      await loginAsAdmin(page);
      const businessId = await createBusinessViaUi(page, `Sıfırlama Pasif ${Date.now()}`, "Rıza Sahip");
      const plate = uniqueRawPlate("PSV");
      await createVehicleViaUi(page, businessId, {
        plate,
        ownerPassword: "sahip-psv-1",
        driverPassword: "sofor-psv-1",
      });

      await page.getByRole("button", { name: "Aracı pasifleştir" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Pasifleştir", exact: true }).click();
      await expect(page.getByRole("button", { name: "Aracı yeniden aktifleştir" })).toBeVisible();

      const section = page.locator("#sifre-sifirlama");
      await expect(section.getByText("Araç veya işletme pasif; şifre sıfırlanamaz.")).toBeVisible();
      await expect(section.getByLabel("Mal sahibi şifresi")).toHaveCount(0);
      await expect(section.getByLabel("Yeni şifre")).toHaveCount(0);
    });
  });
});
