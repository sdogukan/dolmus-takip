/**
 * GET /api/v1/session — T1.4 ADIM 1/2 (ilk sürüm), ADIM 2/2 (taşındı),
 * T1.5 ADIM 1/2 (izinli kapsam özeti + scopeKey), düzeltme turu 1
 * (credentialId/platformUserId geri alındı), S1.4/S1.5.
 *
 * ARCHITECTURE.md §4 — "GET | /session | Rol, izinli kapsam ve CSRF
 * bilgisi | Oturum". Yanıt "rol, izinli kapsam (kind/businessId/vehicleId/
 * role) ve CSRF token" içerir. `sessionId` bu listede YOKTUR (hiçbir
 * istemci özelliği ona ihtiyaç duymaz — gereksiz iç ayrıntı yüzeyi
 * küçültülür).
 *
 * DÜZELTME (denetim bulgusu, düzeltme turu 1 — "GET /session
 * credentialId/platformUserId alanları DECISIONS.md T1.4 kararını ihlal
 * ediyor"): bu iki alan yanıttan KALDIRILDI. docs/DECISIONS.md satır 89
 * ("T1.4 uygulama kararları", ürün sahibi onaylı, 2026-09-17) BİREBİR:
 * "GET /session istemciye sessionId/credentialId/platformUserId VERMEZ.
 * client-state (F6) anahtarı için T1.5'te yanıta gizli olmayan opak
 * `scopeKey` eklenir." Önceki düzeltme turu bu kararı, kod yorumunda
 * kendi gerekçesiyle ("bu gerekçe TUTARSIZDI") tek taraflı GEÇERSİZ
 * KILMIŞTI — CLAUDE.md ("asla varsayımda bulunma, kanıta dayalı çalış")
 * ve görev talimatı (dokümanla çelişen bir davranış doküman güncellenmeden
 * eklenemez) gereği, dokümante edilmiş bir ürün sahibi kararı yalnız
 * DECISIONS.md'nin kendisi güncellenerek veya yeni bir onayla tersine
 * çevrilebilir; bir kod yorumu bu yetkiye sahip değildir. Ayrıca bu alanlar
 * zaten GEREKSİZDİ: aşağıdaki `scopeKey` (bkz. `computeScopeKey`) tam da
 * bu ihtiyacı (client-state anahtarı, F6) karşılamak için VARDIR ve
 * `tests/integration/session-scope-summary.test.ts` scopeKey'in hem farklı
 * araç hem farklı ekip üyesi için farklı değer ürettiğini zaten kanıtlar —
 * credentialId/platformUserId'yi AYRICA açığa çıkarmak yalnız DECISIONS.md
 * kararıyla çelişen, kullanılmayan bir yüzey ekler.
 *
 * GET salt okunur olduğundan `requireWrite` (CSRF/origin/Content-Type/gövde
 * boyutu) DEĞİL, yalnız `requireSession` kullanılır — CSRF tokenının
 * KENDİSİ zaten burada ÜRETİLİP döndürülür (bkz. `guard.ts` üst notu).
 *
 * Görev tanımı gereği route handler "doğrudan Request nesnesiyle" test
 * edilir (Next'in kendi istek kapsamı OLMADAN) — bu yüzden `next/server`
 * yerine düz Web `Request`/`Response` kullanılır.
 *
 * T1.5 ADIM 1/2 (görev tanımı iş adımı 4): "GET /api/v1/session yanıtını
 * genişlet: izinli kapsam özeti (actor, businessId, vehicleId, permissions
 * listesi) ve gizli OLMAYAN opak `scopeKey`." Bu ADIM'da iki alan EKLENİR:
 *
 * - `permissions`: `context.role`'ün (ARCHITECTURE §2 yetki matrisinin
 *   kod karşılığı — bkz. `../../../../server/auth/permissions.ts`) TAM
 *   izin listesi, alfabetik sırayla. "actor" AYRI bir alan olarak
 *   EKLENMEZ: `SessionRole` ("owner"|"driver"|"admin"|"support") ile
 *   `Scope.actor` (`../../../../server/auth/scope.ts`) AYNI dört değeri
 *   taşır — zaten var olan `role` alanının BİREBİR kopyasını ikinci bir
 *   adla tekrar döndürmek yalnız yüzey/bakım maliyeti eklerdi (bu ADIM'ın
 *   open_issues'ında ayrıca not edilmiştir). Bu liste yalnız ROLE bağlıdır
 *   (bir `Scope` NESNESİ kurmayı GEREKTİRMEZ) — ekip (platform) oturumları
 *   için henüz seçilmiş bir hedef işletme/araç YOKTUR (bkz. `../../../../
 *   server/auth/scope.ts` üst notu: staff'ın Scope'u yalnız
 *   `X-Target-Vehicle` header'ıyla bir MÜŞTERİ ucunda ÇÖZÜLÜR), bu yüzden
 *   burada DB erişimi YAPILMAZ.
 * - `scopeKey`: DECISIONS.md T1.4 notu — "client-state anahtarı için
 *   T1.5'te yanıta gizli olmayan opak `scopeKey` eklenir"; görev tanımı —
 *   "sunucuda SHA-256(kind + ':' + credentialId|platformUserId + ':' +
 *   vehicleId).slice(0,16)" (bkz. `computeScopeKey`). `../../../../
 *   lib/client-state.ts` bu opak anahtarı DOĞRUDAN kullanır; iç
 *   credentialId/platformUserId değerlerine ihtiyaç duymaz.
 */
import { requireSession } from "../../../../server/auth/guard";
import { permissionsForActor } from "../../../../server/auth/permissions";
import { computeScopeKey } from "../../../../server/auth/scope";
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
    permissions: permissionsForActor(context.role),
    scopeKey: computeScopeKey(context),
  };
  if (context.businessId !== undefined) {
    body.businessId = context.businessId;
  }
  if (context.vehicleId !== undefined) {
    body.vehicleId = context.vehicleId;
  }

  return jsonSuccessResponse(200, body, { requestId });
}
