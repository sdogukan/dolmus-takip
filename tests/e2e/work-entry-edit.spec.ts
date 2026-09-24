import { expect, test, type Page } from "@playwright/test";
import {
  SEED_IDS,
  SEED_RAW_PLATES,
  SEED_TEST_PASSWORDS,
  SEED_USERNAMES,
} from "../../scripts/db-seed-dev";

/**
 * Kayıt detayı, düzenleme ve sahibin teslim onayı uçtan uca testleri (T3.5,
 * T4.2). Gerçek standalone sunucu + seed; her test kendi kaydını UI'dan
 * oluşturur ve "Kaydı aç" bağlantısıyla açar. Sahip sayfasında düzenleme
 * formu "Kaydı düzenle" ile açılır. Sayfa hydrate olmadan etkileşim yapılmaz:
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
  options: { date: string; kind: "owner" | "driver"; gross?: string; fuel?: string },
): Promise<void> {
  await openHydrated(page, "/sahip/kayit/yeni");
  await page.getByLabel("Çalışılan gün").fill(options.date);
  await page.getByLabel("Başlangıç saati").fill("08:00");
  await page.getByLabel("Bitiş saati").fill("17:00");
  await page.getByLabel("Hasılat").fill(options.gross ?? "10.000");
  await page.getByLabel("Mazot").fill(options.fuel ?? "1.500");
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
const CONFIRM = "Parayı aldım, tutar doğru";
const CHECKING_TEXT = "Kaydın sonucu kontrol ediliyor.";

/** Sahip sayfasında düzenleme formunu açar. */
async function openEditForm(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Kaydı düzenle", exact: true }).click();
  await expect(page.getByRole("button", { name: SAVE })).toBeVisible();
}

function captureCorrects(page: Page): string[] {
  const bodies: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/correct-and-confirm")) {
      bodies.push(request.postData() ?? "");
    }
  });
  return bodies;
}

const CORRECT = "Düzelt ve onayla";
const CORRECTED_TEXT = "Kayıt düzeltildi ve onaylandı.";

/** Sahip sayfasında bekleyen şoför kaydını verilen tutarla onaylar (kayıt sürümü 2 olur). */
async function confirmEntry(page: Page, received: string): Promise<void> {
  await page.getByLabel("Aldığım tutar (TL)").fill(received);
  await page.getByRole("button", { name: CONFIRM }).click();
  await expect(page.getByText("Teslim doğrulandı")).toBeVisible();
}

/** Onaylı kayıtta düzeltme formunu açar. */
async function openCorrectForm(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Kaydı düzenle", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Onaylanmış kaydı düzelt" })).toBeVisible();
}

function captureConfirms(page: Page): string[] {
  const bodies: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/confirm")) {
      bodies.push(request.postData() ?? "");
    }
  });
  return bodies;
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("Sahip kayıt düzenleme (/sahip/kayitlar/:id)", () => {
  test("şoför adına bekleyen kayıt: brüt değişir, sunucunun yeni sürümü, payı ve teslimi görünür; hâlâ 'Henüz doğrulanmadı'; tür değiştirilemez", async ({
    page,
  }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-01", kind: "driver" });
    const patches = capturePatches(page);

    await expect(page.getByRole("heading", { name: "Kayıt detayı" })).toBeVisible();
    await expect(detailRow(page, "Şoför payı")).toContainText("2.000,00 TL");
    await expect(detailRow(page, "Beklenen teslim")).toContainText("6.200,00 TL");
    await expect(page.getByText("Henüz doğrulanmadı")).toBeVisible();
    // Düzenleme formu kapalı gelir ve "Kaydı düzenle" ile açılır.
    await expect(page.getByLabel("Hasılat (TL)")).toHaveCount(0);
    await openEditForm(page);
    // Tür formda değiştirilemez.
    await expect(page.getByRole("button", { name: "Şoför adına" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Kendim çalıştım" })).toHaveCount(0);
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
    await expect(detailRow(page, "Hasılat")).toContainText("12.000,00 TL");
    await expect(detailRow(page, "Şoför payı")).toContainText("2.400,00 TL");
    await expect(detailRow(page, "Beklenen teslim")).toContainText("7.800,00 TL");
    await expect(page.getByText("Henüz doğrulanmadı")).toBeVisible();
    // Kullanıcı yazmadıysa alınan tutar alanı sunucunun yeni beklenen tutarını izler; hâlâ onay yok.
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveValue("7.800,00");
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
    // Sahibin kendi kaydında teslim onayı yok.
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveCount(0);
    await expect(page.getByRole("button", { name: CONFIRM })).toHaveCount(0);
    await openEditForm(page);
    await expect(page.getByLabel("Kim çalıştı?")).toHaveCount(0);

    await page.getByLabel("Hasılat").fill("9.000");
    await page.getByRole("button", { name: SAVE }).click();
    await expect(page.getByText("Değişiklikler kaydedildi")).toBeVisible();
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
    await openEditForm(other);
    await other.getByLabel("Hasılat").fill("12.000");
    await other.getByRole("button", { name: SAVE }).click();
    await expect(detailRow(other, "Hasılat")).toContainText("12.000,00 TL");

    await openEditForm(page);
    await page.getByLabel("Hasılat").fill("13.000");
    await page.getByRole("button", { name: SAVE }).click();

    await expect(page.getByText(CONFLICT_TEXT).first()).toBeVisible();
    await expect(detailRow(page, "Hasılat")).toContainText("12.000,00 TL");
    await expect(page.getByLabel("Hasılat")).toHaveValue("13.000");
    await expect(page.getByLabel("Hasılat")).toBeDisabled();
    await expect(page.getByRole("button", { name: SAVE })).toHaveCount(0);
    expect(JSON.parse(patches[0]!)).toMatchObject({ version: 1 });

    await page.getByRole("button", { name: "Benim değerlerimle devam et" }).click();
    await expect(page.getByLabel("Hasılat")).toBeEnabled();
    await page.getByRole("button", { name: SAVE }).click();
    await expect(page.getByText("Değişiklikler kaydedildi")).toBeVisible();
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
    await openEditForm(other);
    await other.getByLabel("Mazot").fill("2.000");
    await other.getByRole("button", { name: SAVE }).click();
    await expect(detailRow(other, "Mazot")).toContainText("2.000,00 TL");

    await openEditForm(page);
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
    await expect(detailRow(second, "Hasılat")).toContainText("10.000,00 TL");

    await openEditForm(page);
    await page.getByLabel("Hasılat").fill("8.000");
    await page.getByRole("button", { name: SAVE }).click();
    await expect(page.getByText("Değişiklikler kaydedildi")).toBeVisible();

    await expect(detailRow(second, "Hasılat")).toContainText("8.000,00 TL");
    await openEditForm(second);
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

    await openEditForm(page);
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
    // Sunucu değişikliği yalnız BİR kez uyguladı: iki gönderim, aynı gövde.
    await expect(detailRow(page, "Hasılat")).toContainText("9.500,00 TL");
    expect(patches).toHaveLength(2);
    expect(patches[1]).toBe(patches[0]);
    expect(JSON.parse(patches[0]!)).toMatchObject({ version: 1 });
  });

  test("teslim onayı: bekleyen şoför kaydı beklenen tutar ve ön dolumla görünür, düğmeye basana dek doğrulanmaz; tek POST açık receivedCents ile gider; onaydan sonra sunucunun tutarı ve zamanı görünür, form salt okunur; 320 px'te yatay kaydırma yok", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-10", kind: "driver" });
    const confirms = captureConfirms(page);

    await expect(page.getByText(/Hüseyin Ak · /)).toBeVisible();
    await expect(page.getByText(/10 Haziran 2026 · 08:00–17:00/)).toBeVisible();
    await expect(page.getByText("Henüz doğrulanmadı")).toBeVisible();
    await expect(detailRow(page, "Hasılat")).toContainText("10.000,00 TL");
    await expect(detailRow(page, "Mazot")).toContainText("1.500,00 TL");
    await expect(detailRow(page, "Diğer masraf")).toContainText("300,00 TL");
    await expect(detailRow(page, "Şoför payı")).toContainText("2.000,00 TL");
    await expect(detailRow(page, "Beklenen teslim")).toContainText("6.200,00 TL");
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveValue("6.200,00");
    await expect(page.getByRole("button", { name: CONFIRM })).toBeEnabled();
    await expectNoHorizontalScroll(page);

    // Ön dolum onay değildir: yenilemede de istek gitmez, durum değişmez.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Henüz doğrulanmadı")).toBeVisible();
    expect(confirms).toHaveLength(0);

    // Fark metni yazdıkça güncellenir.
    await page.getByLabel("Aldığım tutar (TL)").fill("6.000");
    await expect(page.getByText("Beklenenden 200,00 TL az.")).toBeVisible();
    await page.getByLabel("Aldığım tutar (TL)").fill("6.200");
    await expect(page.getByText(/Beklenenden/)).toHaveCount(0);

    await page.getByRole("button", { name: CONFIRM }).dblclick();
    await expect(page.getByText("Teslim doğrulandı")).toBeVisible();
    expect(confirms).toHaveLength(1);
    expect(JSON.parse(confirms[0]!)).toEqual({
      requestId: expect.any(String),
      version: 1,
      receivedCents: "620000",
    });
    await expect(page.getByText("Alınan tutar")).toBeVisible();
    await expect(page.locator("section", { hasText: "Alınan tutar" })).toContainText("6.200,00 TL");
    await expect(page.locator("section", { hasText: "Doğrulama zamanı" })).toContainText(/\d{1,2} \S+ \d{4} · \d\d:\d\d/);
    await expect(page.getByText("Henüz doğrulanmadı")).toHaveCount(0);
    await expect(page.getByRole("button", { name: CONFIRM })).toHaveCount(0);
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveCount(0);
    // Onaydan sonra sahip kaydı düzeltebilir (T4.3): "Kaydı düzenle" görünür ama form kapalıdır, kayıtlı alan yok.
    await expect(page.getByRole("button", { name: "Kaydı düzenle", exact: true })).toHaveCount(1);
    await expect(page.getByLabel("Hasılat (TL)")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("teslim onayı: yazılan tutar korunur ve gövdede açık gider (eksik teslim)", async ({ page }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-11", kind: "driver" });
    const confirms = captureConfirms(page);

    // Geçersiz/eksi tutar alan hatasıdır, istek gitmez.
    await page.getByLabel("Aldığım tutar (TL)").fill("-5");
    await page.getByRole("button", { name: CONFIRM }).click();
    await expect(page.getByText("Tutar eksi olamaz.")).toBeVisible();
    expect(confirms).toHaveLength(0);

    await page.getByLabel("Aldığım tutar (TL)").fill("6.000");
    await page.getByRole("button", { name: CONFIRM }).click();
    await expect(page.getByText("Teslim doğrulandı")).toBeVisible();
    expect(confirms).toHaveLength(1);
    expect(JSON.parse(confirms[0]!)).toMatchObject({ version: 1, receivedCents: "600000" });
    await expect(page.locator("section", { hasText: "Alınan tutar" })).toContainText("6.000,00 TL");
  });

  test("teslim onayı (S4.2): beklenenden farklı tutar — beklenen ve alınan ayrı görünür, yazılan 6.000 yenilemede korunur, tek POST 600000 taşır; onaydan ve yenilemeden sonra 'Ödenmedi' yok, 320 px'te yatay kaydırma yok", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-16", kind: "driver" });
    const confirms = captureConfirms(page);

    await expect(detailRow(page, "Beklenen teslim")).toContainText("6.200,00 TL");
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveValue("6.200,00");

    await page.getByLabel("Aldığım tutar (TL)").fill("6.000");
    await expect(page.getByText("Beklenenden 200,00 TL az.")).toBeVisible();
    await expect(detailRow(page, "Hasılat")).toContainText("10.000,00 TL");
    await expect(detailRow(page, "Mazot")).toContainText("1.500,00 TL");
    await expect(detailRow(page, "Diğer masraf")).toContainText("300,00 TL");
    await expect(detailRow(page, "Şoför payı")).toContainText("2.000,00 TL");
    await expect(detailRow(page, "Beklenen teslim")).toContainText("6.200,00 TL");

    // Yazılan değer hazır beklenen tutara geri dönmez.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveValue("6.000");
    await expect(page.getByText("Beklenenden 200,00 TL az.")).toBeVisible();
    await expect(page.getByText("Henüz doğrulanmadı")).toBeVisible();
    expect(confirms).toHaveLength(0);

    await page.getByRole("button", { name: CONFIRM }).click();
    await expect(page.getByText("Teslim doğrulandı")).toBeVisible();
    expect(confirms).toHaveLength(1);
    expect(JSON.parse(confirms[0]!)).toEqual({
      requestId: expect.any(String),
      version: 1,
      receivedCents: "600000",
    });

    const expectConfirmedView = async (): Promise<void> => {
      await expect(detailRow(page, "Hasılat")).toContainText("10.000,00 TL");
      await expect(detailRow(page, "Mazot")).toContainText("1.500,00 TL");
      await expect(detailRow(page, "Diğer masraf")).toContainText("300,00 TL");
      await expect(detailRow(page, "Şoför payı")).toContainText("2.000,00 TL");
      await expect(detailRow(page, "Beklenen teslim")).toContainText("6.200,00 TL");
      await expect(page.getByText("Teslim doğrulandı")).toBeVisible();
      await expect(page.locator("section", { hasText: "Alınan tutar" })).toContainText("6.000,00 TL");
      await expect(page.getByText(/Ödenmedi/)).toHaveCount(0);
      await expect(page.getByText("Beklenenden")).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    };
    await expectConfirmedView();
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expectConfirmedView();
    expect(confirms).toHaveLength(1);
  });

  test("teslim onayı: istek sunucuya ulaşmadıysa sonuç belirsiz kalır; yenileme sonrası tekrar aynı requestId ve gövdeyle gider", async ({
    page,
  }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-12", kind: "driver" });
    const confirms = captureConfirms(page);
    let dropNext = true;
    await page.route("**/api/v1/work-entries/*/confirm", async (route) => {
      if (dropNext) {
        dropNext = false;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.getByLabel("Aldığım tutar (TL)").fill("6.000");
    await page.getByRole("button", { name: CONFIRM }).click();
    await expect(page.getByText(CHECKING_TEXT)).toBeVisible();
    await expect(page.getByRole("button", { name: CONFIRM })).toBeDisabled();
    await expect(page.getByLabel("Aldığım tutar (TL)")).toBeDisabled();

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(CHECKING_TEXT)).toBeVisible();
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveValue("6.000,00");
    await expect(page.getByText("Henüz doğrulanmadı")).toBeVisible();
    expect(confirms).toHaveLength(1); // yenileme kendiliğinden göndermez

    await page.getByRole("button", { name: "Sonucu şimdi kontrol et" }).click();
    await expect(page.getByText("Teslim doğrulandı")).toBeVisible();
    expect(confirms).toHaveLength(2);
    expect(confirms[1]).toBe(confirms[0]);
    expect(JSON.parse(confirms[0]!)).toMatchObject({ version: 1, receivedCents: "600000" });
    await expect(page.locator("section", { hasText: "Alınan tutar" })).toContainText("6.000,00 TL");
  });

  test("teslim onayı: yanıt kaybolur ama sunucu onaylamışsa tekrar deneme aynı gövdeyle yanıtı yeniden oynatır; tek onay", async ({
    page,
  }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-15", kind: "driver" });
    const confirms = captureConfirms(page);
    let dropNext = true;
    await page.route("**/api/v1/work-entries/*/confirm", async (route) => {
      const response = await route.fetch();
      if (dropNext) {
        dropNext = false;
        await route.abort("failed");
        return;
      }
      await route.fulfill({ response });
    });

    await page.getByRole("button", { name: CONFIRM }).click();
    await expect(page.getByText(CHECKING_TEXT)).toBeVisible();
    await page.getByRole("button", { name: "Sonucu şimdi kontrol et" }).click();
    await expect(page.getByText("Teslim doğrulandı")).toBeVisible();
    expect(confirms).toHaveLength(2);
    expect(confirms[1]).toBe(confirms[0]);
    await expect(page.locator("section", { hasText: "Alınan tutar" })).toContainText("6.200,00 TL");
    await expect(page.getByText(CHECKING_TEXT)).toHaveCount(0);
  });

  test("teslim onayı: başka cihaz kaydı değiştirmişse 409 kanonik metni ve güncel kayıt görünür; sonra yeni sürümle onaylanır", async ({
    page,
    browser,
  }, testInfo) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-13", kind: "driver" });
    const confirms = captureConfirms(page);

    const other = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(other, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await other.goto(page.url());
    await other.waitForLoadState("networkidle");
    await openEditForm(other);
    await other.getByLabel("Hasılat").fill("12.000");
    await other.getByRole("button", { name: SAVE }).click();
    await expect(detailRow(other, "Beklenen teslim")).toContainText("7.800,00 TL");

    await page.getByRole("button", { name: CONFIRM }).click();
    await expect(page.getByText(CONFLICT_TEXT).first()).toBeVisible();
    await expect(detailRow(page, "Hasılat")).toContainText("12.000,00 TL");
    await expect(detailRow(page, "Beklenen teslim")).toContainText("7.800,00 TL");
    await expect(page.getByText("Henüz doğrulanmadı")).toBeVisible();
    expect(JSON.parse(confirms[0]!)).toMatchObject({ version: 1, receivedCents: "620000" });

    // Kullanıcı yazmadığı için ön dolum güncel beklenen tutara geçer; yeni sürümle onaylanır.
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveValue("7.800,00");
    await page.getByRole("button", { name: CONFIRM }).click();
    await expect(page.getByText("Teslim doğrulandı")).toBeVisible();
    expect(confirms).toHaveLength(2);
    expect(JSON.parse(confirms[1]!)).toMatchObject({ version: 2, receivedCents: "780000" });
    expect(JSON.parse(confirms[1]!).requestId).not.toBe(JSON.parse(confirms[0]!).requestId);
  });

  test("teslim onayı: eksi beklenen tutar uyarı ile gösterilir ve alan boş başlar; boş alanla istek gitmez", async ({
    page,
  }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-14", kind: "driver", gross: "1.000", fuel: "1.500" });
    const confirms = captureConfirms(page);

    await expect(detailRow(page, "Beklenen teslim")).toContainText("-1.000,00 TL");
    await expect(page.getByText(/teslim edilecek tutar eksi görünür/)).toBeVisible();
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveValue("");
    await page.getByRole("button", { name: CONFIRM }).click();
    await expect(page.getByText("Tutarı gir. Yoksa 0 yaz.")).toBeVisible();
    expect(confirms).toHaveLength(0);
    await expect(page.getByText("Henüz doğrulanmadı")).toBeVisible();
  });

  test("düzelt ve onayla: alınan tutar onaylı tutarla ön dolu, hasılat değişince kaymaz; Vazgeç istek atmaz; yalnız tutarı 6.100 yapınca tek POST gider ve sunucunun tutarı görünür; 320 px'te yatay kaydırma yok", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-20", kind: "driver" });
    await confirmEntry(page, "6.000");
    const corrects = captureCorrects(page);

    await openCorrectForm(page);
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveValue("6.000,00");
    await expect(page.getByLabel("Hasılat")).toHaveValue("10.000,00");
    await expect(page.locator("#correct-summary p", { hasText: "Yeni beklenen teslim" })).toContainText("6.200,00 TL");
    await expectNoHorizontalScroll(page);

    // Hasılat değişince yeni beklenen teslim değişir, alınan tutar DEĞİŞMEZ.
    await page.getByLabel("Hasılat").fill("12.000");
    await expect(page.locator("#correct-summary p", { hasText: "Yeni beklenen teslim" })).toContainText("7.800,00 TL");
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveValue("6.000,00");
    await expect(page.getByText("Beklenenden 1.800,00 TL az.")).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Vazgeç: yarım değişiklik varsa önce sorulur; hiçbir istek gitmez, kayıt aynı kalır.
    await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
    await expect(page.getByText("Değişiklikler silinsin mi?")).toBeVisible();
    await page.getByRole("button", { name: "Düzeltmeye dön" }).click();
    await expect(page.getByLabel("Hasılat")).toHaveValue("12.000");
    await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
    await page.getByRole("button", { name: "Sil ve kapat" }).click();
    await expect(page.getByRole("heading", { name: "Onaylanmış kaydı düzelt" })).toHaveCount(0);
    expect(corrects).toHaveLength(0);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(detailRow(page, "Hasılat")).toContainText("10.000,00 TL");
    await expect(page.locator("section", { hasText: "Alınan tutar" })).toContainText("6.000,00 TL");
    await expect(page.getByRole("heading", { name: "Onaylanmış kaydı düzelt" })).toHaveCount(0);

    // Değişmemiş formda Vazgeç doğrudan kapatır.
    await openCorrectForm(page);
    await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Onaylanmış kaydı düzelt" })).toHaveCount(0);
    expect(corrects).toHaveLength(0);

    // Hiçbir şey değişmediyse istek atılmaz.
    await openCorrectForm(page);
    await page.getByRole("button", { name: CORRECT }).click();
    await expect(page.getByText("Değişiklik yok.")).toBeVisible();
    expect(corrects).toHaveLength(0);

    // Yalnız alınan tutar 6.100: tek POST, açık receivedCents.
    await page.getByLabel("Aldığım tutar (TL)").fill("6.100");
    await page.getByRole("button", { name: CORRECT }).dblclick();
    await expect(page.getByText(CORRECTED_TEXT)).toBeVisible();
    expect(corrects).toHaveLength(1);
    expect(JSON.parse(corrects[0]!)).toEqual({
      requestId: expect.any(String),
      version: 2,
      workerPersonId: expect.any(String),
      date: "2026-06-20",
      startTime: "08:00",
      endTime: "17:00",
      endsNextDay: false,
      grossCents: "1000000",
      fuelCents: "150000",
      otherExpenseCents: "30000",
      receivedCents: "610000",
    });
    await expect(page.locator("section", { hasText: "Alınan tutar" })).toContainText("6.100,00 TL");
    await expect(page.getByRole("heading", { name: "Onaylanmış kaydı düzelt" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("section", { hasText: "Alınan tutar" })).toContainText("6.100,00 TL");
    expect(corrects).toHaveLength(1);
  });

  test("düzelt ve onayla: günlük alanlar da düzeltilir; alınan tutar korunur, yeni beklenen teslim sunucudan gelir", async ({
    page,
  }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-21", kind: "driver" });
    await confirmEntry(page, "6.000");
    const corrects = captureCorrects(page);

    await openCorrectForm(page);
    await page.getByLabel("Hasılat").fill("12.000");
    await page.getByRole("button", { name: CORRECT }).click();
    await expect(page.getByText(CORRECTED_TEXT)).toBeVisible();
    expect(JSON.parse(corrects[0]!)).toMatchObject({ version: 2, grossCents: "1200000", receivedCents: "600000" });
    await expect(detailRow(page, "Hasılat")).toContainText("12.000,00 TL");
    await expect(detailRow(page, "Beklenen teslim")).toContainText("7.800,00 TL");
    await expect(page.locator("section", { hasText: "Alınan tutar" })).toContainText("6.000,00 TL");
    await expect(page.getByText("Teslim doğrulandı")).toBeVisible();
  });

  test("düzelt ve onayla: başka cihaz önce düzelttiyse 409 kanonik metni ve güncel değerler görünür; güncel değerlerle yeni sürüme gönderilir", async ({
    page,
    browser,
  }, testInfo) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-22", kind: "driver" });
    await confirmEntry(page, "6.000");
    await openCorrectForm(page);
    const corrects = captureCorrects(page);

    const other = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(other, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await other.goto(page.url());
    await other.waitForLoadState("networkidle");
    await openCorrectForm(other);
    await other.getByLabel("Aldığım tutar (TL)").fill("6.050");
    await other.getByRole("button", { name: CORRECT }).click();
    await expect(other.getByText(CORRECTED_TEXT)).toBeVisible();

    await page.getByLabel("Aldığım tutar (TL)").fill("6.100");
    await page.getByRole("button", { name: CORRECT }).click();
    await expect(page.getByText(CONFLICT_TEXT).first()).toBeVisible();
    await expect(page.locator("section", { hasText: "Alınan tutar" }).first()).toContainText("6.050,00 TL");
    expect(JSON.parse(corrects[0]!)).toMatchObject({ version: 2, receivedCents: "610000" });

    // Kullanıcının bayat taslağı kilitlidir: gönderilemez, güncel değerler seçimle yüklenir.
    await expect(page.getByLabel("Aldığım tutar (TL)")).toBeDisabled();
    await expect(page.getByRole("button", { name: CORRECT })).toHaveCount(0);
    await page.getByRole("button", { name: "Güncel değerleri yükle" }).click();
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveValue("6.050,00");
    await page.getByLabel("Aldığım tutar (TL)").fill("6.200");
    await page.getByRole("button", { name: CORRECT }).click();
    await expect(page.getByText(CORRECTED_TEXT)).toBeVisible();
    expect(corrects).toHaveLength(2);
    expect(JSON.parse(corrects[1]!)).toMatchObject({ version: 3, receivedCents: "620000" });
    expect(JSON.parse(corrects[1]!).requestId).not.toBe(JSON.parse(corrects[0]!).requestId);
  });

  test("düzelt ve onayla: yanıt kaybolur ama sunucu işlemişse form kilitlenir; yenileme sonrası tekrar aynı requestId ve bayt bayt aynı gövdeyle gider, tek yeni sürümle biter", async ({
    page,
  }) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-23", kind: "driver" });
    await confirmEntry(page, "6.000");
    const entryId = page.url().split("/").pop()!;
    const corrects = captureCorrects(page);
    let dropNext = true;
    await page.route("**/api/v1/work-entries/*/correct-and-confirm", async (route) => {
      if (dropNext) {
        dropNext = false;
        await route.fetch(); // sunucu düzeltmeyi işler, yanıt tarayıcıya ulaşmaz
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await openCorrectForm(page);
    await page.getByLabel("Aldığım tutar (TL)").fill("6.100");
    await page.getByRole("button", { name: CORRECT }).click();
    await expect(page.getByText(/Düzeltmenin gönderilip gönderilmediği bilinmiyor/)).toBeVisible();
    await expect(page.getByLabel("Aldığım tutar (TL)")).toBeDisabled();
    await expect(page.getByLabel("Hasılat")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Vazgeç", exact: true })).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Düzeltmenin gönderilip gönderilmediği bilinmiyor/)).toBeVisible();
    await expect(page.getByLabel("Aldığım tutar (TL)")).toHaveValue("6.100");
    expect(corrects).toHaveLength(1); // yenileme kendiliğinden göndermez

    await page.getByRole("button", { name: "Sonucu şimdi kontrol et" }).click();
    await expect(page.getByText(CORRECTED_TEXT)).toBeVisible();
    expect(corrects).toHaveLength(2);
    expect(corrects[1]).toBe(corrects[0]);
    expect(JSON.parse(corrects[0]!)).toMatchObject({ version: 2, receivedCents: "610000" });
    await expect(page.locator("section", { hasText: "Alınan tutar" })).toContainText("6.100,00 TL");

    // Yeniden oynatma yeni sürüm üretmez: 2 (onay) → 3 (düzeltme), 4 değil.
    const response = await page.request.get(`/api/v1/work-entries/${entryId}`);
    expect((await response.json()).workEntry.version).toBe(3);
  });

  test("düzelt ve onayla: şoför görünümünde onaylı kayıtta düzeltme kontrolü çıkmaz; ekip tek 'Düzelt ve onayla' görür", async ({
    page,
    browser,
  }, testInfo) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-24", kind: "driver" });
    await confirmEntry(page, "6.200");
    const entryId = page.url().split("/").pop()!;
    await expect(page.getByRole("button", { name: "Kaydı düzenle", exact: true })).toBeVisible();

    const driver = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(driver, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver, "/sofor");
    await driver.goto(`/sofor/kayitlar/${entryId}`);
    await driver.waitForLoadState("networkidle");
    await expect(driver.getByText("Bu kayıt onaylanmış; buradan düzenlenemez.")).toBeVisible();
    await expect(driver.getByRole("button", { name: "Kaydı düzenle", exact: true })).toHaveCount(0);
    await expect(driver.getByRole("button", { name: CORRECT })).toHaveCount(0);

    const staff = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await loginAsAdmin(staff);
    await staff.goto(`/yonetim/araclar/${SEED_IDS.vehicleA1}/kayitlar/${entryId}`);
    await staff.waitForLoadState("networkidle");
    await expect(staff.getByText("Bu kayıt onaylanmış; buradan düzenlenemez.")).toHaveCount(0);
    await openCorrectForm(staff);
    await expect(staff.getByRole("button", { name: CORRECT })).toHaveCount(1);
    await expect(staff.getByLabel("Sahip adına alınan tutar")).toBeVisible();
    await expect(staff.getByText("Aldığım tutar")).toHaveCount(0);
  });

  test("ekip sahip adına teslimi onaylar: X-Target-Vehicle + CSRF, tek POST, tutarlar değişmez, iz sahip ve geçmiş sayfalarında; sonra ekip düzeltip onaylar", async ({
    page,
    browser,
  }, testInfo) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-26", kind: "driver" });
    const entryId = page.url().split("/").pop()!;
    const trace = `Sahip adına platform desteği · ${SEED_USERNAMES.admin}`;

    const staff = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await loginAsAdmin(staff);
    await staff.goto(`/yonetim/araclar/${SEED_IDS.vehicleA1}/kayitlar/${entryId}`);
    await staff.waitForLoadState("networkidle");
    await expect(staff.getByText("Destek: İşletme A")).toBeVisible();
    await expect(staff.getByText(`İşlemi yapan: ${SEED_USERNAMES.admin}`)).toBeVisible();
    await expect(detailRow(staff, "Hasılat")).toContainText("10.000,00 TL");
    await expect(staff.getByLabel("Sahip adına alınan tutar")).toBeVisible();
    await expect(staff.getByText("Aldığım tutar")).toHaveCount(0);
    await expect(staff.getByText("Parayı aldım")).toHaveCount(0);

    const requests: Array<{ url: string; target: string | undefined; csrf: string | undefined; body: string }> = [];
    staff.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/confirm")) {
        requests.push({
          url: request.url(),
          target: request.headers()["x-target-vehicle"],
          csrf: request.headers()["x-csrf-token"],
          body: request.postData() ?? "",
        });
      }
    });
    await staff.getByLabel("Sahip adına alınan tutar").fill("6.000");
    await staff.getByRole("button", { name: "Sahip adına teslimi onayla" }).click();
    await expect(staff.getByText(trace)).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toContain(`/api/v1/work-entries/${entryId}/confirm`);
    expect(requests[0]!.target).toBe(SEED_IDS.vehicleA1);
    expect(requests[0]!.csrf).toBeTruthy();
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ receivedCents: "600000" });
    await expect(staff.getByText("Alınan tutar", { exact: true })).toBeVisible();
    await expect(staff.locator("section", { hasText: "Alınan tutar" }).first()).toContainText("6.000,00 TL");
    await expect(detailRow(staff, "Hasılat")).toContainText("10.000,00 TL");
    await expect(detailRow(staff, "Şoför payı")).toContainText("2.000,00 TL");
    await expect(detailRow(staff, "Teslim edilecek tutar")).toContainText("6.200,00 TL");

    // İz sahip sayfasında ve iki geçmiş sayfasında aynı metindir.
    await page.goto(`/sahip/kayitlar/${entryId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(trace)).toBeVisible();
    await page.goto(`/sahip/kayitlar/${entryId}/gecmis`);
    await expect(page.getByText(trace)).toBeVisible();
    await staff.goto(`/yonetim/araclar/${SEED_IDS.vehicleA1}/kayitlar/${entryId}/gecmis`);
    await expect(staff.getByText(trace)).toBeVisible();

    // Onaylı kayıtta ekip tek "Düzelt ve onayla" ile düzeltir; istek hedef araçla gider.
    await staff.goto(`/yonetim/araclar/${SEED_IDS.vehicleA1}/kayitlar/${entryId}`);
    await staff.waitForLoadState("networkidle");
    const corrects = captureCorrects(staff);
    const targets: Array<string | undefined> = [];
    staff.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/correct-and-confirm")) {
        targets.push(request.headers()["x-target-vehicle"]);
      }
    });
    await openCorrectForm(staff);
    await staff.getByLabel("Sahip adına alınan tutar").fill("6.100");
    await staff.getByRole("button", { name: CORRECT }).click();
    await expect(staff.getByText(CORRECTED_TEXT)).toBeVisible();
    expect(corrects).toHaveLength(1);
    expect(targets).toEqual([SEED_IDS.vehicleA1]);
    expect(JSON.parse(corrects[0]!)).toMatchObject({ receivedCents: "610000" });
  });

  test("ekip onayı: yazılmış tutarla Hedefi değiştir onay ister ve devam edince taslağı siler; başka aracın kaydı bu araç URL'sinde 404", async ({
    page,
    browser,
  }, testInfo) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-27", kind: "driver" });
    const entryId = page.url().split("/").pop()!;

    const staff = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await loginAsAdmin(staff);
    const url = `/yonetim/araclar/${SEED_IDS.vehicleA1}/kayitlar/${entryId}`;
    await staff.goto(url);
    await staff.waitForLoadState("networkidle");
    await staff.getByLabel("Sahip adına alınan tutar").fill("5.500");
    await staff.getByRole("button", { name: "Hedefi değiştir" }).click();
    await staff.getByRole("button", { name: "Bırakıp çık" }).click();
    await staff.waitForURL("**/yonetim");
    await staff.goto(url);
    await staff.waitForLoadState("networkidle");
    await expect(staff.getByLabel("Sahip adına alınan tutar")).toHaveValue("6.200,00");

    const other = await staff.goto(`/yonetim/araclar/${SEED_IDS.vehicleA2}/kayitlar/${entryId}`);
    expect(other?.status()).toBe(404);
  });

  test("kayıt geçmişi: onaylanıp düzeltilen kayıtta 'Geçmişi gör' — oluşturma, iki ayrı onay satırı (yalnız sonuncu güncel), düzenleme/silme kontrolü ve toplam yok; şoför yönlenir ve bağlantı görmez; kapsam dışı kimlik 404", async ({
    page,
    browser,
  }, testInfo) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-25", kind: "driver" });
    await confirmEntry(page, "6.000");
    const entryId = page.url().split("/").pop()!;
    await openCorrectForm(page);
    await page.getByLabel("Aldığım tutar (TL)").fill("6.100");
    await page.getByRole("button", { name: CORRECT }).click();
    await expect(page.getByText(CORRECTED_TEXT)).toBeVisible();

    await page.getByRole("link", { name: "Geçmişi gör" }).click();
    await page.waitForURL(`**/sahip/kayitlar/${entryId}/gecmis`);
    await expect(page.getByRole("heading", { name: "Kayıt geçmişi" })).toBeVisible();

    const list = page.locator("#history-list > li");
    await expect(list.first()).toContainText("Kayıt oluşturuldu");
    await expect(list.first()).toContainText("Sürüm 1");
    const confirmations = list.filter({ hasText: "Teslim doğrulandı" });
    await expect(confirmations).toHaveCount(2);
    await expect(confirmations.nth(0)).toContainText("6.000,00 TL");
    await expect(confirmations.nth(0)).toContainText("Sahip oturumu");
    await expect(confirmations.nth(0)).not.toContainText("Güncel");
    await expect(confirmations.nth(1)).toContainText("6.100,00 TL");
    await expect(confirmations.nth(1)).toContainText("Güncel");
    await expect(page.locator("#history-current")).toContainText("6.100,00 TL");

    await expect(page.getByRole("button", { name: /düzenle|sil|kaydet|düzelt/iu })).toHaveCount(0);
    await expect(page.getByText(/toplam/iu)).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    const driver = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(driver, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver, "/sofor");
    await driver.goto(`/sahip/kayitlar/${entryId}/gecmis`);
    await driver.waitForURL("**/sofor");
    await driver.goto(`/yonetim/araclar/${SEED_IDS.vehicleA1}/kayitlar/${entryId}/gecmis`);
    await driver.waitForURL("**/sofor");
    await driver.goto(`/sofor/kayitlar/${entryId}`);
    await driver.waitForLoadState("networkidle");
    await expect(driver.getByRole("link", { name: "Geçmişi gör" })).toHaveCount(0);

    const unknown = await page.goto("/sahip/kayitlar/00000000-0000-4000-8000-000000000000/gecmis");
    expect(unknown?.status()).toBe(404);
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

  test("şoför detayı teslim durumunu gösterir: açılışta istek yok, 'Yenile' onayı okur (alınan/beklenen ayrı satır, doğrulama zamanı), okunamazsa son bilinen kalır, düzeltmeden sonra yalnız yeni sürüm", async ({
    page,
    browser,
  }, testInfo) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-28", kind: "driver" });
    const entryId = page.url().split("/").pop()!;

    const driver = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(driver, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver, "/sofor");
    await driver.goto(`/sofor/kayitlar/${entryId}`);
    await driver.waitForLoadState("networkidle");

    // Bekleyen: durum bir kez, ipucu var; onay/düzeltme/geçmiş kontrolü yok.
    await expect(driver.getByText("Henüz doğrulanmadı")).toHaveCount(1);
    await expect(driver.getByText("Mal sahibi parayı aldığında burada görebileceksin.")).toBeVisible();
    await expect(detailRow(driver, "Teslim edilecek tutar")).toContainText("6.200,00 TL");
    await expect(driver.getByText("Alınan tutar")).toHaveCount(0);
    await expect(driver.getByRole("button", { name: CONFIRM })).toHaveCount(0);
    await expect(driver.getByRole("button", { name: CORRECT })).toHaveCount(0);
    await expect(driver.getByRole("button", { name: "Kaydı düzenle", exact: true })).toHaveCount(0);
    await expect(driver.getByRole("link", { name: /geçmiş/i })).toHaveCount(0);
    await expectNoHorizontalScroll(driver);

    // Açılıştan sonra 'Yenile'ye basılana dek kayıt okuması gitmez (yoklama yok).
    const reads: string[] = [];
    driver.on("request", (request) => {
      if (request.method() === "GET" && /\/api\/v1\/work-entries\//.test(request.url())) reads.push(request.url());
    });
    await driver.waitForTimeout(1500);
    expect(reads).toHaveLength(0);

    // Sahip 6.000 onaylar (beklenen 6.200); şoför 'Yenile' ile görür.
    await confirmEntry(page, "6.000");
    await driver.getByRole("button", { name: "Yenile" }).click();
    await expect(driver.getByText("Teslim doğrulandı")).toHaveCount(1);
    await expect(detailRow(driver, "Teslim edilecek tutar")).toContainText("6.200,00 TL");
    await expect(detailRow(driver, "Alınan tutar")).toContainText("6.000,00 TL");
    await expect(detailRow(driver, "Doğrulama zamanı")).toContainText(/\d{4} · \d{2}:\d{2}/);
    await expect(driver.getByText("Henüz doğrulanmadı")).toHaveCount(0);
    await expect(driver.getByText("Sahip adına platform desteği")).toHaveCount(0);
    expect(reads).toHaveLength(1);
    await expectNoHorizontalScroll(driver);

    // Okunamayan 'Yenile': son bilinen durum ve tutarlar kalır.
    await driver.route(`**/api/v1/work-entries/${entryId}`, (route) => route.abort());
    await driver.getByRole("button", { name: "Yenile" }).click();
    await expect(driver.getByRole("alert").filter({ hasText: "Güncel kayıt okunamadı. Tekrar dene." })).toBeVisible();
    await expect(driver.getByText("Teslim doğrulandı")).toHaveCount(1);
    await expect(detailRow(driver, "Alınan tutar")).toContainText("6.000,00 TL");
    await expect(detailRow(driver, "Teslim edilecek tutar")).toContainText("6.200,00 TL");
    await driver.unroute(`**/api/v1/work-entries/${entryId}`);

    // Sahip düzeltip onaylar (beklenen 7.800, alınan 6.100); şoför yalnız yeni sürümü görür.
    await openCorrectForm(page);
    await page.getByLabel("Hasılat").fill("12.000");
    await page.getByLabel("Aldığım tutar (TL)").fill("6.100");
    await page.getByRole("button", { name: CORRECT }).click();
    await expect(page.getByText(CORRECTED_TEXT)).toBeVisible();
    await driver.getByRole("button", { name: "Yenile" }).click();
    await expect(detailRow(driver, "Teslim edilecek tutar")).toContainText("7.800,00 TL");
    await expect(detailRow(driver, "Alınan tutar")).toContainText("6.100,00 TL");
    await expect(driver.getByText("6.000,00 TL")).toHaveCount(0);
    await expect(driver.getByText("6.200,00 TL")).toHaveCount(0);
    await expect(driver.getByText("Teslim doğrulandı")).toHaveCount(1);
  });

  test("ekip sahip adına onaylayınca şoför 'Sahip adına platform desteği' görür, kullanıcı adı yok; liste satırı 'Teslim doğrulandı' der", async ({
    page,
    browser,
  }, testInfo) => {
    await login(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.owner, "/sahip");
    await createOwnerEntry(page, { date: "2026-06-29", kind: "driver" });
    const entryId = page.url().split("/").pop()!;

    const staff = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await loginAsAdmin(staff);
    await staff.goto(`/yonetim/araclar/${SEED_IDS.vehicleA1}/kayitlar/${entryId}`);
    await staff.waitForLoadState("networkidle");
    await staff.getByLabel("Sahip adına alınan tutar").fill("6.000");
    await staff.getByRole("button", { name: "Sahip adına teslimi onayla" }).click();
    await expect(staff.getByText(`Sahip adına platform desteği · ${SEED_USERNAMES.admin}`)).toBeVisible();

    const driver = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(driver, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver, "/sofor");
    await driver.goto(`/sofor/kayitlar/${entryId}`);
    await driver.waitForLoadState("networkidle");
    await expect(driver.getByText("Teslim doğrulandı")).toHaveCount(1);
    await expect(driver.getByText("Sahip adına platform desteği", { exact: true })).toBeVisible();
    await expect(driver.getByText(SEED_USERNAMES.admin)).toHaveCount(0);
    await expect(detailRow(driver, "Alınan tutar")).toContainText("6.000,00 TL");

    await driver.goto("/sofor/kayitlar");
    await driver.getByLabel("Kimin kayıtları?").selectOption({ label: "Hüseyin Ak" });
    const row = driver.getByRole("link", { name: /29 Haziran 2026/ }).first();
    await expect(row).toContainText("Teslim doğrulandı");
    await expect(row).not.toContainText("Onaylandı");
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
