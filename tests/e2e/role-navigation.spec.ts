import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  SEED_IDS,
  SEED_RAW_PLATES,
  SEED_TEST_PASSWORDS,
  SEED_USERNAMES,
} from "../../scripts/db-seed-dev";

/**
 * Rol ekranlarının ortak gezinmesi: gerçek standalone sunucu ve geçici E2E
 * veritabanı. Her testin tarayıcı/taslağı ayrıdır. Detay ve geçmiş testleri
 * kendi requestId'siyle yalnız yeni bir sentetik kayıt oluşturur; mevcut
 * kayıtları değiştirmez. Eski tarih güncel dönem raporlarını etkilemez.
 */
type VehicleRole = "owner" | "driver";
type NavigationItem = { href: string; label: string };
type RoleRoute = { path: string; title: string; selected: string };

const VIEWPORTS = [
  { name: "dar telefon", width: 320, height: 844 },
  { name: "telefon", width: 390, height: 844 },
  { name: "masaüstü", width: 1280, height: 800 },
] as const;

const NAVIGATION: Record<VehicleRole, { label: string; items: readonly NavigationItem[] }> = {
  owner: {
    label: "Sahip bağlantıları",
    items: [
      { href: "/sahip", label: "Özet" },
      { href: "/sahip/raporlar", label: "Raporlar" },
      { href: "/sahip/soforler", label: "Şoförlerim" },
    ],
  },
  driver: {
    label: "Şoför bağlantıları",
    items: [
      { href: "/sofor", label: "Günlük kayıt" },
      { href: "/sofor/kayitlar", label: "Araçtaki kayıtlar" },
    ],
  },
};

async function loginAsVehicle(page: Page, role: VehicleRole): Promise<void> {
  await page.goto("/giris");
  await page.getByLabel("Plaka").fill(SEED_RAW_PLATES.vehicleA1);
  await page.getByLabel("Şifre").fill(SEED_TEST_PASSWORDS[role]);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL(role === "owner" ? "**/sahip" : "**/sofor");
  await page.waitForLoadState("networkidle");
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/yonetim/giris");
  await page.getByLabel("Kullanıcı adı").fill(SEED_USERNAMES.admin);
  await page.getByLabel("Şifre").fill(SEED_TEST_PASSWORDS.admin);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL("**/yonetim");
  await page.waitForLoadState("networkidle");
}

async function openHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function createNavigationEntry(page: Page): Promise<string> {
  const result = await page.evaluate(async ({ workerPersonId }) => {
    const sessionResponse = await fetch("/api/v1/session");
    if (!sessionResponse.ok) throw new Error("Test oturumu okunamadı.");
    const session = (await sessionResponse.json()) as { csrfToken: string };
    const response = await fetch("/api/v1/work-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        workType: "driver",
        workerPersonId,
        date: "2000-03-14",
        startTime: "08:00",
        endTime: "17:30",
        endsNextDay: false,
        grossCents: "1000000",
        fuelCents: "150000",
      }),
    });
    return {
      status: response.status,
      body: (await response.json()) as { workEntry?: { id?: string } },
    };
  }, { workerPersonId: SEED_IDS.driverA1c });
  expect(result.status).toBe(201);
  const id = result.body.workEntry?.id;
  expect(id).toMatch(/^[0-9a-f-]{36}$/u);
  if (!id) throw new Error("Gezinme testi kaydı oluşturulamadı.");
  return id;
}

function routesFor(role: VehicleRole, entryId: string): readonly RoleRoute[] {
  return role === "owner" ? [
    { path: "/sahip", title: "Özet", selected: "/sahip" },
    { path: "/sahip/raporlar", title: "Raporlar", selected: "/sahip/raporlar" },
    { path: "/sahip/soforler", title: "Şoförlerim", selected: "/sahip/soforler" },
    { path: "/sahip/kayit/yeni", title: "Çalışma kaydı", selected: "/sahip" },
    { path: `/sahip/kayitlar/${entryId}`, title: "Kayıt detayı", selected: "/sahip" },
    { path: `/sahip/kayitlar/${entryId}/gecmis`, title: "Kayıt geçmişi", selected: "/sahip" },
  ] : [
    { path: "/sofor", title: "Günlük kayıt", selected: "/sofor" },
    { path: "/sofor/kayitlar", title: "Araçtaki kayıtlar", selected: "/sofor/kayitlar" },
    { path: `/sofor/kayitlar/${entryId}`, title: "Kayıt detayı", selected: "/sofor/kayitlar" },
  ];
}

async function expectNavigation(page: Page, role: VehicleRole, selected: string, width: number): Promise<void> {
  const definition = NAVIGATION[role];
  const nav = page.getByRole("navigation", { name: definition.label, exact: true });
  await expect(nav).toHaveCount(1);
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link")).toHaveCount(definition.items.length);
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute("href", selected);

  for (const item of definition.items) {
    const link = nav.getByRole("link", { name: item.label, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", item.href);
    await expect(link).toContainText(item.label);
    if (item.href !== selected) await expect(link).not.toHaveAttribute("aria-current", "page");
    const bounds = await link.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(48);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  }

  const navBounds = await nav.boundingBox();
  const contentBounds = await page.getByRole("main").boundingBox();
  expect(navBounds).not.toBeNull();
  expect(contentBounds).not.toBeNull();
  if (width < 1024) {
    await expect(nav).toHaveCSS("position", "fixed");
    const height = page.viewportSize()!.height;
    expect(navBounds!.y).toBeGreaterThan(height * 0.7);
    expect(Math.abs(navBounds!.y + navBounds!.height - height)).toBeLessThanOrEqual(1);
    expect(navBounds!.width).toBe(width);
  } else {
    await expect(nav).toHaveCSS("position", "sticky");
    expect(navBounds!.x + navBounds!.width).toBeLessThanOrEqual(contentBounds!.x);
  }

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(nav).toBeInViewport();
  for (const item of definition.items) {
    await expect(nav.getByRole("link", { name: item.label, exact: true })).toBeInViewport();
  }
}

function istanbulToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** İptal hiçbir değeri kaybetmez; ancak açık çıkış onayı hedefe geçirir. */
async function expectGuardedExit(page: Page, field: Locator, value: string, link: Locator, target: string): Promise<void> {
  const source = new URL(page.url()).pathname;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PATCH", "DELETE"].includes(request.method()) && request.url().includes("/api/v1/")) {
      writes.push(request.url());
    }
  });
  await field.fill(value);
  await expect(field).toHaveValue(value);
  await link.click();
  const dialog = page.getByRole("dialog", { name: "Değişiklikleri bırakıp çık?", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === source);
  await dialog.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === source);
  await expect(field).toHaveValue(value);

  await link.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Bırakıp çık", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === target);
  await expect(dialog).not.toBeVisible();
  expect(writes).toEqual([]);
}

for (const viewport of VIEWPORTS) {
  test.describe(`Rol gezinmesi — ${viewport.name} ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const role of ["owner", "driver"] as const) {
      test(`${role === "owner" ? "sahibin altı" : "şoförün üç"} ekranında aynı yazılı menü, doğru seçim ve kaydırmada erişim`, async ({ page }) => {
        await loginAsVehicle(page, role);
        const entryId = await createNavigationEntry(page);
        for (const route of routesFor(role, entryId)) {
          await test.step(route.path, async () => {
            await openHydrated(page, route.path);
            await expect(page.getByRole("heading", { level: 1, name: route.title, exact: true })).toBeVisible();
            await expectNavigation(page, role, route.selected, viewport.width);
          });
        }
      });
    }

    test("yeni şoför formunda bugün hazırdır; saatler ve tutarlar kullanıcı girene kadar boştur", async ({ page }) => {
      const before = istanbulToday();
      await loginAsVehicle(page, "driver");
      await expect(page.getByRole("option", { name: "Hüseyin Ak", exact: true })).toBeAttached();
      const today = istanbulToday();
      expect([before, today]).toContain(await page.getByLabel("Çalışılan gün", { exact: true }).inputValue());
      await expect(page.locator("#work-date-display")).toContainText("Bugün");
      await expect(page.getByLabel("Kim çalıştı?", { exact: true })).toHaveValue("");
      for (const label of ["Başlangıç saati", "Bitiş saati", "Hasılat (TL)", "Mazot (TL)"]) {
        await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
      }
      await page.getByLabel("Başlangıç saati", { exact: true }).fill("08:00");
      await page.getByLabel("Bitiş saati", { exact: true }).fill("17:30");
      await expect(page.getByText("Süre: 9 saat 30 dakika", { exact: true })).toBeVisible();
      await page.getByLabel("Çalışılan gün", { exact: true }).fill("2000-03-14");
      await expect(page.getByLabel("Çalışılan gün", { exact: true })).toHaveValue("2000-03-14");
      await expect(page.locator("#work-date-display")).not.toContainText("Bugün");
    });

    test("şoför günlük kayıt taslağı: menüden çıkışı iptal değerleri korur; açık onay kayıt listesine geçirir", async ({ page }) => {
      await loginAsVehicle(page, "driver");
      const nav = page.getByRole("navigation", { name: "Şoför bağlantıları", exact: true });
      await expectGuardedExit(page, page.getByLabel("Hasılat (TL)", { exact: true }), "123", nav.getByRole("link", { name: "Araçtaki kayıtlar", exact: true }), "/sofor/kayitlar");
    });

    test("sahip çalışma kaydı taslağı: menüden çıkışı iptal değeri korur; açık onay raporlara geçirir", async ({ page }) => {
      await loginAsVehicle(page, "owner");
      await openHydrated(page, "/sahip/kayit/yeni");
      const nav = page.getByRole("navigation", { name: "Sahip bağlantıları", exact: true });
      await expectGuardedExit(page, page.getByLabel("Hasılat (TL)", { exact: true }), "234", nav.getByRole("link", { name: "Raporlar", exact: true }), "/sahip/raporlar");
    });

    test("sahip şoför ekleme taslağı: menüden çıkışı iptal adı korur; açık onay özete geçirir", async ({ page }) => {
      await loginAsVehicle(page, "owner");
      await openHydrated(page, "/sahip/soforler");
      await page.getByRole("button", { name: "+ Şoför ekle", exact: true }).click();
      const nav = page.getByRole("navigation", { name: "Sahip bağlantıları", exact: true });
      await expectGuardedExit(page, page.getByLabel("Ad soyad", { exact: true }), "Gezinme Taslak Şoförü", nav.getByRole("link", { name: "Özet", exact: true }), "/sahip");
    });

    test("yönetim işletme açma taslağı: menüden çıkışı iptal adı korur; açık onay işlem geçmişine geçirir", async ({ page }) => {
      await loginAsAdmin(page);
      await openHydrated(page, "/yonetim/isletmeler/yeni");
      const nav = page.getByRole("navigation", { name: "Yönetim bölümleri", exact: true });
      await expectGuardedExit(page, page.getByLabel("İşletme adı", { exact: true }), "Gezinme Taslak İşletmesi", nav.getByRole("link", { name: "İşlem geçmişi", exact: true }), "/yonetim/islem-gecmisi");
    });
  });
}
