import { defineConfig } from "vitest/config";

/**
 * İki ayrı Vitest projesi (Vitest 5 `test.projects` API'si; eski
 * `vitest.workspace.ts` dosyası artık gerekmiyor — bkz.
 * `node_modules/vitest/dist/chunks/plugin.d.CN87HSxv.d.ts`
 * `TestProjectConfiguration`/`UserWorkspaceConfig` tanımları):
 *
 * - `unit`: `src/**\/*.test.ts` + `tests/unit/**\/*.test.ts`, Node ortamı.
 *   Dış kaynaklara (DB, ağ) dokunmayan saf birim testleri (ör. plaka
 *   normalizasyonu). İkinci desen T6.1 ADIM 2/2 (S6.1) ile eklendi:
 *   `.github/workflows/*.yml` metinsel doğrulaması `src/` altında değil,
 *   görev tanımının istediği gibi `tests/unit/` altında yaşar.
 * - `integration`: `tests/integration/**\/*.test.ts`, Node ortamı, gerçek
 *   geçici SQLite dosyalarıyla çalıştığı için dosyalar arası sıralı
 *   (`fileParallelism: false`) çalıştırılır. QA-PLAN.md §1/§3 —
 *   "Finansal DB testleri yalnız mock veya :memory: üzerinde kabul
 *   edilmez"; bu proje gerçek `better-sqlite3` dosya bağlantısı kullanır.
 * - `release`: `tests/release/**\/*.test.ts` — `release:build`/
 *   `release:verify` boru hattının uçtan uca meta-testi (`npm run
 *   test:release`). Geçici bir klonda `release:build` koşar; klonun ağacı
 *   için geçerli `.quality-gate` kaydı yoksa kalite kapısını
 *   (typecheck/lint/unit/integration) klonda bir kez tam çalıştırır (bkz.
 *   `scripts/lib/quality-gate.ts`). Rutin `test:integration`'a dahil
 *   olsaydı kapı, klondaki iç içe `release:build` üzerinden kendini
 *   çağırırdı (ölçülen, kayıttan önce: dosya tek başına ~20 dk, paketin
 *   %72'si). Bu yüzden `perf:reports` gibi ayrı bir komuttur; CI
 *   (`scripts/ci-steps.json`) onu `quality-gate` adımından sonra ayrı adım
 *   olarak koşar.
 *
 * `passWithNoTests` kullanılmaz: her proje gerçek test içerir.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "release",
          environment: "node",
          include: ["tests/release/**/*.test.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
