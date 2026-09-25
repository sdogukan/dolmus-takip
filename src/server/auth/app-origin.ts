/**
 * Güvenilir uygulama origin'i — T1.4 düzeltme turu 1, S1.4 AC7.
 *
 * KÖK NEDEN (denetim bulgusu, düzeltme turu 1 — "blocker"/"high"/"mimari"):
 * `guard.ts`'in ÖNCEKİ `selfOrigin()` uygulaması `new URL(request.url).origin`
 * kullanıyordu. Üretim topolojisinde (Next.js uygulaması yalnız
 * 127.0.0.1:3000'i dinler; Caddy dışarıya HTTPS sunar) bu asla doğru
 * DEĞİLDİR: Next'in KENDİSİ, Route Handler'a verdiği `Request.url`'i
 * istemcinin gerçekte gönderdiği `Host`/`Origin`'den DEĞİL, sunucunun kendi
 * dinleme adresinden üretir. Kanıt — bu repodaki `next@16.3.5` paketinin
 * KENDİ kaynağı:
 *
 *   - `node_modules/next/dist/server/next-server.js:1280` —
 *     `initUrl = this.fetchHostname && this.port
 *        ? \`${protocol}://${this.fetchHostname}:${this.port}${req.url}\`
 *        : (nextConfig.experimental.trustHostHeader
 *            ? \`https://${req.headers.host || 'localhost'}${req.url}\`
 *            : req.url)`
 *     — `trustHostHeader` bu projede (next.config.ts) AYARLANMAMIŞ, yani
 *     varsayılan `false`; `fetchHostname`/`port` HER ZAMAN doludur
 *     (`base-server.js:352`), bu yüzden İLK dal her zaman kullanılır.
 *   - `node_modules/next/dist/build/utils.js:1124-1125` — standalone
 *     `server.js` şablonu: `hostname = process.env.HOSTNAME || '0.0.0.0'`.
 *     Üretim topolojisi gereği systemd bunu `127.0.0.1` verecek şekilde
 *     başlatacaktır; sonuç Route Handler'daki `request.url`'in origin'i
 *     HER ZAMAN `http://127.0.0.1:<port>` olur — tarayıcının gerçekten
 *     gönderdiği (`https://<genel alan adı>`) Origin header'ıyla ASLA
 *     eşleşmez. Bu, gerçek `next build` + standalone çıktısı + curl ile
 *     doğrulandı (bu dosyanın ekleneceği düzeltme sonrası tekrar doğrulama
 *     için bkz. proje kökü düzeltme notları).
 *
 * DÜZELTME: "aynı kaynak" artık İSTEĞİN KENDİ `url`'İNDEN DEĞİL, açıkça
 * yapılandırılmış, önyükleme sırasında doğrulanan `APP_ORIGIN` ortam
 * değişkeninden hesaplanır — `../data/db.ts` `resolveDbPathFromEnv`'in
 * izlediği AYNI desen ("zorunlu env, sessiz varsayılan YOK, eksikse açık
 * hata"). Üretimde bu, Caddy'nin arkasındaki GERÇEK genel origin'e
 * (`https://<alan-adı>`) eşitlenir; yerel geliştirme/test için
 * `.env.example`'da `http://localhost:3000` örneklenir.
 *
 * Bu değer İSTEK BAŞINA DEĞİŞMEZ (süreç ömrü boyunca sabittir — tıpkı DB
 * yolu gibi); bu yüzden `../data/app-db.ts`'teki `getAppDb()` deseniyle
 * AYNI şekilde bir kez hesaplanıp önbelleğe alınır. `resetTrustedAppOrigin
 * ForTests()` yalnız testler içindir.
 */

let cachedOrigin: string | null = null;

export class InvalidAppOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAppOriginError";
  }
}

function parseAppOrigin(
  env: Record<string, string | undefined>,
): string {
  const value = env.APP_ORIGIN;
  if (!value || value.trim().length === 0) {
    throw new InvalidAppOriginError(
      'APP_ORIGIN ortam değişkeni tanımlı değil. Bkz. ".env.example". Bu ' +
        "değer, yazma isteklerinin \"aynı kaynak\" denetimi için Caddy'nin " +
        "arkasındaki GERÇEK genel origin'i (ör. \"https://dolmus-takip." +
        'ornek.com\") taşımalıdır; sunucunun kendi dinleme adresinden ' +
        "(127.0.0.1:3000) OTOMATİK türetilmez (bkz. bu dosyanın üst notu).",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidAppOriginError(
      `APP_ORIGIN geçerli bir mutlak URL değil: "${value}".`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidAppOriginError(
      `APP_ORIGIN yalnız http/https şeması olabilir: "${value}".`,
    );
  }
  // `URL#origin` yol/sorgu/hash'i ATAR — yalnız şema+host+port kalır; bu,
  // `Origin` header'ının tarayıcı tarafından üretilen biçimiyle BİREBİR
  // karşılaştırılabilir tek kanonik biçimdir.
  return parsed.origin;
}

/**
 * Güvenilir origin'i döner (önbellekten, ilk çağrıda hesaplanır). Eksik/
 * geçersiz `APP_ORIGIN` `InvalidAppOriginError` fırlatır; çağıran (`guard.ts`
 * `requireWrite`) bunu 503'e çevirir — bu, `assertMigrationsApplied`'ın DB
 * hazır değilken izlediği "açık hata, sessiz yanlış davranış yok" ilkesiyle
 * AYNIDIR.
 */
export function resolveTrustedAppOrigin(
  env: Record<string, string | undefined> = process.env,
): string {
  cachedOrigin ??= parseAppOrigin(env);
  return cachedOrigin;
}

/** Yalnız testler içindir — bkz. `../data/app-db.ts` `resetAppDbForTests`. */
export function resetTrustedAppOriginForTests(): void {
  cachedOrigin = null;
}
