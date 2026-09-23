import { expect, test, type Page } from "@playwright/test";
import {
  SEED_IDS,
  SEED_RAW_PLATES,
  SEED_TEST_PASSWORDS,
  SEED_USERNAMES,
} from "../../scripts/db-seed-dev";

/**
 * Kayıt detayı ve düzenleme uçtan uca testleri (T3.5). Gerçek standalone sunucu
 * + seed; her test kendi kaydını UI'dan oluşturur ve "Kaydı aç" bağlantısıyla
 * açar. Onaylı kayıt henüz oluşturulamadığından onaylı durumun birim ve
 * entegrasyon testleri vardır. Sayfa hydrate olmadan etkileşim yapılmaz:
 * `networkidle` beklenir.
 */

const CONFLICT_TEXT = "Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.";
const DRIVERS_URL = "**/api/v1/drivers";
const MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

/** Şu an İstanbul'da hangi gün — cihaz saat diliminden bağımsız. */
function istanbulTodayParts(): { iso: string; display: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const [year, month, day] = [get("year"), get("month"), get("day")];
  return {
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    display: `${day} ${MONTHS[month - 1]} ${year}`,
  };
}

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

async function openHydrated(page: Page, url: string): Promise<void> {
  const firstRead = page.waitForResponse(DRIVERS_URL);
  await page.goto(url);
  await firstRead;
}

/** Sahip formundan bir kayıt oluşturur ve "Kaydı aç" ile detay sayfasına gider. */
async function createOwnerEntry(
  page: Page,
  options: { date: string; kind: "owner" | "driver" },
): Promise<void> {
  await openHydrated(page, "/sahip/kayit/yeni");
  await page.getByLabel("Çalışılan gün").fill(options.date);
  await page.getByLabel("Başlangıç saati").fill("08:00");
  await page.getByLabel("Bitiş saati").fill("17:00");
  await page.getByLabel("Hasılat").fill("10.000");
  await page.getByLabel("Mazot").fill("1.500");
  await page.getByRole("button", { name: "+ Masraf ekle" }).click();
  await page.getByLabel("Diğer masraf").fill("300");
  if (options.kind === "owner") {
    await page.getByRole("button", { name: "Kendim çalıştım" }).click();
  } else {
    await page.getByRole("button", { name: "Şoför adına" }).click();
    await page.getByLabel("Kim çalıştı?").selectOption({ label: "Hüseyin Ak" });
  }
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Kaydedildi", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Kaydı aç" }).click();
  await page.waitForURL("**/sahip/kayitlar/*");
  await page.waitForLoadState("networkidle");
}

/** Sunucu kaydının bir satırı (üstteki "Güncel kayıt" kartı). */
function detailRow(page: Page, label: string) {
  return page.locator("#entry-detail p", { hasText: label }).first();
}

/** Formdaki canlı özet satırı. */
function summaryLine(page: Page, label: string) {
  return page.locator("#work-summary p", { hasText: label }).first();
}

function capturePatches(page: Page): string[] {
  const bodies: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes("/api/v1/work-entries/")) {
      bodies.push(request.postData() ?? "");
    }
  });
  return bodies;
}

const SAVE = "Değişiklikleri kaydet";

test.describe("Sahip kayıt düzenleme (/sahip/kayitlar/:id)", () => {
  test("şoför adına bekleyen kayıt: brüt değişir, sunucunun yeni sürümü, payı ve teslimi görünür; hâlâ 'Henüz doğrulanmadı'; tür değiştirilemez", async ({
    page,
  }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-01", kind: "driver" });
    const patches = capturePatches(page);

    await expect(page.getByRole("heading", { name: "Kayıt detayı" })).toBeVisible();
    await expect(detailRow(page, "Şoför payı")).toContainText("2.000,00 TL");
    await expect(detailRow(page, "Teslim edilecek tutar")).toContainText("6.200,00 TL");
    await expect(page.getByText("Henüz doğrulanmadı")).toBeVisible();
    await expect(page.getByText("Sürüm 1")).toBeVisible();
    // Tür formda değiştirilemez; alınan tutar yok.
    await expect(page.getByRole("button", { name: "Şoför adına" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Kendim çalıştım" })).toHaveCount(0);
    await expect(page.getByText("Parayı aldım")).toHaveCount(0);
    await expect(page.getByLabel("Hasılat")).toHaveValue("10.000,00");
    await expect(page.getByLabel("Kim çalıştı?")).toHaveValue(/.+/);

    // Değişiklik yoksa istek gitmez.
    await page.getByRole("button", { name: SAVE }).click();
    await expect(page.getByText("Değişiklik yok.")).toBeVisible();
    expect(patches).toHaveLength(0);

    await page.getByLabel("Hasılat").fill("12.000");
    await expect(summaryLine(page, "Şoför payı (%20)")).toContainText("2.400,00 TL");
    await page.getByRole("button", { name: SAVE }).click();

    await expect(page.getByText("Değişiklikler kaydedildi")).toBeVisible();
    await expect(page.getByText("Sürüm 2")).toBeVisible();
    await expect(detailRow(page, "Hasılat")).toContainText("12.000,00 TL");
    await expect(detailRow(page, "Şoför payı")).toContainText("2.400,00 TL");
    await expect(detailRow(page, "Teslim edilecek tutar")).toContainText("7.800,00 TL");
    await expect(page.getByText("Henüz doğrulanmadı")).toBeVisible();
    expect(patches).toHaveLength(1);
    const body = JSON.parse(patches[0]!);
    expect(body).toMatchObject({ version: 1, grossCents: "1200000" });
    for (const key of ["workType", "personId", "shareCents", "status", "businessId"]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(body.workerPersonId).toBeTruthy();
  });

  test("sahibin kendi kaydı: pay 0,00 TL ve 'Onay gerekmiyor' düzenlemeden sonra da kalır; kişi seçici yok", async ({
    page,
  }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-02", kind: "owner" });
    const patches = capturePatches(page);

    await expect(detailRow(page, "Şoför payı")).toContainText("0,00 TL");
    await expect(page.getByText("Onay gerekmiyor")).toBeVisible();
    await expect(page.getByLabel("Kim çalıştı?")).toHaveCount(0);

    await page.getByLabel("Hasılat").fill("9.000");
    await page.getByRole("button", { name: SAVE }).click();
    await expect(page.getByText("Değişiklikler kaydedildi")).toBeVisible();
    await expect(page.getByText("Sürüm 2")).toBeVisible();
    await expect(detailRow(page, "Hasılat")).toContainText("9.000,00 TL");
    await expect(detailRow(page, "Şoför payı")).toContainText("0,00 TL");
    await expect(detailRow(page, "Giderlerden sonra kalan")).toContainText("7.200,00 TL");
    await expect(page.getByText("Onay gerekmiyor")).toBeVisible();
    expect(JSON.parse(patches[0]!)).not.toHaveProperty("workerPersonId");
  });

  test("başka cihaz aynı sürümü kaydetmişse: çakışma metni, güncel değerler ve kullanıcının taslağı yan yana; kayıt kilitli, seçimle devam edilir", async ({
    page,
    browser,
  }, testInfo) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-03", kind: "driver" });
    const patches = capturePatches(page);

    // İkinci cihaz (ayrı depolama) aynı kaydı önce kaydeder.
    const other = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(other, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await other.goto(page.url());
    await other.waitForLoadState("networkidle");
    await other.getByLabel("Hasılat").fill("12.000");
    await other.getByRole("button", { name: SAVE }).click();
    await expect(other.getByText("Sürüm 2")).toBeVisible();

    await page.getByLabel("Hasılat").fill("13.000");
    await page.getByRole("button", { name: SAVE }).click();

    await expect(page.getByText(CONFLICT_TEXT).first()).toBeVisible();
    await expect(page.getByText("Sürüm 2")).toBeVisible();
    await expect(detailRow(page, "Hasılat")).toContainText("12.000,00 TL");
    await expect(page.getByLabel("Hasılat")).toHaveValue("13.000");
    await expect(page.getByLabel("Hasılat")).toBeDisabled();
    await expect(page.getByRole("button", { name: SAVE })).toHaveCount(0);
    expect(JSON.parse(patches[0]!)).toMatchObject({ version: 1 });

    await page.getByRole("button", { name: "Benim değerlerimle devam et" }).click();
    await expect(page.getByLabel("Hasılat")).toBeEnabled();
    await page.getByRole("button", { name: SAVE }).click();
    await expect(page.getByText("Değişiklikler kaydedildi")).toBeVisible();
    await expect(page.getByText("Sürüm 3")).toBeVisible();
    await expect(detailRow(page, "Hasılat")).toContainText("13.000,00 TL");
    expect(JSON.parse(patches[1]!)).toMatchObject({ version: 2 });
  });

  test("çakışmada 'Güncel değerleri yükle' taslağı atar ve formu güncel kayıtla doldurur", async ({
    page,
    browser,
  }, testInfo) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-04", kind: "owner" });

    const other = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(other, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await other.goto(page.url());
    await other.waitForLoadState("networkidle");
    await other.getByLabel("Mazot").fill("2.000");
    await other.getByRole("button", { name: SAVE }).click();
    await expect(other.getByText("Sürüm 2")).toBeVisible();

    await page.getByLabel("Hasılat").fill("11.000");
    await page.getByRole("button", { name: SAVE }).click();
    await expect(page.getByText(CONFLICT_TEXT).first()).toBeVisible();

    await page.getByRole("button", { name: "Güncel değerleri yükle" }).click();
    await expect(page.getByLabel("Hasılat")).toHaveValue("10.000,00");
    await expect(page.getByLabel("Mazot")).toHaveValue("2.000,00");
    await expect(page.getByRole("button", { name: SAVE })).toBeVisible();
  });

  test("aynı tarayıcıdaki başka sekme kaydedince bu sekme bayat sürümü kaydedilebilir bırakmaz, güncel kaydı okur", async ({
    page,
    context,
  }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-05", kind: "owner" });
    const second = await context.newPage();
    await second.goto(page.url());
    await second.waitForLoadState("networkidle");
    await expect(second.getByText("Sürüm 1")).toBeVisible();

    await page.getByLabel("Hasılat").fill("8.000");
    await page.getByRole("button", { name: SAVE }).click();
    await expect(page.getByText("Sürüm 2")).toBeVisible();

    await expect(second.getByText("Sürüm 2")).toBeVisible();
    await expect(detailRow(second, "Hasılat")).toContainText("8.000,00 TL");
    await expect(second.getByLabel("Hasılat")).toHaveValue("8.000,00");
  });

  test("yanıt kaybolursa form kilitlenir; yenileme sonrası tekrar dene aynı gövde ve requestId ile tek yeni sürümle biter", async ({
    page,
  }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-06", kind: "owner" });
    const patches = capturePatches(page);
    let dropNext = true;
    await page.route("**/api/v1/work-entries/*", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      if (dropNext) {
        dropNext = false;
        await route.abort("failed");
        return;
      }
      await route.fulfill({ response });
    });

    await page.getByLabel("Hasılat").fill("9.500");
    await page.getByRole("button", { name: SAVE }).click();
    await expect(page.getByText(/Değişikliğin gönderilip gönderilmediği bilinmiyor/)).toBeVisible();
    await expect(page.getByLabel("Hasılat")).toBeDisabled();

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Değişikliğin gönderilip gönderilmediği bilinmiyor/)).toBeVisible();
    await expect(page.getByLabel("Hasılat")).toBeDisabled();

    await page.getByRole("button", { name: "Değişikliği tekrar dene" }).click();
    await expect(page.getByText("Değişiklikler kaydedildi")).toBeVisible();
    // Sunucu değişikliği yalnız BİR kez uyguladı: sürüm 2.
    await expect(page.getByText("Sürüm 2")).toBeVisible();
    await expect(detailRow(page, "Hasılat")).toContainText("9.500,00 TL");
    expect(patches).toHaveLength(2);
    expect(patches[1]).toBe(patches[0]);
    expect(JSON.parse(patches[0]!)).toMatchObject({ version: 1 });
  });

  test("bilinmeyen kayıt 404; şoför oturumu /sofor'a, ekip /yonetim'e, oturumsuz /giris'e yönlenir", async ({
    page,
    browser,
  }, testInfo) => {
    const unknownId = "00000000-0000-4000-8000-000000000000";
    await page.goto(`/sahip/kayitlar/${unknownId}`);
    await page.waitForURL("**/giris");

    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    const unknown = await page.goto(`/sahip/kayitlar/${unknownId}`);
    expect(unknown?.status()).toBe(404);

    const driver = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(driver, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver, "/sofor");
    await driver.goto(`/sahip/kayitlar/${unknownId}`);
    await driver.waitForURL("**/sofor");

    const staff = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await loginAsAdmin(staff);
    await staff.goto(`/sahip/kayitlar/${unknownId}`);
    await staff.waitForURL("**/yonetim");
  });
});

test.describe("Şoför kayıt listesi ve düzenleme (/sofor/kayitlar)", () => {
  test("şoför kişi seçer, kişinin kayıtlarını listeler; yalnız bugünün bekleyen kaydını düzenler, eskisi salt okunur", async ({
    page,
    browser,
  }, testInfo) => {
    // Hüseyin Ak için eski (bugün olmayan) bir kayıt sahip tarafından açılır.
    const owner = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(owner, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(owner, { date: "2026-06-07", kind: "driver" });

    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver, "/sofor");
    // Bugünün kaydı şoför formundan girilir.
    const today = istanbulTodayParts();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Kim çalıştı?").selectOption({ label: "Hüseyin Ak" });
    await page.getByLabel("Başlangıç saati").fill("08:00");
    await page.getByLabel("Bitiş saati").fill("17:30");
    await page.getByLabel("Hasılat").fill("10.000");
    await page.getByLabel("Mazot").fill("1.500");
    await page.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(page.getByText("Kaydedildi", { exact: true })).toBeVisible();

    await page.goto("/sofor");
    await page.getByRole("link", { name: "Kayıtlarım" }).click();
    await page.waitForURL("**/sofor/kayitlar");
    await expect(page.getByRole("heading", { name: "Kayıtlarım" })).toBeVisible();
    // Kişi seçilmeden liste yok.
    await expect(page.getByRole("link", { name: /Henüz doğrulanmadı/ })).toHaveCount(0);
    const options = await page.getByLabel("Kimin kayıtları?").locator("option").allTextContents();
    expect(options.slice(1).sort()).toEqual(["Hüseyin Ak", "Mehmet Öz", "Mehmet Öz"]);
    await page.getByLabel("Kimin kayıtları?").selectOption({ label: "Hüseyin Ak" });

    const todayRow = page.getByRole("link", { name: new RegExp(today.display) }).first();
    await expect(todayRow).toBeVisible();
    await todayRow.click();
    await page.waitForURL("**/sofor/kayitlar/*");
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Çalışılan gün")).toHaveValue(today.iso);
    await page.getByLabel("Hasılat").fill("11.000");
    await expect(summaryLine(page, "Şoför payın (%20)")).toContainText("2.200,00 TL");
    await page.getByRole("button", { name: SAVE }).click();
    await expect(page.getByText("Değişiklikler kaydedildi")).toBeVisible();
    await expect(detailRow(page, "Hasılat")).toContainText("11.000,00 TL");
    await expect(page.getByText("Henüz doğrulanmadı")).toBeVisible();

    // Eski kayıt listelenir ama düzenleme formu açılmaz.
    await page.goto("/sofor/kayitlar");
    await page.getByLabel("Kimin kayıtları?").selectOption({ label: "Hüseyin Ak" });
    await page.getByRole("link", { name: /7 Haziran 2026/ }).first().click();
    await page.waitForURL("**/sofor/kayitlar/*");
    await expect(
      page.getByText("Şoför olarak yalnız bugünün henüz doğrulanmamış kaydını düzenleyebilirsin."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: SAVE })).toHaveCount(0);
    await expect(page.getByLabel("Hasılat")).toHaveCount(0);
  });

  test("şoför sahibin kendi kaydını göremez (K1): 404; sahip oturumu /sofor/kayitlar'dan /sahip'e yönlenir", async ({
    page,
    browser,
  }, testInfo) => {
    const owner = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(owner, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(owner, { date: "2026-06-08", kind: "owner" });
    const ownerEntryId = owner.url().split("/").pop()!;

    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver, "/sofor");
    const hidden = await page.goto(`/sofor/kayitlar/${ownerEntryId}`);
    expect(hidden?.status()).toBe(404);

    await owner.goto("/sofor/kayitlar");
    await owner.waitForURL("**/sahip");
  });
});

test.describe("Ekip kayıt düzenleme (/yonetim/araclar/:id/kayitlar/:kayit)", () => {
  test("destek kaydı X-Target-Vehicle ve CSRF ile düzenler; audit'te görünür; Hedefi değiştir düzenleme taslağını siler", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await openHydrated(page, `/yonetim/araclar/${SEED_IDS.vehicleA1}/kayit/yeni`);
    await page.getByLabel("Çalışılan gün").fill("2026-06-09");
    await page.getByLabel("Başlangıç saati").fill("08:00");
    await page.getByLabel("Bitiş saati").fill("17:00");
    await page.getByLabel("Hasılat").fill("10.000");
    await page.getByLabel("Mazot").fill("1.500");
    await page.getByRole("button", { name: "Sahip çalıştı" }).click();
    await page.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(page.getByText("Kaydedildi", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Kaydı aç" }).click();
    await page.waitForURL(`**/yonetim/araclar/${SEED_IDS.vehicleA1}/kayitlar/*`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Destek: İşletme A")).toBeVisible();
    await expect(page.getByText("Onay gerekmiyor")).toBeVisible();
    const headers: Array<{ target: string | undefined; csrf: string | undefined }> = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/api/v1/work-entries/")) {
        headers.push({ target: request.headers()["x-target-vehicle"], csrf: request.headers()["x-csrf-token"] });
      }
    });
    await page.getByLabel("Hasılat").fill("10.500");
    await page.getByRole("button", { name: SAVE }).click();
    await expect(page.getByText("Değişiklikler kaydedildi")).toBeVisible();
    await expect(page.getByText("Sürüm 2")).toBeVisible();
    expect(headers).toHaveLength(1);
    expect(headers[0]!.target).toBe(SEED_IDS.vehicleA1);
    expect(headers[0]!.csrf).toBeTruthy();

    // Yarım bırakılan düzenleme taslağı hedef değişince silinir.
    const detailUrl = page.url();
    await page.getByLabel("Hasılat").fill("777");
    await page.getByRole("button", { name: "Hedefi değiştir" }).click();
    await page.getByRole("button", { name: "Bırakıp çık" }).click();
    await page.waitForURL("**/yonetim");
    await page.goto(detailUrl);
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Hasılat")).toHaveValue("10.500,00");

    await page.goto("/yonetim/islem-gecmisi");
    await expect(page.getByText("Çalışma kaydı düzenlendi").first()).toBeVisible();
  });

  test("bilinmeyen kayıt ve bilinmeyen araç 404", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const unknownEntry = await page.goto(
      `/yonetim/araclar/${SEED_IDS.vehicleA1}/kayitlar/00000000-0000-4000-8000-000000000000`,
    );
    expect(unknownEntry?.status()).toBe(404);
    const unknownVehicle = await page.goto(
      "/yonetim/araclar/00000000-0000-4000-8000-000000000000/kayitlar/00000000-0000-4000-8000-000000000000",
    );
    expect(unknownVehicle?.status()).toBe(404);
  });
});
