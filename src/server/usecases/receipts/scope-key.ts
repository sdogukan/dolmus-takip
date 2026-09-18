/**
 * mutation_receipts scope_key üretimi — T1.5 ADIM 2/2, S1.5.
 *
 * Görev tanımı (birebir): "mutation_receipts kapsam bağı (ARCH §3.4):
 * src/server/usecases/receipts/: scope_key = kalıcı aktör kimliği
 * (credentialId | platformUserId) + ':' + businessId + ':' + vehicleId."
 *
 * ARCHITECTURE.md §3.4 — "Scope, oturum tokenına değil kalıcı credential/
 * ekip kimliğine ve işlem hedefi kapsamına bağlanır; tekrar giriş sonrası
 * aynı request_id korunabilir." Bu yüzden anahtar `sessionId`'ye DEĞİL
 * (oturum her girişte değişir — aynı isteğin tekrarında sessionId farklı
 * olabilir), `../../auth/scope.ts` `Scope`'un taşıdığı KALICI kimliğe
 * (VehicleScope.credentialId veya StaffScope.platformUserId) bağlanır.
 *
 * DİKKAT — bu, `../../auth/scope.ts` `computeScopeKey`'DEN (GET /session
 * yanıtındaki opak, SHA-256 KISALTILMIŞ `scopeKey`) FARKLI bir fonksiyondur:
 * o, İSTEMCİYE dönen bir DIŞ kimlik (gizli olmayan ama OPAK olması istenen,
 * DECISIONS.md F6/T1.4 notu — "client-state anahtarı"); BU fonksiyon ise
 * yalnız SUNUCU İÇİ bir DB birincil anahtar bileşenidir (mutation_receipts
 * satırının `(scope_key, request_id)` UNIQUE'i, §3.2) ve İSTEMCİYE ASLA
 * DÖNMEZ — görev tanımı burada hash İSTEMEZ, ham (okunabilir) birleştirme
 * ister ("scope_key = ... + ':' + ... + ':' + ..."). İki fonksiyonun farklı
 * biçimi KASITLIDIR; birbirinin yerine KULLANILAMAZ.
 *
 * `vehicleId` — StaffScope'un salt işletme hedefli hali (`/admin/
 * businesses/:id` gibi, bkz. `../../auth/scope.ts` `StaffScope.vehicleId?`)
 * için BOŞ olabilir; görev tanımının verdiği üç parçalı biçim (businessId +
 * vehicleId) HER ZAMAN İKİSİNİ de içerdiğinden, `vehicleId` yokken boş
 * dizeyle YER TUTULUR (bkz. `../../auth/scope.ts` `computeScopeKey`'in AYNI
 * kararı, birebir gerekçeyle — orada da `vehiclePart = context.vehicleId ??
 * ""`). Mutasyon makbuzlarının T3.4+ kullanım durumları PRATİKTE her zaman
 * belirli bir ARACA bağlı olacağından (work_entries her zaman vehicle_id
 * taşır — §3.2) bu boş-dize dalı bugün HİÇ TETİKLENMEZ; yalnız gelecekte
 * salt-işletme hedefli bir mutasyon (ör. /admin/businesses/:id PATCH)
 * receipts modülünü kullanmak isterse programlama hatası olmadan
 * ÇALIŞMAYA devam eder.
 */
import type { ReceiptScope } from "../../auth/scope";

/**
 * T2.1 — `scope` artık tam bir `Scope` (businessId her zaman dolu) VEYA
 * (POST /admin/businesses gibi hedef işletme henüz VAR OLMADAN önceki
 * oluşturma uçları için) `StaffActorScope` (businessId/vehicleId YOK)
 * olabilir; `businessId`/`vehicleId` YOKSA aynı boş-dize yer tutucu
 * (`../../auth/scope.ts` `computeScopeKey`'in de kullandığı desen)
 * kullanılır — bu, gerçek bir işletmenin ASLA üretemeyeceği bir
 * `scope_key` biçimidir (gerçek `businessId` hiçbir zaman boş dize
 * değildir), bu yüzden aktör-düzeyi ve işletme-düzeyi makbuzlar ASLA
 * çakışmaz.
 */
export function computeReceiptScopeKey(scope: ReceiptScope): string {
  const actorId = scope.kind === "vehicle" ? scope.credentialId : scope.platformUserId;
  const businessPart = "businessId" in scope ? scope.businessId : "";
  const vehiclePart = "vehicleId" in scope ? (scope.vehicleId ?? "") : "";
  return `${actorId}:${businessPart}:${vehiclePart}`;
}
