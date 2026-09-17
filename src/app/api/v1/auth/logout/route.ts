/**
 * POST /api/v1/auth/logout — T1.4 ADIM 1/2 (ilk sürüm), ADIM 2/2 (bu
 * sürüm: `../../../../../server/auth/guard.ts` `requireWrite`'a taşındı),
 * S1.4.
 *
 * ARCHITECTURE.md §4 — "POST | /auth/logout | Mevcut oturumu iptal |
 * Oturum". Görev tanımı (b) — "requireWrite(request) yardımcısı ...
 * birleştirir; logout dahil tüm yazma uçları kullanır." Bu yüzden logout
 * ARTIK diğer her yazma ucu gibi ÖNCE geçerli oturum + aynı-kaynak +
 * doğru CSRF header + `application/json` + gövde boyutu sınırı ister
 * (bkz. `guard.ts` üst notundaki "DAVRANIŞ DEĞİŞİKLİĞİ" bölümü — ADIM
 * 1/2'nin "token eksik/geçersizse de 200" idempotent tasarımı, bu ADIM'ın
 * merkezi denetim gereğiyle SÜPÜRÜLDÜ; STORIES.md S1.4'ün 7 kabul
 * kriterinden hiçbiri o eski davranışı ZORUNLU KILMIYORDU).
 *
 * S1.4 AC7 — "Geçersiz kaynak/tokenla yazma isteği veri DEĞİŞTİRMEZ (test:
 * logout çağrısı CSRF'siz → 403 ve oturum hala geçerli)": `requireWrite`
 * başarısız olduğunda `revokeSession` HİÇ ÇAĞRILMAZ, bu yüzden oturum
 * (ve cookie) DOKUNULMAMIŞ kalır.
 *
 * DÜZELTME TURU 2 (denetim bulgusu, "high", `guvenlik` merceği —
 * `../../../../../server/auth/guard.ts` `dbUnavailableFailure` üst
 * notundaki kanıtla AYNI kök neden): `requireWrite` BAŞARILI döndükten
 * SONRA burada çalışan `revokeSession` yazması KENDİ SQL'i için AYRI bir
 * SQLITE_BUSY/SQLITE_LOCKED riski taşır (`guard.ts`'in denetimi yalnız
 * `requireWrite`'ın KENDİ içindeki `resolveSession` okumasını/last_seen
 * yazmasını kapsar). Bu, S1.4'ün "logout dahil tüm yazma uçları" ifadesinin
 * işaret ettiği ikinci (ve bu paketteki TEK diğer) DB yazma noktasıdır; aynı
 * `extractTransientSqliteLockError` sınıflandırıcısı ve aynı 503
 * SERVICE_UNAVAILABLE zarfı burada da uygulanır.
 */
import { serializeLogoutCookie } from "../../../../../server/auth/cookie";
import { requireWrite } from "../../../../../server/auth/guard";
import { extractTransientSqliteLockError } from "../../../../../server/data/db";
import {
  jsonErrorResponse,
  jsonSuccessResponse,
} from "../../../../../server/http/errors";
import { revokeSession } from "../../../../../server/usecases/session/revoke-session";

export async function POST(request: Request): Promise<Response> {
  const guard = await requireWrite(request);
  if (!guard.ok) {
    return guard.response;
  }

  try {
    await revokeSession(guard.db, guard.context.sessionId);
  } catch (error) {
    const lockError = extractTransientSqliteLockError(error);
    if (lockError) {
      // Ayrıntı (SQL/hata mesajı) istemciye DÖNMEZ — yalnız sunucu logu
      // (bkz. `guard.ts` `dbUnavailableFailure` aynı ilke).
      console.error(
        `[auth/logout] veritabanı kilitli (request_id=${guard.requestId}): ${lockError.message}`,
      );
      return jsonErrorResponse(
        503,
        "SERVICE_UNAVAILABLE",
        "Sunucu şu anda hazır değil. Az sonra tekrar deneyin.",
        { requestId: guard.requestId },
      );
    }
    throw error;
  }

  const response = jsonSuccessResponse(
    200,
    { status: "ok" },
    { requestId: guard.requestId },
  );
  response.headers.append("Set-Cookie", serializeLogoutCookie());
  return response;
}
