/**
 * POST /api/v1/auth/vehicle-login — T1.2 ADIM 1/2, S1.2, görev tanımı (4).
 *
 * ARCHITECTURE.md §4 — "POST | /auth/vehicle-login | Plaka + parola
 * oturumu | Giriş hız sınırı". Görev tanımı (4, birebir): "oturum yok,
 * bu yüzden requireWrite kullanılamaz — guard.ts'e
 * requireAnonymousWrite(request) [kullan]: Origin/Sec-Fetch-Site
 * (APP_ORIGIN), Content-Type JSON (415), gövde sınırı (413); CSRF token
 * yok. Yanıt zarfı errors.ts ile aynı; Cache-Control no-store; başarıda
 * Set-Cookie. Yeni oturum açılırken aynı tarayıcıdaki eski oturum çerezi
 * varsa eski oturum iptal edilir (S1.4 AC2 ortak telefon)."
 *
 * Kimlik doğrulama/hız sınırı/hash kuyruğu ORKESTRASYONUNUN TAMAMI
 * `../../../../../server/usecases/auth/vehicle-login.ts`'tedir (bkz. o
 * dosyanın üst notu — "ayrım"); bu route handler yalnız HTTP'ye ÖZGÜ dört
 * işi yapar: (1) `requireAnonymousWrite` ile origin/Content-Type/gövde
 * denetimi + DB açılışı, (2) `X-Forwarded-For`'dan IP çözümü
 * (`resolveClientIp`), (3) BAŞARIDA eski oturum çerezinin iptali +
 * yeni `Set-Cookie`, (4) usecase sonucunun ARCHITECTURE §4 hata
 * sözleşmesine (`../../../../../server/http/errors.ts`) çevrilmesi.
 *
 * Durum kodu: ARCHITECTURE §4 — "Oluşturma 201". Başarılı giriş YENİ bir
 * `sessions` satırı ÜRETİR (bir kaynak "oluşturma"sıdır) — bu yüzden 200
 * DEĞİL 201 kullanılır (dokümanın genel "oluşturma → 201" kuralı; giriş
 * uçları için AYRICA özel bir kod BELİRTİLMEZ, bu bir mühendislik
 * yorumudur — docs/DECISIONS.md'de AYRICA kayıtlı DEĞİLDİR, bu paketin
 * open_issues'ında işaretlenmiştir).
 */
import { eq } from "drizzle-orm";
import { formatPlateForDisplay } from "../../../../../lib/plate";
import { VEHICLE_LOGIN_RESULT_MESSAGES } from "../../../../../lib/messages";
import {
  readSessionToken,
  serializeSessionCookie,
} from "../../../../../server/auth/cookie";
import { requireAnonymousWrite } from "../../../../../server/auth/guard";
import { permissionsForActor } from "../../../../../server/auth/permissions";
import { resolveClientIp } from "../../../../../server/auth/rate-limit";
import { computeScopeKey } from "../../../../../server/auth/scope";
import { hashSessionToken } from "../../../../../server/auth/session";
import {
  extractTransientSqliteLockError,
  type AppDatabase,
} from "../../../../../server/data/db";
import { sessions } from "../../../../../server/data/schema";
import {
  jsonErrorResponse,
  jsonSuccessResponse,
} from "../../../../../server/http/errors";
import {
  vehicleLogin,
  type VehicleLoginResult,
} from "../../../../../server/usecases/auth/vehicle-login";
import { revokeSession } from "../../../../../server/usecases/session/revoke-session";

/**
 * S1.4 AC2 — "Ortak telefonda başka kullanıcı/araçla giriş yapılınca
 * önceki müşterinin geçici form ve verisi yeni ekrana taşınmaz." Sunucu
 * tarafındaki karşılığı: bu tarayıcıda ZATEN bir `dolmus_session`
 * çerezi varsa (kimin/hangi aracın olduğuna BAKILMAKSIZIN — geçerli,
 * süresi dolmuş veya zaten iptal edilmiş FARK ETMEZ), YENİ oturum
 * başarıyla kurulduğunda o ESKİ oturum satırı da AÇIKÇA iptal edilir; bu
 * sayede paylaşılan bir cihazda unutulmuş eski çerez ARTIK KULLANILAMAZ
 * hale gelir. `revokeSession` İDEMPOTENTTİR (bkz. o dosyanın üst notu) —
 * eski token zaten geçersiz/bilinmeyen olsa da bu çağrı GÜVENLİDİR.
 * Token'ın KENDİSİ `resolveSession` ile ÇÖZÜLMEZ (o oturumun GEÇERLİ
 * olup olmadığı ÖNEMSİZDİR, yalnız VAR OLAN bir satırı hedefine iptal
 * etmek yeterlidir) — bu yüzden doğrudan `token_hash` eşleşmesiyle
 * `sessions.id` aranır.
 */
async function revokePriorSessionCookieIfAny(
  db: AppDatabase,
  request: Request,
): Promise<void> {
  const priorToken = readSessionToken(request);
  if (!priorToken) {
    return;
  }
  const priorTokenHash = hashSessionToken(priorToken);
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.tokenHash, priorTokenHash))
    .limit(1);
  const priorSession = rows[0];
  if (priorSession) {
    await revokeSession(db, priorSession.id);
  }
}

/**
 * DÜZELTME TURU 3 (denetim bulgusu, "high", `guvenlik` merceği — AYNI kök
 * neden `../../../../../server/auth/guard.ts` `dbUnavailableFailure` ve
 * `../logout/route.ts`'in kendi ek yazması için zaten uyguladığı desenle):
 * bu dosyanın KENDİ iki DB YAZMA noktası — aşağıdaki `vehicleLogin(...)`
 * çağrısının `createVehicleSession` INSERT'i (başarılı girişte HER ZAMAN
 * çalışır) ve `revokePriorSessionCookieIfAny(...)`'nin `revokeSession`
 * UPDATE'i — `requireAnonymousWrite`'ın KENDİ içindeki DB-hazır-değil
 * denetiminin KAPSAMI DIŞINDADIR (o denetim yalnız `getAppDb()`'yi
 * kapsar). Canlı bir SQLITE_BUSY/SQLITE_LOCKED (ARCHITECTURE §3.6
 * busy_timeout=2000 ms aşımı) bu iki noktadan biri sırasında oluşursa,
 * yakalanmadan Next'in ARCH §4 zarfı OLMAYAN genel 500'üne düşerdi (bkz.
 * `tests/integration/vehicle-login-route.test.ts` "DB kilitli" bloğu —
 * CANLI tekrar üretim `session-routes.test.ts`'teki eşdeğer testlerle
 * AYNI yöntem: ikinci bir better-sqlite3 bağlantısıyla BEGIN IMMEDIATE).
 * Bu yardımcı, `logout/route.ts`'in inline desenini BU dosyanın İKİ çağrı
 * noktası arasında TEKRARLAMAMAK için tek yere ÇIKARILMIŞ halidir —
 * davranış (log biçimi, mesaj, durum kodu) BİREBİR aynıdır.
 */
function vehicleLoginTransientLockResponse(
  requestId: string,
  error: unknown,
): Response | undefined {
  const lockError = extractTransientSqliteLockError(error);
  if (!lockError) {
    return undefined;
  }
  // Ayrıntı (SQL/hata mesajı) istemciye DÖNMEZ — yalnız sunucu logu (bkz.
  // `guard.ts` `dbUnavailableFailure` ve `logout/route.ts` aynı ilke).
  console.error(
    `[auth/vehicle-login] veritabanı kilitli (request_id=${requestId}): ${lockError.message}`,
  );
  return jsonErrorResponse(
    503,
    "SERVICE_UNAVAILABLE",
    "Sunucu şu anda hazır değil. Az sonra tekrar deneyin.",
    { requestId },
  );
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireAnonymousWrite(request);
  if (!guard.ok) {
    return guard.response;
  }
  const { db, bodyText, requestId } = guard;

  let rawBody: unknown;
  try {
    rawBody = bodyText.length > 0 ? JSON.parse(bodyText) : {};
  } catch {
    return jsonErrorResponse(
      422,
      "VALIDATION_ERROR",
      "Geçersiz JSON gövdesi.",
      { requestId },
    );
  }

  const ip = resolveClientIp(request);
  let result: VehicleLoginResult;
  try {
    result = await vehicleLogin(db, rawBody, { ip });
  } catch (error) {
    const lockResponse = vehicleLoginTransientLockResponse(requestId, error);
    if (lockResponse) {
      return lockResponse;
    }
    throw error;
  }

  if (!result.ok) {
    switch (result.kind) {
      case "validation":
        return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
          fields: result.fields,
          requestId,
        });
      case "invalid_credentials":
        return jsonErrorResponse(
          401,
          "INVALID_CREDENTIALS",
          VEHICLE_LOGIN_RESULT_MESSAGES.invalidCredentials,
          { requestId },
        );
      case "rate_limited": {
        const response = jsonErrorResponse(
          429,
          "RATE_LIMITED",
          VEHICLE_LOGIN_RESULT_MESSAGES.rateLimited,
          { requestId },
        );
        response.headers.set(
          "Retry-After",
          String(result.retryAfterSeconds),
        );
        return response;
      }
      case "hash_queue_full":
        return jsonErrorResponse(
          429,
          "HASH_QUEUE_FULL",
          VEHICLE_LOGIN_RESULT_MESSAGES.hashQueueFull,
          { requestId },
        );
      default: {
        // Tüketilebilirlik denetimi — `VehicleLoginFailure` yeni bir
        // `kind` ile genişletilirse burada DERLEME HATASI verir (bkz.
        // `../../../../../server/auth/scope.ts` benzeri savunma
        // denetimleri). Normal akışta HİÇ tetiklenmez.
        const exhaustiveCheck: never = result;
        throw new Error(
          `vehicleLogin: bilinmeyen başarısızlık türü: ${JSON.stringify(exhaustiveCheck)}`,
        );
      }
    }
  }

  // Başarı — önce (varsa) bu tarayıcıdaki ESKİ oturumu iptal et (yukarıdaki
  // fonksiyon notu, S1.4 AC2), SONRA yeni oturumu döndür.
  try {
    await revokePriorSessionCookieIfAny(db, request);
  } catch (error) {
    const lockResponse = vehicleLoginTransientLockResponse(requestId, error);
    if (lockResponse) {
      return lockResponse;
    }
    throw error;
  }

  const { session } = result;
  const response = jsonSuccessResponse(
    201,
    {
      role: result.role,
      businessId: result.businessId,
      vehicleId: result.vehicleId,
      plate: formatPlateForDisplay(result.plateNormalized),
      csrfToken: session.context.csrfToken,
      scopeKey: computeScopeKey(session.context),
      permissions: permissionsForActor(result.role),
    },
    { requestId },
  );
  response.headers.append(
    "Set-Cookie",
    serializeSessionCookie(session.token, {
      expiresAt: session.expiresAt,
      now: new Date(),
    }),
  );
  return response;
}
