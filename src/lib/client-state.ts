/**
 * İstemci tarafı geçici veri (taslak/request_id) anahtarlama kuralı —
 * T1.4 ADIM 2/2, S1.4, görev tanımı (c).
 *
 * Kaynak — DECISIONS.md F6: "Taslak + request_id **localStorage**'da;
 * anahtar = credential/platform_user kimliği + araç; TTL 24 saat; çıkış/
 * oturum değişiminde temizlenir." ve görev tanımı: "anahtar öneki = kind +
 * credentialId/platformUserId + vehicleId, TTL 24 saat; süresi geçeni
 * okumama, clearClientStateForOtherScopes(currentScope) ve çıkışta tümünü
 * temizleme."
 *
 * DB/ağ YOK — bu SAF bir tarayıcı `Storage` sarmalayıcısıdır. `window`/
 * `localStorage` DOĞRUDAN KULLANILMAZ: `StorageLike` arayüzü enjekte edilir
 * (görev tanımı — "birim testleri (jsdom yok: localStorage'ı küçük bir
 * in-memory Storage ile enjekte et)"); gerçek UI kodu (T1.6+) çağırırken
 * tarayıcının kendi `window.localStorage`'ını geçirir.
 *
 * DÜZELTME (düzeltme turu 1): DECISIONS F6'nın istediği anahtar
 * (`credentialId`/`platformUserId`) artık GET /api/v1/session yanıtında
 * VARDIR (bkz. `../app/api/v1/session/route.ts` üst notu) — bu modül F6/
 * görev tanımının BİREBİR yazdığı kuralı uygular (`ClientStateScope.
 * credentialId`/`platformUserId` alanları) ve gerçek UI kodu (T1.6/T3.4)
 * bu değerleri GÜNCEL `GET /session` yanıtından doğrudan üretebilir;
 * `tests/integration/session-routes.test.ts` bunu gerçek route yanıtından
 * kanıtlar.
 */

/** `window.localStorage`'ın (veya testteki in-memory taklidinin) uyması
 * gereken minimal arayüz — yalnız bu modülün kullandığı 5 üye. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export type ClientStateActorKind = "vehicle" | "platform";

/**
 * Bir oturumun "kapsamı" — anahtar önekini üreten kimlik kümesi. `kind`
 * "vehicle" ise `credentialId` VE `vehicleId` ZORUNLUDUR (araç oturumu
 * kimliği + hangi araçta olduğu — aynı credential farklı araca ASLA
 * bağlanmaz ama okunabilirlik ve gelecekteki olası çok-araçlı senaryolar
 * için ikisi de anahtara girer); "platform" ise `platformUserId`
 * ZORUNLUDUR.
 */
export interface ClientStateScope {
  kind: ClientStateActorKind;
  credentialId?: string;
  platformUserId?: string;
  vehicleId?: string;
}

/** DECISIONS.md F6 — "TTL 24 saat." */
export const CLIENT_STATE_TTL_MS = 24 * 60 * 60 * 1000;

const KEY_PREFIX = "dolmus_takip:client_state:";

export class InvalidClientStateScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidClientStateScopeError";
  }
}

/**
 * Bir kapsamın anahtar ÖN EKİNİ üretir — "anahtar öneki = kind +
 * credentialId/platformUserId + vehicleId". Eksik zorunlu alan SESSİZCE
 * yok sayılmaz; programlama hatasını ERKEN yakalamak için fırlatılır
 * (CLAUDE.md — "varsayımda bulunma", geçersiz kapsamla sessizce yanlış bir
 * anahtar üretip başka bir kullanıcının verisini KARIŞTIRMAK çok daha
 * kötü bir sonuçtur).
 */
export function clientStateScopePrefix(scope: ClientStateScope): string {
  if (scope.kind === "vehicle") {
    if (!scope.credentialId || !scope.vehicleId) {
      throw new InvalidClientStateScopeError(
        'kind "vehicle" için credentialId VE vehicleId zorunludur.',
      );
    }
    return `${KEY_PREFIX}vehicle:${scope.credentialId}:${scope.vehicleId}:`;
  }
  if (!scope.platformUserId) {
    throw new InvalidClientStateScopeError(
      'kind "platform" için platformUserId zorunludur.',
    );
  }
  return `${KEY_PREFIX}platform:${scope.platformUserId}:`;
}

/** Belirli bir kapsam + ad için TAM localStorage anahtarı. */
export function clientStateKey(scope: ClientStateScope, name: string): string {
  return `${clientStateScopePrefix(scope)}${name}`;
}

interface StoredEnvelope<T> {
  value: T;
  /** ISO 8601 — yazıldığı an (`Clock` enjeksiyonu, testler zaman
   * kontrollü çalışabilsin diye; üretim kodu `systemClock` kullanır). */
  savedAt: string;
}

export type ClientStateClock = () => Date;
const systemClientStateClock: ClientStateClock = () => new Date();

/**
 * Bir taslağı/`request_id`'yi kaydeder. `storage.setItem` BAZI ortamlarda
 * (gizli sekme, dolu kota) fırlatabilir — bu yalnız kullanım KOLAYLIĞI
 * verisidir (DESIGN §2.10 — "Telefonun kapanması veya tarayıcı verilerinin
 * silinmesine karşı taslak kurtarma garantisi verilmez"), bu yüzden hata
 * SESSİZCE yutulur; kaydetme başarısızlığı KULLANICI İŞLEMİNİ engellemez.
 */
export function saveClientState<T>(
  storage: StorageLike,
  scope: ClientStateScope,
  name: string,
  value: T,
  clock: ClientStateClock = systemClientStateClock,
): void {
  const envelope: StoredEnvelope<T> = { value, savedAt: clock().toISOString() };
  try {
    storage.setItem(clientStateKey(scope, name), JSON.stringify(envelope));
  } catch {
    // Yukarıdaki not — kritik veri değil, sessizce yok say.
  }
}

/**
 * Bir taslağı okur. Üç durumda `null` döner: (1) hiç kayıt yok, (2) kayıt
 * bozuk/ayrıştırılamaz, (3) TTL (24 saat) GEÇMİŞ — "süresi geçeni
 * okumama" (görev tanımı). (3) durumunda kayıt AYRICA silinir (bir daha
 * kontrol edilmesine gerek kalmasın diye).
 */
export function readClientState<T>(
  storage: StorageLike,
  scope: ClientStateScope,
  name: string,
  clock: ClientStateClock = systemClientStateClock,
): T | null {
  const key = clientStateKey(scope, name);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }

  let envelope: StoredEnvelope<T>;
  try {
    envelope = JSON.parse(raw) as StoredEnvelope<T>;
  } catch {
    return null;
  }

  const savedAtMs = Date.parse(envelope.savedAt);
  const isExpired =
    !Number.isFinite(savedAtMs) ||
    clock().getTime() - savedAtMs >= CLIENT_STATE_TTL_MS;
  if (isExpired) {
    try {
      storage.removeItem(key);
    } catch {
      // Silme başarısız olsa bile bu çağrı yine de `null` döner — "süresi
      // geçeni okumama" garantisi BOZULMAZ.
    }
    return null;
  }

  return envelope.value;
}

/** Bu modülün yazdığı TÜM anahtarları (herhangi bir kapsam) listeler. */
function allClientStateKeys(storage: StorageLike): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(KEY_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * "clearClientStateForOtherScopes(currentScope)" — S1.4 AC2: "Ortak
 * telefonda başka kullanıcı/araçla giriş yapılınca önceki müşterinin
 * geçici form ve verisi yeni ekrana taşınmaz." `currentScope` KENDİ
 * anahtarları KORUNUR (ör. aynı oturumda sayfa yenileme taslağı silmez);
 * FARKLI kapsama ait (önceki kullanıcı/araç/ekip hesabı) HER ŞEY silinir.
 * `currentScope` `null` ise (ör. henüz giriş yapılmamış ekran) TÜM
 * kapsamlar silinir — bu, aşağıdaki `clearAllClientState`'in de temelidir.
 */
export function clearClientStateForOtherScopes(
  storage: StorageLike,
  currentScope: ClientStateScope | null,
): void {
  const keepPrefix = currentScope
    ? clientStateScopePrefix(currentScope)
    : null;
  for (const key of allClientStateKeys(storage)) {
    if (keepPrefix !== null && key.startsWith(keepPrefix)) {
      continue;
    }
    try {
      storage.removeItem(key);
    } catch {
      // En iyi çaba temizliği — kalan bir anahtar en fazla TTL'e kadar
      // yaşar ve zaten farklı bir kapsam ADI taşıdığından başka bir
      // ekranda OKUNMAZ (`readClientState` her zaman KENDİ kapsamının
      // anahtarını arar).
    }
  }
}

/**
 * "çıkışta tümünü temizleme" (görev tanımı) — S1.4 AC2/DESIGN §2.10
 * "Çıkışta müşteriye ait geçici veriler temizlenir." Çıkışta ARTIK hiçbir
 * kapsam "mevcut" sayılmadığından, bu `clearClientStateForOtherScopes`'u
 * `currentScope: null` ile çağırmakla AYNIDIR (tek kaynak, iki isim).
 */
export function clearAllClientState(storage: StorageLike): void {
  clearClientStateForOtherScopes(storage, null);
}
