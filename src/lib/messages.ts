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
// T1.3, S1.3 AC4 (birebir) — "Geçersiz giriş kullanıcı adının varlığını
// ifşa etmeden genel hata verir." Görev tanımı: "genel hata 401
// INVALID_CREDENTIALS ('Kullanıcı adı veya şifre yanlış.')." KASITLI
// olarak `INVALID_CREDENTIALS_MESSAGE`'DAN (plaka metni) FARKLI bir metin
// — aynı HTTP hata KODU (`INVALID_CREDENTIALS`) iki farklı giriş ekranında
// (araç/ekip) KENDİ bağlamına uygun Türkçe metinle gösterilir; ekip giriş
// ekranı (ADIM 2/2) bu sabiti DOĞRUDAN kullanır, `ERROR_CODE_MESSAGES`'in
// KOD bazlı genel eşlemesini KULLANMAZ.
const PLATFORM_INVALID_CREDENTIALS_MESSAGE = "Kullanıcı adı veya şifre yanlış.";
// Hem araç hem ekip girişinin PAYLAŞTIĞI şifre alanı boş-hata metni — tek
// kaynak, iki alan-mesajı sabitinde (aşağıda) tekrar KULLANILIR, tekrar
// YAZILMAZ.
const PASSWORD_EMPTY_MESSAGE = "Şifreyi gir.";
// F7/ARCHITECTURE §3.4 kanonik 409 metni — hem `ERROR_CODE_MESSAGES.
// VERSION_CONFLICT` hem `COMMON_SCREEN_MESSAGES.concurrentEditConflict`
// AYNI kaynaktan beslenir (aşağıdaki `ERROR_CODE_MESSAGES` `COMMON_SCREEN_
// MESSAGES`'TEN ÖNCE tanımlandığından, bu sabit dosyanın en üstünde tutulur
// — ikisi de bu SABİTİ kullanır, `const` TDZ'si nedeniyle biri diğerini
// İLERİYE referans EDEMEZ).
const CONCURRENT_EDIT_CONFLICT_MESSAGE =
  "Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.";
// DESIGN §2.10 "Yetkisiz / pasif erişim" satırı — `ERROR_CODE_MESSAGES.
// CSRF_TOKEN_INVALID`/`ORIGIN_INVALID`/`FORBIDDEN` VE `COMMON_SCREEN_
// MESSAGES.unauthorizedOrInactiveAccess` AYNI metni taşır (yukarıdaki
// sabitle AYNI TDZ gerekçesiyle burada tutulur).
const UNAUTHORIZED_OR_INACTIVE_ACCESS_MESSAGE = "Bu işlem için erişimin yok.";

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
  // T2.1 ADIM 3, S2.1 — işletme/mal sahibi yönetim ekranlarının mutasyon
  // uçları (`POST`/`PATCH /admin/businesses`) bu üç kodu da üretebilir
  // (bkz. `../server/usecases/admin-businesses/errors.ts`, `../server/
  // data/scoped.ts` `ScopeTargetInactiveError`, `../server/usecases/
  // receipts/errors.ts` `RequestIdReusedError`). Sunucunun kendi
  // `error.message`'ı BURADA DA ekrana basılmaz (dosya üstü kural); kod →
  // Türkçe ekran metni eşlemesi buraya eklenir.
  VERSION_CONFLICT: CONCURRENT_EDIT_CONFLICT_MESSAGE,
  TARGET_INACTIVE_FOR_WRITE: "İşletme veya araç artık pasif; bu işlem yapılamaz.",
  // Normal akışta oluşmaz (istemci aynı requestId'yi yalnız AYNI içerikle
  // tekrar gönderir, bkz. `../app/yonetim/isletmeler/**` form yorumları);
  // yine de savunma amaçlı bir genel metin taşır (sayfa yenilemesi güvenli
  // bir kurtarma yoludur — taslak client-state'te kalır).
  REQUEST_ID_REUSED: "Bu işlem başka bir denemeyle çakıştı. Sayfayı yenileyip tekrar dene.",
  FORBIDDEN: UNAUTHORIZED_OR_INACTIVE_ACCESS_MESSAGE,
  // Sunucu 422 VALIDATION_ERROR döndüğünde alan ayrıntısı ekranda ayrıca
  // gösterilir; alan hatası olmayan durumlar için genel doğrulama metni.
  VALIDATION_ERROR: "Girilen bilgiler geçersiz. Alanları kontrol edip tekrar dene.",
  // T2.4 — şoför yönetimi uçları (`../server/usecases/drivers/errors.ts`).
  // Başka işletmenin/araçtan bağımsız kişi kimliği de AYNI kodu alır (kimliğin
  // varlığı doğrulanmaz).
  PERSON_NOT_FOUND: "Kişi bulunamadı.",
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
  passwordEmpty: PASSWORD_EMPTY_MESSAGE,
} as const;

/**
 * Ekip girişi (POST /api/v1/auth/platform-login) alan doğrulama metinleri —
 * T1.3, S1.3. `passwordEmpty` `VEHICLE_LOGIN_FIELD_MESSAGES.passwordEmpty`
 * ile AYNI kaynaktan (`PASSWORD_EMPTY_MESSAGE`) gelir — iki form AYNI
 * kavramı ("şifre alanı boş") taşır, metin İKİ YERDE AYRI YAZILMAZ.
 */
export const PLATFORM_LOGIN_FIELD_MESSAGES = {
  /** Boş/eksik kullanıcı adı alanı. */
  usernameEmpty: "Kullanıcı adını gir.",
  /** Boş/eksik şifre alanı. */
  passwordEmpty: PASSWORD_EMPTY_MESSAGE,
} as const;

/**
 * `../server/usecases/auth/platform-login.ts` sonucunun ROUTE HANDLER'ının
 * (`../app/api/v1/auth/platform-login/route.ts`) kullanacağı DAR tipli
 * sabitler — `VEHICLE_LOGIN_RESULT_MESSAGES`'in ekip girişi karşılığı.
 * `rateLimited`/`hashQueueFull` metinleri PLAKAYA ÖZGÜ DEĞİLDİR (genel
 * sistem durumu metinleridir); bu yüzden AYNI iki sabitten (yukarıdaki
 * dosya-özel `RATE_LIMITED_MESSAGE`/`HASH_QUEUE_FULL_MESSAGE`) tekrar
 * KULLANILIR, ikinci bir kopya YAZILMAZ. Yalnız `invalidCredentials`
 * araç girişinden FARKLIDIR (bkz. `PLATFORM_INVALID_CREDENTIALS_MESSAGE`
 * üstü not).
 */
export const PLATFORM_LOGIN_RESULT_MESSAGES = {
  invalidCredentials: PLATFORM_INVALID_CREDENTIALS_MESSAGE,
  rateLimited: RATE_LIMITED_MESSAGE,
  hashQueueFull: HASH_QUEUE_FULL_MESSAGE,
} as const;

/**
 * Platform rolü → ekranda gösterilecek Türkçe etiket — T1.3 ADIM 2/2,
 * S1.3, görev tanımı (b, birebir): "rol etiketi ('Yönetici' / 'Destek')."
 * `../server/usecases/session/types.ts` `SessionRole`'ün `"admin"|
 * "support"` alt kümesiyle sınırlıdır (araç rolleri owner/driver bu
 * eşlemede YOKTUR — `../app/_components/team-page-header.tsx` yalnız
 * platform oturumları için çağrılır).
 */
export const PLATFORM_ROLE_LABELS = {
  admin: "Yönetici",
  support: "Destek",
} as const;

/**
 * S1.6 AC7 (birebir): "Kayıt ol/uygulama indir zorunluluğu veya yeni
 * kurtarma hizmeti yoktur. 'Giriş yapamıyorsan hesabını açan ekipten
 * yardım al.' metni görünür." S1.6 AC1 bu hikâyenin kapsamını "Araç ve
 * ekip girişleri" olarak tanımlar ve AC7 bu iki varyanttan yalnız birine
 * ÖZGÜLENMEZ (S1.2'nin araca özgü AC4'ünün AKSİNE) — bu yüzden metin HER
 * İKİ giriş ekranında (`../app/giris/page.tsx`, `../app/yonetim/giris/
 * page.tsx`) da `LoginForm`'un `helpText` prop'una AYNI kaynaktan
 * (tekrar YAZILMADAN) geçirilir. Düzeltme turu 1 denetim bulgusu: önceki
 * sürüm bu metni yalnız araç girişinde gösteriyordu; docs/DECISIONS.md'de
 * bu dışlamayı kaydeden bir karar YOKTUR, bu yüzden kapsam daraltması
 * geri alındı.
 */
export const LOGIN_HELP_TEXT =
  "Giriş yapamıyorsan hesabını açan ekipten yardım al.";

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
  concurrentEditConflict: CONCURRENT_EDIT_CONFLICT_MESSAGE,
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

/** T2.4 — şoför yönetimi 422 `fields` metinleri (`../app/api/v1/drivers/_http.ts`
 * ve `../server/usecases/drivers/**`). */
export const DRIVER_FIELD_MESSAGES = {
  requestId: "İstek kimliği eksik veya geçersiz.",
  fullName: "Ad soyad 1-120 karakter olmalı.",
  version: "Sürüm bilgisi eksik veya geçersiz.",
  active: "Aktiflik değeri geçersiz.",
  noChange: "Değişiklik yok.",
  noChangeMessage: "Gönderilen değerler mevcut kayıtla aynı; değişiklik uygulanmadı.",
  ownerPerson: "Araç sahibi şoför olarak atanamaz.",
  personInactive: "Bu kişi pasif olduğu için araca atanamaz. Ekipten aktifleştirilmesini iste.",
  notAssigned: "Bu kişi bu araca atanmamış.",
} as const;

/** T2.4 — Şoförlerim ekranı metinleri (DESIGN "Şoförlerim — notes"). */
export const DRIVER_SCREEN_MESSAGES = {
  renameNote: "Bu kişinin eski kayıtları da yeni adıyla görünür.",
  sharedPasswordWarning:
    "Ortak şoför şifresi hâlâ geçerli. Erişimi tamamen kesmek için ekipten şifre sıfırlama isteyin.",
  emptyActiveList: "Bu araç için şoför eklenmemiş.",
} as const;

/** Yönetim ana ekranı araması (`../app/yonetim/admin-search.tsx`). */
export const ADMIN_SEARCH_MESSAGES = {
  label: "Plaka veya işletme ara",
  activeLabel: "Durum",
  activeAll: "Hepsi",
  activeOnly: "Aktif",
  inactiveOnly: "Pasif",
  loading: "Yükleniyor…",
  noResults: "Sonuç yok.",
  noBusinesses: "Henüz işletme yok.",
  loadMore: "Daha fazla göster",
  loadingMore: "Yükleniyor…",
  retry: "Tekrar dene",
  activeBadge: "Aktif",
  inactiveBadge: "Pasif",
  businessInactive: "İşletme pasif",
  openSupport: "Destek ekranını aç",
  openVehicle: "Araç bilgisi",
  resultCount: (count: number, more: boolean): string =>
    `${count}${more ? "+" : ""} sonuç listelendi.`,
} as const;

/** Destek ekranı ve sabit hedef başlığı. */
export const SUPPORT_MESSAGES = {
  targetRegion: "Destek hedefi",
  business: (name: string): string => `Destek: ${name}`,
  vehicleOwner: (plate: string, owner: string): string => `Araç: ${plate} · Sahip: ${owner}`,
  actor: (username: string, roleLabel: string): string => `İşlemi yapan: ${username} (${roleLabel})`,
  changeTarget: "Hedefi değiştir",
  leaveTitle: "Değişiklikleri bırakıp çık?",
  leaveDescription: "Kaydedilmemiş değişiklikler silinir ve yönetim ana ekranına dönülür.",
  leaveConfirm: "Bırakıp çık",
  inactiveTarget: "Araç veya işletme pasif; bilgiler okunabilir, değişiklik yapılamaz.",
  pageTitle: "Destek",
  linkDrivers: "Şoförler",
  linkVehicle: "Araç bilgisi",
  linkAudit: "Bu aracın işlem geçmişi",
} as const;

/** İşlem geçmişi ekranı (`../app/yonetim/islem-gecmisi/audit-history.tsx`). */
export const AUDIT_MESSAGES = {
  title: "İşlem geçmişi",
  filterPrefix: "Filtre",
  clearFilter: "Filtreyi kaldır",
  loading: "Yükleniyor…",
  empty: "Henüz işlem kaydı yok.",
  loadMore: "Daha fazla göster",
  loadingMore: "Yükleniyor…",
  retry: "Tekrar dene",
  noPreviousValue: "Önceki değer yok (yeni kayıt).",
  before: "Önce",
  after: "Sonra",
  onBehalfOf: (name: string): string => `Sahip adına: ${name}`,
  targetUser: (username: string): string => `Ekip hesabı: ${username}`,
  actorPrefix: "İşlemi yapan",
  resultCount: (count: number, more: boolean): string =>
    `${count}${more ? "+" : ""} kayıt listelendi.`,
} as const;

/** Ekip hesapları ekranları (`../app/yonetim/ekip/**`) — S2.6. */
export const TEAM_USER_MESSAGES = {
  listTitle: "Ekip hesapları",
  openAccount: "+ Hesap aç",
  edit: "Düzenle",
  resetPassword: "Şifre sıfırla",
  empty: "Henüz ekip hesabı yok.",
  activeBadge: "Aktif",
  inactiveBadge: "Pasif",
  noFullName: "Ad soyad yok",
  backToList: "← Ekip hesapları",
  backToAdmin: "← Yönetim",
  unauthorized: UNAUTHORIZED_OR_INACTIVE_ACCESS_MESSAGE,
  sessionEnded: "Oturumun sona erdi. Yeniden giriş yap.",
  connection: "Bağlantı kurulamadı. Tekrar dene.",
  checking: "Kaydın sonucu kontrol ediliyor.",
  retryCheck: "Tekrar kontrol et",
  reenterPassword: "Devam etmek için şifreyi tekrar gir.",
  reloadLatest: "Güncel halini aç",
  saving: "Kaydediliyor…",
  newTitle: "Ekip hesabı aç",
  newIntro: "Kullanıcı adı, ad soyad, yetki ve ilk şifreyi gir. Şifreyi kişiye kendin ilet; uygulama mesaj göndermez.",
  usernameLabel: "Kullanıcı adı",
  usernameHelp: "3–32 karakter; harf, rakam, nokta, alt çizgi ve tire.",
  fullNameLabel: "Ad soyad",
  roleLegend: "Yetki",
  passwordLabel: "Şifre",
  newPasswordLabel: "Yeni şifre",
  show: "Göster",
  hide: "Gizle",
  createSubmit: "Hesabı aç",
  creating: "Hesap açılıyor…",
  infoTitle: "Hesap bilgisi",
  infoSubmit: "Bilgiyi kaydet",
  activeTitle: "Aktiflik",
  deactivateHint: "Hesap pasifleşince kişinin açık oturumları kapanır ve yeniden giriş yapamaz. Geçmiş kayıtlar silinmez.",
  reactivateHint: "Hesap tekrar aktif olur. Kapanan oturumlar geri gelmez; kişinin yeniden giriş yapması gerekir.",
  deactivateSubmit: "Hesabı pasifleştir",
  deactivating: "Pasifleştiriliyor…",
  reactivateSubmit: "Hesabı yeniden aktifleştir",
  reactivating: "Aktifleştiriliyor…",
  deactivateDialogTitle: "Hesabı pasifleştir",
  deactivateDialogConfirm: "Pasifleştir",
  deactivateSelfWarning: "Kendi hesabını pasifleştiriyorsun; oturumun hemen kapanır.",
  resetTitle: "Şifre sıfırlama",
  resetHint: "Sıfırlama kişinin açık oturumlarını kapatır.",
  resetSelfWarning: "Kendi şifreni sıfırlıyorsun; oturumun kapanır ve yeniden giriş yapman gerekir.",
  resetSubmit: "Şifreyi sıfırla",
  resetting: "Sıfırlanıyor…",
  resetDone: (username: string): string =>
    `${username} hesabının şifresi değiştirildi. Açık oturumları kapatıldı. Yeni şifreyi kişiye kendin ilet; uygulama otomatik mesaj göndermez.`,
  requestIdReusedCreate:
    "Bu hesap önceki denemede ilk girdiğin şifreyle zaten açılmış olabilir. Hesap listesini kontrol et.",
  requestIdReusedReset:
    "Bu hesabın şifresi önceki denemede ilk girdiğin şifreyle zaten sıfırlanmış olabilir. Şimdi yeni bir şifre belirle.",
  usernameInvalid: "Kullanıcı adı 3–32 karakter olmalı; yalnız harf, rakam, nokta, alt çizgi ve tire içerebilir.",
  fullNameInvalid: "Ad soyad 1–120 karakter olmalı.",
  passwordEmpty: "Şifreyi gir.",
  newPasswordEmpty: "Yeni şifreyi gir.",
  passwordTooLong: "Şifre en fazla 200 karakter olabilir.",
  noChange: "Değişiklik yok.",
} as const;

/** T3.1 — şoförün günlük kayıt formu (`../app/sofor/work-entry-form.tsx`,
 * kural: `./work-time.ts`). Bu paket kayıt YAZMAZ; "Kaydedildi" metni
 * bilerek burada YOKTUR. */
export const WORK_ENTRY_MESSAGES = {
  dateLabel: "Çalışılan gün",
  personLabel: "Kim çalıştı?",
  personPlaceholder: "Adını seç",
  personLoading: "Şoförler yükleniyor…",
  personEmpty: "Bu araçta seçilebilir şoför yok. Araç sahibinden şoför eklemesini iste.",
  personRequired: "Adını seç.",
  workTypeInvalid: "Kayıt türünü seç.",
  personUnavailable:
    "Bu kişi artık bu araçta seçilemiyor. Liste yenilendi; adını yeniden seç.",
  retry: "Tekrar dene",
  startLabel: "Başlangıç saati",
  endLabel: "Bitiş saati",
  nextDayLabel: "Bitiş ertesi gün",
  endsOn: (date: string, time: string): string => `Bitiş: ${date} ${time}`,
  duration: (text: string): string => `Süre: ${text}`,
  submit: "Kontrol et",
  submitting: "Kontrol ediliyor…",
  dateInvalid: "Geçerli bir tarih gir.",
  startRequired: "Başlangıç saatini gir.",
  endRequired: "Bitiş saatini gir.",
  timesEqual: "Başlangıç ve bitiş saati aynı olamaz.",
  endBeforeStart:
    "Bitiş saati başlangıçtan önce. Ertesi gün bitiyorsa “Bitiş ertesi gün” kutusunu işaretle.",
  durationTooLong: "Süre 24 saati geçemez.",
  notSavedYet:
    "Bilgiler geçerli. Kayıt henüz kaydedilmiyor; kaydetme bir sonraki aşamada açılacak.",
  connectionFailed: "Bağlantı yok. Henüz kaydedilmedi.",
  // T3.2 — para girdileri ve otomatik pay (`./money.ts`, `./work-calculation.ts`).
  grossLabel: "Hasılat (TL)",
  fuelLabel: "Mazot (TL)",
  otherExpenseLabel: "Diğer masraf (TL)",
  otherExpenseNoteLabel: "Açıklama",
  addExpense: "+ Masraf ekle",
  removeExpense: "Masrafı kaldır",
  removeExpenseTitle: "Masraf kaldırılsın mı?",
  removeExpenseDescription: "Girdiğin diğer masraf tutarı ve açıklaması silinecek.",
  removeExpenseConfirm: "Kaldır",
  removeExpenseCancel: "Vazgeç",
  moneyRequired: "Tutarı gir. Yoksa 0 yaz.",
  moneyNegative: "Tutar eksi olamaz.",
  moneyFormat: "Tutarı rakamla yaz. Örnek: 1.250,50",
  moneyThousands:
    "Nokta yalnız binlik ayracıdır ve 3 haneli gruplardan önce gelir. Kuruş için virgül kullan. Örnek: 1.250,50",
  moneyPrecision: "Kuruş en fazla 2 haneli olabilir. Örnek: 1.250,50",
  moneyTooLarge: "Tutar çok büyük.",
  amountsTooLarge: "Yakıt, diğer gider ve pay toplamı çok büyük.",
  otherExpenseNoteTooLong: "Açıklama en fazla 200 karakter olabilir.",
  summaryTitle: "Hesap özeti",
  driverShareLabel: "Şoför payın (%20)",
  remainderLabel: "Teslim edilecek tutar",
  remainderNegative:
    "Giderler hasılatı ve payı aşıyor; teslim edilecek tutar eksi görünür. Tutarları kontrol et.",
} as const;
