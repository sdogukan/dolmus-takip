import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright uçtan uca test yapılandırması.
 *
 * Bu adımda yalnızca yapılandırma hazırlanır; tarayıcı ikilileri indirilmez
 * (`npx playwright install` T1.6'da çalıştırılacak) ve henüz `tests/e2e`
 * altında test yoktur — bu yüzden `npm run test:e2e` bu paketin doğrulama
 * listesinde yoktur. `webServer` (üretim derlemesiyle otomatik başlatma)
 * gerçek E2E akışları yazılırken (T1.6) eklenecektir.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
