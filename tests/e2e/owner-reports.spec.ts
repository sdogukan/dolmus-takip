import { expect, test, type Page } from "@playwright/test";
import { SEED_IDS, SEED_RAW_PLATES, SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";

/**
 * Sahip araç dönem raporu (/sahip/raporlar). Gerçek standalone sunucu + seed.
 * Veri testi yalnız A2 aracında (başka spec'lerin yazmadığı araç) kayıt açar ve
 * bugünün ayında çalışır; yükleniyor/hata/401 durumları yanıtı taklit eder.
 */

const REPORT_URL = /\/api\/v1\/reports\/vehicles\?/u;
const PEOPLE_URL = /\/api\/v1\/reports\/people\?/u;
const PERSON_URL = /\/api\/v1\/reports\/people\/[^/?]+\?/u;
const ENTRIES_URL = /\/api\/v1\/work-entries\?/u;
const PLATE = SEED_RAW_PLATES.vehicleA2;
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const FORBIDDEN_WORDS = /net kâr|bakiye|kasa/iu;

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

/** Bugünün (İstanbul) günü ve ay aralığı metni. */
function currentMonth(): { today: string; range: string } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [year, month] = today.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { today, range: `1–${lastDay} ${MONTHS[month - 1]} ${year}` };
}

async function apiPost(page: Page, url: string, body: unknown): Promise<{ status: number; body: { workEntry?: { id: string } } }> {
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

async function openReport(page: Page): Promise<void> {
  const firstRead = page.waitForResponse(REPORT_URL);
  await page.goto("/sahip/raporlar");
  await firstRead;
}

test.describe("Sahip raporları (/sahip/raporlar)", () => {
  test("yalnız sahip açar: şoför → /sofor, ekip → /yonetim, oturumsuz → /giris; /sahip'te Raporlar bağlantısı var", async ({
    page,
    browser,
  }, testInfo) => {
    await page.goto("/sahip/raporlar");
    await page.waitForURL("**/giris");

    const driver = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(driver, PLATE, SEED_TEST_PASSWORDS.driver, "/sofor");
    await driver.goto("/sahip/raporlar");
    await driver.waitForURL("**/sofor");

    const staff = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await loginAsAdmin(staff);
    await staff.goto("/sahip/raporlar");
    await staff.waitForURL("**/yonetim");

    await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");
    await page.getByRole("link", { name: "Raporlar", exact: true }).click();
    await page.waitForURL("**/sahip/raporlar");
    await expect(page.getByRole("heading", { name: "Raporlar", level: 1 })).toBeVisible();
  });

  test("S5.2 verisi: kalan, onaylı teslim alınan (0 → 6.200 → 6.000), döküm ve dönem gezinmesi", async ({ page }) => {
    const { today, range } = currentMonth();
    await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");
    await openReport(page);

    // Kayıt yokken boş dönem.
    await expect(page.getByText(range, { exact: true })).toBeVisible();
    await expect(page.getByText("Bu dönemde kayıt yok.")).toBeVisible();
    await expect(page.getByText("Hesaplanan kalan")).toHaveCount(0);

    const daily = { date: today, startTime: "08:00", endTime: "17:30", endsNextDay: false, grossCents: "1000000", fuelCents: "150000", otherExpenseCents: "30000", otherExpenseNote: "otopark" };
    const driverEntry = await apiPost(page, "/api/v1/work-entries", { requestId: requestId(), workType: "driver", workerPersonId: SEED_IDS.driverA2a, ...daily });
    expect(driverEntry.status).toBe(201);
    expect((await apiPost(page, "/api/v1/work-entries", { requestId: requestId(), workType: "owner", ...daily })).status).toBe(201);
    const entryId = driverEntry.body.workEntry!.id;

    const received = page.locator("p", { hasText: "Teslim alınan (onaylı)" }).first();
    const remainder = page.locator("p", { hasText: "Hesaplanan kalan" }).first();

    await openReport(page);
    await expect(remainder).toContainText("14.400,00 TL");
    await expect(received).toContainText("0,00 TL");

    expect((await apiPost(page, `/api/v1/work-entries/${entryId}/confirm`, { requestId: requestId(), version: 1, receivedCents: "620000" })).status).toBe(200);
    await openReport(page);
    await expect(received).toContainText("6.200,00 TL");

    expect(
      (await apiPost(page, `/api/v1/work-entries/${entryId}/correct-and-confirm`, { requestId: requestId(), version: 2, ...daily, receivedCents: "600000" })).status,
    ).toBe(200);
    await openReport(page);
    await expect(received).toContainText("6.000,00 TL");
    await expect(remainder).toContainText("14.400,00 TL");

    // Hesap dökümü.
    const details = page.locator("details");
    await expect(details).not.toHaveAttribute("open", "");
    await page.getByText("Hesap dökümünü gör").click();
    for (const [label, value] of [
      ["Hasılat", "20.000,00 TL"],
      ["Mazot", "3.000,00 TL"],
      ["Diğer masraf", "600,00 TL"],
      ["Şoför payı", "2.000,00 TL"],
      ["Toplam süre", "19 saat"],
      ["Çalışılan gün", "1 gün"],
    ] as const) {
      await expect(details.locator("div", { has: page.locator("dt", { hasText: label }) }).first()).toContainText(value);
    }
    await expect(details).toContainText("19 saat");

    // Bölüm sekmeleri: Kişiler seçili, Gün gün yanında; özet tüm dönemin araç toplamı olarak etiketli.
    await expect(page.getByRole("tab", { name: "Gün gün", exact: true })).toHaveAttribute("aria-selected", "false");
    await expect(page.getByText(/dönemin tamamındaki araç toplamıdır/u)).toBeVisible();

    // Kişiler: iki kart (şoför + mal sahibi), her biri kendi 9 saat 30 dakikası; araç günü toplanmaz.
    await expect(page.getByRole("tab", { name: "Kişiler", exact: true })).toBeVisible();
    const cards = page.locator("li", { hasText: "Ayrıntıyı gör" });
    await expect(cards).toHaveCount(2);
    for (const index of [0, 1]) {
      await expect(cards.nth(index)).toContainText("9 saat 30 dakika · 1 gün · 1 çalışma");
    }
    const ownerCard = cards.filter({ hasText: "Mal sahibi" });
    await expect(ownerCard).toHaveCount(1);
    await expect(ownerCard).toContainText("Pay 0,00 TL");
    await expect(details).toContainText("19 saat");
    expect(await page.locator("main").innerText()).not.toMatch(FORBIDDEN_WORDS);

    // Ayrıntı: şoförün mazot, diğer masraf, kalan ve kaydı; kayıt bağlantısı sahip kaydını açar.
    await cards.filter({ hasNotText: "Mal sahibi" }).getByRole("button", { name: "Ayrıntıyı gör" }).click();
    const totals = page.locator("dl[aria-label='Kişi dönem toplamı']");
    for (const [label, value] of [
      ["Mazot", "1.500,00 TL"],
      ["Diğer masraf", "300,00 TL"],
      ["Hesaplanan kalan", "6.200,00 TL"],
    ] as const) {
      await expect(totals.locator("div", { has: page.locator("dt", { hasText: label }) }).first()).toContainText(value);
    }
    const entryLink = page.getByRole("link", { name: "Kaydı aç" });
    await expect(entryLink).toHaveCount(1);
    await expect(entryLink).toHaveAttribute("href", `/sahip/kayitlar/${entryId}`);
    expect(await page.locator("main").innerText()).not.toMatch(FORBIDDEN_WORDS);
    await entryLink.click();
    await page.waitForURL(`**/sahip/kayitlar/${entryId}`);
    await openReport(page);

    // Önceki/sonraki dönem: sunucunun aralığı gösterilir, her seferinde API yeniden okunur.
    const previousRead = page.waitForResponse(REPORT_URL);
    await page.getByRole("button", { name: "Önceki dönem" }).click();
    const previous = (await (await previousRead).json()) as { report: { period: { startDate: string; nextStartDate: string } } };
    expect(previous.report.period.nextStartDate).toBe(`${today.slice(0, 7)}-01`);
    await expect(page.getByText("Hesaplanan kalan")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2 })).not.toHaveText(range);

    const nextRead = page.waitForResponse(REPORT_URL);
    await page.getByRole("button", { name: "Sonraki dönem" }).click();
    await nextRead;
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(range);
    await expect(remainder).toContainText("14.400,00 TL");

    // Hafta ve yıl sekmeleri.
    const weekRead = page.waitForResponse(REPORT_URL);
    await page.getByRole("button", { name: "Bu hafta" }).click();
    expect(new URL((await weekRead).url()).searchParams.get("period")).toBe("week");
    await expect(page.getByRole("button", { name: "Bu hafta" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(/\d/u);

    const yearRead = page.waitForResponse(REPORT_URL);
    await page.getByRole("button", { name: "Bu yıl" }).click();
    await yearRead;
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(`1 Ocak – 31 Aralık ${today.slice(0, 4)}`);
    await expect(remainder).toContainText("14.400,00 TL");
  });

  test("yükleniyor: tutar görünmez; hata: metin ve Tekrar dene; 401: yeniden giriş metni", async ({ page }) => {
    await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(REPORT_URL, async (route) => {
      await gate;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "gizli ayrıntı" } }) });
    });
    await page.goto("/sahip/raporlar");
    await expect(page.getByText("Rapor yükleniyor…")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("TL");
    release();

    await expect(page.getByText("Rapor yüklenemedi. Tekrar dene.")).toBeVisible();
    await expect(page.getByText("gizli ayrıntı")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("TL");

    await page.unroute(REPORT_URL);
    await page.route(REPORT_URL, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "SESSION_EXPIRED", message: "x" } }) }),
    );
    await page.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(page.getByText("Oturumun sona erdi. Yeniden giriş yap.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Giriş sayfasına git" })).toHaveAttribute("href", "/giris");
    await expect(page.locator("main")).not.toContainText("TL");
  });

  test("hızlı sekme değişiminde eski yanıt yeni dönemi ezmez", async ({ page }) => {
    await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");
    await openReport(page);

    const report = (period: string, startDate: string, nextStartDate: string, gross: string) => ({
      report: { period: { kind: period, startDate, nextStartDate }, entryCount: 1, workDays: 1, durationMinutes: 60, grossCents: gross, fuelCents: "0", otherExpenseCents: "0", shareCents: "0", remainderCents: gross, confirmedReceivedCents: "0" },
    });
    await page.route(REPORT_URL, async (route) => {
      const period = new URL(route.request().url()).searchParams.get("period");
      if (period === "week") {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.fulfill({ json: report("week", "2030-01-07", "2030-01-14", "111100") });
      } else {
        await route.fulfill({ json: report("year", "2030-01-01", "2031-01-01", "222200") });
      }
    });
    await page.getByRole("button", { name: "Bu hafta" }).click();
    await page.getByRole("button", { name: "Bu yıl" }).click();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("1 Ocak – 31 Aralık 2030");
    await page.waitForTimeout(1200);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("1 Ocak – 31 Aralık 2030");
    await expect(page.locator("p", { hasText: "Hesaplanan kalan" }).first()).toContainText("2.222,00 TL");
  });

  test("eksi kalan eksi işaretiyle ve 2^53 kuruş üstü toplam kesin gösterilir", async ({ page }) => {
    await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");
    await page.route(REPORT_URL, (route) =>
      route.fulfill({
        json: {
          report: { period: { kind: "month", startDate: "2030-01-01", nextStartDate: "2030-02-01" }, entryCount: 1, workDays: 1, durationMinutes: 60, grossCents: "9007199254740993", fuelCents: "0", otherExpenseCents: "0", shareCents: "0", remainderCents: "-40000", confirmedReceivedCents: "0" },
        },
      }),
    );
    await page.goto("/sahip/raporlar");
    await expect(page.locator("p", { hasText: "Hesaplanan kalan" }).first()).toContainText("-400,00 TL");
    await page.getByText("Hesap dökümünü gör").click();
    await expect(page.getByText("90.071.992.547.409,93 TL")).toBeVisible();
  });

  test.describe("Kişiler (taklit yanıtlarla)", () => {
    const period = { kind: "month", startDate: "2030-01-01", nextStartDate: "2030-02-01" };
    const vehicleReport = { report: { period, entryCount: 2, workDays: 1, durationMinutes: 1140, grossCents: "2000000", fuelCents: "300000", otherExpenseCents: "60000", shareCents: "200000", remainderCents: "1440000", confirmedReceivedCents: "0" } };
    const totals = (personId: string, fullName: string, fuelCents: string, isOwner = false) => ({
      personId, fullName, isOwner, entryCount: 1, workDays: 1, durationMinutes: 570, grossCents: "1000000", fuelCents, otherExpenseCents: "0", shareCents: "0", remainderCents: "500000",
    });
    const entry = (id: string) => ({ id, workDate: "2030-01-10", startsAt: "2030-01-10T05:00:00.000Z", endsAt: "2030-01-10T14:30:00.000Z", durationMinutes: 570, grossCents: "1000000", shareCents: "0", remainderCents: "500000", status: "pending" });
    const personReport = (person: ReturnType<typeof totals>, entries: unknown[], nextCursor: string | null) => ({ report: { period, person, entries, nextCursor } });

    async function openMocked(page: Page): Promise<void> {
      await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");
      await page.route(REPORT_URL, (route) => route.fulfill({ json: vehicleReport }));
    }

    test("yükleniyor ve hata: kart ve tutar yok, boş durum yok; tekrar dene toparlar", async ({ page }) => {
      await openMocked(page);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(PEOPLE_URL, async (route) => {
        await gate;
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "gizli ayrıntı" } }) });
      });
      await page.goto("/sahip/raporlar");
      const panel = page.getByRole("tabpanel");
      await expect(page.getByText("Kişiler yükleniyor…")).toBeVisible();
      await expect(panel).not.toContainText("TL");
      await expect(page.getByText("Bu dönemde kişi kaydı yok.")).toHaveCount(0);
      release();

      await expect(panel.getByText("Rapor yüklenemedi. Tekrar dene.")).toBeVisible();
      await expect(page.getByText("gizli ayrıntı")).toHaveCount(0);
      await expect(panel).not.toContainText("TL");
      await expect(page.getByText("Bu dönemde kişi kaydı yok.")).toHaveCount(0);

      await page.unroute(PEOPLE_URL);
      await page.route(PEOPLE_URL, (route) => route.fulfill({ json: { report: { period, people: [totals("p1", "Ahmet", "0")] } } }));
      await panel.getByRole("button", { name: "Tekrar dene" }).click();
      await expect(page.locator("li", { hasText: "Ayrıntıyı gör" })).toHaveCount(1);
    });

    test("bozuk gövde hata sayılır; 401 yeniden giriş metni; başarılı boş yanıt boş durum", async ({ page }) => {
      await openMocked(page);
      await page.route(PEOPLE_URL, (route) => route.fulfill({ json: { report: { period, people: [{ personId: "p1" }] } } }));
      await page.goto("/sahip/raporlar");
      const panel = page.getByRole("tabpanel");
      await expect(panel.getByText("Rapor yüklenemedi. Tekrar dene.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Ayrıntıyı gör" })).toHaveCount(0);

      await page.unroute(PEOPLE_URL);
      await page.route(PEOPLE_URL, (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "SESSION_EXPIRED", message: "x" } }) }));
      await panel.getByRole("button", { name: "Tekrar dene" }).click();
      await expect(panel.getByText("Oturumun sona erdi. Yeniden giriş yap.")).toBeVisible();
      await expect(panel.getByRole("link", { name: "Giriş sayfasına git" })).toHaveAttribute("href", "/giris");

      await page.unroute(PEOPLE_URL);
      await page.route(PEOPLE_URL, (route) => route.fulfill({ json: { report: { period, people: [] } } }));
      await page.reload();
      await expect(page.getByText("Bu dönemde kişi kaydı yok.")).toBeVisible();
    });

    test("eski kişinin veya dönemin yanıtı yeni başlığın altında görünmez", async ({ page }) => {
      await openMocked(page);
      await page.route(PEOPLE_URL, (route) =>
        route.fulfill({ json: { report: { period, people: [totals("p1", "Ahmet", "111100"), totals("p2", "Berk", "222200")] } } }),
      );
      await page.route(PERSON_URL, async (route) => {
        if (route.request().url().includes("/people/p1?")) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          await route.fulfill({ json: personReport(totals("p1", "Ahmet", "111100"), [entry("e-p1")], null) });
        } else {
          await route.fulfill({ json: personReport(totals("p2", "Berk", "222200"), [entry("e-p2")], null) });
        }
      });
      await page.goto("/sahip/raporlar");
      const cards = page.locator("li", { hasText: "Ayrıntıyı gör" });
      await cards.filter({ hasText: "Ahmet" }).getByRole("button", { name: "Ayrıntıyı gör" }).click();
      await expect(page.getByText("Kişi ayrıntısı yükleniyor…")).toBeVisible();
      await page.getByRole("button", { name: "← Kişilere dön" }).click();
      await cards.filter({ hasText: "Berk" }).getByRole("button", { name: "Ayrıntıyı gör" }).click();
      await expect(page.getByRole("heading", { level: 3 })).toHaveText("Berk");
      await expect(page.getByRole("link", { name: "Kaydı aç" })).toHaveAttribute("href", "/sahip/kayitlar/e-p2");
      await page.waitForTimeout(1200);
      await expect(page.getByRole("heading", { level: 3 })).toHaveText("Berk");
      await expect(page.locator("dl[aria-label='Kişi dönem toplamı']")).toContainText("2.222,00 TL");
      await expect(page.getByText("1.111,00 TL")).toHaveCount(0);

      // Dönem değişince açık kişi ayrıntısı kalkar; yeni dönem yüklenene dek kişi verisi yok.
      await page.route(REPORT_URL, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.fulfill({ json: vehicleReport });
      });
      await page.getByRole("button", { name: "Bu yıl" }).click();
      await expect(page.getByRole("heading", { level: 3 })).toHaveCount(0);
      await expect(page.getByRole("tabpanel")).toHaveCount(0);
    });

    test("Daha fazla göster aynı kişinin sonraki sayfasını ekler", async ({ page }) => {
      await openMocked(page);
      await page.route(PEOPLE_URL, (route) => route.fulfill({ json: { report: { period, people: [totals("p1", "Ahmet", "0")] } } }));
      await page.route(PERSON_URL, (route) => {
        const cursor = new URL(route.request().url()).searchParams.get("cursor");
        return route.fulfill({
          json: cursor === null ? personReport(totals("p1", "Ahmet", "0"), [entry("e1")], "c1") : personReport(totals("p1", "Ahmet", "0"), [entry("e2")], null),
        });
      });
      await page.goto("/sahip/raporlar");
      await page.getByRole("button", { name: "Ayrıntıyı gör" }).click();
      await expect(page.getByRole("link", { name: "Kaydı aç" })).toHaveCount(1);
      await page.getByRole("button", { name: "Daha fazla göster" }).click();
      await expect(page.getByRole("link", { name: "Kaydı aç" })).toHaveCount(2);
      await expect(page.getByRole("button", { name: "Daha fazla göster" })).toHaveCount(0);
    });

    test("320 px genişlikte uzun ad sarılır, yatay kaydırma yok (liste ve ayrıntı)", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await openMocked(page);
      const longName = "Çok Uzun Soyadlı Şoförümüz Abdurrahmanoğlu-Karadeniz-Yıldırımhanoğulları";
      await page.route(PEOPLE_URL, (route) => route.fulfill({ json: { report: { period, people: [totals("p1", longName, "0", true)] } } }));
      await page.route(PERSON_URL, (route) => route.fulfill({ json: personReport(totals("p1", longName, "0", true), [entry("e1")], null) }));
      await page.goto("/sahip/raporlar");
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await expect(page.getByRole("button", { name: "Ayrıntıyı gör" })).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(0);
      await page.getByRole("button", { name: "Ayrıntıyı gör" }).click();
      await expect(page.getByRole("link", { name: "Kaydı aç" })).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(0);
    });
  });

  test.describe("Gün gün (taklit yanıtlarla)", () => {
    const period = { kind: "month", startDate: "2030-01-01", nextStartDate: "2030-02-01" };
    const vehicleReport = { report: { period, entryCount: 3, workDays: 2, durationMinutes: 1710, grossCents: "3000000", fuelCents: "0", otherExpenseCents: "0", shareCents: "300000", remainderCents: "2700000", confirmedReceivedCents: "600000" } };
    const person = (personId: string, fullName: string, isOwner = false) => ({
      personId, fullName, isOwner, entryCount: 1, workDays: 1, durationMinutes: 570, grossCents: "1000000", fuelCents: "0", otherExpenseCents: "0", shareCents: "0", remainderCents: "500000",
    });
    const people = { report: { period, people: [person("p1", "Ahmet"), person("p2", "Görkem", true)] } };
    const dayEntry = (id: string, override: Record<string, unknown> = {}) => ({
      id, version: 1, status: "pending", workKind: "driver", workDate: "2030-01-10", startsAt: "2030-01-10T05:00:00.000Z", endsAt: "2030-01-10T14:30:00.000Z", durationMinutes: 570,
      grossCents: "1000000", fuelCents: "0", otherExpenseCents: "0", shareCents: "100000", remainderCents: "900000", otherExpenseNote: null, person: { id: "p1", fullName: "Ahmet" }, confirmation: null, ...override,
    });
    const confirmed = dayEntry("e-conf", { status: "confirmed", version: 2, confirmation: { receivedCents: "600000", confirmedAt: "2030-01-10T15:00:00.000Z", entryVersion: 2, actor: { kind: "vehicle_credential" } } });
    const ownerEntry = dayEntry("e-own", { status: "not_required", workKind: "owner", shareCents: "0", remainderCents: "850000", person: { id: "p2", fullName: "Görkem" } });
    const pendingEntry = dayEntry("e-pend");

    async function openDaily(page: Page): Promise<void> {
      await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");
      await page.route(REPORT_URL, (route) => route.fulfill({ json: vehicleReport }));
      await page.route(PEOPLE_URL, (route) => route.fulfill({ json: people }));
    }

    async function goDaily(page: Page): Promise<void> {
      await page.goto("/sahip/raporlar");
      await page.getByRole("tab", { name: "Gün gün", exact: true }).click();
    }

    const query = (route: { request(): { url(): string } }, key: string) => new URL(route.request().url()).searchParams.get(key);

    test("kartlar: tarih, kişi, saat, hasılat, beklenen, alınan yalnız onaylıda; mal sahibi 'Onay gerekmiyor'", async ({ page }) => {
      await openDaily(page);
      const urls: string[] = [];
      await page.route(ENTRIES_URL, (route) => {
        urls.push(route.request().url());
        return route.fulfill({ json: { workEntries: [confirmed, ownerEntry, pendingEntry], nextCursor: null } });
      });
      await goDaily(page);
      const cards = page.locator("li", { hasText: "Kaydı aç" });
      await expect(cards).toHaveCount(3);
      const params = new URL(urls[0]!).searchParams;
      expect([params.get("period"), params.get("date"), params.get("workerPersonId"), params.get("status"), params.get("cursor")]).toEqual(["month", "2030-01-01", null, null, null]);

      const conf = cards.filter({ hasText: "Teslim doğrulandı" });
      await expect(conf).toContainText("Ahmet");
      await expect(conf).toContainText("Hasılat: 10.000,00 TL");
      await expect(conf).toContainText("Teslim edilecek tutar: 9.000,00 TL");
      await expect(conf).toContainText("Teslim alınan: 6.000,00 TL");
      const pend = cards.filter({ hasText: "Henüz doğrulanmadı" });
      await expect(pend).not.toContainText("Teslim alınan");
      const owner = cards.filter({ hasText: "Görkem" });
      await expect(owner).toContainText("Onay gerekmiyor");
      await expect(owner).toContainText("Giderlerden sonra kalan: 8.500,00 TL");
      await expect(owner).not.toContainText(/Henüz doğrulanmadı|Teslim edilecek tutar|Teslim alınan/u);
      await expect(owner.getByRole("link", { name: "Kaydı aç" })).toHaveAttribute("href", "/sahip/kayitlar/e-own");
      await expect(page.getByRole("group", { name: "Günlük kayıtları filtrele" })).toBeVisible();
    });

    test("kişi ve durum süzgeci yalnız listeyi yeniden okur; özet tutarlar aynı kalır", async ({ page }) => {
      await openDaily(page);
      let reportReads = 0;
      await page.route(REPORT_URL, (route) => {
        reportReads += 1;
        return route.fulfill({ json: vehicleReport });
      });
      const urls: URL[] = [];
      await page.route(ENTRIES_URL, (route) => {
        urls.push(new URL(route.request().url()));
        const status = query(route, "status");
        const worker = query(route, "workerPersonId");
        const rows = [confirmed, ownerEntry, pendingEntry].filter((row) => (!status || row.status === status) && (!worker || row.person.id === worker));
        return route.fulfill({ json: { workEntries: rows, nextCursor: null } });
      });
      await goDaily(page);
      const remainder = page.locator("p", { hasText: "Hesaplanan kalan" }).first();
      const received = page.locator("p", { hasText: "Teslim alınan (onaylı)" }).first();
      await expect(remainder).toContainText("27.000,00 TL");
      await expect(received).toContainText("6.000,00 TL");
      const readsBefore = reportReads;
      const cards = page.locator("li", { hasText: "Kaydı aç" });
      await expect(cards).toHaveCount(3);

      await page.getByLabel("Kişi", { exact: true }).selectOption({ label: "Görkem" });
      await expect(cards).toHaveCount(1);
      await expect(cards).toContainText("Onay gerekmiyor");
      expect(urls.at(-1)!.searchParams.get("workerPersonId")).toBe("p2");

      await page.getByLabel("Kişi", { exact: true }).selectOption({ label: "Tüm kişiler" });
      await page.getByLabel("Teslim durumu").selectOption({ label: "Teslim doğrulandı" });
      await expect(cards).toHaveCount(1);
      await expect(cards).toContainText("Teslim alınan: 6.000,00 TL");
      expect(urls.at(-1)!.searchParams.get("status")).toBe("confirmed");

      expect(reportReads).toBe(readsBefore);
      await expect(remainder).toContainText("27.000,00 TL");
      await expect(received).toContainText("6.000,00 TL");
    });

    test("önceki/sonraki dönem özeti ve listeyi yeniden okur; süzgeç ve sayfalama sıfırlanır", async ({ page }) => {
      await openDaily(page);
      const urls: URL[] = [];
      await page.route(ENTRIES_URL, (route) => {
        urls.push(new URL(route.request().url()));
        return route.fulfill({ json: { workEntries: [pendingEntry], nextCursor: query(route, "cursor") === null ? "c1" : null } });
      });
      await goDaily(page);
      await page.getByLabel("Teslim durumu").selectOption({ label: "Henüz doğrulanmadı" });
      await page.getByRole("button", { name: "Daha fazla göster" }).click();
      await expect(page.locator("li", { hasText: "Kaydı aç" })).toHaveCount(2);

      const reportRead = page.waitForResponse(REPORT_URL);
      await page.getByRole("button", { name: "Sonraki dönem" }).click();
      await reportRead;
      await page.getByRole("tab", { name: "Gün gün", exact: true }).click();
      await expect(page.getByLabel("Teslim durumu")).toHaveValue("");
      await expect(page.locator("li", { hasText: "Kaydı aç" })).toHaveCount(1);
      const last = urls.at(-1)!.searchParams;
      expect([last.get("status"), last.get("cursor")]).toEqual([null, null]);
    });

    test("Daha fazla göster sonraki sayfayı ekler; 500 kartları korur, Tekrar dene aynı imleci yollar", async ({ page }) => {
      await openDaily(page);
      let failNext = true;
      const cursors: (string | null)[] = [];
      await page.route(ENTRIES_URL, (route) => {
        const cursor = query(route, "cursor");
        cursors.push(cursor);
        if (cursor === null) return route.fulfill({ json: { workEntries: [pendingEntry], nextCursor: "c1" } });
        if (failNext) {
          failNext = false;
          return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "gizli ayrıntı" } }) });
        }
        return route.fulfill({ json: { workEntries: [confirmed], nextCursor: null } });
      });
      await goDaily(page);
      const cards = page.locator("li", { hasText: "Kaydı aç" });
      await expect(cards).toHaveCount(1);

      await page.getByRole("button", { name: "Daha fazla göster" }).click();
      await expect(page.getByText("Rapor yüklenemedi. Tekrar dene.")).toBeVisible();
      await expect(page.getByText("gizli ayrıntı")).toHaveCount(0);
      await expect(cards).toHaveCount(1);
      await expect(page.getByText("Bu dönem ve süzgeçler için kayıt yok.")).toHaveCount(0);

      await page.getByRole("button", { name: "Tekrar dene" }).click();
      await expect(cards).toHaveCount(2);
      expect(cursors).toEqual([null, "c1", "c1"]);
      await expect(page.getByRole("button", { name: "Daha fazla göster" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Tekrar dene" })).toHaveCount(0);
    });

    test("eski süzgecin gecikmiş yanıtı yeni süzgeçten sonra görünmez; bekleyen sonraki sayfa da eklenmez", async ({ page }) => {
      await openDaily(page);
      await page.route(ENTRIES_URL, async (route) => {
        const status = query(route, "status");
        const cursor = query(route, "cursor");
        if (status === "pending" && cursor === null) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          return route.fulfill({ json: { workEntries: [pendingEntry], nextCursor: null } });
        }
        if (status === "confirmed" && cursor === null) return route.fulfill({ json: { workEntries: [confirmed], nextCursor: "c1" } });
        if (status === "confirmed" && cursor === "c1") {
          await new Promise((resolve) => setTimeout(resolve, 800));
          return route.fulfill({ json: { workEntries: [ownerEntry], nextCursor: null } });
        }
        return route.fulfill({ json: { workEntries: [], nextCursor: null } });
      });
      await goDaily(page);
      await page.getByLabel("Teslim durumu").selectOption({ label: "Henüz doğrulanmadı" });
      await page.getByLabel("Teslim durumu").selectOption({ label: "Teslim doğrulandı" });
      const cards = page.locator("li", { hasText: "Kaydı aç" });
      await expect(cards).toHaveCount(1);
      await page.waitForTimeout(1200);
      await expect(cards).toHaveCount(1);
      await expect(cards).toContainText("Teslim doğrulandı");

      // Bekleyen "Daha fazla göster" isteği süzgeç değişince kesilir; eski sayfa yeni listeye eklenmez.
      await page.getByRole("button", { name: "Daha fazla göster" }).click();
      await page.getByLabel("Teslim durumu").selectOption({ label: "Tüm durumlar" });
      await expect(page.getByText("Bu dönem ve süzgeçler için kayıt yok.")).toBeVisible();
      await page.waitForTimeout(1200);
      await expect(cards).toHaveCount(0);
    });

    test("yükleniyor, 401 ve boş yanıt ayrı durumlardır; boş durum yalnız başarılı boş yanıttan sonra", async ({ page }) => {
      await openDaily(page);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(ENTRIES_URL, async (route) => {
        await gate;
        await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "SESSION_EXPIRED", message: "x" } }) });
      });
      await goDaily(page);
      await expect(page.getByText("Günlük kayıtlar yükleniyor…")).toBeVisible();
      await expect(page.getByText("Bu dönem ve süzgeçler için kayıt yok.")).toHaveCount(0);
      release();
      await expect(page.getByText("Oturumun sona erdi. Yeniden giriş yap.")).toBeVisible();
      await expect(page.getByText("Bu dönem ve süzgeçler için kayıt yok.")).toHaveCount(0);

      await page.unroute(ENTRIES_URL);
      await page.route(ENTRIES_URL, (route) => route.fulfill({ json: { workEntries: [], nextCursor: null } }));
      await page.reload();
      await page.getByRole("tab", { name: "Gün gün", exact: true }).click();
      await expect(page.getByText("Bu dönem ve süzgeçler için kayıt yok.")).toBeVisible();
    });

    test("320 px genişlikte uzun ad sarılır, yatay kaydırma yok", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await openDaily(page);
      const longName = "Çok Uzun Soyadlı Şoförümüz Abdurrahmanoğlu-Karadeniz-Yıldırımhanoğulları";
      await page.route(ENTRIES_URL, (route) =>
        route.fulfill({ json: { workEntries: [{ ...confirmed, person: { id: "p1", fullName: longName } }, ownerEntry], nextCursor: "c1" } }),
      );
      await goDaily(page);
      await expect(page.getByText(longName)).toBeVisible();
      await expect(page.getByRole("button", { name: "Daha fazla göster" })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });

  test("320 px genişlikte yatay kaydırma yok", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");
    await openReport(page);
    await expect(page.getByRole("button", { name: "Bu yıl" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
