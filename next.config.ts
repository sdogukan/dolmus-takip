import type { NextConfig } from "next";

/**
 * Alan adları `node_modules/next/dist/server/config-shared.d.ts` içindeki
 * NextConfig tipinden ve `node_modules/next/dist/lib/load-custom-routes.d.ts`
 * içindeki Header tipinden doğrulanmıştır (next@16.3.5).
 *
 * Content-Security-Policy BURADA YOK: statik/sabit bir `script-src 'self'`
 * değeri, Next'in her sayfada ürettiği satır içi RSC/hydration
 * script'lerini (`<script>(self.__next_f=...).push(...)</script>`, `src`
 * özniteliği yok) engeller — gerçek Chrome ile doğrulandı (audit bulgusu,
 * düzeltme turu 1): React hiç hydrate olmuyor, konsolda "Executing inline
 * script violates ... script-src 'self' ..." hatası çıkıyor. Doğru çözüm
 * Next'in kendi CSP rehberindeki nonce tabanlı yaklaşımdır ve nonce yalnız
 * istek başına üretilebildiğinden statik `headers()` yerine `src/proxy.ts`
 * içinde uygulanır (bkz. o dosyadaki ayrıntılı not). Buradaki diğer
 * header'lar isteğe özgü değildir, bu yüzden statik kalabilir.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // better-sqlite3 ve argon2 native dosyaları standalone çıktısına dahil
  // edilmeli; yayın makinesi bu dosyalar olmadan çalışamaz (F4 kararı).
  // T1.4 — `drizzle/**` (migration SQL + `meta/_journal.json`) da eklendi:
  // uygulama açılışı (`src/instrumentation.ts` → `server/data/app-db.ts`) bu
  // klasörü `assertMigrationsApplied` ile okur; olmadan standalone süreç
  // migration kapısını hiç geçemez.
  //
  // T6.1 — `node_modules/drizzle-orm/**` de eklendi: Next'in kendi webpack
  // tracer'ı yalnız GERÇEKTEN import edilen `drizzle-orm` alt yollarını
  // (ör. `drizzle-orm/better-sqlite3`, uygulama route'larının kullandığı)
  // standalone'a taşır — `drizzle-orm/better-sqlite3/migrator` (yalnız
  // `scripts/db-init.ts` kullanır, hiçbir Next route'u değil) bu yüzden
  // KANITLANDI şekilde standalone `node_modules`'ta YOKTU (`next build`
  // sonrası `find .next/standalone/node_modules/drizzle-orm` sıfır sonuç
  // verdi). T6.1'in yayın çıktısı (`scripts/release-build.ts`) standalone
  // içine `scripts/db-init.ts` + `src/server/data/{db,schema}.ts`
  // KENDİSİNİ de kopyalar (hedef makinede açık migration komutu
  // çalıştırılabilsin diye) — o script'in `drizzle-orm` bağımlılığı da
  // aynı standalone `node_modules` kökünden çözülür; ayrı bir kopyalama
  // adımına gerek KALMAMASI için paket bütünüyle burada eklendi (paketin
  // kendi `package.json`'ında runtime `dependencies` alanı YOK — yalnız
  // opsiyonel peer bağımlılıklar; ekstra native/ağır alt paket taşımaz).
  outputFileTracingIncludes: {
    "/api/**/*": [
      "node_modules/better-sqlite3/build/**",
      "node_modules/better-sqlite3/prebuilds/**",
      "node_modules/argon2/prebuilds/**",
      "node_modules/argon2/lib/**",
      "node_modules/drizzle-orm/**",
      "drizzle/**",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
