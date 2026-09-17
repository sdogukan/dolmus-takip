/**
 * Türkçe ekran metinleri — T1.4 ADIM 2/2, S1.4, görev tanımı (d).
 *
 * "hata kodu → Türkçe ekran metni ('SESSION_EXPIRED' ve 'SESSION_REVOKED'
 * → 'Oturumun sona erdi. Yeniden giriş yap.'; DESIGN §2.10 tablosundaki
 * diğer metinleri de ekle)."
 *
 * Bu dosya İSTEMCİ (tarayıcı) tarafı içindir — `../server/**` KODUNU HİÇ
 * İÇE AKTARMAZ; sunucu route handler'larının ürettiği `error.code` alanını
 * (bkz. `../server/http/errors.ts`) EKRANDA gösterilecek Türkçe metne
 * çevirir. Sunucunun kendi `error.message`'ı (ör. `SessionRevokedError`'ın
 * "Oturum iptal edildi. Yeniden giriş yap." — bkz. `../server/usecases/
 * session/errors.ts`) BAŞKA bir amaca hizmet eder (API/log tüketicisi için
 * kod-özgü ayrıntı); bu dosyadaki eşleme İSE kasıtlı olarak SESSION_EXPIRED
 * ve SESSION_REVOKED'i AYNI kullanıcı mesajına birleştirir — S1.4 AC6'nın
 * verdiği metin BİREBİR budur ve kullanıcı için "süre doldu" ile "erişimin
 * iptal edildi" arasındaki fark ANLAMSIZDIR (ikisi de "yeniden giriş yap").
 *
 * `ERROR_CODE_MESSAGES` yalnız BU pakette (T1.4) VAR OLAN kodları içerir
 * (`SESSION_MISSING`/`SESSION_EXPIRED`/`SESSION_REVOKED` — `../server/
 * usecases/session/errors.ts`; `CSRF_TOKEN_INVALID`/`ORIGIN_INVALID` —
 * `../server/auth/guard.ts`). `UNSUPPORTED_MEDIA_TYPE`/`PAYLOAD_TOO_LARGE`
 * BİLEREK DIŞLANIR: bunlar gerçek bir kullanıcı eylemini değil, İSTEMCİ
 * KODUNUN KENDİ HATASINI (yanlış Content-Type/aşırı büyük gövde) yansıtır
 * ve DESIGN §2.10 tablosunda karşılığı yoktur — uydurma metin EKLENMEDİ.
 * Bu karar docs/DECISIONS.md'de AYRICA kayıtlı DEĞİLDİR ("open_issues"
 * diye bir dosya/bölüm YOKTUR — denetim bulgusu, düzeltme turu 2), yalnız
 * bu yorumda gerekçelendirilmiştir.
 */

/** Şu an bilinen oturum hatası kodları — `../server/usecases/session/
 * errors.ts` `SessionErrorCode` ile `../server/auth/guard.ts`'nin ürettiği
 * CSRF/origin kodlarının birleşimi. Tip burada YENİDEN İÇE AKTARILMAZ
 * (sunucu koduna bağımlılık kurmamak için serbest `string` anahtarlı bir
 * kayıt kullanılır); anahtarlar yukarıdaki iki dosyayla ELLE senkron
 * tutulur.
 */
export const ERROR_CODE_MESSAGES: Record<string, string> = {
  SESSION_MISSING: "Oturum bulunamadı. Giriş yap.",
  // S1.4 AC6 — birebir metin; SESSION_REVOKED de KASITLI olarak AYNI metni
  // kullanır (yukarıdaki dosya üstü not).
  SESSION_EXPIRED: "Oturumun sona erdi. Yeniden giriş yap.",
  SESSION_REVOKED: "Oturumun sona erdi. Yeniden giriş yap.",
  // ARCHITECTURE §6 "CSRF" / görev tanımı (b) — kullanıcıya CSRF/origin
  // JARGONU gösterilmez; DESIGN §2.10 "Yetkisiz / pasif erişim" satırının
  // metniyle AYNI ("Bu işlem için erişimin yok.") kullanılır: kullanıcı
  // açısından engellenen bir yazma isteği, yetkisi olmayan bir işlem
  // denemesinden AYIRT EDİLEMEZ bir deneyimdir. DESIGN bu eşlemeyi birebir
  // VERMEZ — bu bir mühendislik yorumudur; docs/DECISIONS.md'de AYRICA
  // kayıtlı DEĞİLDİR (denetim bulgusu, düzeltme turu 2).
  CSRF_TOKEN_INVALID: "Bu işlem için erişimin yok.",
  ORIGIN_INVALID: "Bu işlem için erişimin yok.",
};

/**
 * `code` bilinen bir hata koduysa Türkçe ekran metnini döner; bilinmeyen
 * kod için `undefined` döner (UYDURMA fallback metin YAZILMAZ — çağıran
 * ekran kendi genel hata metnini seçer).
 */
export function getErrorMessage(code: string): string | undefined {
  return ERROR_CODE_MESSAGES[code];
}

/**
 * DESIGN.md §2.10 "Ortak durumlar ve ekran metinleri" tablosunun SABİT
 * (parametresiz) satırları — her anahtarın üstünde tablodaki karşılığı
 * BİREBİR alıntılanır. Alan hatası mesajları ("Hasılatı gir.", "Geçerli
 * bir saat seç." gibi) buraya EKLENMEDİ: bunlar tablonun kendi verdiği
 * SOMUT ÖRNEKLERDİR, genel bir sabit metin değil — her form kendi alan
 * mesajını üretir (T3.x).
 */
export const COMMON_SCREEN_MESSAGES = {
  /** "Yükleniyor" satırı — "'Kayıtlar yükleniyor…' / nötr yer tutucular;
   * gerçek veri gelmeden finansal tutarlar 0 gösterilmez." */
  loading: "Kayıtlar yükleniyor…",
  /** "Gerçekten boş dönem" satırı — "Başarılı sorgudan sonra 'Bu dönemde
   * kayıt yok.'; 0 toplam ancak veri gerçekten boşsa." */
  trulyEmptyPeriod: "Bu dönemde kayıt yok.",
  /** "Kayıt sürüyor" satırı — "'Kaydediliyor…'; aynı işlem düğmesi geçici
   * kapalı, durum ekran okuyucuya da bildirilir." */
  saving: "Kaydediliyor…",
  /** "Sunucu kaydı kesin başarılı" satırı — "'Kaydedildi.' ve ilgili
   * kayıt; yeni kayıt/rapor açılabilir." */
  savedSuccessfully: "Kaydedildi.",
  /** "Gönderim sonrası bağlantı koptu" satırı — "'Kaydın sonucu kontrol
   * ediliyor.' Sonuç bilinmeden 'Kaydedilemedi' veya 'Kaydedildi' denmez." */
  checkingResultAfterDisconnect: "Kaydın sonucu kontrol ediliyor.",
  /** "Gönderilmediği bilinen bağlantı hatası" satırı — "'Bağlantı yok.
   * Henüz kaydedilmedi.' Mevcut sayfadaki form korunur." */
  knownDisconnectBeforeSubmit: "Bağlantı yok. Henüz kaydedilmedi.",
  /** "İki kişinin aynı kaydı düzenlemesi" satırı — F7/ARCHITECTURE §3.4
   * ile senkronlanmış KANONİK metin: "'Bu kayıt değişmiş. Güncel halini
   * açıp tekrar kontrol et.' Eski taslak sessizce üzerine yazılmaz." */
  concurrentEditConflict:
    "Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.",
  /** "Onaylı düzeltme başarılı" satırı — "'Kayıt düzeltildi ve
   * onaylandı.' Yeni değerler birlikte görünür." */
  correctedAndConfirmed: "Kayıt düzeltildi ve onaylandı.",
  /** "Rapor alınamadı" satırı — "'Rapor yüklenemedi. Tekrar dene.' Önceki
   * veri gösterilecekse eski olduğu ve ait olduğu dönem açık kalır." */
  reportLoadFailed: "Rapor yüklenemedi. Tekrar dene.",
  /** "Oturum bitti" satırı — S1.4 AC6 ile BİREBİR aynı metin (bkz.
   * `ERROR_CODE_MESSAGES.SESSION_EXPIRED`/`SESSION_REVOKED`); burada AYRICA
   * DURUM tabanlı (kod OLMADAN) erişim için tekrarlanır. "Taslak ancak aynı
   * yetkili araç/ekip hedefi doğrulandıktan sonra geri yüklenir. Başka
   * müşteri/rol ekranına veri taşınmaz." (bkz. `./client-state.ts`). */
  sessionEnded: "Oturumun sona erdi. Yeniden giriş yap.",
  /** "Yetkisiz / pasif erişim" satırı — "Veri açılmaz; 'Bu işlem için
   * erişimin yok.' veya pasif araç açıklaması ve girişe dönüş." (pasif
   * araç açıklamasının somut metni bu tabloda VERİLMEZ — T1.5/T1.6'ya
   * bırakıldı.) */
  unauthorizedOrInactiveAccess: "Bu işlem için erişimin yok.",
} as const;
