import { expect, test, type Page } from "@playwright/test";
import { SEED_IDS, SEED_RAW_PLATES, SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";

/**
 * Sahip araç dönem raporu (/sahip/raporlar). Gerçek standalone sunucu + seed.
 * Veri testi yalnız A2 aracında (başka spec'lerin yazmadığı araç) kayıt açar ve
 * bugünün ayında çalışır; yükleniyor/hata/401 durumları yanıtı taklit eder.
 */

const REPORT_URL = /\/api\/v1\/reports\/vehicles\?/u;
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
    await expect(page.getByText("Kişiler")).toHaveCount(0);
    await expect(page.getByText("Gün gün")).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toMatch(FORBIDDEN_WORDS);

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

  test("320 px genişlikte yatay kaydırma yok", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");
    await openReport(page);
    await expect(page.getByRole("button", { name: "Bu yıl" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
