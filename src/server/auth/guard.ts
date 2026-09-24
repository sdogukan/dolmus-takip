/**
 * Merkezi denetim katmanı — T1.4 ADIM 2/2, S1.4, görev tanımı (a)/(b).
 *
 * (a) "requireSession(request, clock) → SessionContext ya da 401 hata
 * nesnesi; tüm route handler'lar bunu kullanır." ADIM 1/2'de GET /session
 * ve POST /auth/logout, "token oku → getAppDb() → resolveSession → hata
 * türüne göre 401/503" akışını KENDİ İÇİNDE tekrarlıyordu (bkz. o iki route
 * handler'ın ADIM 1/2 sürümü). Bu modül o TEK ortak akışı buraya taşır;
 * `requireSession` yalnız "401" DEMEZ, DB henüz migration bekliyorsa
 * (`PendingMigrationsError` vb., ADIM 1/2'de zaten 503'e çevrilen durum)
 * bunu da kapsar — aksi halde "merkezi" iddiası her route handler'ın yine
 * kendi DB-hazır-değil dalını AYRI AYRI yazmasını gerektirirdi. Bu, görev
 * tanımının "401 hata nesnesi" ifadesinin BİREBİR yazmadığı ama "tüm route
 * handler'lar bunu kullanır" amacına dayanan bir mühendislik kararıdır. Bu
 * karar başka hiçbir yere (ör. "open_issues" diye bir dosya/bölüm yoktur —
 * denetim bulgusu, düzeltme turu 2) AYRICA KAYDEDİLMEMİŞTİR; yalnız bu
 * yorumda belgelenir. docs/DECISIONS.md'de T1.1'inkine benzer bir "T1.4
 * uygulama kararları" bölümü ürün sahibi tarafından istenirse eklenebilir.
 *
 * (b) "requireWrite(request) yardımcısı [origin/Sec-Fetch-Site, CSRF token,
 * Content-Type, gövde boyutu] birleştirir; logout dahil tüm yazma uçları
 * kullanır." `requireWrite` önce `requireSession`'ı çağırır (CSRF tokenı
 * `SessionContext.csrfToken`'a bağlı olduğundan — ARCHITECTURE §6 "CSRF" —
 * geçerli bir oturum olmadan karşılaştırılacak bir değer yoktur), sonra
 * sırasıyla origin/Sec-Fetch-Site (403), CSRF header (403), Content-Type
 * (415), gövde boyutu (413) denetler.
 *
 * DAVRANIŞ DEĞİŞİKLİĞİ (açık karar — docs/DECISIONS.md'de AYRICA kayıtlı
 * DEĞİLDİR, bkz. dosya üstündeki ilk not; denetim bulgusu, düzeltme turu 2):
 * ADIM 1/2'nin
 * POST /auth/logout'u KASITLI olarak "idempotent" tasarlanmıştı (token
 * eksik/geçersiz/süresi dolmuş olsa da 200) ve bu, o dosyanın kendi üst
 * notunda "STORIES.md S1.4'te açıkça yazılmamış bir tasarım kararı" olarak
 * işaretlenmişti. Bu ADIM'ın "logout dahil tüm yazma uçları [requireWrite]
 * kullanır" talimatı MUTLAK ise (özel durum/istisna TANIMLANMADAN), logout
 * artık DİĞER her yazma ucu gibi ÖNCE geçerli bir oturum ister — token
 * eksik/geçersiz/süresi dolmuşsa 401 döner (200 DEĞİL). STORIES.md S1.4'ün
 * 7 kabul kriterinden HİÇBİRİ "logout'un tokensız da 200 dönmesini"
 * ZORUNLU KILMAZ; bu yüzden bu, dokümanla ÇELİŞEN değil, ADIM 1/2'nin
 * kendi kendine koyduğu (ve kendi içinde "açık nokta" işaretlediği) bir
 * tasarım tercihinin bu ADIM'ın merkezi-denetim gereğiyle DEĞİŞTİRİLMESİDİR.
 *
 * DÜZELTME TURU 1 (denetim bulguları — kanıt için ayrıntılar ilgili
 * fonksiyonların üst notlarında):
 * - "aynı kaynak" artık `request.url`'den DEĞİL, açıkça yapılandırılmış
 *   `APP_ORIGIN`'den (bkz. `./app-origin.ts`) hesaplanır — ARCHITECTURE §2
 *   üretim topolojisinde (Next yalnız 127.0.0.1:3000, Caddy arkasında)
 *   `request.url` istemcinin gerçek Origin'ini ASLA yansıtmaz; bu, gerçek
 *   `next@16.3.5` next-server.js/build-utils.js kaynağıyla ve gerçek
 *   `next build` + standalone + gerçek HTTP isteğiyle doğrulandı.
 * - CSRF karşılaştırması `crypto.timingSafeEqual` ile sabit-zamanlıdır.
 * - Gövde boyutu sınırı artık AKIŞ (stream) üzerinden, sınır aşılır aşılmaz
 *   iptal edilerek denetlenir; `request.arrayBuffer()` ile TÜMÜNÜ önce
 *   belleğe okuma kaldırıldı.
 */
import crypto from "node:crypto";
import { getAppDb } from "../data/app-db";
import {
  extractTransientSqliteLockError,
  MissingDatabaseFileError,
  PendingMigrationsError,
  UninitializedDatabaseError,
  UnsupportedSqliteVersionError,
  type AppDatabase,
} from "../data/db";
import { generateRequestId, jsonErrorResponse } from "../http/errors";
import { SessionError } from "../usecases/session/errors";
import { resolveSession } from "../usecases/session/resolve-session";
import type { SessionContext } from "../usecases/session/types";
import { InvalidAppOriginError, resolveTrustedAppOrigin } from "./app-origin";
import { readSessionToken } from "./cookie";
import { systemClock, type Clock } from "./session";

/** `requireSession`/`requireWrite` başarısız olduğunda döndürülecek hazır
 * `Response` — route handler bunu OLDUĞU GİBİ döner (kendi hata gövdesini
 * ÜRETMEZ; ARCHITECTURE §4 hata sözleşmesi TEK yerde uygulanır). */
export interface GuardFailure {
  ok: false;
  response: Response;
}

export interface RequireSessionSuccess {
  ok: true;
  context: SessionContext;
  /**
   * DÜZELTME (T1.5 ADIM 2/2 — `../http/handler.ts` `withProtectedRoute`
   * ile bütünleşme): önceki tip `BetterSQLite3Database<Schema>` (dar,
   * `$client` OLMADAN) idi. `getAppDb()`'nin GERÇEK dönüş değeri zaten her
   * zaman `AppDatabase` (`$client` alanını İÇEREN geniş tip, bkz. `../data/
   * app-db.ts` üst notu) olduğundan bu bir DAVRANIŞ değişikliği DEĞİLDİR —
   * yalnız TİPİ, ZATEN taşınan değere UYDURUR. `../http/handler.ts`'in
   * `resolveStaffVehicleScopeFromHeader`/`resolveAdminScope`'u (`../auth/
   * scope.ts`, `db: AppDatabase` ister) bu `db`'YE UYGULAMASI GEREKTİĞİNDE
   * ortaya çıkan gerçek bir tip uyuşmazlığı düzeltilmiştir (kanıt: bu alan
   * dar tutulduğunda `npm run typecheck` `$client alanı eksik` hatası
   * verir — bkz. bu ADIM'ın open_issues'ı).
   */
  db: AppDatabase;
  /** Ham (özetlenmemiş) oturum tokenı. Route handler'lar bunu ASLA loglamaz
   * veya yanıt gövdesine yazmaz; yalnız `requireWrite`'ın kendi içindeki
   * CSRF karşılaştırması (`context.csrfToken`, zaten bu tokendan türetilmiş
   * bir özet — bkz. `./session.ts` `deriveCsrfToken`) ve olası ileri
   * kullanım durumları (ör. token'a bağlı ek denetim) için taşınır. */
  token: string;
  /** Bu isteğin izleme kimliği — hem hata hem başarı yanıtında AYNI değer
   * kullanılsın diye burada üretilip route handler'a geri verilir. */
  requestId: string;
}

export type RequireSessionResult = RequireSessionSuccess | GuardFailure;

/**
 * Yalnızca `error.message`'ı SUNUCU LOGUNA yazar (istemciye ASLA); bu
 * yüzden imza kasıtlı olarak GENİŞ `Error`'dır. DÜZELTME TURU 2 (denetim
 * bulgusu, "high"): bu, artık üç DB-hazır-değil sınıfının yanı sıra
 * `../data/db.ts` `extractTransientSqliteLockError`'ın çıkardığı canlı
 * `SqliteError` (SQLITE_BUSY/SQLITE_LOCKED) için de çağrılır — ikisi de
 * aynı "sunucu şu an hazır değil, az sonra tekrar dene" 503 zarfını
 * hak eder (ARCHITECTURE §3.6/§4).
 */
function dbUnavailableFailure(requestId: string, error: Error): GuardFailure {
  // ARCHITECTURE §4 — "geçici DB kilidi/hazır olmama 503". Ayrıntı (dosya
  // yolu/migration sayısı/SQL hata mesajı vb.) istemciye DÖNMEZ; yalnız
  // sunucu tarafında loglanır (bkz. ADIM 1/2'nin aynı davranışı, artık
  // burada tek yerde).
  console.error(
    `[guard] veritabanı hazır değil (request_id=${requestId}): ${error.message}`,
  );
  return {
    ok: false,
    response: jsonErrorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      "Sunucu şu anda hazır değil. Az sonra tekrar deneyin.",
      { requestId },
    ),
  };
}

/**
 * "requireSession(request, clock) → SessionContext ya da 401 hata nesnesi."
 * `clock` yalnız ZAMAN KONTROLLÜ testler için vardır (varsayılan
 * `systemClock`); üretim çağrıları hiçbir zaman geçirmez.
 */
export async function requireSession(
  request: Request,
  clock: Clock = systemClock,
): Promise<RequireSessionResult> {
  const requestId = generateRequestId();
  const token = readSessionToken(request);
  if (!token) {
    return {
      ok: false,
      response: jsonErrorResponse(
        401,
        "SESSION_MISSING",
        "Oturum bulunamadı. Giriş yap.",
        { requestId },
      ),
    };
  }

  try {
    const db = getAppDb();
    const context = await resolveSession(db, token, clock);
    return { ok: true, context, db, token, requestId };
  } catch (error) {
    if (error instanceof SessionError) {
      return {
        ok: false,
        response: jsonErrorResponse(401, error.code, error.message, {
          requestId,
        }),
      };
    }
    if (
      error instanceof PendingMigrationsError ||
      error instanceof MissingDatabaseFileError ||
      error instanceof UninitializedDatabaseError ||
      error instanceof UnsupportedSqliteVersionError
    ) {
      return dbUnavailableFailure(requestId, error);
    }
    // DÜZELTME TURU 2 (denetim bulgusu, "high", `guvenlik` merceği): canlı
    // bir SQLITE_BUSY/SQLITE_LOCKED (`resolveSession`'ın SELECT'i veya
    // last_seen_at UPDATE'i sırasında, ör. eşzamanlı bir BEGIN IMMEDIATE
    // kilidi busy_timeout'u [2000 ms] aşarsa) daha önce hiçbir sınıfa
    // uymadığından burada `throw error` ile dışarı SIZIYOR ve Next'in genel
    // 500'üne düşüyordu — ARCHITECTURE §3.6/§4'ün istediği 503 zarfı YOKTU.
    // Kanıt ve ayrıntı için `../data/db.ts` `extractTransientSqliteLockError`
    // üst notuna bakın.
    const lockError = extractTransientSqliteLockError(error);
    if (lockError) {
      return dbUnavailableFailure(requestId, lockError);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// requireWrite — CSRF/origin/Content-Type/gövde boyutu (görev tanımı (b)).
// ---------------------------------------------------------------------------

/**
 * "gövde boyutu sınırı (örn. 64 KB → 413)" — görev tanımının verdiği örnek
 * değer. ARCHITECTURE bu sayıyı kendisi vermez (Caddy'nin kendi istek
 * boyutu sınırı §2'de anılır ama sayısı burada değildir); bu, uygulama
 * katmanının EK bir savunma-derinliği sınırıdır. Bu sayı docs/DECISIONS.md'de
 * AYRICA kayıtlı DEĞİLDİR (denetim bulgusu, düzeltme turu 2) — yalnız bu
 * yorumda gerekçelendirilmiştir.
 */
export const MAX_WRITE_BODY_BYTES = 64 * 1024;

/**
 * "Origin veya Sec-Fetch-Site kontrolü (same-origin değilse 403)." Modern
 * tarayıcılar POST/PATCH/PUT/DELETE fetch/XHR isteklerinde bu iki header'dan
 * EN AZ birini her zaman gönderir (Fetch standardı — bkz. MDN "Origin
 * header" ve "Sec-Fetch-Site header"); `Sec-Fetch-Site` VARSA öncelikli
 * kabul edilir (tarayıcının KENDİSİNİN ürettiği, sahteciliği DAHA ZOR bir
 * sinyaldir — ARCHITECTURE §6 "SameSite tek başına kontrol değildir" aynı
 * savunma-derinliği ilkesine dayanır). İkisi de YOKSA reddedilir (güvenli
 * varsayım).
 *
 * DÜZELTME (denetim bulgusu, düzeltme turu 1): Origin-header yedek yolu
 * `trustedOrigin` (bkz. `./app-origin.ts`) ile karşılaştırır — İSTEĞİN
 * KENDİ `request.url`'İYLE DEĞİL. Önceki sürüm `new URL(request.url).origin`
 * kullanıyordu; ARCHITECTURE §2 üretim topolojisinde ("Next.js ... Yalnız
 * 127.0.0.1:3000") Next'in KENDİSİ Route Handler'a verdiği `request.url`'i
 * istemcinin gerçek Host/Origin'inden değil sunucunun kendi dinleme
 * adresinden üretir (`./app-origin.ts` üst notundaki next-server.js/
 * build/utils.js kanıtına bakın) — bu yüzden `request.url` GÜVENİLMEZ bir
 * kaynaktır; her zaman AÇIKÇA yapılandırılmış `APP_ORIGIN`
 * kullanılmalıdır.
 */
function isSameOriginWriteRequest(
  request: Request,
  trustedOrigin: string,
): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null) {
    return secFetchSite === "same-origin";
  }
  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      return new URL(origin).origin === trustedOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * "oturuma bağlı CSRF token ... GET /api/v1/session ile verilir; X-CSRF-
 * Token header'ında beklenir, uyuşmazsa 403." `context.csrfToken`
 * `deriveCsrfToken(rawToken)`'dan gelir (bkz. `./session.ts` üst notu —
 * HMAC/SHA-256 türetme gerekçesi orada belgelenir).
 *
 * Karşılaştırma `crypto.timingSafeEqual` iledir (denetim bulgusu, düzeltme
 * turu 1 — "CSRF token karşılaştırması sabit-zamanlı değil"): JS'in `===`
 * dize karşılaştırması ilk uyuşmayan baytta kısa devre yapar, bu da teorik
 * bir zamanlama yan-kanalı bırakır. `timingSafeEqual` EŞİT UZUNLUKTA
 * `Buffer` ister; uzunluk farkı zaten eşleşmediğini gösterir ama ERKEN
 * DÖNMEMEK için (uzunluk karşılaştırmasının kendisi de bir zamanlama sinyali
 * taşıyabilir) sabit boyutlu bir "dummy" tokenla KARŞILAŞTIRMA HER ZAMAN
 * ÇALIŞTIRILIR; sonuç yalnız uzunluklar da eşitse anlamlıdır.
 */
function csrfTokenMatches(request: Request, context: SessionContext): boolean {
  const header = request.headers.get("x-csrf-token");
  if (header === null) {
    return false;
  }
  const expected = Buffer.from(context.csrfToken, "utf8");
  const actual = Buffer.from(header, "utf8");
  if (actual.length !== expected.length) {
    // Uzunluk eşit değilken `timingSafeEqual` fırlatır; yine de SABİT bir
    // karşılaştırma çalıştırıp erken dönüşü engelliyoruz (yukarıdaki not).
    crypto.timingSafeEqual(expected, expected);
    return false;
  }
  return crypto.timingSafeEqual(expected, actual);
}

/** "Content-Type: application/json zorunluluğu (415)." `charset` gibi
 * parametreler yok sayılır (`; charset=utf-8` dahil kabul edilir); yalnız
 * medya türü karşılaştırılır. */
function hasJsonContentType(request: Request): boolean {
  const raw = request.headers.get("content-type");
  if (!raw) {
    return false;
  }
  const mediaType = raw.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Gövdeyi EN FAZLA `maxBytes` sınırına kadar akış (stream) olarak okur —
 * denetim bulgusu (düzeltme turu 1, "medium"): önceki uygulama
 * `request.arrayBuffer()` ile gövdenin TAMAMINI belleğe okuduktan SONRA
 * boyutu denetliyordu; bu, 413 dönmeden ÖNCE isteyerek büyük (yüz MB'lık)
 * bir gövdenin sunucu belleğine tam olarak okunmasına izin veriyordu
 * (savunma-derinliği sınırının kendisi etkisizdi).
 *
 * Bu sürüm `ReadableStream`'i (`request.body`) parça parça okur; TOPLAM
 * boyut `maxBytes`'ı AŞAR AŞMAZ akış İPTAL EDİLİR (`reader.cancel()`) ve
 * gövdenin geri kalanı hiç okunmadan/beklemeden 413 dönülür — en kötü
 * durumda bellekte tutulan veri `maxBytes + son parçanın boyutu` ile
 * sınırlıdır, gövdenin TAMAMI değil.
 */
async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  // Content-Length VARSA ve sınırı aşıyorsa, hiçbir bayt okumadan reddet.
  // (Bu yalnız bir HIZLI YOL'dur — header istemci tarafından yanlış/eksik
  // verilebileceğinden [ör. chunked transfer], TEK savunma bu değildir;
  // asıl sınır aşağıdaki akış sayacıdır.)
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const declared = Number(declaredLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      try {
        await request.body?.cancel();
      } catch {
        // En iyi çaba — reddetme kararını etkilemez.
      }
      return { ok: false };
    }
  }

  if (request.body === null) {
    return { ok: true, text: "" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // En iyi çaba — reddetme kararını etkilemez.
      }
      return { ok: false };
    }
    chunks.push(value);
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8").decode(buffer) };
}

export interface RequireWriteSuccess extends RequireSessionSuccess {
  /**
   * İstek gövdesi BURADA (boyut denetimi için) zaten TÜKETİLMİŞTİR — Web
   * `Request` gövdesi yalnız BİR KEZ okunabildiğinden, route handler ARTIK
   * `request.json()`/`request.text()` ÇAĞIRAMAZ; JSON'u bu metinden kendisi
   * ayrıştırır (`JSON.parse(bodyText)`). Boş gövdeli yazmalarda (ör.
   * logout) boş dize (`""`) döner.
   */
  bodyText: string;
}

export type RequireWriteResult = RequireWriteSuccess | GuardFailure;

/**
 * "requireWrite(request) yardımcısı bunları birleştirir; logout dahil tüm
 * yazma uçları kullanır." Sıra: (1) geçerli oturum — CSRF karşılaştırması
 * için gerekli — (2) origin/Sec-Fetch-Site (3) CSRF header (4) Content-Type
 * (5) gövde boyutu. Herhangi bir adım BAŞARISIZSA, sonraki adımlar HİÇ
 * ÇALIŞMAZ ve hiçbir DB yazması olmamış olur (S1.4 AC7 — "Geçersiz kaynak/
 * tokenla yazma isteği veri DEĞİŞTİRMEZ").
 */
export async function requireWrite(
  request: Request,
  clock: Clock = systemClock,
): Promise<RequireWriteResult> {
  const sessionResult = await requireSession(request, clock);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  const { context, requestId } = sessionResult;

  let trustedOrigin: string;
  try {
    trustedOrigin = resolveTrustedAppOrigin();
  } catch (error) {
    if (error instanceof InvalidAppOriginError) {
      // Yapılandırma hatası — istemcinin değil, dağıtımın sorunu. DB henüz
      // hazır değilken izlenen aynı "açık hata, 503" ilkesi (bkz.
      // `dbUnavailableFailure`): istemciye ayrıntı SIZDIRILMAZ, yalnız
      // sunucu tarafında loglanır.
      console.error(
        `[guard] APP_ORIGIN yapılandırma hatası (request_id=${requestId}): ${error.message}`,
      );
      return {
        ok: false,
        response: jsonErrorResponse(
          503,
          "SERVICE_UNAVAILABLE",
          "Sunucu şu anda hazır değil. Az sonra tekrar deneyin.",
          { requestId },
        ),
      };
    }
    throw error;
  }

  if (!isSameOriginWriteRequest(request, trustedOrigin)) {
    return {
      ok: false,
      response: jsonErrorResponse(
        403,
        "ORIGIN_INVALID",
        "İstek kaynağı doğrulanamadı.",
        { requestId },
      ),
    };
  }

  if (!csrfTokenMatches(request, context)) {
    return {
      ok: false,
      response: jsonErrorResponse(
        403,
        "CSRF_TOKEN_INVALID",
        "CSRF doğrulaması başarısız.",
        { requestId },
      ),
    };
  }

  if (!hasJsonContentType(request)) {
    return {
      ok: false,
      response: jsonErrorResponse(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "İçerik türü application/json olmalı.",
        { requestId },
      ),
    };
  }

  const bodyResult = await readBodyWithLimit(request, MAX_WRITE_BODY_BYTES);
  if (!bodyResult.ok) {
    return {
      ok: false,
      response: jsonErrorResponse(
        413,
        "PAYLOAD_TOO_LARGE",
        "İstek gövdesi çok büyük.",
        { requestId },
      ),
    };
  }

  return { ...sessionResult, bodyText: bodyResult.text };
}

// ---------------------------------------------------------------------------
// requireAnonymousWrite — T1.2 ADIM 1/2, S1.2, görev tanımı (4).
// ---------------------------------------------------------------------------

/**
 * `POST /api/v1/auth/vehicle-login` (ve ileride T1.3'ün `/auth/platform-
 * login`'i) için — görev tanımı (4, birebir): "oturum yok, bu yüzden
 * requireWrite kullanılamaz — guard.ts'e requireAnonymousWrite(request)
 * ekle: Origin/Sec-Fetch-Site (APP_ORIGIN), Content-Type JSON (415),
 * gövde sınırı (413); CSRF token yok."
 *
 * `requireWrite`'ın AYNI dört savunma-derinliği kontrolünü (origin/
 * Sec-Fetch-Site, Content-Type, gövde boyutu) KULLANIR — üstteki
 * `isSameOriginWriteRequest`/`hasJsonContentType`/`readBodyWithLimit`
 * özel (bu dosyaya AİT) fonksiyonları BİREBİR paylaşılır, mantık
 * TEKRARLANMAZ. Yalnız İKİ şey `requireWrite`'tan FARKLIDIR:
 *
 * 1. `requireSession` HİÇ ÇAĞRILMAZ (henüz oturum YOK — bu endpoint'in
 *    KENDİSİ oturumu ÜRETİR) — bu yüzden CSRF header karşılaştırması da
 *    YOKTUR (karşılaştırılacak bir `context.csrfToken` yok; görev tanımı
 *    "CSRF token yok" der).
 * 2. DB (`getAppDb()`) burada AYRICA açılır (session yoksa `requireWrite`
 *    gibi onu `requireSession` üzerinden ALAMAZ) — aynı üç migration/
 *    sürüm hatası sınıfı ve aynı SQLITE_BUSY/LOCKED sınıflandırıcısı
 *    `dbUnavailableFailure` ile AYNI 503 zarfına çevrilir (kod
 *    TEKRARLANMAZ, `requireSession`'ın kullandığı YARDIMCI burada da
 *    çağrılır).
 *
 * Sıra: (1) APP_ORIGIN çözümü/503 (2) origin/Sec-Fetch-Site 403 (3)
 * Content-Type 415 (4) gövde boyutu 413 (5) DB açılışı/migration 503.
 * Origin/Content-Type/boyut kontrolleri BİLEREK DB açılışından ÖNCEDİR —
 * bu, kimliği doğrulanmamış (anonim) bir uca gelen sahte-origin/hatalı
 * gövdeli istek gürültüsünün DB bağlantısını hiç MEŞGUL ETMEMESİNİ sağlar
 * (`requireWrite`'ın sırası farklıdır çünkü ORADA zaten geçerli bir
 * oturum kanıtlanmadan CSRF karşılaştırması YAPILAMAZ — bkz. dosya üstü
 * not; burada böyle bir zorunluluk yoktur, bu yüzden en ucuz kontroller
 * öne alınabilir).
 */
export interface RequireAnonymousWriteSuccess {
  ok: true;
  db: AppDatabase;
  /** `requireWrite`'ın `bodyText` alanıyla AYNI sözleşme — gövde BURADA
   * (boyut denetimi için) TÜKETİLMİŞTİR; çağıran `JSON.parse(bodyText)`
   * ile kendi ayrıştırmasını yapar. */
  bodyText: string;
  requestId: string;
}

export type RequireAnonymousWriteResult = RequireAnonymousWriteSuccess | GuardFailure;

export async function requireAnonymousWrite(
  request: Request,
): Promise<RequireAnonymousWriteResult> {
  const requestId = generateRequestId();

  let trustedOrigin: string;
  try {
    trustedOrigin = resolveTrustedAppOrigin();
  } catch (error) {
    if (error instanceof InvalidAppOriginError) {
      console.error(
        `[guard] APP_ORIGIN yapılandırma hatası (request_id=${requestId}): ${error.message}`,
      );
      return {
        ok: false,
        response: jsonErrorResponse(
          503,
          "SERVICE_UNAVAILABLE",
          "Sunucu şu anda hazır değil. Az sonra tekrar deneyin.",
          { requestId },
        ),
      };
    }
    throw error;
  }

  if (!isSameOriginWriteRequest(request, trustedOrigin)) {
    return {
      ok: false,
      response: jsonErrorResponse(
        403,
        "ORIGIN_INVALID",
        "İstek kaynağı doğrulanamadı.",
        { requestId },
      ),
    };
  }

  if (!hasJsonContentType(request)) {
    return {
      ok: false,
      response: jsonErrorResponse(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "İçerik türü application/json olmalı.",
        { requestId },
      ),
    };
  }

  const bodyResult = await readBodyWithLimit(request, MAX_WRITE_BODY_BYTES);
  if (!bodyResult.ok) {
    return {
      ok: false,
      response: jsonErrorResponse(
        413,
        "PAYLOAD_TOO_LARGE",
        "İstek gövdesi çok büyük.",
        { requestId },
      ),
    };
  }

  let db: AppDatabase;
  try {
    db = getAppDb();
  } catch (error) {
    if (
      error instanceof PendingMigrationsError ||
      error instanceof MissingDatabaseFileError ||
      error instanceof UninitializedDatabaseError ||
      error instanceof UnsupportedSqliteVersionError
    ) {
      return dbUnavailableFailure(requestId, error);
    }
    const lockError = extractTransientSqliteLockError(error);
    if (lockError) {
      return dbUnavailableFailure(requestId, lockError);
    }
    throw error;
  }

  return { ok: true, db, bodyText: bodyResult.text, requestId };
}
