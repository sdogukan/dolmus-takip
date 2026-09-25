/**
 * İstemci tarafı geçici veri (taslak/request_id) anahtarlama kuralı —
 * T1.4 ADIM 2/2, S1.4, görev tanımı (c); düzeltme turu 1 ile `scopeKey`
 * tabanlı tek anahtara geçirildi.
 *
 * Kaynak — F6 kararı: taslak + request_id **localStorage**'da; anahtar =
 * credential/platform_user kimliği + araç; TTL 24 saat; çıkış/oturum
 * değişiminde temizlenir. T1.4 kararı: GET /session istemciye
 * sessionId/credentialId/platformUserId VERMEZ; client-state (F6) anahtarı
 * için T1.5'te yanıta gizli olmayan opak `scopeKey` eklenir.
 *
 * DB/ağ YOK — bu SAF bir tarayıcı `Storage` sarmalayıcısıdır. `window`/
 * `localStorage` DOĞRUDAN KULLANILMAZ: `StorageLike` arayüzü enjekte edilir
 * (görev tanımı — "birim testleri (jsdom yok: localStorage'ı küçük bir
 * in-memory Storage ile enjekte et)"); gerçek UI kodu (T1.6+) çağırırken
 * tarayıcının kendi `window.localStorage`'ını geçirir.
 *
 * DÜZELTME (denetim bulgusu, düzeltme turu 1): önceki sürüm F6'nın "anahtar
 * = credential/platform_user kimliği + araç" cümlesini HAM `credentialId`/
 * `platformUserId` alanlarıyla uyguluyordu — ama bu iki alan GET /session
 * yanıtında YOKTUR ve T1.4 kararı gereği asla EKLENMEYECEKTİR
 * (bkz. `../app/api/v1/session/route.ts` üst notu). Gerçek UI kodunun
 * KULLANABİLECEĞİ tek eşdeğer, sunucunun ZATEN aynı kimliklerden ürettiği
 * opak `scopeKey`dir (`../server/auth/scope.ts` `computeScopeKey`:
 * SHA-256(kind + credentialId/platformUserId + vehicleId) — F6'nın istediği
 * "kimlik + araç" bileşimini birebir kapsar, yalnız hash'lenmiş/kısaltılmış
 * biçimde). Bu yüzden `ClientStateScope` artık kendi ayrı kind/credentialId/
 * platformUserId/vehicleId alanlarını TUTMAZ; doğrudan `scopeKey`'i sarar.
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

/**
 * Bir oturumun "kapsamı" — anahtar önekini üreten kimlik. `scopeKey`,
 * GET /api/v1/session yanıtındaki opak alanın AYNISIDIR (bkz. dosya üstü
 * notu); bu modül onun İÇİNİ hiç açmaz, yalnız bir anahtar öneki olarak
 * kullanır.
 */
export interface ClientStateScope {
  scopeKey: string;
}

/** F6 — TTL 24 saat. */
export const CLIENT_STATE_TTL_MS = 24 * 60 * 60 * 1000;

const KEY_PREFIX = "dolmus_takip:client_state:";

export class InvalidClientStateScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidClientStateScopeError";
  }
}

/**
 * Bir kapsamın anahtar ÖN EKİNİ üretir — `scopeKey` (GET /session'ın opak
 * alanı) DOĞRUDAN kullanılır; bu, F6'nın istediği "kind + credential/
 * platform_user kimliği + araç" ayrımını zaten TAŞIR (bkz. `computeScopeKey`
 * — kind farklıysa, aynı kind içinde kimlik veya araç farklıysa scopeKey de
 * farklıdır). Boş/whitespace-only bir `scopeKey` SESSİZCE kabul edilmez;
 * programlama hatasını ERKEN yakalamak için fırlatılır (CLAUDE.md —
 * "varsayımda bulunma", geçersiz kapsamla sessizce yanlış bir anahtar
 * üretip başka bir kullanıcının verisini KARIŞTIRMAK çok daha kötü bir
 * sonuçtur).
 */
export function clientStateScopePrefix(scope: ClientStateScope): string {
  if (!scope.scopeKey.trim()) {
    throw new InvalidClientStateScopeError("scopeKey boş olamaz.");
  }
  return `${KEY_PREFIX}${scope.scopeKey}:`;
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
 * verisidir (telefonun kapanması veya tarayıcı verilerinin silinmesine
 * karşı taslak kurtarma garantisi verilmez), bu yüzden hata
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
 * "çıkışta tümünü temizleme" (görev tanımı) — S1.4 AC2: çıkışta müşteriye
 * ait geçici veriler temizlenir. Çıkışta ARTIK hiçbir
 * kapsam "mevcut" sayılmadığından, bu `clearClientStateForOtherScopes`'u
 * `currentScope: null` ile çağırmakla AYNIDIR (tek kaynak, iki isim).
 */
export function clearAllClientState(storage: StorageLike): void {
  clearClientStateForOtherScopes(storage, null);
}
