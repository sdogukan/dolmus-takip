/**
 * GET /api/v1/session — T1.4 ADIM 1/2 (ilk sürüm), ADIM 2/2 (taşındı),
 * T1.5 ADIM 1/2 (izinli kapsam özeti + scopeKey), düzeltme turu 1
 * (credentialId/platformUserId geri alındı), S1.4/S1.5.
 *
 * GET /session rol, izinli kapsam ve CSRF bilgisini döndürür; oturum
 * gerektirir. Yanıt rol, izinli kapsam (kind/businessId/vehicleId/role) ve
 * CSRF token içerir. `sessionId` bu listede YOKTUR (hiçbir
 * istemci özelliği ona ihtiyaç duymaz — gereksiz iç ayrıntı yüzeyi
 * küçültülür).
 *
 * DÜZELTME (denetim bulgusu, düzeltme turu 1 — "GET /session
 * credentialId/platformUserId alanları T1.4 kararını ihlal ediyor"): bu
 * iki alan yanıttan KALDIRILDI. T1.4 uygulama kararı (ürün sahibi onaylı,
 * 2026-09-17): GET /session istemciye sessionId/credentialId/
 * platformUserId VERMEZ; client-state (F6) anahtarı için T1.5'te yanıta
 * gizli olmayan opak `scopeKey` eklenir. Önceki düzeltme turu bu kararı,
 * kod yorumunda kendi gerekçesiyle ("bu gerekçe TUTARSIZDI") tek taraflı
 * GEÇERSİZ KILMIŞTI — CLAUDE.md ("asla varsayımda bulunma, kanıta dayalı
 * çalış") ve görev talimatı gereği, ürün sahibinin onayladığı bir karar
 * yalnız kararın kendisi güncellenerek veya yeni bir onayla tersine
 * çevrilebilir; bir kod yorumu bu yetkiye sahip değildir. Ayrıca bu alanlar
 * zaten GEREKSİZDİ: aşağıdaki `scopeKey` (bkz. `computeScopeKey`) tam da
 * bu ihtiyacı (client-state anahtarı, F6) karşılamak için VARDIR ve
 * `tests/integration/session-scope-summary.test.ts` scopeKey'in hem farklı
 * araç hem farklı ekip üyesi için farklı değer ürettiğini zaten kanıtlar —
 * credentialId/platformUserId'yi AYRICA açığa çıkarmak yalnız T1.4
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
 * - `permissions`: `context.role`'ün (yetki matrisinin
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
 * - `scopeKey`: T1.4 kararı gereği client-state anahtarı için T1.5'te
 *   yanıta gizli olmayan opak `scopeKey` eklenir; görev tanımı —
 *   "sunucuda SHA-256(kind + ':' + credentialId|platformUserId + ':' +
 *   vehicleId).slice(0,16)" (bkz. `computeScopeKey`). `../../../../
 *   lib/client-state.ts` bu opak anahtarı DOĞRUDAN kullanır; iç
 *   credentialId/platformUserId değerlerine ihtiyaç duymaz.
 *
 * T1.2 (görev tanımı (1); T1.5 notu: araç oturumu için T1.2'de `plate`
 * [görüntü biçimi] eklenecek): araç oturumları için `plate` alanı EKLENDİ —
 * şoför ekranında sabit gösterilen plakanın kaynağı budur
 * (`../../../../server/auth/permissions.ts` dosya üstü notundaki "KALDIRILDI" bölümünün de doğruladığı gibi, ayrı bir
 * `GET /vehicles/current` ucu YOKTUR; plaka BURADAN gelir). `SessionContext`
 * plakayı KENDİSİ TAŞIMAZ (yalnız `vehicleId` — bkz. `../../../../server/
 * usecases/session/types.ts`); bu yüzden `context.kind === "vehicle"`
 * iken `vehicles.plate_normalized` `../../../../server/auth/
 * vehicle-plate.ts` `readVehiclePlateForDisplay` ile okunup görüntü
 * biçimine (`"35 ABC 123"`) çevrilir — API'nin GERİ KALANI plakayı
 * normalize (boşluksuz) taşırken (T1.5 notu), bu ALAN
 * KASITLI olarak GÖRÜNTÜ biçimindedir (görev tanımı: "plate (görüntü
 * biçimi, formatPlateForDisplay)").
 *
 * DÜZELTME (denetim bulgusu, düzeltme turu 1 — "readVehiclePlateForDisplay,
 * GET /session route'undaki aynı sorgu+biçimlendirmeyi tekrar ediyor"):
 * bu route ÖNCEDEN aynı SELECT + `formatPlateForDisplay` çağrısını
 * `readVehiclePlateForDisplay` ile birebir aynı şekilde KENDİ İÇİNDE
 * tekrar ediyordu (iki ayrı kaynak, aynı davranış — biri değişip diğeri
 * unutulursa /sofor ve /sahip başlığı ile bu yanıtın `plate` alanı
 * sessizce SAPARDI). Davranış AYNI kalacak şekilde tek kaynağa
 * (`readVehiclePlateForDisplay`) yönlendirildi; bu fonksiyon zaten
 * `AppDatabase` alıp `vehicles.id`'ye göre tek satır okuyup
 * `formatPlateForDisplay` uygular — burada YENİDEN YAZILMADI, olduğu gibi
 * ÇAĞRILDI (CLAUDE.md "var olan modülleri yeniden yazma; genişlet").
 */
import { requireSession } from "../../../../server/auth/guard";
import { permissionsForActor } from "../../../../server/auth/permissions";
import { readPlatformUsernameForDisplay } from "../../../../server/auth/platform-username";
import { computeScopeKey } from "../../../../server/auth/scope";
import { readVehiclePlateForDisplay } from "../../../../server/auth/vehicle-plate";
import { jsonSuccessResponse } from "../../../../server/http/errors";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireSession(request);
  if (!guard.ok) {
    return guard.response;
  }
  const { context, db, requestId } = guard;

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

    const plate = await readVehiclePlateForDisplay(db, context.vehicleId);
    if (plate !== undefined) {
      body.plate = plate;
    }
  }

  // T1.3, S1.3 — "GET /session platform oturumu için `username` döner."
  // Kişisel ekip kimliğinin ekranda görünmesi (S1.3 AC3 "çalışan ekip
  // kullanıcısının kimliği ekranda görünür") bu alana dayanır.
  if (context.kind === "platform" && context.platformUserId !== undefined) {
    const username = await readPlatformUsernameForDisplay(
      db,
      context.platformUserId,
    );
    if (username !== undefined) {
      body.username = username;
    }
  }

  return jsonSuccessResponse(200, body, { requestId });
}
