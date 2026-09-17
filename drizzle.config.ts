import { defineConfig } from "drizzle-kit";

/**
 * `drizzle-kit generate` yapılandırması (ADIM 2/3, S1.1).
 *
 * Kaynak: TECH-STACK.md K9 — drizzle-kit 0.31.10. Görev tanımı: "dialect
 * sqlite, out ./drizzle" — `out` migration SQL dosyalarının commit'lenebilir
 * konumu, ARCHITECTURE.md §3'teki şemayı üreten kaynak `schema` bu paketin
 * tek dosyası `src/server/data/schema.ts`'tir.
 *
 * `dbCredentials.url` yalnız `drizzle-kit`'in TypeScript `Config` birleşimi
 * `dialect: "sqlite"` için zorunlu tuttuğu alandır (`node_modules/
 * drizzle-kit/index.d.ts`); bu proje `drizzle-kit push`/`studio` KULLANMAZ
 * (migration'lar `scripts/db-init.ts` içinde `drizzle-orm/better-sqlite3/
 * migrator`'ın `migrate()` fonksiyonuyla uygulanır, bkz. ARCHITECTURE.md
 * §8.1 — "İlk şema kurulumuna yalnız açık migration/kurulum komutu izin
 * verir"). Bu yüzden burada gerçek bir DB dosyasına ihtiyaç yoktur; yol,
 * `.env.example`'daki `DOLMUS_DB_PATH` ile tutarlı bir varsayılana düşer.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/data/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DOLMUS_DB_PATH ?? "./data/dev.sqlite",
  },
});
