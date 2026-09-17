/**
 * Oturum çerezi yardımcıları (T1.4 ADIM 1/2, S1.4).
 *
 * Kaynak — ARCHITECTURE.md §6 "Oturum" satırı (birebir): "...istemcide
 * HttpOnly/Secure/SameSite=Lax, Path=/, Domain'siz cookie. Token URL/
 * localStorage'a yazılmaz." Görev tanımı: "ad dolmus_session; HttpOnly;
 * Secure (NODE_ENV production'da zorunlu, geçerli dev'de HTTP için kapalı
 * ama testte her iki mod doğrulanır); SameSite=Lax; Path=/; Domain yok;
 * Max-Age = kalan mutlak süre."
 *
 * Next'in `next/headers` `cookies()` API'si yalnız Next'in kendi istek
 * kapsamı (AsyncLocalStorage) içinde çalışır; görev tanımı route
 * handler'ların "doğrudan Request nesnesiyle" (Next'in istek kapsamı
 * OLMADAN) test edilmesini istediğinden, bu dosya `next/headers`
 * KULLANMAZ — `Cookie`/`Set-Cookie` header'larını düz Web API `Headers`
 * üzerinden elle okur/yazar. Bu, hem gerçek Next sunucusunda hem doğrudan
 * çağrılan test ortamında birebir aynı şekilde çalışır.
 */

export const SESSION_COOKIE_NAME = "dolmus_session";

export interface CookieEnv {
  NODE_ENV?: string;
}

/**
 * "Secure (NODE_ENV production'da zorunlu, geçerli dev'de HTTP için
 * kapalı ama testte her iki mod doğrulanır)" — `env` parametresi yalnız
 * testlerin gerçek `process.env`'i değiştirmeden iki modu da
 * sınayabilmesi içindir (bkz. `../data/db.ts` `resolveDbPathFromEnv` aynı
 * desen); üretim çağrıları varsayılan `process.env` ile çalışır.
 */
export function isSecureCookieEnv(env: CookieEnv = process.env): boolean {
  return env.NODE_ENV === "production";
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
 * Girişte (T1.2/T1.3, bu paketin kapsamı dışında) veya bu paketin
 * testlerinde kullanılacak `Set-Cookie` değeri. "Max-Age = kalan mutlak
 * süre" — negatif çıkması durumunda (ör. zaten geçmiş bir `expiresAt`)
 * 0'a kırpılır; tarayıcı Max-Age=0'ı "hemen sil" olarak yorumlar, bu da
 * güvenli bir varsayılan davranıştır.
 */
export function serializeSessionCookie(
  token: string,
  options: { expiresAt: Date; now: Date; env?: CookieEnv },
): string {
  const remainingMs = options.expiresAt.getTime() - options.now.getTime();
  const maxAgeSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  return serializeCookie(SESSION_COOKIE_NAME, token, {
    maxAgeSeconds,
    secure: isSecureCookieEnv(options.env),
  });
}

/**
 * POST /api/v1/auth/logout için çerezi siler. Değer boş, Max-Age=0; diğer
 * öznitelikler (Path/HttpOnly/SameSite/Secure) tarayıcının çerezi doğru
 * eşleştirip silmesi için orijinal çerezle AYNI olmalıdır.
 */
export function serializeLogoutCookie(env?: CookieEnv): string {
  return serializeCookie(SESSION_COOKIE_NAME, "", {
    maxAgeSeconds: 0,
    secure: isSecureCookieEnv(env),
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
