/**
 * Oturum çözümleme hataları (T1.4 ADIM 1/2, S1.4).
 *
 * Görev tanımı — "ARCHITECTURE §4 hata sözleşmesi: 401 için kod alanı
 * (SESSION_MISSING | SESSION_EXPIRED | SESSION_REVOKED)". Üç kod arasındaki
 * ayrım (hangi geçersizlik nedeni hangi koda düşer) ARCHITECTURE'da açık
 * yazılmaz; burada seçilen eşleme, dokümanın kendi terimlerine dayanır:
 *
 * - SESSION_MISSING: çerez/token hiç yok VEYA token_hash DB'de eşleşmiyor
 *   (hiç var olmamış/geçersiz token — "oturum bulunamadı").
 * - SESSION_EXPIRED: yalnız ZAMANA bağlı geçersizlik — mutlak süre
 *   (`expires_at`) veya hareketsizlik sınırı aşılmış. STORIES.md S1.4 AC6
 *   bu durum için TAM METNİ verir: "Süre bittiğinde 'Oturumun sona erdi.
 *   Yeniden giriş yap.' gösterilir" — bu yüzden yalnız zaman aşımı bu
 *   metni taşır.
 * - SESSION_REVOKED: ERİŞİME bağlı geçersizlik — `revoked_at` dolu
 *   (logout/parola sıfırlama/pasiflik gibi kullanım durumlarının
 *   yazacağı açık iptal) VEYA `issued_version` güncel credential/platform
 *   sürümüyle uyuşmuyor VEYA ilgili işletme/araç/platform kullanıcısı
 *   pasif. ARCHITECTURE §6 "Yenileme ve iptal" satırı bu üç durumu
 *   (logout, parola sıfırlama, pasiflik) tek bir şemsiye terimle —
 *   "iptal" — anar ve "Credential sürümü iptal edilmiş eski session'ın
 *   kullanılmasını engeller" der; bu yüzden version uyuşmazlığı ve
 *   pasiflik de REVOKED sayılır, EXPIRED değil.
 *
 * Bu eşleme ARCHITECTURE'ın kelimesi kelimesine verdiği bir kural değil,
 * yukarıdaki iki alıntıya dayanan mühendislik yorumudur. "open_issues" diye
 * bir dosya/bölüm YOKTUR (denetim bulgusu, düzeltme turu 2); bu eşleme
 * docs/DECISIONS.md'de AYRICA kayıtlı değildir — yalnız bu yorumda
 * gerekçelendirilmiştir.
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

/** Metin STORIES.md S1.4 AC6'dan BİREBİR alınmıştır; değiştirilmemelidir. */
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
