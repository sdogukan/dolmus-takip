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
import { workEntryDraftName, workEntryEditDraftPrefix } from "./work-entry-ui";

export function vehicleDetailDraftName(vehicleId: string): string {
  return `arac-${vehicleId}`;
}

export function vehicleResetDraftName(vehicleId: string): string {
  return `arac-sifre-${vehicleId}`;
}

/** Bir aracın dört formunun (bilgi/aktiflik, şifre sıfırlama, şoförler,
 * çalışma kaydı) taslak adları; kayıt düzenleme taslakları ayrıca önekle silinir. */
export function vehicleDraftNames(vehicleId: string): string[] {
  return [
    vehicleDetailDraftName(vehicleId),
    vehicleResetDraftName(vehicleId),
    driversDraftName(vehicleId),
    workEntryDraftName(vehicleId),
  ];
}

/** Bu aracın kayıt düzenleme taslakları (kayıt başına bir tane) — adları önceden
 * bilinmediğinden anahtar önekiyle bulunur. */
function entryEditDraftKeys(storage: StorageLike, scope: ClientStateScope, vehicleId: string): string[] {
  const prefix = clientStateKey(scope, workEntryEditDraftPrefix(vehicleId));
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && key.startsWith(prefix)) keys.push(key);
    }
  } catch {
    // En iyi çaba — bulunamayan anahtar en fazla TTL'e kadar yaşar.
  }
  return keys;
}

/** Yalnız bu aracın taslaklarını siler; başka araç/kapsam anahtarlarına
 * dokunmaz. Depo hatası kullanıcı akışını engellemez (`saveClientState`
 * ile aynı gerekçe). */
export function clearVehicleDrafts(
  storage: StorageLike,
  scope: ClientStateScope,
  vehicleId: string,
): void {
  const keys = [
    ...vehicleDraftNames(vehicleId).map((name) => clientStateKey(scope, name)),
    ...entryEditDraftKeys(storage, scope, vehicleId),
  ];
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // En iyi çaba — kalan anahtar en fazla TTL'e kadar yaşar.
    }
  }
}
