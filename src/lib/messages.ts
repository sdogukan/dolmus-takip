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
// T1.2 metinleri — görev tanımının BİREBİR verdiği üç durum. Önce DAR
// (literal, index-imzası OLMAYAN) sabitler olarak tanımlanır: hem aşağıdaki
// `ERROR_CODE_MESSAGES` (client-side kod→metin eşlemesi, GENİŞ `Record<
// string,string>` tipli) hem de `VEHICLE_LOGIN_RESULT_MESSAGES` (route
// handler'ın DAR tipe ihtiyaç duyduğu — bkz. onun üst notu) AYNI TEK
// kaynaktan (bu üç sabit) beslenir; metin İKİ YERDE AYRI YAZILMAZ.
const INVALID_CREDENTIALS_MESSAGE = "Plaka veya şifre yanlış.";
const RATE_LIMITED_MESSAGE = "Çok fazla deneme. Lütfen biraz bekleyip tekrar dene.";
const HASH_QUEUE_FULL_MESSAGE = "Sistem şu anda yoğun. Lütfen tekrar dene.";

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
  // T1.2, STORIES.md S1.2 AC4 — "Biçimi geçerli ama tanımsız plaka ile
  // yanlış şifre aynı genel 'Plaka veya şifre yanlış.' mesajını verir."
  // ARCHITECTURE §6 "Kullanıcı/plaka tahmini" — bilinmeyen plaka, pasif
  // araç/işletme VE yanlış parola aynı bu genel yanıtı üretir; hangi
  // durumun gerçekleştiği (plaka yok mu, araç pasif mi, şifre yanlış mı)
  // bu metinden ASLA ayırt edilemez.
  INVALID_CREDENTIALS: INVALID_CREDENTIALS_MESSAGE,
  // T1.2, görev tanımı (2) — ARCHITECTURE §6 "Giriş saldırıları" birebir:
  // "429/geçici bekleme ... anlaşılır mesaj." Görev tanımının verdiği
  // BİREBİR metin.
  RATE_LIMITED: RATE_LIMITED_MESSAGE,
  // T1.2, görev tanımı (3) — ARCHITECTURE §6 "Hash yükü": "Aşım 429";
  // görev tanımı: "mesaj: sistem yoğun, tekrar dene." Kullanıcıya teknik
  // "kuyruk/hash" ayrıntısı SIZDIRILMAZ.
  HASH_QUEUE_FULL: HASH_QUEUE_FULL_MESSAGE,
};

/**
 * `ERROR_CODE_MESSAGES`'teki AYNI üç metnin (üstteki dosya-özel sabitler)
 * DAR (index imzası OLMAYAN, `as const`) tipli tekrarı — `../server/
 * usecases/auth/vehicle-login.ts`'in ROUTE HANDLER'ı (`../app/api/v1/
 * auth/vehicle-login/route.ts`) bu sabitleri DOĞRUDAN kullanır.
 * `tsconfig.json` `noUncheckedIndexedAccess: true` altında `Record<
 * string, string>` (yukarıdaki `ERROR_CODE_MESSAGES`'in tipi) üzerindeki
 * HER erişim — nokta gösterimiyle bile — `string | undefined` döner
 * (TypeScript bunu bir index-imzası erişimi SAYAR); route handler'ın
 * KESİN bildiği (sabit, hardcoded) bir anahtarı `!` gibi bir GÜVENSİZ
 * olumsuzlama OPERATÖRÜYLE "biliyorum" DEMEDEN kullanabilmesi için bu üç
 * metin AYRICA (tek kaynak METNİ birebir KORUYARAK, yalnız TİP amacıyla)
 * burada dar tipli bir sabitte tekrarlanır.
 */
export const VEHICLE_LOGIN_RESULT_MESSAGES = {
  invalidCredentials: INVALID_CREDENTIALS_MESSAGE,
  rateLimited: RATE_LIMITED_MESSAGE,
  hashQueueFull: HASH_QUEUE_FULL_MESSAGE,
  /**
   * T1.2 ADIM 2/2 — görev tanımı (1, birebir): "ağ hatasında 'Bağlantı
   * kurulamadı. Tekrar dene.' benzeri metin (messages.ts)." Diğer üçünden
   * FARKLI olarak bu metnin sunucu tarafında bir karşılığı YOKTUR (sunucu
   * hiçbir zaman "ağ hatası" ÜRETMEZ — bu, `fetch()`'in KENDİSİNİN
   * (bağlantı hiç kurulamadığı, isteğin sunucuya ULAŞMADIĞI için) attığı
   * bir istisnadır); yalnız `../app/giris/login-form.tsx` bu sabiti okur.
   * Yine de aynı "tek kaynak" ilkesiyle burada, diğer üç giriş-sonucu
   * metniyle YAN YANA tutulur — ikinci bir kopya YAZILMAZ.
   */
  networkError: "Bağlantı kurulamadı. Tekrar dene.",
} as const;

/**
 * Araç girişi (POST /api/v1/auth/vehicle-login) alan doğrulama metinleri —
 * T1.2, STORIES.md S1.2 AC3: "Biçimi geçersiz veya eksik plaka için
 * anlaşılır alan hatası gösterilir." Görev tanımı (1): "Plaka biçimi
 * geçersiz' benzeri Türkçe metin, src/lib/messages.ts."
 *
 * Bu üç metin hem SUNUCU tarafından (422 yanıtının `error.fields.plate`/
 * `error.fields.password` değeri — bkz. `../server/usecases/auth/
 * vehicle-login.ts`) hem de (ileride, T1.6'da) EKRAN tarafından aynı
 * kaynaktan okunur; DESIGN.md §2.10'un "Eksik/geçersiz alan" satırındaki
 * ÖRNEK biçimle (ör. "Hasılatı gir.") aynı kalıptadır — boş alan ve
 * biçimsiz-ama-dolu alan AYRI, daha isabetli metinler taşır (STORIES bu
 * ikisini TEK bir metinle sınırlamaz, yalnız "anlaşılır" der).
 */
export const VEHICLE_LOGIN_FIELD_MESSAGES = {
  /** `validatePlate` `reason: "empty"`. */
  plateEmpty: "Plakayı gir.",
  /** `validatePlate` `reason: "invalid_format"` — görev tanımının verdiği
   * BİREBİR örnek metin. */
  plateInvalidFormat: "Plaka biçimi geçersiz.",
  /** Boş/eksik şifre alanı. */
  passwordEmpty: "Şifreyi gir.",
} as const;

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
