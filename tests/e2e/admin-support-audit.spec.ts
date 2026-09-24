import { expect, test, type Browser, type Page } from "@playwright/test";
import { SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";

/**
 * Yönetim araması, destek alanı ve işlem geçmişi uçtan uca testleri.
 * `./drivers.spec.ts` İLE AYNI altyapı (gerçek standalone sunucu + seed);
 * testler KENDİ işletme/araçlarını açar, paylaşılan seed verisini DEĞİŞTİRMEZ.
 * Yükleme/hata/sayfalama durumları gerçek veriyle tetiklenemediğinden ilgili
 * liste isteği `page.route` ile taklit edilir (yalnız o testlerde).
 */

const OWNER_PASSWORD = "sahip-e2e-destek";
const DRIVER_PASSWORD = "sofor-e2e-destek";
const RESET_OWNER_PASSWORD = "gizli-sahip-sifre-9";

async function loginAsStaff(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/yonetim/giris");
  await page.getByLabel("Kullanıcı adı").fill(username);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL("**/yonetim");
}

async function loginAsAdmin(page: Page): Promise<void> {
  await loginAsStaff(page, SEED_USERNAMES.admin, SEED_TEST_PASSWORDS.admin);
}

async function loginAsVehicle(page: Page, plate: string, password: string, landing: string): Promise<void> {
  await page.goto("/giris");
  await page.getByLabel("Plaka").fill(plate);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL(`**${landing}`);
}

async function newVehiclePage(
  browser: Browser,
  baseURL: string | undefined,
  plate: string,
  password: string,
  landing: string,
): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await loginAsVehicle(page, plate, password, landing);
  return page;
}

function uniqueRawPlate(letters: string): string {
  return `34 ${letters} ${100 + (Date.now() % 900)}`;
}

/** `34 SUP 123` → `34 SUP 123` (yalnız büyük harf/boşluk normalleştirilmiş gösterim). */
function displayPlate(rawPlate: string): string {
  return rawPlate.replace(/\s+/g, "").replace(/^(\d{2})([A-Z]+)(\d+)$/u, "$1 $2 $3");
}

async function createBusinessViaUi(page: Page, name: string, ownerFullName: string): Promise<string> {
  await page.goto("/yonetim/isletmeler/yeni");
  await page.getByLabel("İşletme adı").fill(name);
  await page.getByLabel("Sahibin ad soyadı").fill(ownerFullName);
  await page.getByRole("button", { name: "İşletmeyi kaydet" }).click();
  await page.waitForURL(/\/yonetim\/isletmeler\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
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

/** Oturumdaki CSRF ile JSON istek atar (sayfa bağlamında). */
async function apiRequest(
  page: Page,
  method: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; text: string }> {
  return page.evaluate(
    async ({ method, url, body }) => {
      const session = (await (await fetch("/api/v1/session")).json()) as { csrfToken: string };
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, text: await response.text() };
    },
    { method, url, body },
  );
}

async function createBusinessWithVehicle(page: Page, letters: string) {
  const businessName = `Destek E2E ${Date.now()}`;
  const plate = uniqueRawPlate(letters);
  const businessId = await createBusinessViaUi(page, businessName, "Sevim Sahip");
  const vehicleId = await createVehicleViaUi(page, businessId, plate);
  return { businessName, plate, businessId, vehicleId };
}

const searchInput = (page: Page) => page.getByLabel("Plaka veya işletme ara");

test.describe("Yönetim araması (/yonetim)", () => {
  test("plaka (farklı boşluk/harf) veya işletme adıyla araç kartları; sonuç yok ve URL yansıması", async ({ page }) => {
    await loginAsAdmin(page);
    const { businessName, plate } = await createBusinessWithVehicle(page, "SRC");
    const plateDisplay = displayPlate(plate);

    await page.goto("/yonetim");
    await expect(page.getByText(businessName)).toHaveCount(1); // boş aramada işletme listesi

    // Plaka: boşluksuz + küçük harf.
    await searchInput(page).fill(plate.replace(/\s+/g, "").toLowerCase());
    const card = page.getByRole("listitem").filter({ hasText: plateDisplay });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(businessName);
    await expect(card).toContainText("Sahip: Sevim Sahip");
    await expect(card.getByText("Aktif", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/yonetim\?q=/);

    // İşletme adı.
    await searchInput(page).fill(businessName);
    await expect(page.getByRole("listitem").filter({ hasText: plateDisplay })).toHaveCount(1);

    // Sonuç yok.
    await searchInput(page).fill("hicbirsey-bulunmaz-zzz");
    await expect(page.getByText("Sonuç yok.").first()).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(0);

    // Sayfa yenilenince arama korunur.
    await searchInput(page).fill(plateDisplay);
    await expect(page.getByRole("listitem").filter({ hasText: plateDisplay })).toHaveCount(1);
    await page.reload();
    await expect(searchInput(page)).toHaveValue(plateDisplay);
    await expect(page.getByRole("listitem").filter({ hasText: plateDisplay })).toHaveCount(1);

    // Kartlar destek ekranına ve araç bilgisine bağlanır.
    await expect(card.getByRole("link", { name: /Destek ekranını aç/ })).toHaveAttribute(
      "href",
      /\/yonetim\/araclar\/[0-9a-f-]{36}\/destek$/,
    );
  });

  test("yükleme sırasında 'sonuç yok' gösterilmez; hata yazılan metni korur ve tekrar dene çalışır", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/yonetim");
    await expect(page.getByLabel("Plaka veya işletme ara")).toBeVisible();

    // Yavaş yanıt: yükleniyor görünür, "Sonuç yok." görünmez.
    await page.route(/\/api\/v1\/admin\/vehicles\?/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await searchInput(page).fill("yavas-sorgu-zzz");
    await expect(page.getByText("Yükleniyor…").first()).toBeVisible();
    await expect(page.getByText("Sonuç yok.")).toHaveCount(0);
    await expect(page.getByText("Sonuç yok.").first()).toBeVisible();
    await page.unroute(/\/api\/v1\/admin\/vehicles\?/);

    // Sunucu hatası.
    await page.route(/\/api\/v1\/admin\/vehicles\?/, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL" } }) }),
    );
    await searchInput(page).fill("hata-sorgusu-zzz");
    await expect(page.getByRole("alert").filter({ hasText: "Bağlantı kurulamadı. Tekrar dene." })).toBeVisible();
    await expect(searchInput(page)).toHaveValue("hata-sorgusu-zzz");
    await expect(page.getByText("Sonuç yok.")).toHaveCount(0);

    // Oturum bitti (401).
    await page.unroute(/\/api\/v1\/admin\/vehicles\?/);
    await page.route(/\/api\/v1\/admin\/vehicles\?/, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "SESSION_EXPIRED" } }) }),
    );
    await searchInput(page).fill("oturum-sorgusu-zzz");
    await expect(page.getByRole("alert").filter({ hasText: "Oturumun sona erdi. Yeniden giriş yap." })).toBeVisible();

    // Tekrar dene: gerçek isteğe dönünce sonuç durumu.
    await page.unroute(/\/api\/v1\/admin\/vehicles\?/);
    await page.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(page.getByText("Sonuç yok.").first()).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  test("'Daha fazla göster' sonraki sayfayı listeye ekler, yeni sorguda liste sıfırlanır ve eski yanıt ezmez", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/yonetim");
    await expect(page.getByLabel("Plaka veya işletme ara")).toBeVisible();

    const vehicle = (id: string, plate: string) => ({
      id,
      plateNormalized: plate,
      active: true,
      owner: { personId: `p-${id}`, fullName: "Sahip Sahte" },
      business: { id: `b-${id}`, name: "Sahte İşletme", active: true },
    });
    await page.route(/\/api\/v1\/admin\/vehicles\?/, async (route) => {
      const url = new URL(route.request().url());
      const q = url.searchParams.get("q");
      if (q === "sayfa") {
        const second = url.searchParams.get("cursor") === "imlec-2";
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(
            second
              ? { vehicles: [vehicle("v2", "35BBB222")], nextCursor: null }
              : { vehicles: [vehicle("v1", "35AAA111")], nextCursor: "imlec-2" },
          ),
        });
      }
      if (q === "eski") {
        // Yavaş dönen ESKİ sorgu, sonradan başlayan "yeni" sorgunun listesini ezmemeli.
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        // İstemci isteği kestiyse yanıt verilemez; test için önemli değil.
        return route
          .fulfill({
            contentType: "application/json",
            body: JSON.stringify({ vehicles: [vehicle("v-eski", "35EEE555")], nextCursor: null }),
          })
          .catch(() => undefined);
      }
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ vehicles: [vehicle("v-yeni", "35NNN666")], nextCursor: null }),
      });
    });

    await searchInput(page).fill("sayfa");
    await expect(page.getByRole("listitem").filter({ hasText: "35 AAA 111" })).toHaveCount(1);
    await page.getByRole("button", { name: "Daha fazla göster" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "35 BBB 222" })).toHaveCount(1);
    await expect(page.getByRole("listitem").filter({ hasText: "35 AAA 111" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Daha fazla göster" })).toHaveCount(0);

    // Yeni sorguda liste sıfırlanır.
    await searchInput(page).fill("yeni");
    await expect(page.getByRole("listitem").filter({ hasText: "35 NNN 666" })).toHaveCount(1);
    await expect(page.getByRole("listitem").filter({ hasText: "35 AAA 111" })).toHaveCount(0);

    // Eski (yavaş) sorgu sonradan dönse de yenisini ezmez.
    await searchInput(page).fill("eski");
    await page.waitForTimeout(500); // debounce sonrası eski istek başladı
    await searchInput(page).fill("yeni");
    await expect(page.getByRole("listitem").filter({ hasText: "35 NNN 666" })).toHaveCount(1);
    await page.waitForTimeout(1_800);
    await expect(page.getByRole("listitem").filter({ hasText: "35 EEE 555" })).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "35 NNN 666" })).toHaveCount(1);
  });
});

test.describe("Destek ekranı (/yonetim/araclar/:id/destek)", () => {
  test("hedef ve gerçek ekip kimliğini gösterir; çalışma kaydı, Özet ve Raporlar bağlantıları vardır, teslim bağlantısı yoktur; bilinmeyen araç 404", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const { businessName, plate, vehicleId } = await createBusinessWithVehicle(page, "DST");

    await page.goto(`/yonetim/araclar/${vehicleId}/destek`);
    await expect(page.getByText(`Destek: ${businessName}`)).toBeVisible();
    await expect(page.getByText(`Araç: ${displayPlate(plate)} · Sahip: Sevim Sahip`)).toBeVisible();
    await expect(page.getByText(`İşlemi yapan: ${SEED_USERNAMES.admin} (Yönetici)`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Hedefi değiştir" })).toBeVisible();

    // Çalışma kaydı formu vardır ve bağlanır.
    await expect(page.getByRole("link", { name: "+ Çalışma kaydı gir" })).toHaveAttribute(
      "href",
      `/yonetim/araclar/${vehicleId}/kayit/yeni`,
    );

    // Özet ve raporlar vardır ve bağlanır (destek modu sayfaları).
    await expect(page.getByRole("link", { name: "Özet", exact: true })).toHaveAttribute(
      "href",
      `/yonetim/araclar/${vehicleId}/ozet`,
    );
    await expect(page.getByRole("link", { name: "Raporlar", exact: true })).toHaveAttribute(
      "href",
      `/yonetim/araclar/${vehicleId}/raporlar`,
    );

    // Dürüstlük: hâlâ olmayan işler bağlanmaz.
    await expect(page.getByRole("link", { name: /günlük|Teslim|onay|Kayıtlar/i })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Çalışma kaydı|günlük|Teslim|onay|Rapor/i }),
    ).toHaveCount(0);

    // Kirli form yokken hedef değişimi doğrudan /yonetim'e döner.
    await page.getByRole("button", { name: "Hedefi değiştir" }).click();
    await page.waitForURL("**/yonetim");

    const unknown = await page.goto("/yonetim/araclar/00000000-0000-4000-8000-000000000000/destek");
    expect(unknown?.status()).toBe(404);
  });

  test("destek rolü kendi adı ve rol etiketiyle görünür; sahip ve şoför oturumu erişemez", async ({
    page,
    browser,
  }, testInfo) => {
    await loginAsAdmin(page);
    const { plate, vehicleId } = await createBusinessWithVehicle(page, "DSR");

    const supportPage = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await loginAsStaff(supportPage, SEED_USERNAMES.support, SEED_TEST_PASSWORDS.support);
    await supportPage.goto(`/yonetim/araclar/${vehicleId}/destek`);
    await expect(supportPage.getByText(`İşlemi yapan: ${SEED_USERNAMES.support} (Destek)`)).toBeVisible();

    const owner = await newVehiclePage(browser, testInfo.project.use.baseURL, plate, OWNER_PASSWORD, "/sahip");
    await owner.goto(`/yonetim/araclar/${vehicleId}/destek`);
    await owner.waitForURL("**/sahip");
    const driver = await newVehiclePage(browser, testInfo.project.use.baseURL, plate, DRIVER_PASSWORD, "/sofor");
    await driver.goto(`/yonetim/araclar/${vehicleId}/destek`);
    await driver.waitForURL("**/sofor");
  });

  test("kaydedilmemiş alanla 'Hedefi değiştir' onay ister; Vazgeç değeri korur, devam taslağı siler", async ({ page }) => {
    await loginAsAdmin(page);
    const { vehicleId } = await createBusinessWithVehicle(page, "DRT");
    const detailUrl = `/yonetim/araclar/${vehicleId}`;

    await page.goto(detailUrl);
    const brand = page.getByLabel("Marka / model");
    const save = page.getByRole("button", { name: "Bilgiyi kaydet" });
    // Kaydet düğmesi yalnız hydrate olmuş ve değişiklik algılanmış sayfada açılır.
    await expect(async () => {
      await brand.fill("Yeni Marka");
      await expect(save).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    await page.getByRole("button", { name: "Hedefi değiştir" }).click();
    const dialog = page.getByRole("dialog", { name: "Değişiklikleri bırakıp çık?" });
    await expect(dialog).toBeVisible();

    // Vazgeç: değer, adres ve sayfa korunur; odak düğmeye döner.
    await dialog.getByRole("button", { name: "Vazgeç" }).click();
    await expect(dialog).toBeHidden();
    await expect(brand).toHaveValue("Yeni Marka");
    await expect(page).toHaveURL(new RegExp(`${detailUrl}$`));
    await expect(page.getByRole("button", { name: "Hedefi değiştir" })).toBeFocused();

    // Devam: /yonetim'e gider; araç yeniden açılınca sunucu değerleri (taslak yok).
    await page.getByRole("button", { name: "Hedefi değiştir" }).click();
    await dialog.getByRole("button", { name: "Bırakıp çık" }).click();
    await page.waitForURL("**/yonetim");
    await page.goto(detailUrl);
    await expect(page.getByLabel("Marka / model")).toHaveValue("");
  });

  test("yazılmış (gönderilmemiş) yeni şifre de kirli sayılır ve devam edince hiçbir yere yazılmaz", async ({ page }) => {
    await loginAsAdmin(page);
    const { vehicleId } = await createBusinessWithVehicle(page, "DPS");
    await page.goto(`/yonetim/araclar/${vehicleId}`);
    await page.waitForLoadState("networkidle");

    const password = page.getByLabel("Yeni şifre");
    await expect(async () => {
      await password.fill("yazilmis-ama-gonderilmedi-1");
      await page.getByRole("button", { name: "Hedefi değiştir" }).click();
      await expect(page.getByRole("dialog", { name: "Değişiklikleri bırakıp çık?" })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.getByRole("dialog").getByRole("button", { name: "Vazgeç" }).click();
    await expect(password).toHaveValue("yazilmis-ama-gonderilmedi-1");

    await page.getByRole("button", { name: "Hedefi değiştir" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Bırakıp çık" }).click();
    await page.waitForURL("**/yonetim");
    const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage }));
    expect(stored).not.toContain("yazilmis-ama-gonderilmedi-1");
  });
});

test.describe("İşlem geçmişi (/yonetim/islem-gecmisi)", () => {
  test("yapılan işlemleri gerçek kullanıcı adı, önce/sonra değerleriyle listeler; şifre göstermez; sahip/şoför açamaz", async ({
    page,
    browser,
  }, testInfo) => {
    await loginAsAdmin(page);
    const { businessName, plate, businessId, vehicleId } = await createBusinessWithVehicle(page, "AUD");
    const renamed = `${businessName} Yeni`;

    expect(
      (await apiRequest(page, "PATCH", `/api/v1/admin/businesses/${businessId}`, {
        requestId: crypto.randomUUID(),
        version: 1,
        name: renamed,
      })).status,
    ).toBe(200);
    expect(
      (await apiRequest(page, "PATCH", `/api/v1/admin/vehicles/${vehicleId}`, {
        requestId: crypto.randomUUID(),
        version: 1,
        brandModel: "Audit Marka",
      })).status,
    ).toBe(200);
    expect(
      (await apiRequest(page, "POST", `/api/v1/admin/vehicles/${vehicleId}/reset-password`, {
        requestId: crypto.randomUUID(),
        access: "owner",
        newPassword: RESET_OWNER_PASSWORD,
      })).status,
    ).toBe(200);

    // Sahip oturumu kendi şoförünü ekler → aktör "Sahip oturumu · plaka".
    const owner = await newVehiclePage(browser, testInfo.project.use.baseURL, plate, RESET_OWNER_PASSWORD, "/sahip");
    expect(
      (await apiRequest(owner, "POST", "/api/v1/drivers", {
        requestId: crypto.randomUUID(),
        fullName: "Denetim Şoförü",
      })).status,
    ).toBeLessThan(300);

    await page.goto(`/yonetim/islem-gecmisi?businessId=${businessId}`);
    const main = page.getByRole("main");
    await expect(page.getByText("Araç şifresi sıfırlandı")).toBeVisible();
    for (const label of [
      "İşletme oluşturuldu",
      "İşletme bilgisi değişti",
      "Araç oluşturuldu",
      "Araç bilgisi değişti",
      "Şoför eklendi",
    ]) {
      await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
    }

    // Gerçek ekip kullanıcı adı ve rol; sahip oturumu erişim + plaka olarak.
    await expect(main.getByText(`İşlemi yapan: ${SEED_USERNAMES.admin} (Yönetici)`).first()).toBeVisible();
    await expect(main.getByText(`İşlemi yapan: Sahip oturumu · ${displayPlate(plate)}`).first()).toBeVisible();
    await expect(main.getByText("Denetim Şoförü").first()).toBeVisible();

    // Önce/sonra ve oluşturma satırı metni.
    await expect(main.getByText(`Önce: ${businessName} Sonra: ${renamed}`)).toBeVisible();
    await expect(main.getByText("Önceki değer yok (yeni kayıt).").first()).toBeVisible();
    await expect(main.getByText(/\d{1,2} \p{L}+ 20\d\d \d{2}:\d{2}/u).first()).toBeVisible();

    // Salt okunur: düzenleme/silme/giriş denetimi yok; şifre metni hiçbir yerde yok.
    await expect(main.getByRole("textbox")).toHaveCount(0);
    await expect(main.getByRole("button", { name: /Düzenle|Sil|Kaldır|Kaydet/ })).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain(RESET_OWNER_PASSWORD);
    expect(html).not.toContain(OWNER_PASSWORD);
    const api = await apiRequest(page, "GET", `/api/v1/admin/audit?businessId=${businessId}`);
    expect(api.status).toBe(200);
    expect(api.text).not.toContain(RESET_OWNER_PASSWORD);

    // Sahip ve şoför oturumu sayfayı da API'yi de açamaz.
    await owner.goto("/yonetim/islem-gecmisi");
    await owner.waitForURL("**/sahip");
    expect((await apiRequest(owner, "GET", "/api/v1/admin/audit")).status).toBe(403);
    const driver = await newVehiclePage(browser, testInfo.project.use.baseURL, plate, DRIVER_PASSWORD, "/sofor");
    await driver.goto("/yonetim/islem-gecmisi");
    await driver.waitForURL("**/sofor");
  });

  test("boş, hata ve 'Daha fazla göster' durumları ayrıdır", async ({ page }) => {
    await loginAsAdmin(page);

    const entry = (id: string, action: string) => ({
      id,
      occurredAt: "2026-09-21T11:05:00.000Z",
      action,
      entityType: "business",
      entityId: "b1",
      business: { id: "b1", name: "Sahte İşletme" },
      vehicle: null,
      actor: { kind: "platform_user", username: "sahte.kullanici", role: "support" },
      onBehalfOf: null,
      before: null,
      after: { name: "Sahte" },
    });

    await page.route(/\/api\/v1\/admin\/audit\?/, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL" } }) }),
    );
    await page.goto("/yonetim/islem-gecmisi");
    await expect(page.getByRole("alert").filter({ hasText: "Bağlantı kurulamadı. Tekrar dene." })).toBeVisible();
    await expect(page.getByText("Henüz işlem kaydı yok.")).toHaveCount(0);
    await page.unroute(/\/api\/v1\/admin\/audit\?/);

    await page.route(/\/api\/v1\/admin\/audit\?/, (route) => {
      const url = new URL(route.request().url());
      const second = url.searchParams.get("cursor") === "imlec-2";
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          second
            ? { entries: [entry("a2", "business.update")], nextCursor: null }
            : { entries: [entry("a1", "business.create")], nextCursor: "imlec-2" },
        ),
      });
    });
    await page.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(page.getByText("İşletme oluşturuldu")).toBeVisible();
    await expect(page.getByText("sahte.kullanici (Destek)")).toHaveCount(1);
    await page.getByRole("button", { name: "Daha fazla göster" }).click();
    await expect(page.getByText("İşletme bilgisi değişti")).toBeVisible();
    await expect(page.getByText("İşletme oluşturuldu")).toBeVisible();
    await expect(page.getByRole("button", { name: "Daha fazla göster" })).toHaveCount(0);
  });
});
