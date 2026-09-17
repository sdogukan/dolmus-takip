import { NextResponse, type NextRequest } from "next/server";

/**
 * CSP nonce üretimi (S1.1 düzeltme turu 1 — audit bulgusu).
 *
 * Next.js App Router her sayfada RSC/hydration verisini
 * `<script>(self.__next_f=...).push(...)</script>` biçiminde satır içi
 * (inline, `src` özniteliği yok) enjekte eder — bkz.
 * `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`
 * "Nonces" bölümü. `next.config.ts`'teki `script-src 'self'` tek başına bu
 * satır içi script'i bloklar (`unsafe-inline`/nonce/hash yoksa); gerçek
 * Chrome ile doğrulandı: `NODE_ENV=production` derlemesinde konsolda
 * "Executing inline script violates ... script-src 'self' ..." hatası ve
 * ardından "Uncaught (in promise)" çıkıyor, React hiç hydrate olmuyor.
 *
 * Next'in kendi önerisi düz `unsafe-inline` DEĞİL, nonce tabanlı CSP'dir:
 * bu dosya her istekte rastgele bir nonce üretir, hem isteğe (Next'in
 * render sırasında kendi framework/sayfa script ve style etiketlerine
 * otomatik nonce eklemesi için) hem yanıta (tarayıcının politikayı
 * doğrulaması için) aynı `Content-Security-Policy` header'ını yazar.
 * Deneysel `experimental.sri` (hash tabanlı, statik render'ı koruyan
 * alternatif) AYRI BİR MEKANİZMADIR ve yalnız `<script src=...>` gibi dış
 * dosyalara `integrity` ekler; yukarıdaki satır içi RSC payload script'ini
 * KAPSAMAZ — yerel derlemede denenip doğrulandı (SRI açıkken de aynı CSP
 * ihlali sürüyor). Bu yüzden nonce + zorunlu dynamic render (bkz.
 * `src/app/layout.tsx` `connection()` çağrısı) seçildi.
 *
 * `middleware.ts` dosya kuralı Next 16'da deprecated, yerine `proxy.ts`
 * geldi (bkz. `node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/middleware.md` — "middleware.js dosya kuralı ...
 * deprecated ... renamed to proxy.js"); bu yüzden burada `middleware.ts`
 * değil `proxy.ts` kullanılıyor. `NextRequest`/`NextResponse` tipleri ve
 * `NextResponse.next({ request: { headers } })` imzası
 * `node_modules/next/dist/server/web/spec-extension/response.d.ts` ve
 * `next/server` public export'larından doğrulandı.
 *
 * Bu dosya kimlik doğrulama/oturum/yetki mantığı İÇERMEZ (T1.4/T1.5'te
 * ayrı eklenecek); yalnız güvenlik header'ı üretir.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const cspHeader = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      isDev ? " 'unsafe-eval'" : ""
    }`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  // Düzeltme turu 3 — audit bulgusu (guvenlik/düşük): Next'in resmi CSP
  // nonce örneği (yukarıdaki dosya üstü nottaki
  // `content-security-policy.md` "Nonces" bölümü) nonce'u hem CSP
  // header'ına hem ayrı bir `x-nonce` istek header'ına yazar; ikincisi
  // Server Component'lerin `(await headers()).get('x-nonce')` ile nonce'u
  // okuyup ör. üçüncü taraf `<Script nonce=...>` etiketine geçirebilmesi
  // içindir. Bugün böyle bir Server Component yok; ama bu satır olmadan
  // ileride nonce okuma ihtiyacı doğduğunda kimse bu boşluğu fark etmeyip
  // "unsafe-inline" gibi bir kısayola yönelmesin diye örnekle birebir
  // eklendi.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", cspHeader);
  return response;
}

// _next/static ve _next/image zaten içerik hash'iyle adreslenen/cache'lenen
// statik varlıklardır; CSP nonce'u yalnız render edilen belgeler için
// anlamlıdır (bkz. proxy.md "Matcher" — Next'in kendi negative-match
// önerisi). API rotaları JSON döndürse de aynı güvenlik header setini
// alması için matcher dışında bırakılmaz.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
