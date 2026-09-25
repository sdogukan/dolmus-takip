/**
 * Oturum çözümleme hataları (T1.4 ADIM 1/2, S1.4).
 *
 * Görev tanımı — "API hata sözleşmesi: 401 için kod alanı
 * (SESSION_MISSING | SESSION_EXPIRED | SESSION_REVOKED)". Üç kod arasındaki
 * ayrım (hangi geçersizlik nedeni hangi koda düşer) açıkça tanımlanmamıştır;
 * burada seçilen eşleme, oturum kurallarının kendi terimlerine dayanır:
 *
 * - SESSION_MISSING: çerez/token hiç yok VEYA token_hash DB'de eşleşmiyor
 *   (hiç var olmamış/geçersiz token — "oturum bulunamadı").
 * - SESSION_EXPIRED: yalnız ZAMANA bağlı geçersizlik — mutlak süre
 *   (`expires_at`) veya hareketsizlik sınırı aşılmış. S1.4 AC6
 *   bu durum için TAM METNİ verir: "Süre bittiğinde 'Oturumun sona erdi.
 *   Yeniden giriş yap.' gösterilir" — bu yüzden yalnız zaman aşımı bu
 *   metni taşır.
 * - SESSION_REVOKED: ERİŞİME bağlı geçersizlik — `revoked_at` dolu
 *   (logout/parola sıfırlama/pasiflik gibi kullanım durumlarının
 *   yazacağı açık iptal) VEYA `issued_version` güncel credential/platform
 *   sürümüyle uyuşmuyor VEYA ilgili işletme/araç/platform kullanıcısı
 *   pasif. Yenileme ve iptal kuralı bu üç durumu (logout, parola
 *   sıfırlama, pasiflik) tek bir şemsiye terimle — "iptal" — anar ve
 *   credential sürümü iptal edilmiş eski session'ın kullanılmasını
 *   engeller; bu yüzden version uyuşmazlığı ve
 *   pasiflik de REVOKED sayılır, EXPIRED değil.
 *
 * Bu eşleme kelimesi kelimesine verilmiş bir kural değil, yukarıdaki iki
 * kurala dayanan mühendislik yorumudur. "open_issues" diye bir dosya/bölüm
 * YOKTUR (denetim bulgusu, düzeltme turu 2); bu eşleme başka bir yerde
 * AYRICA kayıtlı değildir — yalnız bu yorumda gerekçelendirilmiştir.
 */

export type SessionErrorCode =
  | "SESSION_MISSING"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED";

export class SessionError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = "SessionError";
    this.code = code;
  }
}

export class SessionMissingError extends SessionError {
  constructor(message = "Oturum bulunamadı. Giriş yap.") {
    super("SESSION_MISSING", message);
    this.name = "SessionMissingError";
  }
}

/** Metin S1.4 AC6'dan BİREBİR alınmıştır; değiştirilmemelidir. */
export class SessionExpiredError extends SessionError {
  constructor(message = "Oturumun sona erdi. Yeniden giriş yap.") {
    super("SESSION_EXPIRED", message);
    this.name = "SessionExpiredError";
  }
}

export class SessionRevokedError extends SessionError {
  constructor(message = "Oturum iptal edildi. Yeniden giriş yap.") {
    super("SESSION_REVOKED", message);
    this.name = "SessionRevokedError";
  }
}

/**
 * `createVehicleSession` girdisi geçersiz (var olmayan credential id) ise
 * fırlatılır. Bu, T1.2/T1.3'ün (bu paket dışı) parola doğrulamasından
 * SONRA çağrılması beklenen bir kullanım durumu için savunma amaçlı bir
 * bütünlük denetimidir — normal akışta hiç tetiklenmemesi beklenir.
 */
export class VehicleCredentialNotFoundError extends Error {
  constructor(credentialId: string) {
    super(`vehicle_credentials bulunamadı: "${credentialId}".`);
    this.name = "VehicleCredentialNotFoundError";
  }
}

/** `createPlatformSession` için `VehicleCredentialNotFoundError` karşılığı. */
export class PlatformUserNotFoundError extends Error {
  constructor(platformUserId: string) {
    super(`platform_users bulunamadı: "${platformUserId}".`);
    this.name = "PlatformUserNotFoundError";
  }
}

/**
 * T2.2 — `createVehicleSession`in aracın/işletmenin GÜNCEL aktifliğini
 * `sessions` INSERT'iyle AYNI transaction içinde yeniden denetlediğinde
 * (giriş/pasifleştirme yarışını kapatmak için — bkz. o dosyanın üst notu)
 * fırlatılır. `../auth/vehicle-login.ts` bunu YAKALAR ve diğer TÜM
 * başarısız giriş nedenleriyle (bilinmeyen plaka, yanlış parola) AYNI genel
 * 401 `INVALID_CREDENTIALS` yanıtına ÇEVİRİR — kullanıcı/plaka tahmini
 * ilkesi (hangi durumun gerçekleştiği asla ayırt edilemez) burada da
 * geçerlidir; bu yüzden bu sınıf `SessionError` DEĞİLDİR (o, `resolveSession`in
 * 401 ZARFINA doğrudan giden ayrı bir aile — bkz. dosya üstü not).
 */
export class VehicleSessionTargetInactiveError extends Error {
  constructor(message = "Araç veya işletme artık pasif; oturum açılamaz.") {
    super(message);
    this.name = "VehicleSessionTargetInactiveError";
  }
}

/**
 * T2.3 — `createVehicleSession`e bir `expectedCredentialVersion` verildiğinde
 * (bkz. o dosyanın üst notu — giriş/parola sıfırlama yarışı), transaction
 * içinde YENİDEN okunan `credential_version` bu beklenen değerden FARKLIYSA
 * fırlatılır (satır INSERT EDİLMEZ). `../auth/vehicle-login.ts` bunu
 * `VehicleSessionTargetInactiveError` ile AYNI şekilde YAKALAR ve diğer TÜM
 * başarısız giriş nedenleriyle AYNI genel 401 `INVALID_CREDENTIALS` yanıtına
 * ÇEVİRİR (kullanıcı/plaka tahmini ilkesi burada da geçerlidir) —
 * bu yüzden bu sınıf da `SessionError` DEĞİLDİR.
 */
export class VehicleCredentialVersionChangedError extends Error {
  constructor(message = "Credential sürümü değişti; oturum açılamaz.") {
    super(message);
    this.name = "VehicleCredentialVersionChangedError";
  }
}

/**
 * `createPlatformSession` oturum INSERT'iyle AYNI transaction içinde hesabın
 * artık pasif olduğunu görürse fırlatılır (giriş/pasifleştirme yarışı —
 * `VehicleSessionTargetInactiveError` karşılığı). `../auth/platform-login.ts`
 * bunu genel 401 `INVALID_CREDENTIALS`e ÇEVİRİR; bu yüzden `SessionError`
 * DEĞİLDİR.
 */
export class PlatformSessionTargetInactiveError extends Error {
  constructor(message = "Ekip hesabı artık pasif; oturum açılamaz.") {
    super(message);
    this.name = "PlatformSessionTargetInactiveError";
  }
}

/**
 * `createPlatformSession`e verilen `expectedCredentialVersion`, transaction
 * içinde yeniden okunan güncel sürümden farklıysa (giriş/parola sıfırlama
 * yarışı — `VehicleCredentialVersionChangedError` karşılığı) fırlatılır.
 * `SessionError` DEĞİLDİR; `platformLogin` genel 401'e çevirir.
 */
export class PlatformCredentialVersionChangedError extends Error {
  constructor(message = "Credential sürümü değişti; oturum açılamaz.") {
    super(message);
    this.name = "PlatformCredentialVersionChangedError";
  }
}
