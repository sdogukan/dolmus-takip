/**
 * POST /api/v1/auth/platform-login — T1.3 ADIM 1/2, S1.3, görev tanımı (b).
 *
 * Ekibin ilk yönetici hesabı kurulumda, sunucunun yerel yönetim komutuyla
 * oluşturulur; herkese açık yönetici kayıt endpoint'i bulunmaz. Bu uç kayıt
 * DEĞİL, GİRİŞ ucudur (hesabın kendisi `scripts/platform-admin.ts` ile
 * önceden oluşturulmuş olmalıdır).
 *
 * Görev tanımı (b, birebir): "POST /api/v1/auth/platform-login
 * (requireAnonymousWrite; girişte aynı tarayıcıdaki eski oturum iptal)."
 * Bu route handler `../vehicle-login/route.ts`'İN (T1.2) BİREBİR AYNI dört
 * HTTP-katmanı işini yapar — kimlik doğrulama/hız sınırı/hash kuyruğu
 * ORKESTRASYONUNUN TAMAMI `../../../../../server/usecases/auth/
 * platform-login.ts`'tedir (bkz. o dosyanın üst notu):
 *
 * (1) `requireAnonymousWrite` ile origin/Content-Type/gövde denetimi + DB
 *     açılışı, (2) `X-Forwarded-For`'dan IP çözümü, (3) BAŞARIDA eski
 *     oturum çerezinin iptali (S1.4 AC2 "ortak telefon" — `../vehicle-
 *     login/route.ts`'in EXPORT ettiği `revokePriorSessionCookieIfAny`
 *     DOĞRUDAN kullanılır, kod tekrarı yok; bu fonksiyon oturumun
 *     KİNDİNDEN [araç/ekip] bağımsızdır) + yeni `Set-Cookie`, (4) usecase
 *     sonucunun API hata sözleşmesine çevrilmesi.
 *
 * Durum kodu: 201 (oluşturma — yeni bir `sessions` satırı üretir) —
 * `../vehicle-login/route.ts`'in AYNI yorumu burada da geçerlidir.
 *
 * "Araç credential'ı ekip girişini AÇMAZ" — `platformLogin` yalnız
 * `platform_users` tablosunu sorgular (bkz. usecase'in üst notu); bu route
 * handler bunu AYRICA denetlemez, DOĞRUDAN sonuca güvenir.
 */
import { PLATFORM_LOGIN_RESULT_MESSAGES } from "../../../../../lib/messages";
import { serializeSessionCookie } from "../../../../../server/auth/cookie";
import { requireAnonymousWrite } from "../../../../../server/auth/guard";
import { permissionsForActor } from "../../../../../server/auth/permissions";
import { resolveClientIp } from "../../../../../server/auth/rate-limit";
import { logThrottled } from "../../../../../server/auth/throttle-log";
import { computeScopeKey } from "../../../../../server/auth/scope";
import { extractTransientSqliteLockError } from "../../../../../server/data/db";
import {
  jsonErrorResponse,
  jsonSuccessResponse,
} from "../../../../../server/http/errors";
import {
  platformLogin,
  type PlatformLoginResult,
} from "../../../../../server/usecases/auth/platform-login";
import { revokePriorSessionCookieIfAny } from "../vehicle-login/route";

/**
 * `../vehicle-login/route.ts`'İN `vehicleLoginTransientLockResponse`
 * fonksiyonuyla AYNI ilke (bkz. o dosyanın üst notu — `guard.ts`
 * `dbUnavailableFailure` ve `../logout/route.ts`'in kendi ek yazması için
 * uyguladığı desenle AYNI kök neden): bu dosyanın KENDİ iki DB YAZMA
 * noktası — `platformLogin(...)`'in `createPlatformSession` INSERT'i ve
 * `revokePriorSessionCookieIfAny(...)`'nin `revokeSession` UPDATE'i —
 * `requireAnonymousWrite`'ın KENDİ içindeki DB-hazır-değil denetiminin
 * KAPSAMI DIŞINDADIR. Canlı bir SQLITE_BUSY/SQLITE_LOCKED bu iki noktadan
 * biri sırasında oluşursa, yakalanmadan Next'in API hata zarfı OLMAYAN genel
 * 500'üne düşerdi. Log etiketi `[auth/platform-login]` DIŞINDA
 * `vehicleLoginTransientLockResponse` ile birebir aynıdır; her route
 * kendi doğru log etiketini taşıması için (mevcut kod tabanının
 * `guard.ts`/`../logout/route.ts`/`../vehicle-login/route.ts` üçlüsünde
 * zaten izlediği kurulmuş desen) burada AYRI tutulur.
 */
function platformLoginTransientLockResponse(
  requestId: string,
  error: unknown,
): Response | undefined {
  const lockError = extractTransientSqliteLockError(error);
  if (!lockError) {
    return undefined;
  }
  console.error(
    `[auth/platform-login] veritabanı kilitli (request_id=${requestId}): ${lockError.message}`,
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
  let result: PlatformLoginResult;
  try {
    result = await platformLogin(db, rawBody, { ip });
  } catch (error) {
    const lockResponse = platformLoginTransientLockResponse(requestId, error);
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
          PLATFORM_LOGIN_RESULT_MESSAGES.invalidCredentials,
          { requestId },
        );
      case "rate_limited": {
        logThrottled("auth/platform-login", "RATE_LIMITED", requestId);
        const response = jsonErrorResponse(
          429,
          "RATE_LIMITED",
          PLATFORM_LOGIN_RESULT_MESSAGES.rateLimited,
          { requestId },
        );
        response.headers.set(
          "Retry-After",
          String(result.retryAfterSeconds),
        );
        return response;
      }
      case "hash_queue_full":
        logThrottled("auth/platform-login", "HASH_QUEUE_FULL", requestId);
        return jsonErrorResponse(
          429,
          "HASH_QUEUE_FULL",
          PLATFORM_LOGIN_RESULT_MESSAGES.hashQueueFull,
          { requestId },
        );
      default: {
        // Tüketilebilirlik denetimi (bkz. `../vehicle-login/route.ts`'in
        // AYNI deseni) — normal akışta HİÇ tetiklenmez.
        const exhaustiveCheck: never = result;
        throw new Error(
          `platformLogin: bilinmeyen başarısızlık türü: ${JSON.stringify(exhaustiveCheck)}`,
        );
      }
    }
  }

  // Başarı — önce (varsa) bu tarayıcıdaki ESKİ oturumu iptal et (S1.4 AC2),
  // SONRA yeni oturumu döndür.
  try {
    await revokePriorSessionCookieIfAny(db, request);
  } catch (error) {
    const lockResponse = platformLoginTransientLockResponse(requestId, error);
    if (lockResponse) {
      return lockResponse;
    }
    throw error;
  }

  const { session } = result;
  const response = jsonSuccessResponse(
    201,
    {
      kind: "platform",
      role: result.role,
      username: result.username,
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
