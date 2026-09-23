import { expect, test, type Page } from "@playwright/test";
import { SEED_RAW_PLATES, SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";

/**
 * Şoförün günlük kayıt formu uçtan uca testleri — T3.1. Gerçek standalone
 * sunucu + seed (yalnız OKUNUR); boş liste için test KENDİ işletme/aracını
 * açar. Form kayıt YAZMAZ: hiçbir testte "Kaydedildi" görünmemelidir.
 *
 * Hydration: şoför listesi istemcide `useEffect` ile yüklenir; seçenekler
 * görününce React hydrate olmuştur — etkileşimler bundan SONRA yapılır.
 */

const NOT_SAVED_TEXT =
  "Bilgiler geçerli. Kayıt henüz kaydedilmiyor; kaydetme bir sonraki aşamada açılacak.";
const EMPTY_TEXT = "Bu araçta seçilebilir şoför yok. Araç sahibinden şoför eklemesini iste.";
const SESSION_ENDED = "Oturumun sona erdi. Yeniden giriş yap.";
const CONNECTION_ERROR = "Bağlantı kurulamadı. Tekrar dene.";

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

async function loginAsDriver(page: Page, plate: string, password: string): Promise<void> {
  await page.goto("/giris");
  await page.getByLabel("Plaka").fill(plate);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL("**/sofor");
}

async function openSeedForm(page: Page): Promise<void> {
  await loginAsDriver(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver);
  await expect(page.getByRole("option", { name: "Hüseyin Ak" })).toBeAttached();
}

async function fillMoney(page: Page, gross: string, fuel: string): Promise<void> {
  await page.getByLabel("Hasılat").fill(gross);
  await page.getByLabel("Mazot").fill(fuel);
}

const SUMMARY_SHARE = "Şoför payın (%20)";
const SUMMARY_REMAINDER = "Teslim edilecek tutar";

/** Özet satırının değeri: etiket + sağdaki tutar aynı satırda. */
function summaryLine(page: Page, label: string) {
  return page.locator("#work-summary p", { hasText: label }).first();
}

test.describe("Şoför günlük kayıt formu (/sofor)", () => {
  test("sabit plaka, bugünün İstanbul tarihi ve yalnız aktif şoförler; hiçbiri önceden seçili değil", async ({
    page,
  }) => {
    await openSeedForm(page);
    const today = istanbulTodayParts();

    await expect(page.getByText(SEED_RAW_PLATES.vehicleA1, { exact: false })).toBeVisible();
    await expect(page.getByLabel("Çalışılan gün")).toHaveValue(today.iso);
    await expect(page.getByText(today.display)).toBeVisible();

    const person = page.getByLabel("Kim çalıştı?");
    await expect(person).toHaveValue("");
    const options = await person.locator("option").allTextContents();
    expect(options[0]).toBe("Adını seç");
    expect(options.slice(1).sort()).toEqual(["Hüseyin Ak", "Mehmet Öz", "Mehmet Öz"]);
    // Pasif atama ve başka aracın şoförü listede YOK; serbest metin alanı YOK.
    expect(options).not.toContain("Kemal Şahin");
    expect(options).not.toContain("Zeynep Arslan");
    // Serbest metin yok: yalnız iki tutar alanı (masraf bölümü kapalıyken).
    await expect(page.locator("form input[type=text], form textarea")).toHaveCount(2);
    await expect(page.locator("form input[type=number]")).toHaveCount(0);
  });

  test("canlı süre: 08:00-17:30 → 9 saat 30 dakika; aynı gün eşit/ters saat hata; ertesi gün 22:00-06:00 → 8 saat", async ({
    page,
  }) => {
    await openSeedForm(page);
    await page.getByLabel("Başlangıç saati").fill("08:00");
    await page.getByLabel("Bitiş saati").fill("17:30");
    await expect(page.getByText("Süre: 9 saat 30 dakika")).toBeVisible();

    await page.getByLabel("Bitiş saati").fill("08:00");
    await expect(page.getByText("Başlangıç ve bitiş saati aynı olamaz.")).toBeVisible();
    await expect(page.getByText(/^Süre:/)).toHaveCount(0);

    await page.getByLabel("Başlangıç saati").fill("22:00");
    await page.getByLabel("Bitiş saati").fill("06:00");
    await expect(page.getByText(/Bitiş saati başlangıçtan önce/)).toBeVisible();

    await page.getByLabel("Bitiş ertesi gün").check();
    await expect(page.getByText("Süre: 8 saat")).toBeVisible();
    await expect(page.getByText(/^Bitiş: \d+ \S+ \d{4} 06:00$/)).toBeVisible();

    await page.getByLabel("Bitiş saati").fill("22:30");
    await expect(page.getByText("Süre 24 saati geçemez.")).toBeVisible();
  });

  test("eksik kişi/saat alanları kendi altında hata verir, diğer değerler korunur; kayıt iddiası yok", async ({
    page,
  }) => {
    await openSeedForm(page);
    await page.getByLabel("Çalışılan gün").fill("2026-09-14");
    await page.getByLabel("Başlangıç saati").fill("08:00");
    await page.getByRole("button", { name: "Kontrol et" }).click();

    await expect(page.getByText("Adını seç.", { exact: true })).toBeVisible();
    await expect(page.getByText("Bitiş saatini gir.")).toBeVisible();
    await expect(page.getByLabel("Çalışılan gün")).toHaveValue("2026-09-14");
    await expect(page.getByLabel("Başlangıç saati")).toHaveValue("08:00");
    await expect(page.getByText("14 Eylül 2026")).toBeVisible();

    await page.getByLabel("Çalışılan gün").fill("");
    await page.getByRole("button", { name: "Kontrol et" }).click();
    await expect(page.getByText("Geçerli bir tarih gir.")).toBeVisible();
    await expect(page.getByText("Kaydedildi")).toHaveCount(0);
  });

  test("geçerli gönderim taze okur, kayıt YAZMAZ; aynı kişi ve gün için form tekrar doldurulabilir", async ({
    page,
  }) => {
    await openSeedForm(page);
    let reads = 0;
    await page.route("**/api/v1/drivers", async (route) => {
      reads += 1;
      await route.continue();
    });
    await page.getByLabel("Kim çalıştı?").selectOption({ label: "Hüseyin Ak" });
    await page.getByLabel("Başlangıç saati").fill("08:00");
    await page.getByLabel("Bitiş saati").fill("17:30");
    await fillMoney(page, "10.000", "1.500");
    await page.getByRole("button", { name: "Kontrol et" }).click();

    await expect(page.getByText(NOT_SAVED_TEXT, { exact: false })).toBeVisible();
    expect(reads).toBe(1);
    await expect(page.getByText("Kaydedildi")).toHaveCount(0);

    // Aynı kişi + gün için ikinci kayıt engellenmez: form düzenlenebilir kalır.
    await page.getByLabel("Başlangıç saati").fill("18:00");
    await expect(page.getByText(NOT_SAVED_TEXT, { exact: false })).toHaveCount(0);
    await page.getByLabel("Bitiş saati").fill("20:00");
    await page.getByRole("button", { name: "Kontrol et" }).click();
    await expect(page.getByText(NOT_SAVED_TEXT, { exact: false })).toBeVisible();
    await expect(page.getByText("Kaydedildi")).toHaveCount(0);
  });

  test("gönderimde taze okuma kişiyi artık içermiyorsa alan hatası + liste yenilenir, diğer alanlar korunur", async ({
    page,
  }) => {
    await openSeedForm(page);
    await page.getByLabel("Kim çalıştı?").selectOption({ label: "Hüseyin Ak" });
    await page.getByLabel("Başlangıç saati").fill("08:00");
    await page.getByLabel("Bitiş saati").fill("17:30");
    await fillMoney(page, "10.000", "1.500");

    // Form açıkken kişi pasife alınmış gibi: sonraki okuma onu içermez.
    await page.route("**/api/v1/drivers", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ drivers: [{ personId: "baska-kisi", fullName: "Başka Kişi" }] }),
      }),
    );
    await page.getByRole("button", { name: "Kontrol et" }).click();

    await expect(page.getByText(/Bu kişi artık bu araçta seçilemiyor/)).toBeVisible();
    await expect(page.getByLabel("Kim çalıştı?")).toHaveValue("");
    await expect(page.getByRole("option", { name: "Başka Kişi" })).toBeAttached();
    await expect(page.getByRole("option", { name: "Hüseyin Ak" })).toHaveCount(0);
    await expect(page.getByLabel("Başlangıç saati")).toHaveValue("08:00");
    await expect(page.getByLabel("Bitiş saati")).toHaveValue("17:30");
    await expect(page.getByText(NOT_SAVED_TEXT, { exact: false })).toHaveCount(0);
  });

  test("gönderimde taze okuma 401 dönerse oturum bitti metni görünür (kişi hatası değil)", async ({
    page,
  }) => {
    await openSeedForm(page);
    await page.getByLabel("Kim çalıştı?").selectOption({ label: "Hüseyin Ak" });
    await page.getByLabel("Başlangıç saati").fill("08:00");
    await page.getByLabel("Bitiş saati").fill("17:30");
    await fillMoney(page, "10.000", "1.500");
    await page.route("**/api/v1/drivers", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "SESSION_REVOKED", message: "x" },
          request_id: "r",
        }),
      }),
    );
    await page.getByRole("button", { name: "Kontrol et" }).click();

    await expect(page.getByRole("alert").filter({ hasText: SESSION_ENDED })).toBeVisible();
    await expect(page.getByText(/Bu kişi artık bu araçta seçilemiyor/)).toHaveCount(0);
  });

  test("liste hatası boş liste metnini göstermez; 'Tekrar dene' listeyi yükler", async ({ page }) => {
    await page.route("**/api/v1/drivers", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "x" }, request_id: "r" }),
      }),
    );
    await loginAsDriver(page, SEED_RAW_PLATES.vehicleA1, SEED_TEST_PASSWORDS.driver);

    await expect(page.getByText(CONNECTION_ERROR)).toBeVisible();
    await expect(page.getByText(EMPTY_TEXT)).toHaveCount(0);

    await page.unroute("**/api/v1/drivers");
    await page.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(page.getByRole("option", { name: "Hüseyin Ak" })).toBeAttached();
    await expect(page.getByText(CONNECTION_ERROR)).toHaveCount(0);
  });

  test("şoförü olmayan araçta boş liste metni görünür", async ({ page, browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    await page.goto("/yonetim/giris");
    await page.getByLabel("Kullanıcı adı").fill(SEED_USERNAMES.admin);
    await page.getByLabel("Şifre").fill(SEED_TEST_PASSWORDS.admin);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await page.waitForURL("**/yonetim");

    await page.goto("/yonetim/isletmeler/yeni");
    await page.getByLabel("İşletme adı").fill(`Form E2E ${Date.now()}`);
    await page.getByLabel("Sahibin ad soyadı").fill("Sevim Sahip");
    await page.getByRole("button", { name: "İşletmeyi kaydet" }).click();
    await page.waitForURL(/\/yonetim\/isletmeler\/[0-9a-f-]{36}$/);
    const businessId = page.url().split("/").pop()!;

    const plate = `34 FRM ${100 + (Date.now() % 900)}`;
    await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
    await page.getByLabel("Plaka").fill(plate);
    await page.getByLabel("Sahip şifresi").fill("sahip-e2e-form");
    await page.getByLabel("Şoför şifresi").fill("sofor-e2e-form");
    await page.getByRole("button", { name: "Aracı kaydet" }).click();
    await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);

    const context = await browser.newContext({ baseURL });
    const driverPage = await context.newPage();
    await loginAsDriver(driverPage, plate, "sofor-e2e-form");
    await expect(driverPage.getByText(EMPTY_TEXT)).toBeVisible();
    await expect(driverPage.getByLabel("Kim çalıştı?")).toBeDisabled();
    await expect(driverPage.getByText(CONNECTION_ERROR)).toHaveCount(0);
    await context.close();
  });

  test("canlı özet: 10.000 / 1.500 / 300 → pay 2.000,00 TL, teslim 6.200,00 TL; gönderimden ÖNCE; salt okunur", async ({
    page,
  }) => {
    await openSeedForm(page);
    await fillMoney(page, "10.000", "1.500");
    await page.getByRole("button", { name: "+ Masraf ekle" }).click();
    await page.getByLabel("Diğer masraf").fill("300");
    await page.getByLabel("Açıklama").fill("Otopark");

    await expect(summaryLine(page, SUMMARY_SHARE)).toContainText("2.000,00 TL");
    await expect(summaryLine(page, SUMMARY_REMAINDER)).toContainText("6.200,00 TL");
    await expect(page.getByText("Kaydedildi")).toHaveCount(0);

    // Pay ve kalan düzenlenebilir kontrol DEĞİL.
    await expect(page.locator("#work-summary input, #work-summary select, #work-summary textarea")).toHaveCount(0);

    // Kullanılmayan masraf bölümü kapalıyken de özet hesaplanır (masraf 0).
    await page.getByLabel("Diğer masraf").fill("");
    await page.getByLabel("Açıklama").fill("");
    await expect(summaryLine(page, SUMMARY_REMAINDER)).toContainText("6.500,00 TL");
  });

  test("özet '—' gösterir: hasılat boş, geçersiz ('1.5') ve masraf açıklaması tutarsız; son geçerli toplam kalmaz", async ({
    page,
  }) => {
    await openSeedForm(page);
    await expect(summaryLine(page, SUMMARY_SHARE)).toContainText("—");
    await expect(summaryLine(page, SUMMARY_REMAINDER)).toContainText("—");

    await fillMoney(page, "10.000", "1.500");
    await expect(summaryLine(page, SUMMARY_REMAINDER)).toContainText("6.500,00 TL");

    await page.getByLabel("Hasılat").fill("");
    await expect(summaryLine(page, SUMMARY_SHARE)).toContainText("—");
    await expect(summaryLine(page, SUMMARY_REMAINDER)).toContainText("—");

    await page.getByLabel("Hasılat").fill("1.5");
    await expect(summaryLine(page, SUMMARY_SHARE)).toContainText("—");
    await expect(summaryLine(page, SUMMARY_REMAINDER)).not.toContainText("TL");

    await page.getByLabel("Hasılat").fill("10.000");
    await page.getByRole("button", { name: "+ Masraf ekle" }).click();
    await page.getByLabel("Açıklama").fill("Otopark");
    // Notlu boş tutar 0 sayılmaz.
    await expect(summaryLine(page, SUMMARY_REMAINDER)).toContainText("—");
  });

  test("açık 0 geçerlidir: hasılat 0 ve mazot 0 → pay 0,00 TL, teslim 0,00 TL, uyarı yok", async ({
    page,
  }) => {
    await openSeedForm(page);
    await fillMoney(page, "0", "0");
    await expect(summaryLine(page, SUMMARY_SHARE)).toContainText("0,00 TL");
    await expect(summaryLine(page, SUMMARY_REMAINDER)).toContainText("0,00 TL");
    await expect(page.getByText(/eksi görünür/)).toHaveCount(0);

    await page.getByLabel("Kim çalıştı?").selectOption({ label: "Hüseyin Ak" });
    await page.getByLabel("Başlangıç saati").fill("08:00");
    await page.getByLabel("Bitiş saati").fill("17:30");
    await page.getByRole("button", { name: "Kontrol et" }).click();
    await expect(page.getByText(NOT_SAVED_TEXT, { exact: false })).toBeVisible();
  });

  test("eksi teslim tutarı kırpılmaz: 10.000 / 9.000 / 0 → -1.000,00 TL ve uyarı metni", async ({
    page,
  }) => {
    await openSeedForm(page);
    await fillMoney(page, "10.000", "9.000");
    await page.getByRole("button", { name: "+ Masraf ekle" }).click();
    await page.getByLabel("Diğer masraf").fill("0");

    await expect(summaryLine(page, SUMMARY_SHARE)).toContainText("2.000,00 TL");
    await expect(summaryLine(page, SUMMARY_REMAINDER)).toContainText("-1.000,00 TL");
    await expect(page.getByText(/Giderler hasılatı ve payı aşıyor/)).toBeVisible();
  });

  test("dolu masraf bölümünü kapatmak onay ister: Vazgeç 300'ü korur, Kaldır siler", async ({
    page,
  }) => {
    await openSeedForm(page);
    await fillMoney(page, "10.000", "1.500");
    await page.getByRole("button", { name: "+ Masraf ekle" }).click();
    await page.getByLabel("Diğer masraf").fill("300");

    await page.getByRole("button", { name: "Masrafı kaldır" }).click();
    const dialog = page.getByRole("dialog", { name: "Masraf kaldırılsın mı?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Vazgeç" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel("Diğer masraf")).toHaveValue("300");
    await expect(summaryLine(page, SUMMARY_REMAINDER)).toContainText("6.200,00 TL");

    await page.getByRole("button", { name: "Masrafı kaldır" }).click();
    await dialog.getByRole("button", { name: "Kaldır" }).click();
    await expect(page.getByLabel("Diğer masraf")).toHaveCount(0);
    await expect(summaryLine(page, SUMMARY_REMAINDER)).toContainText("6.500,00 TL");

    // Boş bölüm onaysız kapanır.
    await page.getByRole("button", { name: "+ Masraf ekle" }).click();
    await page.getByRole("button", { name: "Masrafı kaldır" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("Diğer masraf")).toHaveCount(0);
  });

  test("'Kontrol et' boş hasılatta alan hatası verir, saat ve kişi korunur, kaydetme/'Kaydedildi' yok", async ({
    page,
  }) => {
    await openSeedForm(page);
    let reads = 0;
    await page.route("**/api/v1/drivers", async (route) => {
      reads += 1;
      await route.continue();
    });
    await page.getByLabel("Kim çalıştı?").selectOption({ label: "Hüseyin Ak" });
    await page.getByLabel("Başlangıç saati").fill("08:00");
    await page.getByLabel("Bitiş saati").fill("17:30");
    await page.getByLabel("Mazot").fill("1.500");
    await page.getByRole("button", { name: "Kontrol et" }).click();

    const error = page.locator("#work-gross-error");
    await expect(error).toHaveText("Tutarı gir. Yoksa 0 yaz.");
    await expect(page.getByLabel("Hasılat")).toHaveAttribute("aria-describedby", "work-gross-error");
    await expect(page.getByLabel("Başlangıç saati")).toHaveValue("08:00");
    await expect(page.getByLabel("Bitiş saati")).toHaveValue("17:30");
    await expect(page.getByLabel("Kim çalıştı?")).not.toHaveValue("");
    await expect(page.getByText(NOT_SAVED_TEXT, { exact: false })).toHaveCount(0);
    await expect(page.getByText("Kaydedildi")).toHaveCount(0);
    expect(reads).toBe(0);

    await page.getByLabel("Hasılat").fill("1.5");
    await expect(page.locator("#work-gross-error")).toContainText("Nokta yalnız binlik ayracıdır");
  });

  test("320 px viewport'ta yatay kaydırma yok", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await openSeedForm(page);
    await fillMoney(page, "10.000.000,00", "9.000.000,00");
    await page.getByRole("button", { name: "+ Masraf ekle" }).click();
    await expect(page.getByText(/Giderler hasılatı ve payı aşıyor/)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0))
      .toBeLessThanOrEqual(320);
  });
});
