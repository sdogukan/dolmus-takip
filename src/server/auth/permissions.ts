/**
 * Yetki matrisi — T1.5 ADIM 1/2, S1.5.
 *
 * Kaynak — yetki matrisi tablosu:
 *
 * | İşlem | Ortak şoför oturumu | Sahip oturumu | Platform ekibi |
 * |---|---|---|---|
 * | Şoför listesinden seçip çalışma oluşturma | Giriş yapılan araç | Yetkili
 *   araçta şoför adına | Seçili işletme/araç adına |
 * | Sahibin kendi sürüşünü oluşturma | Hayır | Evet | Sahip adına |
 * | Kayıt/teslim durumunu görme | Kısıtlı geçmiş kapsamı | Yetkili araç
 *   kapsamı | Destek hedefi kapsamında |
 * | Onaysız kaydı düzeltme | Koşullu açık | Evet | Evet |
 * | Teslimi onaylama, onaylı kaydı düzeltme | Hayır | Evet | Sahip adına,
 *   ekip iziyle |
 * | Şoför ekleme/düzeltme/pasifleştirme | Hayır | Yetkili araç ataması ve
 *   bağlı kişi adı | Evet; global kişi durumu ayrıca yetkili |
 * | İşletme/araç açma, iki parolayı sıfırlama | Hayır | İlk sürümde ekip
 *   yapar | Evet |
 * | Ekip hesabı/yetkisi yönetme | Hayır | Hayır | Yalnız platform yöneticisi |
 *
 * ve görev tanımının (T1.5, iş adımı 2) BİREBİR verdiği izin listesi/matrisi:
 *
 * "Permission listesi: work_entry.create_driver, work_entry.create_owner,
 * work_entry.read, work_entry.edit_unconfirmed, work_entry.confirm,
 * work_entry.correct_confirmed, work_entry.history, report.read,
 * driver.read_active, driver.manage (ekle/ad düzelt/araç ataması),
 * person.set_global_active, business.manage, vehicle.manage,
 * vehicle.reset_password, platform_user.manage, audit.read. Matris:
 * driver → create_driver, read (K1: aynı araçta seçtiği kişinin kayıtları —
 * kapsam kuralı T3/T4'te uygulanır, burada izin tanımı), edit_unconfirmed
 * (K1: yalnız çalışma günü — koşul T3.5'te), driver.read_active; owner →
 * driver'ın hepsi + create_owner, confirm, correct_confirmed, history,
 * report.read, driver.manage; support → owner'ın hepsi (hedef kapsamında)
 * + person.set_global_active, business.manage, vehicle.manage,
 * vehicle.reset_password, audit.read; admin → support +
 * platform_user.manage."
 *
 * K1'in "aynı araçta seçtiği kişi" (read) ve "yalnız çalışma günü"
 * (edit_unconfirmed) KOŞULLARI bu dosyada UYGULANMAZ — görev tanımının
 * kendi ayracı ("kapsam kuralı T3/T4'te uygulanır, burada izin tanımı",
 * "koşul T3.5'te") bu ADIM'ın işi olarak yalnız İZİN TANIMINI (driver bu
 * iznin ADI'na sahip mi?) bırakır; asıl kapsam/koşul filtresi (hangi
 * SATIRLARIN görüneceği/düzenlenebileceği) T3/T3.5/T4'ün veri erişim
 * katmanında (bkz. `../data/scoped.ts`'in gelecekteki work_entries
 * genişlemesi) uygulanacaktır. Bu, matrisle ÇELİŞEN bir eksiklik DEĞİL,
 * görev tanımının KENDİSİNİN çizdiği sınırdır (bkz. bu paketin
 * open_issues'ı — "deferred" olarak işaretlenmiştir).
 *
 * KALDIRILDI (düzeltme turu 3 — denetim bulgusu, `ac` merceği): önceki bir
 * sürüm burada `vehicle.read_current` adlı 17. bir izin ve onu kullanan
 * `GET /api/v1/vehicles/current` ucunu tanımlıyordu. Denetim doğruladı ki
 * bu izin/uç ne yetki matrisinin ne de API endpoint tablosunun hiçbir
 * satırına karşılık gelir, ne de ürün sahibi tarafından ayrıca onaylanmış
 * bir K-kararıdır. Plaka T3.x ekranında SABİT bir başlık alanıdır; ayrı bir
 * okuma ucu GEREKTİRMEZ. T1.5'in kendi sınırı da açıktır: "Yeni E2–E5
 * endpoint'leri ... henüz varmış gibi sunulmaz" — bu uç E1–E5'in hiçbirine
 * ait değildi, yalnız `withProtectedRoute`'un `target: "vehicle"` dalını
 * CANLI bir HTTP isteği ile "kanıtlamak" için icat edilmişti. Docs/*.md
 * salt okunur olduğundan (bu paket için) ne bu ucu belgelemek ne de ürün
 * sahibinden gerçek bir onay almak bu ADIM'ın yetkisindedir; en
 * profesyonel düzeltme bu belgelenmemiş yüzeyi KALDIRMAKTIR.
 * `target: "vehicle"` deseninin kendisi zaten
 * `../../tests/integration/scope-authorization.test.ts`
 * (`readAssignment`/`writeAssignment`, gerçek E2.4-benzeri sentetik
 * handler'lar) ve `../../tests/integration/protected-route.test.ts`
 * (aynı sentetik-handler deseniyle `target:"vehicle"` için 401/403/404/422
 * ayrımı) ile CANLI HTTP istekleri üzerinden kanıtlanmaya devam eder —
 * gerçek bir üretim ucu İCAT ETMEDEN.
 */
import type { Actor, Scope } from "./scope";

export const PERMISSIONS = [
  "work_entry.create_driver",
  "work_entry.create_owner",
  "work_entry.read",
  "work_entry.edit_unconfirmed",
  "work_entry.confirm",
  "work_entry.correct_confirmed",
  "work_entry.history",
  "report.read",
  "driver.read_active",
  "driver.manage",
  "person.set_global_active",
  "business.manage",
  "vehicle.manage",
  "vehicle.reset_password",
  "platform_user.manage",
  "audit.read",
  "person.anonymize",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ---------------------------------------------------------------------------
// Matris — "driver → ...; owner → driver'ın hepsi + ...; support → owner'ın
// hepsi + ...; admin → support + platform_user.manage." Bu kademeli
// (driver ⊂ owner ⊂ support ⊂ admin) yapı görev tanımının KENDİSİNİN
// tarif ettiği ilişkidir; her aktörün TAM izin kümesi yine de AŞAĞIDA
// (spread ile) AÇIKÇA yazılır — `permissions.test.ts` her aktör için TAM
// listeyi (kademeli türetime GÜVENMEDEN, bağımsız bir sabit listeyle)
// karşılaştırır (bkz. o dosyanın "matrisin HER hücresi" testi).
// ---------------------------------------------------------------------------

const DRIVER_PERMISSIONS: readonly Permission[] = [
  "work_entry.create_driver",
  "work_entry.read",
  "work_entry.edit_unconfirmed",
  "driver.read_active",
];

const OWNER_PERMISSIONS: readonly Permission[] = [
  ...DRIVER_PERMISSIONS,
  "work_entry.create_owner",
  "work_entry.confirm",
  "work_entry.correct_confirmed",
  "work_entry.history",
  "report.read",
  "driver.manage",
];

const SUPPORT_PERMISSIONS: readonly Permission[] = [
  ...OWNER_PERMISSIONS,
  "person.set_global_active",
  "business.manage",
  "vehicle.manage",
  "vehicle.reset_password",
  "audit.read",
];

// KVKK silme talebi — kişi adının geri dönüşsüz anonimleştirilmesi yalnız
// platform yöneticisindedir (destek `person.set_global_active`/`business.manage`
// sahibi olsa da bu izni ALMAZ).
const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...SUPPORT_PERMISSIONS,
  "platform_user.manage",
  "person.anonymize",
];

export const PERMISSION_MATRIX: Readonly<Record<Actor, ReadonlySet<Permission>>> =
  Object.freeze({
    driver: new Set(DRIVER_PERMISSIONS),
    owner: new Set(OWNER_PERMISSIONS),
    support: new Set(SUPPORT_PERMISSIONS),
    admin: new Set(ADMIN_PERMISSIONS),
  });

/** Bir aktörün TÜM izinlerini alfabetik sırayla döner — `GET /session`
 * yanıtındaki "permissions listesi" ve testler bu sırayı kullanır (kararlı
 * çıktı; Set'in kendi ekleme sırasına bağlı KALINMAZ). */
export function permissionsForActor(actor: Actor): Permission[] {
  return Array.from(PERMISSION_MATRIX[actor]).sort();
}

export function hasPermission(actor: Actor, permission: Permission): boolean {
  return PERMISSION_MATRIX[actor].has(permission);
}

// ---------------------------------------------------------------------------
// authorize(scope, permission, target?) — görev tanımı birebir imza.
// ---------------------------------------------------------------------------

export type AuthorizeResult = { ok: true } | { ok: false; status: 403 };

/**
 * `target` — K1'in "aynı araçta seçtiği kişi"/"yalnız çalışma günü" gibi
 * NESNE bazlı ek koşulları (bkz. dosya üstü not) bu ADIM'DA
 * DEĞERLENDİRİLMEZ; parametre yalnız görev tanımının verdiği imzayı
 * (`authorize(scope, permission, target?)`) KORUMAK ve T3/T3.5'in bu
 * fonksiyonu GERİYE DÖNÜK UYUMLU biçimde genişletebilmesi için buradadır.
 * Şekli henüz BELİRLİ olmadığından (doküman bunu somutlaştırmaz) `unknown`
 * tutulur — var olmayan bir sözleşme İCAT EDİLMEZ.
 */
export function authorize(
  scope: Scope,
  permission: Permission,
  target?: unknown,
): AuthorizeResult {
  void target;
  return hasPermission(scope.actor, permission)
    ? { ok: true }
    : { ok: false, status: 403 };
}
