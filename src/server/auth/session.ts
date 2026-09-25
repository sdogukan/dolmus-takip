/**
 * Oturum tokenı üretimi, özetleme ve süre/eşik sabitleri (T1.4 ADIM 1/2,
 * S1.4). Bu dosya saf kriptografi/sabit yardımcılardır; DB erişimi yoktur
 * (bkz. `../usecases/session/*`).
 *
 * Oturum kuralı: Node kriptografik rastgele üretimle 32 bayt token; DB'de
 * SHA-256 özeti, istemcide HttpOnly/Secure/SameSite=Lax, Path=/, Domain'siz
 * cookie. Token URL/localStorage'a yazılmaz. Oturum süresi kuralı:
 * başlangıçta araç oturumu en fazla 30 gün, 7 gün hareketsizlik; ekip en
 * fazla 12 saat, 30 dk hareketsizlik. last_seen yazımı aralıklı yapılır;
 * her rapor okuması DB yazmasına dönüşmez.
 */
import crypto from "node:crypto";

/**
 * Saat enjeksiyonu — görev tanımı: "Saat enjekte edilebilir (clock
 * parametresi) ve zaman kontrollü testlerle doğrulanır." Üretim kodu
 * `systemClock`'u varsayılan parametre olarak kullanır; testler sabit bir
 * `Date` döndüren kendi `Clock`'unu geçer.
 */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

// ---------------------------------------------------------------------------
// Süre/eşik sabitleri — oturum süresi kuralının birebir sayısal
// karşılıkları (milisaniye). "En fazla" ifadesi ve dönem sınırlarının kendi
// kuralı olan "[başlangıç, sonraki başlangıcın başlangıcı)" yarı-açık
// aralık kuralına göre, bu sınırların TAM ÜZERİNDEKİ an (>=) artık geçersiz
// sayılır (bkz. `../usecases/session/resolve-session.ts` üstündeki not) —
// bu, oturum süresi için açıkça yazılmış bir kural değil, dönem sınırı
// kuralından örnekseme yoluyla alınan bir mühendislik kararıdır.
// "open_issues" diye bir dosya/bölüm YOKTUR (denetim bulgusu, düzeltme turu
// 2); bu karar başka bir yerde AYRICA kayıtlı değildir — yalnız burada
// belgelenir.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Araç oturumu mutlak sınırı: "en fazla 30 gün". */
export const VEHICLE_SESSION_ABSOLUTE_MS = 30 * DAY_MS;
/** Araç oturumu hareketsizlik sınırı: "7 gün hareketsizlik". */
export const VEHICLE_SESSION_INACTIVITY_MS = 7 * DAY_MS;
/** Ekip (platform) oturumu mutlak sınırı: "en fazla 12 saat". */
export const PLATFORM_SESSION_ABSOLUTE_MS = 12 * HOUR_MS;
/** Ekip (platform) oturumu hareketsizlik sınırı: "30 dk hareketsizlik". */
export const PLATFORM_SESSION_INACTIVITY_MS = 30 * MINUTE_MS;

/**
 * "last_seen yazımı aralıklı yapılır; her rapor okuması DB yazmasına
 * dönüşmez." — görev tanımındaki somut örnek: "son yazmadan 5 dk geçmeden
 * tekrar yazılmaz." Bu 5 dk değeri burada seçildi; görev tanımının
 * verdiği somut eşiktir.
 */
export const SESSION_LAST_SEEN_WRITE_INTERVAL_MS = 5 * MINUTE_MS;

// ---------------------------------------------------------------------------
// Token üretimi/özetleme.
// ---------------------------------------------------------------------------

/**
 * Ham oturum tokenı — "Node kriptografik rastgele üretimle 32 bayt token".
 * Yalnız bu değer istemciye (HttpOnly cookie) verilir; DB'ye ASLA
 * düz yazılmaz, yalnız `hashSessionToken` çıktısı yazılır.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * "DB'de SHA-256 özeti". SHA-256 yalnız bu yüksek rastgelelikli oturum
 * tokenı için kullanılır; parola için ASLA kullanılmaz (parola Argon2id ile
 * ayrı saklanır).
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * `sessions.id` için uygulama tarafında üretilen UUID (kimlikler
 * uygulamada üretilen UUID'lerdir).
 */
export function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * CSRF tokenı — yazma istekleri için aynı origin + oturuma bağlı CSRF
 * token kontrolü yapılır. Bu tokenın nasıl üretileceği burada seçildi
 * (açık nokta — başka bir yerde AYRICA kayıtlı DEĞİLDİR, denetim bulgusu
 * düzeltme turu 2); seçilen yöntem, ek bir DB sütunu GEREKTİRMEYEN,
 * standart "oturuma bağlı türetilmiş CSRF tokenı" tekniğidir (OWASP CSRF Cheat Sheet'in "HMAC Based
 * Token Pattern" ailesiyle aynı ilke): ham oturum tokenının kendisi zaten
 * yüksek entropili ve yalnız (a) istemcinin HttpOnly çerezinde, (b) sunucuda
 * geçici olarak (yalnız çözümleme anında, DB'ye yazılmadan) bulunan bir
 * sırdır. CSRF tokenı bu sırdan SHA-256 ile türetilir ve GET /session yanıt
 * gövdesiyle istemciye (çereze DEĞİL) verilir; saldırgan sitesi çapraz
 * kaynaklı isteğiyle bu yanıtı OKUYAMAYACAĞINDAN (aynı-kaynak politikası)
 * doğru CSRF değerini asla öğrenemez. DB'de ayrı bir csrf_token sütunu
 * TUTULMAZ (sessions tablosunun kolon listesi buna izin vermiyor);
 * değer her istekte aynı ham tokendan yeniden hesaplanır.
 *
 * NOT: Bu ADIM'da yalnız üretim/döndürme vardır; yazma isteklerinde bu
 * değerin DOĞRULANMASI (origin kontrolüyle birlikte) T1.4 iş adımı
 * 3'e (ADIM 2/2) bırakılmıştır — bkz. proje köküdeki görev kapsamı notu.
 */
export function deriveCsrfToken(rawToken: string): string {
  return crypto
    .createHash("sha256")
    .update(`${rawToken}:csrf:v1`)
    .digest("base64url");
}
