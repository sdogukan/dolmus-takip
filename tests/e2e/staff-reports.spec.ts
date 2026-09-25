import { expect, test, type Browser, type Page } from "@playwright/test";
import { SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";

/**
 * Destek (ekip) modunda özet ve raporlar: /yonetim/araclar/:id/ozet ve /raporlar.
 * Gerçek standalone sunucu + seed. Testler KENDİ işletme/aracını açar (paylaşılan
 * seed verisine dokunmaz); kayıtlar aracın sahip oturumuyla yazılır, ekip yalnız okur.
 * Örnek senaryo: hasılat 20.000, mazot 3.000, diğer masraf 600, şoför payı 2.000,
 * hesaplanan kalan 14.400, onaylı teslim alınan 6.000 — sahip görünümüyle AYNI.
 */

const OWNER_PASSWORD = "sahip-e2e-rapor";
const DRIVER_PASSWORD = "sofor-e2e-rapor";
const REPORT_API = /\/api\/v1\/(reports\/|work-entries\?)/u;
const SUMMARY_URL = /\/api\/v1\/reports\/summary\?/u;
const VEHICLE_REPORT_URL = /\/api\/v1\/reports\/vehicles\?/u;

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

async function newVehiclePage(browser: Browser, baseURL: string | undefined, plate: string, password: string, landing: string): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await loginAsVehicle(page, plate, password, landing);
  return page;
}

function displayPlate(rawPlate: string): string {
  return rawPlate.replace(/\s+/g, "").replace(/^(\d{2})([A-Z]+)(\d+)$/u, "$1 $2 $3");
}

async function createBusinessWithVehicle(page: Page, letters: string, ownerFullName: string) {
  const businessName = `Rapor E2E ${letters} ${Date.now()}`;
  const plate = `34 ${letters} ${100 + (Date.now() % 900)}`;
  await page.goto("/yonetim/isletmeler/yeni");
  await page.getByLabel("İşletme adı").fill(businessName);
  await page.getByLabel("Sahibin ad soyadı").fill(ownerFullName);
  await page.getByRole("button", { name: "İşletmeyi kaydet" }).click();
  await page.waitForURL(/\/yonetim\/isletmeler\/[0-9a-f-]{36}$/);
  const businessId = page.url().split("/").pop()!;
  await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
  await page.getByLabel("Plaka").fill(plate);
  await page.getByLabel("Sahip şifresi").fill(OWNER_PASSWORD);
  await page.getByLabel("Şoför şifresi").fill(DRIVER_PASSWORD);
  await page.getByRole("button", { name: "Aracı kaydet" }).click();
  await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);
  return { businessName, plate, vehicleId: page.url().split("/").pop()! };
}

async function apiPost(page: Page, url: string, body: unknown): Promise<{ status: number; body: Record<string, any> }> {
  return page.evaluate(
    async ({ url, body }) => {
      const session = (await (await fetch("/api/v1/session")).json()) as { csrfToken: string };
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { url, body },
  );
}

const requestId = (): string => crypto.randomUUID();
const totalsRow = (page: Page, label: string) => page.locator("dl > div", { has: page.locator("dt", { hasText: label }) });

function istanbulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
}

/** Yeni araç + örnek senaryo: doğrulanmamış şoför kaydı ve sahip kaydı; `confirm` şoför teslimini 6.000 TL olarak onaylar. */
async function seedPrdVehicle(page: Page, browser: Browser, baseURL: string | undefined, letters: string) {
  const vehicle = await createBusinessWithVehicle(page, letters, "Sevim Sahip");
  const owner = await newVehiclePage(browser, baseURL, vehicle.plate, OWNER_PASSWORD, "/sahip");
  const driver = await apiPost(owner, "/api/v1/drivers", { requestId: requestId(), fullName: "Hasan Kurt" });
  expect(driver.status).toBe(201);
  const daily = { date: istanbulToday(), startTime: "08:00", endTime: "17:30", endsNextDay: false, grossCents: "1000000", fuelCents: "150000", otherExpenseCents: "30000", otherExpenseNote: "otopark" };
  const driverEntry = await apiPost(owner, "/api/v1/work-entries", { requestId: requestId(), workType: "driver", workerPersonId: driver.body.driver.personId, ...daily });
  expect(driverEntry.status).toBe(201);
  expect((await apiPost(owner, "/api/v1/work-entries", { requestId: requestId(), workType: "owner", ...daily })).status).toBe(201);
  const entryId = driverEntry.body.workEntry.id as string;
  const confirm = async (): Promise<void> => {
    expect((await apiPost(owner, `/api/v1/work-entries/${entryId}/confirm`, { requestId: requestId(), version: 1, receivedCents: "600000" })).status).toBe(200);
  };
  return { ...vehicle, entryId, owner, confirm };
}

/** İstek başlıklarını toplar: rapor uçlarına giden her isteğin `X-Target-Vehicle` değeri. */
function collectTargets(page: Page): Array<string | undefined> {
  const targets: Array<string | undefined> = [];
  page.on("request", (request) => {
    if (REPORT_API.test(request.url())) targets.push(request.headers()["x-target-vehicle"]);
  });
  return targets;
}

const PRD_TOTALS = [
  ["Hasılat", "20.000,00 TL"],
  ["Mazot", "3.000,00 TL"],
  ["Diğer masraf", "600,00 TL"],
  ["Şoför payı", "2.000,00 TL"],
  ["Hesaplanan kalan", "14.400,00 TL"],
] as const;

test.describe("Destek modunda özet ve raporlar", () => {
  test("yalnız ekip açar: sahip/şoför yönlenir, oturumsuz girişe gider, bilinmeyen araç 404", async ({ page, browser }, testInfo) => {
    await loginAsAdmin(page);
    const { plate, vehicleId } = await createBusinessWithVehicle(page, "RAE", "Sevim Sahip");

    for (const suffix of ["ozet", "raporlar"]) {
      const unknown = await page.goto(`/yonetim/araclar/00000000-0000-4000-8000-000000000000/${suffix}`);
      expect(unknown?.status()).toBe(404);

      const owner = await newVehiclePage(browser, testInfo.project.use.baseURL, plate, OWNER_PASSWORD, "/sahip");
      await owner.goto(`/yonetim/araclar/${vehicleId}/${suffix}`);
      await owner.waitForURL("**/sahip");
      const driver = await newVehiclePage(browser, testInfo.project.use.baseURL, plate, DRIVER_PASSWORD, "/sofor");
      await driver.goto(`/yonetim/araclar/${vehicleId}/${suffix}`);
      await driver.waitForURL("**/sofor");

      const anonymous = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
      await anonymous.goto(`/yonetim/araclar/${vehicleId}/${suffix}`);
      await anonymous.waitForURL("**/yonetim/giris");
    }
  });

  test("Özet: destek başlığı, örnek senaryo toplamları sahip görünümüyle aynı, her istek X-Target-Vehicle taşır, Kaydı aç yönetim sayfasına gider", async ({
    page,
    browser,
  }, testInfo) => {
    await loginAsAdmin(page);
    const { businessName, plate, vehicleId, entryId, owner, confirm } = await seedPrdVehicle(page, browser, testInfo.project.use.baseURL, "RAO");

    const targets = collectTargets(page);
    const pendingRead = page.waitForResponse(/\/api\/v1\/work-entries\?/u);
    await page.goto(`/yonetim/araclar/${vehicleId}/ozet`);
    await pendingRead;

    await expect(page.getByText(`Destek: ${businessName}`)).toBeVisible();
    await expect(page.getByText(`Araç: ${displayPlate(plate)} · Sahip: Sevim Sahip`)).toBeVisible();
    await expect(page.getByText(`İşlemi yapan: ${SEED_USERNAMES.admin} (Yönetici)`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Özet", level: 1 })).toBeVisible();
    for (const [label, value] of PRD_TOTALS) await expect(totalsRow(page, label)).toContainText(value);
    await expect(page.locator("p", { hasText: "Teslim alınan (onaylı)" }).first()).toContainText("0,00 TL");

    // Bekleyen liste: yalnız şoför kaydı; bağlantı yönetim sayfasına gider.
    const rows = page.locator("li", { hasText: "Kaydı aç" });
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Hasan Kurt");
    await expect(rows.getByRole("link", { name: "Kaydı aç" })).toHaveAttribute("href", `/yonetim/araclar/${vehicleId}/kayitlar/${entryId}`);
    expect(await page.locator("main").innerText()).not.toMatch(/Kazanç|Borçlu|Ödenmedi/u);

    // Her rapor isteği (özet + bekleyen liste) araç kimliğini taşır.
    expect(targets.length).toBeGreaterThanOrEqual(2);
    expect(targets.every((value) => value === vehicleId)).toBe(true);

    // Onay sonrası ekip görünümü sahip görünümüyle aynı tutarları verir.
    await confirm();
    await page.reload();
    await expect(page.locator("p", { hasText: "Teslim alınan (onaylı)" }).first()).toContainText("6.000,00 TL");
    await expect(page.getByText("Bu dönemde bekleyen kayıt yok.")).toBeVisible();

    const ownerTargets = collectTargets(owner);
    const ownerRead = owner.waitForResponse(SUMMARY_URL);
    await owner.goto("/sahip");
    await ownerRead;
    for (const [label, value] of PRD_TOTALS) await expect(totalsRow(owner, label)).toContainText(value);
    await expect(owner.locator("p", { hasText: "Teslim alınan (onaylı)" }).first()).toContainText("6.000,00 TL");
    expect(ownerTargets.length).toBeGreaterThan(0);
    expect(ownerTargets.every((value) => value === undefined)).toBe(true);
  });

  test("Raporlar: kalan ve teslim alınan sahip raporuyla aynı; Kişiler, kişi ayrıntısı ve Gün gün bağlantıları yönetim sayfasına gider", async ({
    page,
    browser,
  }, testInfo) => {
    await loginAsAdmin(page);
    const { vehicleId, entryId, owner, confirm } = await seedPrdVehicle(page, browser, testInfo.project.use.baseURL, "RAR");
    await confirm();

    const targets = collectTargets(page);
    const firstRead = page.waitForResponse(VEHICLE_REPORT_URL);
    await page.goto(`/yonetim/araclar/${vehicleId}/raporlar`);
    await firstRead;
    await expect(page.getByRole("heading", { name: "Raporlar", level: 1 })).toBeVisible();
    await expect(page.getByText(`İşlemi yapan: ${SEED_USERNAMES.admin} (Yönetici)`)).toBeVisible();
    const remainder = page.locator("p", { hasText: "Hesaplanan kalan" }).first();
    const received = page.locator("p", { hasText: "Teslim alınan (onaylı)" }).first();
    await expect(remainder).toContainText("14.400,00 TL");
    await expect(received).toContainText("6.000,00 TL");

    // Kişiler → kişi ayrıntısı → Kaydı aç.
    await expect(page.getByRole("button", { name: "Ayrıntıyı gör" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Ayrıntıyı gör" }).first().click();
    await expect(page.getByRole("link", { name: "Kaydı aç" }).first()).toHaveAttribute("href", /\/yonetim\/araclar\/[0-9a-f-]{36}\/kayitlar\/[0-9a-f-]{36}$/u);
    for (const link of await page.getByRole("link", { name: "Kaydı aç" }).all()) {
      await expect(link).toHaveAttribute("href", new RegExp(`^/yonetim/araclar/${vehicleId}/kayitlar/`, "u"));
    }
    await page.getByRole("button", { name: /Kişilere dön/u }).first().click();

    // Gün gün: kart bağlantıları yönetim sayfasına gider.
    await page.getByRole("tab", { name: "Gün gün" }).click();
    const cards = page.locator("li", { hasText: "Kaydı aç" });
    await expect(cards).toHaveCount(2);
    await expect(cards.getByRole("link", { name: "Kaydı aç" }).first()).toHaveAttribute("href", new RegExp(`^/yonetim/araclar/${vehicleId}/kayitlar/`, "u"));
    await expect(page.locator(`a[href="/yonetim/araclar/${vehicleId}/kayitlar/${entryId}"]`)).toHaveCount(1);
    await expect(page.locator('a[href^="/sahip/"]')).toHaveCount(0);

    // Her istek (araç raporu, kişiler, kişi ayrıntısı, kayıt listesi) araç kimliğini taşır.
    expect(targets.length).toBeGreaterThanOrEqual(4);
    expect(targets.every((value) => value === vehicleId)).toBe(true);

    // Sahip raporu aynı tutarları verir.
    const ownerRead = owner.waitForResponse(VEHICLE_REPORT_URL);
    await owner.goto("/sahip/raporlar");
    await ownerRead;
    await expect(owner.locator("p", { hasText: "Hesaplanan kalan" }).first()).toContainText("14.400,00 TL");
    await expect(owner.locator("p", { hasText: "Teslim alınan (onaylı)" }).first()).toContainText("6.000,00 TL");
  });

  test("hedef değişince önceki aracın tutarı görünmez; geri-ileri önbelleği dönüşü yeniden okur; çıkışta tutar kalmaz", async ({
    page,
    browser,
  }, testInfo) => {
    await loginAsAdmin(page);
    const withData = await seedPrdVehicle(page, browser, testInfo.project.use.baseURL, "RAA");
    const empty = await createBusinessWithVehicle(page, "RAB", "Boş Sahip");
    const main = page.locator("main");

    await page.goto(`/yonetim/araclar/${withData.vehicleId}/raporlar`);
    await expect(page.locator("p", { hasText: "Hesaplanan kalan" }).first()).toContainText("14.400,00 TL");

    // Hedef değişimi: ikinci araç yavaş yanıtlasa da önceki aracın hiçbir tutarı görünmez.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(VEHICLE_REPORT_URL, async (route) => {
      await gate;
      await route.continue();
    });
    await page.getByRole("button", { name: "Hedefi değiştir" }).click();
    await page.waitForURL("**/yonetim");
    await page.goto(`/yonetim/araclar/${empty.vehicleId}/raporlar`);
    await expect(page.getByText(`Araç: ${displayPlate(empty.plate)} · Sahip: Boş Sahip`)).toBeVisible();
    await expect(page.getByText("Rapor yükleniyor…")).toBeVisible();
    await expect(main).not.toContainText("TL");
    release();
    await expect(page.getByText("Bu dönemde kayıt yok.")).toBeVisible();
    await expect(main).not.toContainText("14.400,00");
    await page.unroute(VEHICLE_REPORT_URL);

    // Geri-ileri önbelleği dönüşü (pageshow persisted): tutarlar temizlenir ve yeniden okunur.
    await page.goto(`/yonetim/araclar/${withData.vehicleId}/raporlar`);
    await expect(page.locator("p", { hasText: "Hesaplanan kalan" }).first()).toContainText("14.400,00 TL");
    let reads = 0;
    await page.route(VEHICLE_REPORT_URL, async (route) => {
      reads += 1;
      await gate;
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "SESSION_EXPIRED" } }) });
    });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(page.getByText("Rapor yükleniyor…")).toBeVisible();
    await expect(main).not.toContainText("TL");
    await expect(page.getByText("Oturumun sona erdi. Yeniden giriş yap.")).toBeVisible();
    expect(reads).toBe(1);
    await expect(page.getByRole("link", { name: "Giriş sayfasına git" })).toHaveAttribute("href", "/yonetim/giris");
    await page.unroute(VEHICLE_REPORT_URL);

    // Çıkış: oturum kapanır; geri dönüşte hiçbir tutar gösterilmez.
    await page.goto(`/yonetim/araclar/${withData.vehicleId}/raporlar`);
    await expect(page.locator("p", { hasText: "Hesaplanan kalan" }).first()).toContainText("14.400,00 TL");
    await page.getByRole("button", { name: "Çıkış" }).click();
    await page.waitForURL("**/yonetim/giris");
    await page.goBack();
    // Geri dönüş ya girişe yönlenir ya da önbellekten gelen sayfa 401 ile yeniden okur; ikisinde de tutar yok.
    await expect(page.getByLabel("Kullanıcı adı").or(page.getByText("Oturumun sona erdi. Yeniden giriş yap."))).toBeVisible();
    await expect(main).not.toContainText("14.400,00");
    await expect(main).not.toContainText("6.000,00");
  });

  test("320 px genişlikte yatay kaydırma yok; dönem sekmeleri ve süzgeçler 48 px altına inmez", async ({ page, browser }, testInfo) => {
    await loginAsAdmin(page);
    const { vehicleId } = await seedPrdVehicle(page, browser, testInfo.project.use.baseURL, "RAV");
    await page.setViewportSize({ width: 320, height: 700 });

    const pendingRead = page.waitForResponse(/\/api\/v1\/work-entries\?/u);
    await page.goto(`/yonetim/araclar/${vehicleId}/ozet`);
    await pendingRead;
    await expect(totalsRow(page, "Hasılat")).toContainText("20.000,00 TL");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const select = await page.getByLabel("Dönem", { exact: true }).boundingBox();
    expect(select!.height).toBeGreaterThanOrEqual(48);

    const reportRead = page.waitForResponse(VEHICLE_REPORT_URL);
    await page.goto(`/yonetim/araclar/${vehicleId}/raporlar`);
    await reportRead;
    await expect(page.locator("p", { hasText: "Hesaplanan kalan" }).first()).toContainText("14.400,00 TL");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const name of ["Bu hafta", "Bu ay", "Bu yıl"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }
  });
});
