import { expect, test, type Page } from "@playwright/test";
import { SEED_IDS, SEED_RAW_PLATES, SEED_TEST_PASSWORDS } from "../../scripts/db-seed-dev";

/**
 * Sahip özeti (/sahip). Gerçek standalone sunucu + seed. Veri testi yalnız
 * B1 aracında (başka spec'lerin bugünün ayına yazmadığı araç) kayıt açar;
 * yükleniyor/hata/401/geç yanıt durumları yanıtı taklit eder.
 */

const SUMMARY_URL = /\/api\/v1\/reports\/summary\?/u;
const PENDING_URL = /\/api\/v1\/work-entries\?/u;
const PLATE = SEED_RAW_PLATES.vehicleB1;
const OWNER_NAME = "Fatma Çelik";
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const FORBIDDEN_WORDS = /Kazanç|Borçlu|Ödenmedi/u;

async function login(page: Page, plate: string, password: string, landing: string): Promise<void> {
  await page.goto("/giris");
  await page.getByLabel("Plaka").fill(plate);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL(`**${landing}`);
}

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
const totalsRow = (page: Page, label: string) => page.locator("dl > div", { has: page.locator("dt", { hasText: label }) });

const summaryBody = (period: string, startDate: string, nextStartDate: string, gross: string) => ({
  summary: {
    period: { kind: period, startDate, nextStartDate },
    entryCount: 1,
    workDays: 1,
    durationMinutes: 60,
    grossCents: gross,
    fuelCents: "0",
    otherExpenseCents: "0",
    shareCents: "0",
    remainderCents: gross,
    confirmedReceivedCents: "0",
    vehicle: { plate: "06 CCC 003" },
    owner: { fullName: OWNER_NAME },
  },
});

test.describe("Sahip özeti (/sahip)", () => {
  test("başlık, üç sekme ve boş dönem; şoför oturumu /sofor'a döner", async ({ page, browser }, testInfo) => {
    const { range } = currentMonth();
    const summaryRead = page.waitForResponse(SUMMARY_URL);
    await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");
    await summaryRead;

    await expect(page.getByText(`06 CCC 003 · ${OWNER_NAME}`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Özet" })).toBeAttached();
    const nav = page.getByRole("navigation", { name: "Sahip bağlantıları" });
    await expect(nav.getByRole("link", { name: "Raporlar", exact: true })).toHaveAttribute("href", "/sahip/raporlar");
    await expect(nav.getByRole("link", { name: "Şoförlerim", exact: true })).toHaveAttribute("href", "/sahip/soforler");
    await expect(page.getByRole("link", { name: "+ Çalışma kaydı gir" })).toHaveAttribute("href", "/sahip/kayit/yeni");
    await expect(page.getByRole("button", { name: "Çıkış" })).toBeVisible();
    await expect(page.getByText(range, { exact: true })).toBeVisible();
    await expect(page.getByText("Bu dönemde kayıt yok.")).toBeVisible();
    await expect(page.getByText("Hesaplanan kalan")).toHaveCount(0);

    // 320 px: yatay kaydırma yok.
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const driver = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
    await login(driver, PLATE, SEED_TEST_PASSWORDS.driver, "/sofor");
    await driver.goto("/sahip");
    await driver.waitForURL("**/sofor");
  });

  test("Örnek senaryo: toplamlar, bekleyen liste (sahip kaydı yok), onay sonrası yenileme", async ({ page }) => {
    const { today, range } = currentMonth();
    await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");

    const daily = { date: today, startTime: "08:00", endTime: "17:30", endsNextDay: false, grossCents: "1000000", fuelCents: "150000", otherExpenseCents: "30000", otherExpenseNote: "otopark" };
    const driverEntry = await apiPost(page, "/api/v1/work-entries", { requestId: requestId(), workType: "driver", workerPersonId: SEED_IDS.driverB1a, ...daily });
    expect(driverEntry.status).toBe(201);
    expect((await apiPost(page, "/api/v1/work-entries", { requestId: requestId(), workType: "owner", ...daily })).status).toBe(201);
    const entryId = driverEntry.body.workEntry!.id;

    const pendingRead = page.waitForResponse(PENDING_URL);
    await page.goto("/sahip");
    await pendingRead;
    await expect(page.getByText(range, { exact: true })).toBeVisible();
    for (const [label, value] of [
      ["Hasılat", "20.000,00 TL"],
      ["Mazot", "3.000,00 TL"],
      ["Diğer masraf", "600,00 TL"],
      ["Şoför payı", "2.000,00 TL"],
      ["Hesaplanan kalan", "14.400,00 TL"],
    ] as const) {
      await expect(totalsRow(page, label)).toContainText(value);
    }
    const received = page.locator("p", { hasText: "Teslim alınan (onaylı)" }).first();
    await expect(received).toContainText("0,00 TL");
    await expect(page.getByText("Yalnız doğruladığın şoför teslimleri")).toBeVisible();

    // Yalnız şoför kaydı bekliyor; sahip kaydı listede yok.
    const rows = page.locator("li", { hasText: "Kaydı aç" });
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Hasan Kurt");
    await expect(rows).toContainText("Henüz doğrulanmadı");
    const open = rows.getByRole("link", { name: "Kaydı aç" });
    await expect(open).toHaveAttribute("href", `/sahip/kayitlar/${entryId}`);
    expect(await page.locator("main").innerText()).not.toMatch(FORBIDDEN_WORDS);

    // Kaydı aç hiçbir şeyi onaylamaz; onay sonrası geri dönüşte özet yeniden okunur.
    await open.click();
    await page.waitForURL(`**/sahip/kayitlar/${entryId}`);
    expect((await apiPost(page, `/api/v1/work-entries/${entryId}/confirm`, { requestId: requestId(), version: 1, receivedCents: "600000" })).status).toBe(200);
    const summaryRead = page.waitForResponse(SUMMARY_URL);
    await page.goBack();
    await summaryRead;
    await expect(received).toContainText("6.000,00 TL");
    await expect(totalsRow(page, "Hesaplanan kalan")).toContainText("14.400,00 TL");
    await expect(page.getByText("Bu dönemde bekleyen kayıt yok.")).toBeVisible();
    await expect(page.locator("li", { hasText: "Kaydı aç" })).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toMatch(FORBIDDEN_WORDS);
  });

  test("özet hatası tutar göstermez; 401 oturum bitti; bekleyen liste hatası toplamları silmez", async ({ page }) => {
    await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(SUMMARY_URL, async (route) => {
      await gate;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "gizli ayrıntı" } }) });
    });
    await page.goto("/sahip");
    await expect(page.getByText("Kayıtlar yükleniyor…")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("TL");
    release();
    await expect(page.getByText("Rapor yüklenemedi. Tekrar dene.")).toBeVisible();
    await expect(page.getByText("gizli ayrıntı")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("TL");

    await page.unroute(SUMMARY_URL);
    await page.route(SUMMARY_URL, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "SESSION_EXPIRED", message: "x" } }) }),
    );
    await page.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(page.getByText("Oturumun sona erdi. Yeniden giriş yap.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Giriş sayfasına git" })).toHaveAttribute("href", "/giris");

    // Liste hatası: toplamlar kalır.
    await page.unroute(SUMMARY_URL);
    await page.route(SUMMARY_URL, (route) => route.fulfill({ json: summaryBody("month", "2030-01-01", "2030-02-01", "500000") }));
    await page.route(PENDING_URL, (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
    await page.goto("/sahip");
    await expect(totalsRow(page, "Hesaplanan kalan")).toContainText("5.000,00 TL");
    await expect(page.getByText("Rapor yüklenemedi. Tekrar dene.")).toBeVisible();
    await expect(page.getByText("Bu dönemde bekleyen kayıt yok.")).toHaveCount(0);
    await expect(totalsRow(page, "Hesaplanan kalan")).toContainText("5.000,00 TL");
  });

  test("hızlı dönem değişiminde eski yanıt yeni aralığı ezmez ve liste yeni başlangıç gününü ister", async ({ page }) => {
    await login(page, PLATE, SEED_TEST_PASSWORDS.owner, "/sahip");
    await page.route(SUMMARY_URL, async (route) => {
      const period = new URL(route.request().url()).searchParams.get("period");
      if (period === "week") {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.fulfill({ json: summaryBody("week", "2030-01-07", "2030-01-14", "111100") });
      } else if (period === "year") {
        await route.fulfill({ json: summaryBody("year", "2030-01-01", "2031-01-01", "222200") });
      } else {
        await route.fulfill({ json: summaryBody("month", "2030-01-01", "2030-02-01", "333300") });
      }
    });
    const pendingUrls: string[] = [];
    await page.route(PENDING_URL, async (route) => {
      pendingUrls.push(route.request().url());
      await route.fulfill({ json: { workEntries: [], nextCursor: null } });
    });
    await page.goto("/sahip");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("1–31 Ocak 2030");

    await page.getByLabel("Dönem", { exact: true }).selectOption("week");
    await page.getByLabel("Dönem", { exact: true }).selectOption("year");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("1 Ocak – 31 Aralık 2030");
    await page.waitForTimeout(1200);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("1 Ocak – 31 Aralık 2030");
    await expect(totalsRow(page, "Hesaplanan kalan")).toContainText("2.222,00 TL");
    await expect(page.getByText("Bu dönemde bekleyen kayıt yok.")).toBeVisible();
    const last = new URL(pendingUrls.at(-1)!).searchParams;
    expect(last.get("period")).toBe("year");
    expect(last.get("date")).toBe("2030-01-01");
    expect(last.get("status")).toBe("pending");
  });
});
