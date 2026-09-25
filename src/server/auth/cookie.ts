/**
 * Oturum çerezi yardımcıları (T1.4 ADIM 1/2, S1.4; Secure bayrağı T1.2 ek
 * düzeltme ile güncellendi).
 *
 * Oturum çerezi kuralı: istemcide HttpOnly/Secure/SameSite=Lax, Path=/,
 * Domain'siz cookie. Token URL'e/localStorage'a yazılmaz.
 *
 * Secure bayrağı: APP_ORIGIN'in şemasından türetilir — `https:` ise Secure
 * eklenir, `http:` ise eklenmez; NODE_ENV'e BAKILMAZ (T1.2 ek düzeltme —
 * önceki sürüm `NODE_ENV === "production"` kullanıyordu, bu da E2E'nin
 * gerçek `.next/standalone/server.js`'i çalıştırmasını engelliyordu: o
 * çıktı kendi `server.js`'i içinde koşulsuz `NODE_ENV=production`
 * ayarlar — bkz. `../../../playwright.config.ts`). Üretimde APP_ORIGIN
 * https olduğundan Secure yine KESİNDİR; yerel/E2E http'de tarayıcı
 * çerezi kabul eder (RFC 6265 §4.1.2.5 — Secure çerez düz HTTP'de
 * SAKLANMAZ).
 *
 * Next'in `next/headers` `cookies()` API'si yalnız Next'in kendi istek
 * kapsamı (AsyncLocalStorage) içinde çalışır; görev tanımı route
 * handler'ların "doğrudan Request nesnesiyle" (Next'in istek kapsamı
 * OLMADAN) test edilmesini istediğinden, bu dosya `next/headers`
 * KULLANMAZ — `Cookie`/`Set-Cookie` header'larını düz Web API `Headers`
 * üzerinden elle okur/yazar. Bu, hem gerçek Next sunucusunda hem doğrudan
 * çağrılan test ortamında birebir aynı şekilde çalışır.
 */
import { resolveTrustedAppOrigin } from "./app-origin";

export const SESSION_COOKIE_NAME = "dolmus_session";

/**
 * Secure bayrağı APP_ORIGIN'in şemasından türetilir: `https:` → true,
 * `http:` → false. `appOrigin` parametresi yalnız TESTLER içindir
 * (`./app-origin.ts` `resolveTrustedAppOrigin(env)`in izlediği AYNI desen
 * — bkz. o dosyanın üst notu); üretim çağrıları argümansız çalışır ve bu
 * noktaya varan HER route handler zaten `./guard.ts` `requireWrite`/
 * `requireAnonymousWrite` üzerinden `resolveTrustedAppOrigin()`'i AYNI
 * istek içinde BAŞARIYLA çözmüş olduğundan, buradaki çağrı yalnız
 * önbellekten okur (süreç ömrü boyunca bir kez hesaplanır — bkz. o
 * dosyanın üst notu).
 */
export function isSecureCookieOrigin(
  appOrigin: string = resolveTrustedAppOrigin(),
): boolean {
  return new URL(appOrigin).protocol === "https:";
}

function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds: number; secure: boolean },
): string {
  const parts = [
    `${name}=${value}`,
    `Max-Age=${options.maxAgeSeconds}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Girişte (T1.2/T1.3) veya bu paketin testlerinde kullanılacak
 * `Set-Cookie` değeri. "Max-Age = kalan mutlak süre" — negatif çıkması
 * durumunda (ör. zaten geçmiş bir `expiresAt`) 0'a kırpılır; tarayıcı
 * Max-Age=0'ı "hemen sil" olarak yorumlar, bu da güvenli bir varsayılan
 * davranıştır.
 */
export function serializeSessionCookie(
  token: string,
  options: { expiresAt: Date; now: Date; appOrigin?: string },
): string {
  const remainingMs = options.expiresAt.getTime() - options.now.getTime();
  const maxAgeSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  return serializeCookie(SESSION_COOKIE_NAME, token, {
    maxAgeSeconds,
    secure: isSecureCookieOrigin(options.appOrigin),
  });
}

/**
 * POST /api/v1/auth/logout için çerezi siler. Değer boş, Max-Age=0; diğer
 * öznitelikler (Path/HttpOnly/SameSite/Secure) tarayıcının çerezi doğru
 * eşleştirip silmesi için orijinal çerezle AYNI olmalıdır.
 */
export function serializeLogoutCookie(appOrigin?: string): string {
  return serializeCookie(SESSION_COOKIE_NAME, "", {
    maxAgeSeconds: 0,
    secure: isSecureCookieOrigin(appOrigin),
  });
}

/**
 * Gelen `Request`'in `Cookie` header'ından ham oturum tokenını okur.
 * `dolmus_session` yoksa `null` döner (401 SESSION_MISSING route
 * handler'da üretilir — bu fonksiyon hata fırlatmaz, yalnız ayrıştırır).
 */
export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const name = trimmed.slice(0, eqIndex);
    if (name !== SESSION_COOKIE_NAME) {
      continue;
    }
    const rawValue = trimmed.slice(eqIndex + 1);
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}
