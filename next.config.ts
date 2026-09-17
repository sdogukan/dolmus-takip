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
  // ARCHITECTURE.md §2/§8 — better-sqlite3 ve argon2 native dosyaları
  // standalone çıktısına dahil edilmeli; yayın makinesi bu dosyalar
  // olmadan çalışamaz (F4 kararı, DECISIONS.md). T1.4 — `drizzle/**`
  // (migration SQL + `meta/_journal.json`) da eklendi: uygulama açılışı
  // (`src/instrumentation.ts` → `server/data/app-db.ts`) bu klasörü
  // `assertMigrationsApplied` ile okur; olmadan standalone süreç migration
  // kapısını hiç geçemez.
  outputFileTracingIncludes: {
    "/api/**/*": [
      "node_modules/better-sqlite3/build/**",
      "node_modules/better-sqlite3/prebuilds/**",
      "node_modules/argon2/prebuilds/**",
      "node_modules/argon2/lib/**",
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
