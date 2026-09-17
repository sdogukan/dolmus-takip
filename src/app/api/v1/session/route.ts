/**
 * GET /api/v1/session — T1.4 ADIM 1/2 (ilk sürüm), ADIM 2/2 (taşındı), bu
 * sürüm (düzeltme turu 1), S1.4.
 *
 * ARCHITECTURE.md §4 — "GET | /session | Rol, izinli kapsam ve CSRF
 * bilgisi | Oturum". Yanıt "rol, izinli kapsam (kind/businessId/vehicleId/
 * role) ve CSRF token" içerir. `sessionId` bu listede YOKTUR (hiçbir
 * istemci özelliği ona ihtiyaç duymaz — gereksiz iç ayrıntı yüzeyi
 * küçültülür).
 *
 * DÜZELTME (denetim bulgusu, düzeltme turu 1 — "DECISIONS.md F6'nın
 * istediği client-state anahtarı GET /session yanıtında yok"): araç
 * oturumu için `credentialId`, ekip oturumu için `platformUserId` ARTIK
 * yanıta dahildir. Önceki sürüm bunları "iç DB kimliği" gerekçesiyle
 * KASITLI dışlıyordu — ama bu gerekçe TUTARSIZDI: `businessId`/`vehicleId`
 * de AYNI sınıftan (opak, tahmin edilemez UUID, gizli/PII DEĞİL) iç DB
 * kimlikleridir ve zaten döndürülüyordu. `credentialId`/`platformUserId`
 * olmadan `../../../../lib/client-state.ts` (DECISIONS.md F6 — "anahtar =
 * credential/platform_user kimliği + araç") GERÇEK bir GET /session
 * yanıtından KULLANILAMAZ (bkz. o dosyanın önceki "AÇIK NOKTA" notu);
 * özellikle EKİP (platform) tarafında `role` tek başına farklı iki ekip
 * üyesini AYIRT ETMEZ (ör. iki "support" hesabı aynı cihazı paylaşırsa),
 * bu da S1.4 AC2'nin ("başka kullanıcı/araçla giriş yapılınca önceki
 * müşterinin geçici verisi taşınmaz") tam olarak önlemek istediği
 * karışmadır — yalnız `businessId+vehicleId+role`'e indirgenmiş bir
 * anahtarlama bu senaryoda YETERSİZ kalırdı. Bu iki alan token/hash/parola
 * gibi GİZLİ bir değer DEĞİLDİR; oturum zaten geçerliyken sahibinin kendi
 * hesap/araç kimliğini bilmesi bir yetki artışı oluşturmaz.
 *
 * GET salt okunur olduğundan `requireWrite` (CSRF/origin/Content-Type/gövde
 * boyutu) DEĞİL, yalnız `requireSession` kullanılır — CSRF tokenının
 * KENDİSİ zaten burada ÜRETİLİP döndürülür (bkz. `guard.ts` üst notu).
 *
 * Görev tanımı gereği route handler "doğrudan Request nesnesiyle" test
 * edilir (Next'in kendi istek kapsamı OLMADAN) — bu yüzden `next/server`
 * yerine düz Web `Request`/`Response` kullanılır.
 */
import { requireSession } from "../../../../server/auth/guard";
import { jsonSuccessResponse } from "../../../../server/http/errors";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireSession(request);
  if (!guard.ok) {
    return guard.response;
  }
  const { context, requestId } = guard;

  const body: Record<string, unknown> = {
    kind: context.kind,
    role: context.role,
    csrfToken: context.csrfToken,
  };
  if (context.businessId !== undefined) {
    body.businessId = context.businessId;
  }
  if (context.vehicleId !== undefined) {
    body.vehicleId = context.vehicleId;
  }
  if (context.credentialId !== undefined) {
    body.credentialId = context.credentialId;
  }
  if (context.platformUserId !== undefined) {
    body.platformUserId = context.platformUserId;
  }

  return jsonSuccessResponse(200, body, { requestId });
}
