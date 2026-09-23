/**
 * Destek hedefi (araç) değiştirilirken bırakılan taslakların anahtarları —
 * SAF; `storage` enjekte edilir (`./client-state.ts` deseni).
 *
 * Taslaklar araç kimliğiyle anahtarlanır ama kapsam (`scopeKey`) ekip
 * oturumundandır ve araç İÇERMEZ; bu yüzden hedef değişirken eski aracın
 * taslakları AÇIKÇA silinmelidir, yoksa araç yeniden açılınca eski yazılan
 * değer geri gelir.
 */
import { clientStateKey, type ClientStateScope, type StorageLike } from "./client-state";
import { driversDraftName } from "./drivers-ui";

export function vehicleDetailDraftName(vehicleId: string): string {
  return `arac-${vehicleId}`;
}

export function vehicleResetDraftName(vehicleId: string): string {
  return `arac-sifre-${vehicleId}`;
}

/** Bir aracın üç formunun (bilgi/aktiflik, şifre sıfırlama, şoförler)
 * taslak adları. */
export function vehicleDraftNames(vehicleId: string): string[] {
  return [
    vehicleDetailDraftName(vehicleId),
    vehicleResetDraftName(vehicleId),
    driversDraftName(vehicleId),
  ];
}

/** Yalnız bu aracın taslaklarını siler; başka araç/kapsam anahtarlarına
 * dokunmaz. Depo hatası kullanıcı akışını engellemez (`saveClientState`
 * ile aynı gerekçe). */
export function clearVehicleDrafts(
  storage: StorageLike,
  scope: ClientStateScope,
  vehicleId: string,
): void {
  for (const name of vehicleDraftNames(vehicleId)) {
    try {
      storage.removeItem(clientStateKey(scope, name));
    } catch {
      // En iyi çaba — kalan anahtar en fazla TTL'e kadar yaşar.
    }
  }
}
