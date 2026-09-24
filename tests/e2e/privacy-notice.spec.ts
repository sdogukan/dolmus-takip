import { expect, test } from "@playwright/test";

/**
 * KVKK aydınlatma metni — `/aydinlatma-metni` oturumsuz açılır ve yedi bölümü
 * gösterir; araç ve ekip giriş ekranlarının ikisi de bu sayfaya bağlanır.
 * Metnin kendisi `../../src/lib/messages.ts` `PRIVACY_NOTICE`'ten gelir
 * (birim testi: `../../src/lib/messages.test.ts`).
 */

const LINK_NAME = "Kişisel verilerin korunması: aydınlatma metni";
const SECTION_HEADINGS = [
  "1. Veri sorumlusu",
  "2. İşlenen kişisel veriler",
  "3. İşleme amaçları",
  "4. Toplama yöntemi ve hukuki sebep",
  "5. Aktarım",
  "6. Saklama süresi",
  "7. Hakların ve başvuru yolu",
];

test.describe("KVKK aydınlatma metni", () => {
  test("oturum olmadan açılır, yönlendirmez ve yedi bölümü gösterir", async ({ page }) => {
    await page.goto("/aydinlatma-metni");
    await expect(page).toHaveURL(/\/aydinlatma-metni$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Kişisel Verilerin Korunması Aydınlatma Metni" }),
    ).toBeVisible();
    const headings = page.getByRole("heading", { level: 2 });
    await expect(headings).toHaveText(SECTION_HEADINGS);
    await expect(page.getByText("Veri sorumlusu: [Veri sorumlusunun unvanı]")).toBeVisible();
    await expect(page.getByText("Ekip kullanıcı adları ve ekip üyelerinin ad soyadı")).toBeVisible();
    await expect(page.getByText("Çalışma ve para kayıtları en az beş yıl saklanır.")).toBeVisible();
    await expect(page.getByText(/Silme talebinde kişinin adı anonimleştirilir/)).toBeVisible();
    await expect(page.getByText("KVKK m.11 uyarınca şu haklara sahipsin:")).toBeVisible();
    await expect(page.getByText(/^Başvurunu yazılı olarak/)).toBeVisible();
  });

  test("320 px genişlikte yatay kaydırma yok", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/aydinlatma-metni");
    await expect
      .poll(() => page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0))
      .toBeLessThanOrEqual(320);
  });

  for (const loginPath of ["/giris", "/yonetim/giris"]) {
    test(`${loginPath} aydınlatma metnine bağlanır; bağlantı en az 48 px yüksekliğindedir`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(loginPath);
      const link = page.getByRole("link", { name: LINK_NAME });
      await expect(link).toHaveAttribute("href", "/aydinlatma-metni");
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
      await expect
        .poll(() => page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0))
        .toBeLessThanOrEqual(320);

      await link.click();
      await page.waitForURL("**/aydinlatma-metni");
      await expect(page.getByRole("heading", { level: 2 })).toHaveCount(7);
    });
  }
});
