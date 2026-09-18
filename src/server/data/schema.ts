/**
 * Drizzle şeması (ADIM 2/3, S1.1).
 *
 * Kaynak: ARCHITECTURE.md §3.2 (tablolar), §3.1 (ortak kurallar), §3.3
 * (hesap/durum kuralları — K3/K5/K6 karar kayıtlarıyla birlikte), §3.4
 * (transaction/tekrar gönderim/sürüm), §3.5 (indeksler), §6 (oturum/kimlik
 * sütunları). Tam alıntılar ilgili tabloların üstünde tekrarlanır; burada
 * yalnız §3.1'deki ortak kurallar özetlenir:
 *
 * - "Kimlikler uygulamada üretilen UUID'lerdir." → `id` sütunları DB'de
 *   varsayılan (autoincrement/`uuid()` gibi) üretmez; uygulama katmanı
 *   INSERT'te değeri açıkça verir (bu dosyada `.default(...)` YOK).
 * - "Her işletme tablosunda business_id zorunludur." → işletmeye özgü her
 *   tabloda `business_id` NOT NULL (admin_audit hariç; bkz. o tablonun
 *   kendi notu — "business_id/vehicle_id gerektiğinde").
 * - "Ebeveynlerde UNIQUE(business_id, id); çocuklarda aynı işletmeyi taşıyan
 *   birleşik foreign key kullanılır." → SQLite'ta birleşik FK hedefi,
 *   hedef tabloda tam o sütun kümesi üzerinde bir UNIQUE/PRIMARY KEY
 *   gerektirir (https://www.sqlite.org/foreignkeys.html — "the parent key
 *   must be ... subject to a UNIQUE constraint"). Bu yüzden "ebeveyn"
 *   tablolarda (people, vehicles, work_entries) `id` PRIMARY KEY'e ek
 *   olarak ayrıca `UNIQUE(business_id, id)` tanımlanır; yalnız bu birleşik
 *   anahtarı hedefleyen bir çocuk varsa eklenir (vehicle_credentials,
 *   cash_confirmations, admin_audit gibi "yaprak" tablolara gerekmez).
 * - "Gerekli foreign key alanları NULL olamaz." → zorunlu ilişkiler NOT
 *   NULL; yalnız §3.2'nin kendisi "gerektiğinde" diyen alanlar (admin_audit
 *   business_id/vehicle_id, "varsa on_behalf_of_kind/person_id") nullable.
 * - Para INTEGER kuruş, süre INTEGER dakika, work_date TEXT YYYY-MM-DD,
 *   zamanlar TEXT ISO UTC (Europe/Istanbul dönüşümü yalnız ekranda/rapor
 *   hesabında yapılır, DB'de saklanmaz).
 *
 * "Actor alanları" (§3.2, tablo altındaki paragraf): work_entry_revisions,
 * cash_confirmations ve admin_audit'in ortak aktör izleme sütun kümesi.
 * Birebir alıntı: "Actor alanları: actor_kind, actor_session_id (gizli
 * token olmayan iz kimliği), actor_role, araç credential kimliği veya
 * gerçek platform_user_id, varsa on_behalf_of_kind/person_id. Çalışmayı
 * yapan person_id ayrı alandır. Oturum temizliği geçmişteki aktör izini
 * silmez; audit kaydı kısa ömürlü sessions satırına silinmeye bağlı
 * değildir." Bu yüzden `actor_session_id` sessions(id)'e FK DEĞİLDİR
 * (session silinse de iz kalır); yalnız bir metin iz kimliğidir.
 *
 * CHECK kısıtları iki kaynaktan gelir:
 * 1. Görev tanımının açıkça istediği "status/role/kind alanları" — bunlar
 *    doğrudan §3.2'deki rol/tür/durum değer kümeleridir (ör. "role owner
 *    veya driver", "status pending, confirmed veya not_required").
 * 2. Zaten bağlayıcı olan başka bir kesin kural (K3/K5/§3.3/§3.4) —
 *    "varsayımda bulunma" değil, doğrudan alıntılanan bir karardır. Her
 *    CHECK'in üstünde hangi cümleye dayandığı belirtilir.
 *
 * `platform_role`/`actor_role` için 'admin'/'support' ve `actor_kind` için
 * 'vehicle_credential'/'platform_user' gibi somut İngilizce sabit değerler
 * ARCHITECTURE'da yalnız Türkçe adlandırılır ("platform yöneticisi",
 * "destek", "araç credential kimliği veya platform_user_id"); belgede
 * birebir sabit metin (enum literal) verilmez. Bu isimlendirme mühendislik
 * kararıdır (bkz. TASKS.md T2.6); gerçek ekip yetki ekranını uygularken bu
 * sabitleri kullanacak veya (dokümantasyonla çelişmeden) yeniden
 * adlandıracaktır — ikisi de aynı migration setiyle uyumludur.
 *
 * "araç bilgileri" (vehicles §3.2 satırı) ARCHITECTURE'da somutlaştırılmaz;
 * somut alan adları yalnız TASKS.md T2.2 ("plaka, marka/model, yıl,
 * hat/durak, not") ve DESIGN.md §2.9 ("plaka, marka/model/yıl, hat/durak
 * notu, aktiflik") içinde geçer. S1.1 bu iki belgeye atıf yapmasa da,
 * ARCHITECTURE'ın "TÜM alanlar" gereğini karşılamak için bu somut adlar
 * kullanılmıştır (bkz. TASKS.md T2.2 — ekran/alan adı netleşince gerekirse
 * yalnız kolon adı/etiket değişir, ilişkisel model değişmez).
 *
 * API doğrulaması (varsayım değil): `drizzle-orm/sqlite-core` public
 * export'ları — `sqliteTable`, `text`, `integer`, `check`, `unique`,
 * `foreignKey`, `primaryKey`, `index` — `node_modules/drizzle-orm/
 * sqlite-core/index.d.ts` ve alt modülleri (`checks.d.ts`,
 * `unique-constraint.d.ts`, `foreign-keys.d.ts`, `primary-keys.d.ts`,
 * `indexes.d.ts`, `columns/text.d.ts`, `columns/integer.d.ts`) içinde
 * doğrulandı. `check(name, sql)` ve SQLite CHECK(...) SQL üretimi
 * `node_modules/drizzle-kit/bin.cjs` içindeki `SQLiteSquasher.unsquashCheck`
 * kullanan CREATE TABLE serileştiricisinde doğrulandı (drizzle-kit
 * 0.31.10). `drizzle-orm/better-sqlite3/migrator` `migrate(db, config)`
 * çağrısı `__drizzle_migrations` tablosuna `hash`/`created_at` yazarak
 * idempotent çalışır (`node_modules/drizzle-orm/sqlite-core/dialect.js`
 * `SQLiteSyncDialect.migrate`) — bu yüzden `db:init`'in tekrar çalıştırılması
 * tanımları çoğaltmaz.
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  type SQLiteColumn,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Ortak sabit değer kümeleri (yalnız TS tarafı literal daraltma için; asıl
// zorunluluk aşağıdaki `check(...)` kısıtlarıyla DB'de uygulanır).
// ---------------------------------------------------------------------------

/** vehicle_credentials.role — "role owner veya driver" (§3.2). */
const VEHICLE_ROLES = ["owner", "driver"] as const;

/**
 * platform_users.platform_role — ARCHITECTURE yalnız "platform yöneticisi"
 * ve "destek" (ekip hesabının yönetici olmayan genel yetkisi) ayrımını adlar
 * (§2 yetki matrisi son satırı: "Ekip hesabı/yetkisi yönetme | ... | Yalnız
 * platform yöneticisi"). Somut sabit metin doküманda yok; bkz. dosya üstü not.
 */
const PLATFORM_ROLES = ["admin", "support"] as const;

/**
 * actor_role — mutasyonu fiilen yapan oturumun rolü: araç rolü (owner/
 * driver) veya platform rolü (admin/support). §3.2 "actor_role" alanı bu
 * dört değerden birini taşır (araç oturumu veya ekip oturumu — "İki aktör
 * türünden tam biri", §3.2 sessions satırı).
 */
const ACTOR_ROLES = [...VEHICLE_ROLES, ...PLATFORM_ROLES] as const;

/**
 * actor_kind — aktörün hangi kimlik tablosundan geldiği: "araç credential
 * kimliği veya gerçek platform_user_id" (§3.2 actor alanları paragrafı).
 */
const ACTOR_KINDS = ["vehicle_credential", "platform_user"] as const;

/**
 * work_entries.work_kind — §3.3: "owner kaydında kişi aracın sahibidir...
 * driver kaydında aktif kişi/araç ataması aranır."
 */
const WORK_KINDS = ["owner", "driver"] as const;

/**
 * work_entries.status — §3.2: "status pending, confirmed veya not_required".
 */
const WORK_ENTRY_STATUSES = ["pending", "confirmed", "not_required"] as const;

// ---------------------------------------------------------------------------
// businesses — "İşletme sınırı" (§3.2). Kök tablo; kendi business_id'si yok.
// ---------------------------------------------------------------------------

export const businesses = sqliteTable("businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  // T2.1 — admin işletme/sahip yönetimi PATCH'inin iyimser eşzamanlılık
  // sürümü (ARCHITECTURE §3.4 — "koşullu UPDATE ... version"). Var olan
  // `businesses` tablosuna eklenir; migration bu yüzden yalnız `ALTER
  // TABLE ADD COLUMN` olmalıdır (bkz. drizzle/000X migration dosyasının
  // üst notu) — bu yüzden burada KASITLI olarak `people`/`vehicles`
  // tablolarındaki gibi bir `check(... >= 1 ...)` EKLENMEZ: SQLite bir var
  // olan tabloya CHECK eklemeyi yalnız tam tablo yeniden oluşturarak
  // (`__new_businesses` + veri kopyalama + DROP + RENAME) destekler — bu
  // tablo people/vehicles/work_entries/admin_audit'in ebeveynidir ve dolu
  // bir DB'de bu yeniden oluşturma FK ihlaline düşer (T2.1 risk notu).
  // Uygulama katmanı (usecases/admin-businesses) version'u her zaman 1'den
  // başlatıp yalnız +1 arttırarak yazar; DB düzeyinde ek bir CHECK olmadan
  // da bu değişmez.
  version: integer("version").notNull().default(1),
});

// ---------------------------------------------------------------------------
// people — "Şoför ve sahibin sabit kişi kimliği; giriş hesabı değildir."
// (§3.2). "Ebeveyn" tablo: vehicles.owner_person_id ve vehicle_drivers.
// person_id bu tabloyu (business_id, id) ile birleşik referanslar.
// ---------------------------------------------------------------------------

export const people = sqliteTable(
  "people",
  {
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    id: text("id").notNull(),
    fullName: text("full_name").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    // §3.1 — "Ebeveynlerde UNIQUE(business_id, id)": vehicles/vehicle_drivers
    // buradan birleşik FK ile referans verecek.
    unique("people_business_id_id_uk").on(t.businessId, t.id),
    check("people_version_positive_check", sql`${t.version} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// business_owners — T2.1. "Sahip bağı" — bir işletmenin (en fazla bir)
// mal sahibini taşır; PK tek başına `business_id`'dir (yalnız bir satır ->
// bir işletmenin sahibi en fazla bir kişidir). Satırın YOKLUĞU "işletme
// sahipsiz" anlamına gelir (T2.1 görev tanımı — "sahip atama yalnız
// sahipsiz işletmeye, devir yok"): bir işletmenin sahibi değiştirilemez,
// yalnız hiç sahibi yokken bir kez atanabilir.
// ---------------------------------------------------------------------------

export const businessOwners = sqliteTable(
  "business_owners",
  {
    businessId: text("business_id")
      .primaryKey()
      .references(() => businesses.id),
    personId: text("person_id").notNull(),
  },
  (t) => [
    // "sahip aynı işletmedeki kişidir" — vehicles.owner_person_id ile AYNI
    // birleşik FK deseni (§3.1): başka işletmenin kişisi sahip olarak
    // YAZILAMAZ (DB düzeyinde reddi, API doğrulaması bunun İKİNCİ
    // savunma hattıdır — bkz. usecases/admin-businesses).
    foreignKey({
      name: "business_owners_person_fk",
      columns: [t.businessId, t.personId],
      foreignColumns: [people.businessId, people.id],
    }),
  ],
);

// ---------------------------------------------------------------------------
// vehicles — "Plaka platform genelinde UNIQUE; sahip aynı işletmedeki
// kişidir." (§3.2). "araç bilgileri" somut alanları için dosya üstü not.
// ---------------------------------------------------------------------------

export const vehicles = sqliteTable(
  "vehicles",
  {
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    id: text("id").notNull(),
    plateNormalized: text("plate_normalized").notNull().unique(),
    ownerPersonId: text("owner_person_id").notNull(),
    // "araç bilgileri" — TASKS.md T2.2 / DESIGN.md §2.9 somut alan adları
    // (dosya üstü not). MVP'de hepsi isteğe bağlı; sunucu doğrulaması
    // T2.2'de eklenir, bu adım yalnız kolonu açar.
    brandModel: text("brand_model"),
    year: integer("year"),
    routeStop: text("route_stop"),
    note: text("note"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    // §3.1 — vehicle_drivers/vehicle_credentials/work_entries/admin_audit
    // bu tabloyu (business_id, id) ile birleşik referanslar.
    unique("vehicles_business_id_id_uk").on(t.businessId, t.id),
    // "sahip aynı işletmedeki kişidir" (§3.2) — owner_person_id, aynı
    // business_id altındaki bir people satırına birleşik FK ile bağlanır;
    // başka işletmenin kişisi sahip olarak yazılamaz (DB düzeyinde reddi).
    foreignKey({
      name: "vehicles_owner_person_fk",
      columns: [t.businessId, t.ownerPersonId],
      foreignColumns: [people.businessId, people.id],
    }),
    check("vehicles_version_positive_check", sql`${t.version} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// vehicle_drivers — "Üçlü UNIQUE; geçmiş ilişki silinmez; sahibin kendi
// sürüşü bu atama değildir." (§3.2). §3.2'de ayrı bir `id` alanı listelenmez;
// birleşik anahtarın kendisi PRIMARY KEY'dir (aynı zamanda §3.5'teki
// "vehicle_drivers(business_id, vehicle_id, person_id) UNIQUE" kısıtıdır).
// ---------------------------------------------------------------------------

export const vehicleDrivers = sqliteTable(
  "vehicle_drivers",
  {
    businessId: text("business_id").notNull(),
    vehicleId: text("vehicle_id").notNull(),
    personId: text("person_id").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.businessId, t.vehicleId, t.personId] }),
    foreignKey({
      name: "vehicle_drivers_vehicle_fk",
      columns: [t.businessId, t.vehicleId],
      foreignColumns: [vehicles.businessId, vehicles.id],
    }),
    foreignKey({
      name: "vehicle_drivers_person_fk",
      columns: [t.businessId, t.personId],
      foreignColumns: [people.businessId, people.id],
    }),
    check("vehicle_drivers_version_positive_check", sql`${t.version} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// vehicle_credentials — "Araç/rol UNIQUE; role owner veya driver." (§3.2).
// sessions.credential_id buraya `id` üzerinden (tek sütun) FK verir; başka
// hiçbir tablo bunu (business_id, id) ile birleşik referanslamadığından
// ayrıca UNIQUE(business_id, id) eklenmez (dosya üstü not, kural 1).
// ---------------------------------------------------------------------------

export const vehicleCredentials = sqliteTable(
  "vehicle_credentials",
  {
    businessId: text("business_id").notNull(),
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id").notNull(),
    role: text("role", { enum: VEHICLE_ROLES }).notNull(),
    passwordHash: text("password_hash").notNull(),
    credentialVersion: integer("credential_version").notNull().default(1),
  },
  (t) => [
    foreignKey({
      name: "vehicle_credentials_vehicle_fk",
      columns: [t.businessId, t.vehicleId],
      foreignColumns: [vehicles.businessId, vehicles.id],
    }),
    // "Araç/rol UNIQUE" — aynı araçta aynı rol için ikinci credential açılamaz.
    unique("vehicle_credentials_vehicle_role_uk").on(t.vehicleId, t.role),
    check("vehicle_credentials_role_check", sql`${t.role} IN ('owner', 'driver')`),
    check(
      "vehicle_credentials_credential_version_positive_check",
      sql`${t.credentialVersion} >= 1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// platform_users — "Kişisel ekip kimliği; müşteri kişi kaydından ayrı."
// (§3.2). İşletmeye bağlı değildir (business_id yok) — ekip hesapları
// işletme sınırı dışında, hedef işletme/araç her destek isteğinde ayrıca
// doğrulanır (§2 "Platform desteğinde hedef işletme/araç hem ekranda hem
// sunucuda doğrulanır").
// ---------------------------------------------------------------------------

export const platformUsers = sqliteTable(
  "platform_users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    platformRole: text("platform_role", { enum: PLATFORM_ROLES }).notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    credentialVersion: integer("credential_version").notNull().default(1),
  },
  (t) => [
    check(
      "platform_users_platform_role_check",
      sql`${t.platformRole} IN ('admin', 'support')`,
    ),
    check(
      "platform_users_credential_version_positive_check",
      sql`${t.credentialVersion} >= 1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// sessions — "İki aktör türünden tam biri; araç oturumunda işletme/araç
// rolü credential ilişkisinden alınır." (§3.2). Teknik tablo; business_id
// YOK (§3.2'nin kendi sütun listesinde de yok) — kapsam credential_id/
// platform_user_id üzerinden sunucuda çözülür (§3.2 "Oturum ve makbuzlar
// teknik tablolardır").
// ---------------------------------------------------------------------------

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    credentialId: text("credential_id").references(() => vehicleCredentials.id),
    platformUserId: text("platform_user_id").references(() => platformUsers.id),
    issuedVersion: integer("issued_version").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (t) => [
    // "İki aktör türünden tam biri" — tam olarak biri dolu, diğeri NULL.
    check(
      "sessions_exactly_one_actor_check",
      sql`(
        (${t.credentialId} IS NOT NULL AND ${t.platformUserId} IS NULL)
        OR
        (${t.credentialId} IS NULL AND ${t.platformUserId} IS NOT NULL)
      )`,
    ),
    // §3.5 — "sessions(token_hash) UNIQUE; sessions(expires_at)". token_hash
    // zaten `.unique()` ile kolonda tanımlı; expires_at için ayrı indeks:
    index("idx_sessions_expires_at").on(t.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// work_entries — "Güncel kaynak kayıt; status pending, confirmed veya
// not_required." (§3.2). Para/süre/tarih kuralları §3.1/§3.3/K3/K5/K6.
// ---------------------------------------------------------------------------

export const workEntries = sqliteTable(
  "work_entries",
  {
    businessId: text("business_id").notNull(),
    id: text("id").notNull(),
    vehicleId: text("vehicle_id").notNull(),
    personId: text("person_id").notNull(),
    workKind: text("work_kind", { enum: WORK_KINDS }).notNull(),
    // "kullanıcı çalışma tarihi YYYY-MM-DD olarak saklanır" (§3.1).
    workDate: text("work_date").notNull(),
    // "İşlem zamanları UTC" (§3.1) — ISO 8601 UTC metin.
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    grossCents: integer("gross_cents").notNull(),
    fuelCents: integer("fuel_cents").notNull(),
    // K6 — "Diğer masraf: tek tutar (other_expense_cents) + açıklama
    // (other_expense_note)."
    otherExpenseCents: integer("other_expense_cents").notNull(),
    otherExpenseNote: text("other_expense_note"),
    // §3.3 hesap kuralı v1 — "share_bps = 2000 veya 0."
    shareBps: integer("share_bps").notNull(),
    shareCents: integer("share_cents").notNull(),
    // K5 — negatif kalabilir, sıfıra çekilmez; bu yüzden CHECK >= 0 YOK.
    remainderCents: integer("remainder_cents").notNull(),
    calculationVersion: integer("calculation_version").notNull().default(1),
    status: text("status", { enum: WORK_ENTRY_STATUSES }).notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    // §3.1 — work_entry_revisions bu tabloyu (business_id, id) ile
    // birleşik referanslar.
    unique("work_entries_business_id_id_uk").on(t.businessId, t.id),
    foreignKey({
      name: "work_entries_vehicle_fk",
      columns: [t.businessId, t.vehicleId],
      foreignColumns: [vehicles.businessId, vehicles.id],
    }),
    foreignKey({
      name: "work_entries_person_fk",
      columns: [t.businessId, t.personId],
      foreignColumns: [people.businessId, people.id],
    }),
    check(
      "work_entries_work_kind_check",
      sql`${t.workKind} IN ('owner', 'driver')`,
    ),
    check(
      "work_entries_status_check",
      sql`${t.status} IN ('pending', 'confirmed', 'not_required')`,
    ),
    // K3 — "Süre 0 dk'dan büyük ve en fazla 24 saat (1440 dk)."
    check(
      "work_entries_duration_minutes_range_check",
      sql`${t.durationMinutes} > 0 AND ${t.durationMinutes} <= 1440`,
    ),
    // §3.3 — "Girdiler negatif olamaz" (hasılat/mazot/diğer masraf birer
    // girdidir; kalan ise kasıtlı olarak negatif kalabilir, bkz. yukarısı).
    check("work_entries_gross_cents_nonnegative_check", sql`${t.grossCents} >= 0`),
    check("work_entries_fuel_cents_nonnegative_check", sql`${t.fuelCents} >= 0`),
    check(
      "work_entries_other_expense_cents_nonnegative_check",
      sql`${t.otherExpenseCents} >= 0`,
    ),
    check("work_entries_share_cents_nonnegative_check", sql`${t.shareCents} >= 0`),
    // §3.3 hesap kuralı v1 — "share_bps = 2000 veya 0."
    check(
      "work_entries_share_bps_check",
      sql`${t.shareBps} = 0 OR ${t.shareBps} = 2000`,
    ),
    check(
      "work_entries_calculation_version_positive_check",
      sql`${t.calculationVersion} >= 1`,
    ),
    check("work_entries_version_positive_check", sql`${t.version} >= 1`),
    // §3.5 indeksleri (aynen):
    index("idx_work_entries_vehicle_period").on(
      t.businessId,
      t.vehicleId,
      t.workDate,
      t.id,
    ),
    index("idx_work_entries_person_period").on(
      t.businessId,
      t.personId,
      t.workDate,
      t.id,
    ),
    index("idx_work_entries_vehicle_status_period").on(
      t.businessId,
      t.vehicleId,
      t.status,
      t.workDate,
      t.id,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Ortak "actor" sütunları — work_entry_revisions, cash_confirmations,
// admin_audit için (dosya üstü not, §3.2 actor alanları paragrafı).
// `vehicleCredentials`/`platformUsers` bu noktada zaten tanımlı olduğundan
// referanslar doğrudan (callback'siz) kurulabilir.
// ---------------------------------------------------------------------------

function actorTrackingColumns() {
  return {
    actorKind: text("actor_kind", { enum: ACTOR_KINDS }).notNull(),
    // "gizli token olmayan iz kimliği" — sessions(id)'e FK DEĞİL (bkz.
    // dosya üstü not: oturum temizliği aktör izini silmemeli).
    actorSessionId: text("actor_session_id").notNull(),
    actorRole: text("actor_role", { enum: ACTOR_ROLES }).notNull(),
    actorCredentialId: text("actor_credential_id").references(
      () => vehicleCredentials.id,
    ),
    actorPlatformUserId: text("actor_platform_user_id").references(
      () => platformUsers.id,
    ),
    onBehalfOfKind: text("on_behalf_of_kind", { enum: VEHICLE_ROLES }),
    // Düzeltme turu 1 — audit bulgusu (guvenlik/mimari): yalnız aşağıdaki
    // birleşik FK'lere (ör. `..._on_behalf_of_person_fk`, businessId +
    // onBehalfOfPersonId) güvenmek admin_audit için yetersizdi. §3.2
    // admin_audit.business_id'yi "gerektiğinde" nullable sayıyor; SQLite'ta
    // birleşik bir FK'nin herhangi bir çocuk sütunu NULL ise kısıtın
    // tamamı denetlenmeden geçer (SQLite foreign key kuralları — bir
    // ebeveyn anahtar sütunu NULL olan çocuk satırlar için FK "satisfied"
    // sayılır). Gerçek geçici SQLite dosyasında doğrudan doğrulandı:
    // business_id=NULL + var olmayan on_behalf_of_person_id INSERT'i
    // reddedilmiyordu (bkz. schema.test.ts "admin_audit business_id NULL"
    // grubu). actorCredentialId/actorPlatformUserId'deki gibi business_id'
    // den bağımsız, tekil sütunlu bir FK eklemek (adminAudit.vehicleId'nin
    // zaten sahip olduğu desenle aynı — hem birleşik hem tekil FK) bu
    // boşluğu business_id'den bağımsız olarak kapatır; work_entry_revisions
    // ve cash_confirmations'ta business_id zaten NOT NULL olduğundan bu
    // ek FK onlarda sadece fazladan (zararsız) bir doğrulama katmanıdır.
    onBehalfOfPersonId: text("on_behalf_of_person_id").references(
      () => people.id,
    ),
  };
}

/**
 * "actor_kind"in tam olarak bir kimlik sütunuyla eşleştiğini denetler
 * (sessions'taki "tam biri" kuralının actor sürümü).
 */
function actorKindExclusivityCheck(
  checkName: string,
  actorKind: SQLiteColumn,
  actorCredentialId: SQLiteColumn,
  actorPlatformUserId: SQLiteColumn,
) {
  return check(
    checkName,
    sql`(
      (${actorKind} = 'vehicle_credential' AND ${actorCredentialId} IS NOT NULL AND ${actorPlatformUserId} IS NULL)
      OR
      (${actorKind} = 'platform_user' AND ${actorPlatformUserId} IS NOT NULL AND ${actorCredentialId} IS NULL)
    )`,
  );
}

/** on_behalf_of_kind ve on_behalf_of_person_id ya birlikte dolu ya birlikte boş. */
function onBehalfOfConsistencyCheck(
  checkName: string,
  onBehalfOfKind: SQLiteColumn,
  onBehalfOfPersonId: SQLiteColumn,
) {
  return check(
    checkName,
    sql`(
      (${onBehalfOfKind} IS NULL AND ${onBehalfOfPersonId} IS NULL)
      OR
      (${onBehalfOfKind} IS NOT NULL AND ${onBehalfOfPersonId} IS NOT NULL)
    )`,
  );
}

/**
 * Ortak actor_kind/actor_role/on_behalf_of_kind değer kümesi CHECK'leri
 * (düzeltme turu 1 — mimari bulgusu: bu üç CHECK work_entry_revisions,
 * cash_confirmations ve admin_audit'te birebir aynı SQL metniyle ayrı ayrı
 * yazılmıştı; `actorKindExclusivityCheck`/`onBehalfOfConsistencyCheck` ile
 * aynı desene taşındı). Değer kümeleri §3.2'den: "role owner veya driver"
 * (araç), platform yöneticisi/destek (ekip) → `ACTOR_ROLES`; actor_kind
 * için `ACTOR_KINDS`; on_behalf_of_kind için `VEHICLE_ROLES` (yalnız
 * doldurulmuşsa). Davranış değişmez, yalnız üç `check(...)` çağrısını tek
 * yerden üretir.
 */
function actorEnumChecks(
  namePrefix: string,
  actorKind: SQLiteColumn,
  actorRole: SQLiteColumn,
  onBehalfOfKind: SQLiteColumn,
) {
  return [
    check(
      `${namePrefix}_actor_kind_check`,
      sql`${actorKind} IN ('vehicle_credential', 'platform_user')`,
    ),
    check(
      `${namePrefix}_actor_role_check`,
      sql`${actorRole} IN ('owner', 'driver', 'admin', 'support')`,
    ),
    check(
      `${namePrefix}_on_behalf_of_kind_check`,
      sql`${onBehalfOfKind} IS NULL OR ${onBehalfOfKind} IN ('owner', 'driver')`,
    ),
  ];
}

// ---------------------------------------------------------------------------
// work_entry_revisions — "İşletme/kayıt/sürüm UNIQUE; her başarılı
// değişikliğin tam değer görüntüsü; UPDATE/DELETE yok." (§3.2). §3.2'de
// ayrı `id` listelenmez; (business_id, entry_id, version) PRIMARY KEY'dir.
// ---------------------------------------------------------------------------

export const workEntryRevisions = sqliteTable(
  "work_entry_revisions",
  {
    businessId: text("business_id").notNull(),
    entryId: text("entry_id").notNull(),
    version: integer("version").notNull(),
    action: text("action").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    ...actorTrackingColumns(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.businessId, t.entryId, t.version] }),
    foreignKey({
      name: "work_entry_revisions_entry_fk",
      columns: [t.businessId, t.entryId],
      foreignColumns: [workEntries.businessId, workEntries.id],
    }),
    foreignKey({
      name: "work_entry_revisions_on_behalf_of_person_fk",
      columns: [t.businessId, t.onBehalfOfPersonId],
      foreignColumns: [people.businessId, people.id],
    }),
    check("work_entry_revisions_version_positive_check", sql`${t.version} >= 1`),
    ...actorEnumChecks(
      "work_entry_revisions",
      t.actorKind,
      t.actorRole,
      t.onBehalfOfKind,
    ),
    actorKindExclusivityCheck(
      "work_entry_revisions_actor_kind_exclusivity_check",
      t.actorKind,
      t.actorCredentialId,
      t.actorPlatformUserId,
    ),
    onBehalfOfConsistencyCheck(
      "work_entry_revisions_on_behalf_of_consistency_check",
      t.onBehalfOfKind,
      t.onBehalfOfPersonId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// cash_confirmations — "(business_id, entry_id, entry_version) UNIQUE ve
// ilgili revizyona FK; UPDATE/DELETE yok." (§3.2).
// ---------------------------------------------------------------------------

export const cashConfirmations = sqliteTable(
  "cash_confirmations",
  {
    businessId: text("business_id").notNull(),
    id: text("id").primaryKey(),
    entryId: text("entry_id").notNull(),
    entryVersion: integer("entry_version").notNull(),
    // K5 — "Alınan tutar ayrı alan, ≥ 0."
    receivedCents: integer("received_cents").notNull(),
    confirmedAt: text("confirmed_at").notNull(),
    ...actorTrackingColumns(),
  },
  (t) => [
    unique("cash_confirmations_business_entry_version_uk").on(
      t.businessId,
      t.entryId,
      t.entryVersion,
    ),
    // "ilgili revizyona FK" — aynı sürüme onaylanmış tam revizyon var olmalı.
    foreignKey({
      name: "cash_confirmations_revision_fk",
      columns: [t.businessId, t.entryId, t.entryVersion],
      foreignColumns: [
        workEntryRevisions.businessId,
        workEntryRevisions.entryId,
        workEntryRevisions.version,
      ],
    }),
    foreignKey({
      name: "cash_confirmations_on_behalf_of_person_fk",
      columns: [t.businessId, t.onBehalfOfPersonId],
      foreignColumns: [people.businessId, people.id],
    }),
    check("cash_confirmations_received_cents_nonnegative_check", sql`${t.receivedCents} >= 0`),
    ...actorEnumChecks(
      "cash_confirmations",
      t.actorKind,
      t.actorRole,
      t.onBehalfOfKind,
    ),
    actorKindExclusivityCheck(
      "cash_confirmations_actor_kind_exclusivity_check",
      t.actorKind,
      t.actorCredentialId,
      t.actorPlatformUserId,
    ),
    onBehalfOfConsistencyCheck(
      "cash_confirmations_on_behalf_of_consistency_check",
      t.onBehalfOfKind,
      t.onBehalfOfPersonId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// mutation_receipts — "(scope_key, request_id) UNIQUE; tekrar gönderimde
// aynı işlem sonucunu bulur." (§3.2). §3.2'de ayrı `id` listelenmez.
// ---------------------------------------------------------------------------

export const mutationReceipts = sqliteTable(
  "mutation_receipts",
  {
    scopeKey: text("scope_key").notNull(),
    requestId: text("request_id").notNull(),
    operation: text("operation").notNull(),
    requestHash: text("request_hash").notNull(),
    entityId: text("entity_id"),
    resultVersion: integer("result_version"),
    responseCode: integer("response_code").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scopeKey, t.requestId] })],
);

// ---------------------------------------------------------------------------
// admin_audit — "Kişi/araç/kimlik ve ekip yönetiminin geçmişi; gizli
// değerler dışlanır." (§3.2). "business_id/vehicle_id gerektiğinde" —
// ekip hesabı yönetimi gibi işletmeye bağlı olmayan işlemlerde ikisi de
// NULL kalabilir (§3.1 "Gerekli foreign key alanları NULL olamaz" burada
// ihlal edilmez çünkü bu alanlar açıkça "gerektiğinde" diye şartlı).
// ---------------------------------------------------------------------------

export const adminAudit = sqliteTable(
  "admin_audit",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id").references(() => businesses.id),
    vehicleId: text("vehicle_id").references(() => vehicles.id),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json").notNull(),
    ...actorTrackingColumns(),
    occurredAt: text("occurred_at").notNull(),
  },
  (t) => [
    // vehicle_id verilmişse aynı işletmeye ait gerçek bir araç olmalı.
    foreignKey({
      name: "admin_audit_business_vehicle_fk",
      columns: [t.businessId, t.vehicleId],
      foreignColumns: [vehicles.businessId, vehicles.id],
    }),
    foreignKey({
      name: "admin_audit_on_behalf_of_person_fk",
      columns: [t.businessId, t.onBehalfOfPersonId],
      foreignColumns: [people.businessId, people.id],
    }),
    ...actorEnumChecks("admin_audit", t.actorKind, t.actorRole, t.onBehalfOfKind),
    actorKindExclusivityCheck(
      "admin_audit_actor_kind_exclusivity_check",
      t.actorKind,
      t.actorCredentialId,
      t.actorPlatformUserId,
    ),
    onBehalfOfConsistencyCheck(
      "admin_audit_on_behalf_of_consistency_check",
      t.onBehalfOfKind,
      t.onBehalfOfPersonId,
    ),
    // Düzeltme turu 3 — audit bulgusu (guvenlik/orta): business_id NULL
    // iken vehicle_id/on_behalf_of_person_id gerçek ama BAŞKA işletmeye ait
    // bir kayda sessizce bağlanabiliyordu. Kök neden: SQLite'ta birleşik
    // bir FK'nin (ör. admin_audit_business_vehicle_fk: businessId+vehicleId
    // -> vehicles.businessId+id) herhangi bir çocuk sütunu NULL ise kısıt
    // tamamen "satisfied" sayılır (https://www.sqlite.org/foreignkeys.html
    // — "If any of the child key columns are NULL... the child key is
    // considered to satisfy the constraint"). Turu 1'de eklenen tekil
    // sütunlu FK'ler (vehicleId -> vehicles.id, onBehalfOfPersonId ->
    // people.id, yukarıda actorTrackingColumns() içinde) yalnız "satır
    // gerçekten var mı" sorusunu cevaplıyor; vehicles.id ve people.id
    // PRIMARY KEY olduğundan (işletmeden bağımsız global benzersiz) hangi
    // işletmeye ait olduğunu denetlemiyor. Gerçek geçici SQLite dosyasına
    // karşı doğrudan doğrulandı: business_id=NULL + vehicle_id=<bizA'ya ait
    // gerçek araç> INSERT'i hem tekil hem birleşik FK'den geçiyordu (bkz.
    // schema.test.ts "admin_audit — business_id NULL + var olan ama BAŞKA
    // işletmeden ID" grubu, düzeltme turu 3).
    //
    // Bu CHECK, vehicle_id veya on_behalf_of_person_id doluyken
    // business_id'yi de zorunlu kılarak birleşik FK'leri devreye sokar:
    // business_id NULL kalabilen tek durum ikisi de NULL olduğunda (ör.
    // ekip hesabı yönetimi gibi işletmeye bağlı olmayan işlemler, §3.2
    // "business_id/vehicle_id gerektiğinde") kalır; §3.1 "Bunlar yanlış
    // işletmeye ilişki kurulmasını engeller" garantisi bu tabloda da
    // tutulur.
    check(
      "admin_audit_business_id_required_for_scoped_refs_check",
      sql`(${t.vehicleId} IS NULL OR ${t.businessId} IS NOT NULL)
        AND (${t.onBehalfOfPersonId} IS NULL OR ${t.businessId} IS NOT NULL)`,
    ),
    // §3.5 — "admin_audit(business_id, occurred_at, id) | Destek işlem geçmişi".
    index("idx_admin_audit_business_period").on(t.businessId, t.occurredAt, t.id),
  ],
);

// ---------------------------------------------------------------------------
// Toplu şema — `drizzle(sqlite, { schema })` ve migrator için.
// ---------------------------------------------------------------------------

export const schema = {
  businesses,
  people,
  businessOwners,
  vehicles,
  vehicleDrivers,
  vehicleCredentials,
  platformUsers,
  sessions,
  workEntries,
  workEntryRevisions,
  cashConfirmations,
  mutationReceipts,
  adminAudit,
};

export type Schema = typeof schema;
