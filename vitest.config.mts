import { defineConfig } from "vitest/config";

/**
 * İki ayrı Vitest projesi (Vitest 5 `test.projects` API'si; eski
 * `vitest.workspace.ts` dosyası artık gerekmiyor — bkz.
 * `node_modules/vitest/dist/chunks/plugin.d.CN87HSxv.d.ts`
 * `TestProjectConfiguration`/`UserWorkspaceConfig` tanımları):
 *
 * - `unit`: `src/**\/*.test.ts`, Node ortamı. Dış kaynaklara (DB, ağ)
 *   dokunmayan saf birim testleri (ör. plaka normalizasyonu).
 * - `integration`: `tests/integration/**\/*.test.ts`, Node ortamı, gerçek
 *   geçici SQLite dosyalarıyla çalıştığı için dosyalar arası sıralı
 *   (`fileParallelism: false`) çalıştırılır. QA-PLAN.md §1/§3 —
 *   "Finansal DB testleri yalnız mock veya :memory: üzerinde kabul
 *   edilmez"; bu proje gerçek `better-sqlite3` dosya bağlantısı kullanır.
 *
 * `passWithNoTests` kullanılmaz: her iki proje de gerçek test içerir.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
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
    ],
  },
});
