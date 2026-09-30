import { defineConfig } from "vitest/config";

/**
 * Dört ayrı Vitest projesi (Vitest 5 `test.projects` API'si; eski
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
 *   (`fileParallelism: false`) çalıştırılır. Finansal DB testleri yalnız
 *   mock veya :memory: üzerinde kabul edilmez; bu proje gerçek
 *   `better-sqlite3` dosya bağlantısı kullanır.
 * - `release`: `tests/release/**\/*.test.ts` (`npm run test:release`) —
 *   yalnız `release:build`/`release:verify` boru hattının uçtan uca
 *   meta-testi (`release-build.test.ts`). Meta-test geçici bir klonda
 *   `release:build` koşar; klon, kendi ağacı için yazılmış hazır bir
 *   `.quality-gate` kaydıyla başlar, kalite kapısı yalnız kayıtsız ağaç
 *   testinde tam koşar (bkz. `scripts/lib/quality-gate.ts`). Kapının bir
 *   adımı olsaydı kapı, klondaki iç içe `release:build` üzerinden kendini
 *   çağırırdı (ölçülen, kayıttan önce: dosya tek başına ~20 dk, paketin
 *   %72'si). Bu yüzden `perf:reports` gibi ayrı bir komuttur; CI
 *   (`scripts/ci-steps.json`) onu `quality-gate` adımından sonra ayrı adım
 *   olarak koşar.
 * - `release-ops`: `tests/release-ops/**\/*.test.ts` (`npm run
 *   test:release-ops`) — kontrollü yayın aracı `scripts/release-apply.ts`'in
 *   testleri (`release-apply.test.ts`; 2026-09-25'te `integration`'dan
 *   `release`'e, 2026-09-30'da buraya taşındı). Kalite kapısının beşinci
 *   adımıdır (`test:integration`'dan sonra), bu yüzden elle çağrılan
 *   `release:build`'in kapısı da onu koşar. Kendi `os.tmpdir()` altındaki
 *   geçici dizinlerinde çalışır, proje ağacına yazmaz. Deseni BİLEREK
 *   `tests/release-ops/**` ile sınırlıdır: `tests/release/` altındaki
 *   meta-test kapıya girerse kapı kendini özyinelemeli çağırır.
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
      {
        extends: true,
        test: {
          name: "release-ops",
          environment: "node",
          include: ["tests/release-ops/**/*.test.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
