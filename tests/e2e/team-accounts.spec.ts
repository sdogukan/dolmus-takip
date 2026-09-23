import { expect, test, type Browser, type Page } from "@playwright/test";
import { SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";

/**
 * Ekip hesapları (/yonetim/ekip) uçtan uca testleri. `./admin-support-audit.spec.ts`
 * İLE AYNI altyapı (gerçek standalone sunucu + paylaşılan seed DB). Her test KENDİ
 * benzersiz adlı hesabını açar; tohumlu yönetici/destek hesaplarının rolü, aktifliği
 * ve şifresi ASLA değiştirilmez (diğer spec'ler onlarla giriş yapar; son aktif
 * yönetici koruması da böyle bir değişikliği reddederdi).
 */

const OWNER_PASSWORD = "sahip-e2e-ekip";
const DRIVER_PASSWORD = "sofor-e2e-ekip";

const UNAUTHORIZED_TEXT = "Bu işlem için erişimin yok.";
const SESSION_ENDED_TEXT = "Oturumun sona erdi. Yeniden giriş yap.";
const INVALID_CREDENTIALS_TEXT = "Kullanıcı adı veya şifre yanlış.";
const TAKEN_USERNAME_TEXT = "Bu kullanıcı adı zaten kullanılıyor.";
const CONFLICT_TEXT = "Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.";

let counter = 0;
/** Yeniden koşularda çakışmasın: `^[a-z0-9._-]{3,32}$` içinde, zamana bağlı sonek. */
function uniqueUsername(prefix: string): string {
  counter += 1;
  return `${prefix}.${Date.now().toString(36)}${counter}`;
}

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

async function newContextPage(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  return context.newPage();
}

async function staffPage(browser: Browser, baseURL: string | undefined, username: string, password: string): Promise<Page> {
  const page = await newContextPage(browser, baseURL);
  await loginAsStaff(page, username, password);
  return page;
}

async function loginAsVehicle(page: Page, plate: string, password: string, landing: string): Promise<void> {
  await page.goto("/giris");
  await page.getByLabel("Plaka").fill(plate);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForURL(`**${landing}`);
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

/** Test verisi: hesabı API ile açar (arayüz akışı ayrı testte sınanır). */
async function createAccountViaApi(
  admin: Page,
  username: string,
  password: string,
  platformRole: "admin" | "support" = "support",
  fullName = "E2E Ekip Kişisi",
): Promise<string> {
  const response = await apiRequest(admin, "POST", "/api/v1/admin/users", {
    requestId: crypto.randomUUID(),
    username,
    fullName,
    platformRole,
    password,
  });
  expect(response.status).toBe(201);
  return (JSON.parse(response.text) as { user: { id: string } }).user.id;
}

async function openDetail(page: Page, userId: string): Promise<void> {
  await page.goto(`/yonetim/ekip/${userId}`);
  await page.waitForLoadState("networkidle");
}

async function storageDump(page: Page): Promise<string> {
  return page.evaluate(() => {
    const dump: string[] = [];
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key) dump.push(`${key}=${storage.getItem(key) ?? ""}`);
      }
    }
    return dump.join("\n");
  });
}

async function fillUntilEnabled(page: Page, fieldLabel: string, value: string, buttonName: string): Promise<void> {
  const field = page.getByLabel(fieldLabel, { exact: true });
  const button = page.getByRole("button", { name: buttonName });
  // Düğme yalnız hydrate olmuş ve değişiklik algılanmış sayfada açılır.
  await expect(async () => {
    await field.fill(value);
    await expect(button).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function deactivateViaUi(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Hesabı pasifleştir" }).click();
  const dialog = page.getByRole("dialog", { name: "Hesabı pasifleştir" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Pasifleştir", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.describe("Ekip hesapları (/yonetim/ekip)", () => {
  test("yönetici hesabı arayüzden açar; kullanıcı adı küçük harfe çevrilir; büyük/küçük harf farkıyla tekrar açılamaz", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const username = uniqueUsername("e2e.olustur");

    await page.goto("/yonetim");
    await page.getByRole("link", { name: "Ekip hesapları" }).click();
    await page.waitForURL("**/yonetim/ekip");
    await page.getByRole("link", { name: "+ Hesap aç" }).click();
    await page.waitForURL("**/yonetim/ekip/yeni");
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Kullanıcı adı").fill(username.toUpperCase());
    await page.getByLabel("Ad soyad").fill("Oluşturma Testi");
    await page.getByRole("radio", { name: "Destek" }).check();
    await page.getByLabel("Şifre", { exact: true }).fill("ilk-sifre-e2e-1");
    await page.getByRole("button", { name: "Hesabı aç" }).click();
    await page.waitForURL(/\/yonetim\/ekip\/[0-9a-f-]{36}$/);

    // Kanonik (küçük harf) kullanıcı adı, rol etiketi ve aktiflik.
    await expect(page.getByRole("heading", { level: 1, name: username })).toBeVisible();
    await expect(page.getByText("Oluşturma Testi · Destek")).toBeVisible();
    await expect(page.getByText("Aktif", { exact: true }).first()).toBeVisible();

    // Listede görünür.
    await page.goto("/yonetim/ekip");
    const row = page.getByRole("listitem").filter({ hasText: username });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Oluşturma Testi · Destek · Aktif");

    // Aynı ad, farklı harf düzeniyle: alan hatası aria-describedby ile bağlı.
    await page.goto("/yonetim/ekip/yeni");
    await page.waitForLoadState("networkidle");
    const usernameInput = page.getByLabel("Kullanıcı adı");
    await usernameInput.fill(username.charAt(0).toUpperCase() + username.slice(1));
    await page.getByLabel("Ad soyad").fill("Çift Kayıt");
    await page.getByLabel("Şifre", { exact: true }).fill("ikinci-sifre-e2e-1");
    await page.getByRole("button", { name: "Hesabı aç" }).click();
    const error = page.getByText(TAKEN_USERNAME_TEXT);
    await expect(error).toBeVisible();
    await expect(usernameInput).toHaveAttribute("aria-invalid", "true");
    await expect(usernameInput).toHaveAttribute("aria-describedby", "team-username-error");
    await expect(usernameInput).toBeFocused();
    await expect(page).toHaveURL(/\/yonetim\/ekip\/yeni$/);
    await page.goto("/yonetim/ekip");
    await expect(page.getByRole("listitem").filter({ hasText: username })).toHaveCount(1);
  });

  test("ad soyad ve yetki düzenlenir, sayfa yenilenince kalıcıdır", async ({ page }) => {
    await loginAsAdmin(page);
    const username = uniqueUsername("e2e.duzenle");
    const userId = await createAccountViaApi(page, username, "duzenle-sifre-1", "support", "Eski Ad");

    await openDetail(page, userId);
    await expect(page.getByLabel("Ad soyad")).toHaveValue("Eski Ad");
    await expect(page.getByRole("button", { name: "Bilgiyi kaydet" })).toBeDisabled();

    await fillUntilEnabled(page, "Ad soyad", "Yeni Ad Soyad", "Bilgiyi kaydet");
    await page.getByRole("radio", { name: "Yönetici" }).check();
    await page.getByRole("button", { name: "Bilgiyi kaydet" }).click();
    await expect(page.getByText("Yeni Ad Soyad · Yönetici")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Ad soyad")).toHaveValue("Yeni Ad Soyad");
    await expect(page.getByRole("radio", { name: "Yönetici" })).toBeChecked();
    await expect(page.getByText("Yeni Ad Soyad · Yönetici")).toBeVisible();

    // Boş ad soyad alan hatası verir, kayıt yapılmaz.
    await page.getByLabel("Ad soyad").fill("   ");
    await page.getByRole("button", { name: "Bilgiyi kaydet" }).click();
    await expect(page.getByText("Ad soyad 1–120 karakter olmalı.")).toBeVisible();
    await expect(page.getByLabel("Ad soyad")).toHaveAttribute("aria-invalid", "true");
  });

  test("yanıtı kaybolan kayıt yeniden yüklemeden sonra AYNI gövdeyle tekrarlanır: 200 tekrar yanıtı, sürüm bir artar, denetim satırları tekildir", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const userId = await createAccountViaApi(page, uniqueUsername("e2e.kayip"), "kayip-sifre-1", "support", "Kayıp Önce");
    await openDetail(page, userId);

    // İstek sunucuya ulaşıp işlenir, yanıt istemciye dönmez → sonucu belirsiz.
    const patchUrl = new RegExp(`/api/v1/admin/users/${userId}$`);
    const sentBodies: string[] = [];
    await page.route(patchUrl, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      sentBodies.push(route.request().postData() ?? "");
      await route.fetch();
      await route.abort("connectionreset");
    });
    await fillUntilEnabled(page, "Ad soyad", "Kayıp Sonra", "Bilgiyi kaydet");
    await page.getByRole("radio", { name: "Yönetici" }).check();
    await page.getByRole("button", { name: "Bilgiyi kaydet" }).click();
    await expect(page.getByRole("button", { name: "Tekrar kontrol et" })).toBeVisible();
    expect(sentBodies).toHaveLength(1);

    await page.unroute(patchUrl);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Kayıp Sonra · Yönetici")).toBeVisible();

    const replay = page.waitForResponse((r) => patchUrl.test(r.url()) && r.request().method() === "PATCH");
    await page.getByRole("button", { name: "Tekrar kontrol et" }).click();
    const response = await replay;
    expect(response.status()).toBe(200);
    expect(response.request().postData()).toBe(sentBodies[0]);
    await expect(page.getByText("Bu işlem başka bir denemeyle çakıştı.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tekrar kontrol et" })).toHaveCount(0);

    const check = await apiRequest(page, "GET", `/api/v1/admin/users/${userId}`);
    expect((JSON.parse(check.text) as { user: { version: number } }).user.version).toBe(2);

    const audit = await apiRequest(page, "GET", "/api/v1/admin/audit?limit=100");
    const entries = (JSON.parse(audit.text) as { entries: { action: string; targetUser: { id: string } | null }[] }).entries;
    const actions = entries.filter((e) => e.targetUser?.id === userId && e.action !== "platform_user.create").map((e) => e.action);
    expect(actions.sort()).toEqual(["platform_user.role_change", "platform_user.update"]);
  });

  test("bayat sekme sessizce ezmez: sürüm çatışması metni gösterilir, 'Güncel halini aç' sunucu değerini yükler", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const userId = await createAccountViaApi(page, uniqueUsername("e2e.bayat"), "bayat-sifre-1", "support", "Başlangıç");

    const tabB = await page.context().newPage();
    await openDetail(page, userId);
    await openDetail(tabB, userId);

    // Sekme A kaydeder → sürüm ilerler.
    await fillUntilEnabled(page, "Ad soyad", "Sekme A Değeri", "Bilgiyi kaydet");
    await page.getByRole("button", { name: "Bilgiyi kaydet" }).click();
    await expect(page.getByText("Sekme A Değeri · Destek")).toBeVisible();

    // Sekme B eski sürümle kaydetmeyi dener.
    await fillUntilEnabled(tabB, "Ad soyad", "Sekme B Değeri", "Bilgiyi kaydet");
    await tabB.getByRole("button", { name: "Bilgiyi kaydet" }).click();
    const alert = tabB.getByRole("alert").filter({ hasText: CONFLICT_TEXT });
    await expect(alert).toBeVisible();

    // Sunucudaki değer ezilmedi.
    const check = await apiRequest(page, "GET", `/api/v1/admin/users/${userId}`);
    expect(check.text).toContain("Sekme A Değeri");
    expect(check.text).not.toContain("Sekme B Değeri");

    await alert.getByRole("button", { name: "Güncel halini aç" }).click();
    await tabB.waitForLoadState("networkidle");
    await expect(tabB.getByLabel("Ad soyad")).toHaveValue("Sekme A Değeri");
  });

  test("pasifleştirme onay ister, hesabın açık oturumunu kapatır ve girişi engeller; yeniden aktifleştirme eski oturumu geri getirmez", async ({
    page,
    browser,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    await loginAsAdmin(page);
    const username = uniqueUsername("e2e.pasif");
    const password = "pasif-sifre-e2e-1";
    const userId = await createAccountViaApi(page, username, password);

    const target = await staffPage(browser, baseURL, username, password);
    await expect(target.getByText(`${username} · Destek`)).toBeVisible();

    await openDetail(page, userId);
    // Vazgeç: hiçbir şey değişmez.
    await page.getByRole("button", { name: "Hesabı pasifleştir" }).click();
    const dialog = page.getByRole("dialog", { name: "Hesabı pasifleştir" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Vazgeç" }).click();
    await expect(dialog).toBeHidden();
    expect((await target.context().request.get("/api/v1/session")).status()).toBe(200);

    await deactivateViaUi(page);
    await expect(page.getByText("Pasif", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Hesabı yeniden aktifleştir" })).toBeVisible();

    // Yöneticinin kendi oturumu açık kalır.
    expect((await apiRequest(page, "GET", "/api/v1/admin/users")).status).toBe(200);

    // Hesabın açık oturumu kapandı.
    expect((await target.context().request.get("/api/v1/session")).status()).toBe(401);
    await target.goto("/yonetim");
    await target.waitForURL("**/yonetim/giris");

    // Yeniden giriş engellenir.
    const blocked = await newContextPage(browser, baseURL);
    await blocked.goto("/yonetim/giris");
    await blocked.getByLabel("Kullanıcı adı").fill(username);
    await blocked.getByLabel("Şifre").fill(password);
    await blocked.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await expect(blocked.getByText(INVALID_CREDENTIALS_TEXT)).toBeVisible();
    await expect(blocked).toHaveURL(/\/yonetim\/giris/);

    // Yeniden aktifleştirme doğrudan; eski oturum geri gelmez.
    await page.getByRole("button", { name: "Hesabı yeniden aktifleştir" }).click();
    await expect(page.getByRole("button", { name: "Hesabı pasifleştir" })).toBeVisible();
    expect((await target.context().request.get("/api/v1/session")).status()).toBe(401);
    await target.goto("/yonetim");
    await target.waitForURL("**/yonetim/giris");

    // Kişi yeniden giriş yapabilir.
    await loginAsStaff(target, username, password);
    expect((await target.context().request.get("/api/v1/session")).status()).toBe(200);
  });

  test("şifre sıfırlama açık oturumu kapatır; eski şifre reddedilir, yeni şifre girer; şifre ekranda kalmaz", async ({
    page,
    browser,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    await loginAsAdmin(page);
    const username = uniqueUsername("e2e.sifre");
    const oldPassword = "eski-sifre-e2e-1";
    const newPassword = "yeni-sifre-e2e-2";
    const userId = await createAccountViaApi(page, username, oldPassword);

    const target = await staffPage(browser, baseURL, username, oldPassword);

    await openDetail(page, userId);
    await page.getByLabel("Yeni şifre").fill(newPassword);
    await page.getByRole("button", { name: "Şifreyi sıfırla" }).click();
    await expect(page.getByText(`${username} hesabının şifresi değiştirildi.`)).toBeVisible();
    await expect(page.getByLabel("Yeni şifre")).toHaveValue("");
    expect(await page.content()).not.toContain(newPassword);
    expect(await storageDump(page)).not.toContain(newPassword);

    // Açık oturum kapandı.
    expect((await target.context().request.get("/api/v1/session")).status()).toBe(401);

    // Eski şifre reddedilir.
    const oldLogin = await newContextPage(browser, baseURL);
    await oldLogin.goto("/yonetim/giris");
    await oldLogin.getByLabel("Kullanıcı adı").fill(username);
    await oldLogin.getByLabel("Şifre").fill(oldPassword);
    await oldLogin.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await expect(oldLogin.getByText(INVALID_CREDENTIALS_TEXT)).toBeVisible();

    // Yeni şifre girer.
    const newLogin = await newContextPage(browser, baseURL);
    await loginAsStaff(newLogin, username, newPassword);

    // Boş şifre alan hatası verir.
    await page.getByRole("button", { name: "Şifreyi sıfırla" }).click();
    await expect(page.getByText("Yeni şifreyi gir.")).toBeVisible();
    await expect(page.getByLabel("Yeni şifre")).toHaveAttribute("aria-describedby", "team-reset-password-error");
  });

  test("yönetici kendi hesabını pasifleştirince oturum biter ve giriş sayfası oturum bitti notunu gösterir", async ({
    page,
    browser,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    // Kendi hesabı: tohumlu hesap DEĞİL, bu testin açtığı ikinci yönetici.
    await loginAsAdmin(page);
    const username = uniqueUsername("e2e.kendi");
    const password = "kendi-sifre-e2e-1";
    const userId = await createAccountViaApi(page, username, password, "admin");

    const self = await staffPage(browser, baseURL, username, password);
    await openDetail(self, userId);
    await expect(self.getByText("Kendi şifreni sıfırlıyorsun", { exact: false })).toBeVisible();
    await deactivateViaUi(self);
    await self.waitForURL(/\/yonetim\/giris\?oturum=bitti/);
    await expect(self.getByText(SESSION_ENDED_TEXT)).toBeVisible();
    // Tohumlu yönetici etkilenmedi.
    expect((await apiRequest(page, "GET", "/api/v1/admin/users")).status).toBe(200);
  });

  test("işlem geçmişi hedef hesabın kullanıcı adını gösterir; şifre hiçbir yerde yoktur", async ({ page }) => {
    await loginAsAdmin(page);
    const username = uniqueUsername("e2e.gecmis");
    const password = "gecmis-sifre-e2e-1";
    const resetPassword = "gecmis-sifirlanan-e2e-2";
    const userId = await createAccountViaApi(page, username, password);
    expect(
      (await apiRequest(page, "POST", `/api/v1/admin/users/${userId}/reset-password`, {
        requestId: crypto.randomUUID(),
        newPassword: resetPassword,
      })).status,
    ).toBe(200);
    expect(
      (await apiRequest(page, "PATCH", `/api/v1/admin/users/${userId}`, {
        requestId: crypto.randomUUID(),
        version: 1,
        active: false,
      })).status,
    ).toBe(200);

    await page.goto("/yonetim/islem-gecmisi");
    const main = page.getByRole("main");
    await expect(main.getByText(`Ekip hesabı: ${username}`).first()).toBeVisible();
    for (const label of ["Ekip hesabı açıldı", "Ekip hesabı şifresi sıfırlandı", "Ekip hesabı pasifleştirildi"]) {
      await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(main.getByText(`İşlemi yapan: ${SEED_USERNAMES.admin} (Yönetici)`).first()).toBeVisible();

    const html = await page.content();
    for (const secret of [password, resetPassword]) expect(html).not.toContain(secret);
    const api = await apiRequest(page, "GET", "/api/v1/admin/audit");
    expect(api.status).toBe(200);
    expect(api.text).toContain(username);
    for (const secret of [password, resetPassword]) expect(api.text).not.toContain(secret);
    expect(api.text).not.toMatch(/argon2|passwordHash|password_hash/i);
  });

  test("destek yetkisiz metnini görür, bağlantı gizlidir, API 403 verir; sahip ve şoför oturumu erişemez", async ({
    page,
    browser,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    await loginAsAdmin(page);
    const username = uniqueUsername("e2e.gorunur");
    const userId = await createAccountViaApi(page, username, "gorunur-sifre-1");

    // Sahip/şoför için kendi işletmesi ve aracı (seed verisine dokunmadan).
    await page.goto("/yonetim/isletmeler/yeni");
    await page.getByLabel("İşletme adı").fill(`Ekip E2E ${Date.now()}`);
    await page.getByLabel("Sahibin ad soyadı").fill("Ekip Sahibi");
    await page.getByRole("button", { name: "İşletmeyi kaydet" }).click();
    await page.waitForURL(/\/yonetim\/isletmeler\/[0-9a-f-]{36}$/);
    const businessId = page.url().split("/").pop()!;
    const plate = `34 EKP ${100 + (Date.now() % 900)}`;
    await page.goto(`/yonetim/isletmeler/${businessId}/araclar/yeni`);
    await page.getByLabel("Plaka").fill(plate);
    await page.getByLabel("Sahip şifresi").fill(OWNER_PASSWORD);
    await page.getByLabel("Şoför şifresi").fill(DRIVER_PASSWORD);
    await page.getByRole("button", { name: "Aracı kaydet" }).click();
    await page.waitForURL(/\/yonetim\/araclar\/[0-9a-f-]{36}$/);

    // Yönetici bağlantıyı görür (karşılaştırma).
    await page.goto("/yonetim");
    await expect(page.getByRole("link", { name: "Ekip hesapları" })).toBeVisible();

    // Destek: bağlantı yok, sayfalar yetkisiz metni gösterir, liste okunmaz.
    const support = await staffPage(browser, baseURL, SEED_USERNAMES.support, SEED_TEST_PASSWORDS.support);
    await expect(support.getByRole("link", { name: "Ekip hesapları" })).toHaveCount(0);
    for (const url of ["/yonetim/ekip", "/yonetim/ekip/yeni", `/yonetim/ekip/${userId}`]) {
      await support.goto(url);
      await expect(support.getByRole("alert").filter({ hasText: UNAUTHORIZED_TEXT })).toBeVisible();
      await expect(support.getByText(username)).toHaveCount(0);
      await expect(support.getByText(SEED_USERNAMES.admin)).toHaveCount(0);
      await expect(support.getByRole("textbox")).toHaveCount(0);
    }
    expect((await apiRequest(support, "GET", "/api/v1/admin/users")).status).toBe(403);
    expect(
      (await apiRequest(support, "POST", `/api/v1/admin/users/${userId}/reset-password`, {
        requestId: crypto.randomUUID(),
        newPassword: "destek-deneme-1",
      })).status,
    ).toBe(403);

    // Sahip ve şoför (araç oturumu): sayfa kendi ana sayfasına döner, API 403.
    const owner = await newContextPage(browser, baseURL);
    await loginAsVehicle(owner, plate, OWNER_PASSWORD, "/sahip");
    await owner.goto("/yonetim/ekip");
    await owner.waitForURL("**/sahip");
    expect((await apiRequest(owner, "GET", "/api/v1/admin/users")).status).toBe(403);
    const driver = await newContextPage(browser, baseURL);
    await loginAsVehicle(driver, plate, DRIVER_PASSWORD, "/sofor");
    await driver.goto("/yonetim/ekip/yeni");
    await driver.waitForURL("**/sofor");
    expect((await apiRequest(driver, "GET", "/api/v1/admin/users")).status).toBe(403);

    // Araç şifresiyle ekip girişi yapılamaz.
    const vehicleAsStaff = await newContextPage(browser, baseURL);
    await vehicleAsStaff.goto("/yonetim/giris");
    await vehicleAsStaff.getByLabel("Kullanıcı adı").fill(plate);
    await vehicleAsStaff.getByLabel("Şifre").fill(OWNER_PASSWORD);
    await vehicleAsStaff.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await expect(vehicleAsStaff.getByText(INVALID_CREDENTIALS_TEXT)).toBeVisible();
  });

  test("şifreler localStorage/sessionStorage'a hiç yazılmaz", async ({ page }) => {
    await loginAsAdmin(page);
    const username = uniqueUsername("e2e.depo");
    const createPassword = "depo-ilk-sifre-e2e-1";
    const typedResetPassword = "depo-yazilan-sifre-e2e-2";

    await page.goto("/yonetim/ekip/yeni");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Kullanıcı adı").fill(username);
    await page.getByLabel("Ad soyad").fill("Depo Kontrolü");
    await page.getByLabel("Şifre", { exact: true }).fill(createPassword);
    expect(await storageDump(page)).not.toContain(createPassword);

    await page.getByRole("button", { name: "Hesabı aç" }).click();
    await page.waitForURL(/\/yonetim\/ekip\/[0-9a-f-]{36}$/);
    expect(await storageDump(page)).not.toContain(createPassword);

    // Gönderilmemiş sıfırlama şifresi de depoya yazılmaz.
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Yeni şifre").fill(typedResetPassword);
    expect(await storageDump(page)).not.toContain(typedResetPassword);
    await page.getByRole("button", { name: "Şifreyi sıfırla" }).click();
    await expect(page.getByText(`${username} hesabının şifresi değiştirildi.`)).toBeVisible();
    const after = await storageDump(page);
    expect(after).not.toContain(typedResetPassword);
    expect(after).not.toContain(createPassword);
  });

  test("320 px genişlikte liste, açma formu ve detay yatay kaydırmasız ve kullanılabilir", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await loginAsAdmin(page);
    const username = uniqueUsername("e2e.dar.uzun.ad");
    const userId = await createAccountViaApi(page, username, "dar-sifre-e2e-1", "support", "Çok Uzun Bir Ad Soyad Değeri Deneme");

    const noHorizontalScroll = () =>
      expect.poll(() => page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0)).toBeLessThanOrEqual(320);
    const withinViewport = async (locator: ReturnType<Page["getByRole"]>) => {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    };

    await page.goto("/yonetim/ekip");
    await noHorizontalScroll();
    const row = page.getByRole("listitem").filter({ hasText: username });
    await expect(row).toHaveCount(1);
    await withinViewport(row.getByRole("link", { name: "Düzenle" }));
    await withinViewport(page.getByRole("link", { name: "+ Hesap aç" }));

    await page.goto("/yonetim/ekip/yeni");
    await noHorizontalScroll();
    await withinViewport(page.getByRole("button", { name: "Hesabı aç" }));
    await withinViewport(page.getByRole("button", { name: "Göster" }));

    await openDetail(page, userId);
    await noHorizontalScroll();
    await withinViewport(page.getByRole("button", { name: "Hesabı pasifleştir" }));
    await withinViewport(page.getByRole("button", { name: "Şifreyi sıfırla" }));

    // Onay penceresi de dar ekranda taşmaz.
    await page.getByRole("button", { name: "Hesabı pasifleştir" }).click();
    const dialog = page.getByRole("dialog", { name: "Hesabı pasifleştir" });
    await expect(dialog).toBeVisible();
    await withinViewport(dialog.getByRole("button", { name: "Pasifleştir", exact: true }));
    await dialog.getByRole("button", { name: "Vazgeç" }).click();
    await noHorizontalScroll();
  });
});
