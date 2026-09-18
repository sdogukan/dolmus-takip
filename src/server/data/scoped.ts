/**
 * Kapsamlı sorgu yardımcıları — T1.5 ADIM 1/2, S1.5.
 *
 * Görev tanımı (birebir): "kapsamlı sorgu yardımcıları — her okuma/yazma
 * business_id (+ gerektiğinde vehicle_id) filtresini Scope'tan alır; Scope
 * parametresi olmadan çağrılamayan tipler; yazma transaction'ı içinde
 * güncel aktiflik/yetki yeniden denetleyen yardımcı (recheckScopeInTransaction:
 * işletme/araç aktif mi, credential_version değişti mi, oturum iptal
 * edildi mi → değiştiyse işlem geri alınır ve 401/403)."
 *
 * ARCHITECTURE.md §3.1 — "Bunlar [birleşik FK'ler] yanlış işletmeye ilişki
 * kurulmasını engeller; SELECT yetkisini SAĞLAMAZ. Her okuma/yazma,
 * sunucunun ürettiği işletme ve araç kapsamıyla FİLTRELENİR." Bu dosya o
 * filtrenin TEK KAYNAĞIDır: hiçbir çağıran business_id/vehicle_id
 * değerini elle YAZMAZ, yalnız `../auth/scope.ts` `Scope` nesnesinden okur.
 */
import { and, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { systemClock, type Clock } from "../auth/session";
import type { ReceiptScope, Scope } from "../auth/scope";
import type { AppDatabase } from "./db";
import {
  businesses,
  people,
  platformUsers,
  sessions,
  vehicleCredentials,
  vehicleDrivers,
  vehicles,
} from "./schema";
import type { SessionContext } from "../usecases/session/types";
import { SessionExpiredError, SessionRevokedError } from "../usecases/session/errors";

// ---------------------------------------------------------------------------
// Çekirdek filtre — "Scope parametresi olmadan çağrılamayan tip": `scope`
// İLK ve ZORUNLU parametredir; hiçbir üye OPSİYONEL/varsayılanlı değildir,
// bu yüzden TypeScript'te `scopeFilter(columns)` biçiminde (Scope'suz)
// çağırmak DERLENMEZ.
// ---------------------------------------------------------------------------

export interface ScopedTableColumns {
  businessId: SQLiteColumn;
  /** Yalnız tablo GERÇEKTEN vehicle_id taşıyorsa verilir (ör. work_entries,
   * vehicle_credentials); people gibi işletme-seviyeli tablolarda YOKTUR. */
  vehicleId?: SQLiteColumn;
}

/**
 * `columns.vehicleId` verilmiş ama `scope`'ta (henüz belirli bir araca
 * İNMEMİŞ bir StaffScope — ör. `/admin/businesses/:id`) `vehicleId` YOKSA
 * fırlatılır: bu, araç seviyeli bir tabloyu araç kapsamı OLMADAN sorgulama
 * girişimidir — sessizce "tüm işletmeyi" DÖNMEK yanlış olur (ARCH §3.1
 * "yanlış işletmeye ilişki kurulmasını engeller" ilkesiyle aynı
 * doğrultuda: sessiz kapsam GENİŞLEMESİ değil, açık programlama hatası).
 */
export class ScopeMissingVehicleIdError extends Error {
  constructor() {
    super(
      "Bu tablo vehicle_id ile taranıyor ama Scope'ta vehicleId yok. " +
        "Araç seviyeli bir tabloyu araç kapsamı olmadan SORGULAMA.",
    );
    this.name = "ScopeMissingVehicleIdError";
  }
}

/**
 * `scope`'un business_id'sine (ve, `columns.vehicleId` verilmişse,
 * vehicle_id'sine) eşitlik koşulu üretir. Dönen `SQL`, çağıranın kendi
 * `.where(...)` çağrısına (gerekiyorsa `and(scopeFilter(...), ekKoşul)`
 * ile) verilir — bu fonksiyon SORGUYU KENDİSİ ÇALIŞTIRMAZ, yalnız
 * filtreyi üretir (her tablo/kullanım durumu kendi `select`/`update`
 * şeklini seçer).
 */
export function scopeFilter(scope: Scope, columns: ScopedTableColumns): SQL {
  const conditions = [eq(columns.businessId, scope.businessId)];
  if (columns.vehicleId) {
    if (!scope.vehicleId) {
      throw new ScopeMissingVehicleIdError();
    }
    conditions.push(eq(columns.vehicleId, scope.vehicleId));
  }
  // `and(...)` tek bir koşulla de çağrılsa (vehicleId yoksa) tanımlı bir
  // `SQL` döner (drizzle-orm `and()` en az bir argümanla asla `undefined`
  // dönmez); iki argümanlı çağrıda da aynı garanti geçerlidir.
  return and(...conditions) as SQL;
}

// ---------------------------------------------------------------------------
// Somut tablolar için kullanıma hazır kısayollar — S1.5'in doğrudan
// ilgilendiği izinlerin (driver.read_active, driver.manage) dayandığı
// tablolar. work_entries/work_entry_revisions/cash_confirmations gibi mali
// tablolar için somut kısayollar T3.x'in kendi kullanım durumlarıyla
// birlikte eklenecektir (şema zaten hazır; `scopeFilter` üstteki genel
// çekirdek olarak onları da KARŞILAR — yalnız burada erken/kullanılmayan
// bir "work-entry sorgusu" İCAT EDİLMEZ).
// ---------------------------------------------------------------------------

/** people — işletme seviyeli (vehicle_id YOK). */
export function scopedPeopleFilter(scope: Scope): SQL {
  return scopeFilter(scope, { businessId: people.businessId });
}

/** vehicles — işletme seviyeli; belirli bir araç kapsamı VARSA (staff
 * hedefi veya vehicle oturumu) o araca da daraltır. */
export function scopedVehiclesFilter(scope: Scope): SQL {
  if (scope.vehicleId) {
    return scopeFilter(scope, { businessId: vehicles.businessId, vehicleId: vehicles.id });
  }
  return scopeFilter(scope, { businessId: vehicles.businessId });
}

/** vehicle_drivers — üçlü anahtarın (business_id, vehicle_id, person_id)
 * ilk ikisini Scope'tan alır; ARAÇ KAPSAMI ZORUNLUDUR (bu tablo her zaman
 * belirli bir araca aittir — bkz. `../data/schema.ts` `vehicleDrivers`). */
export function scopedVehicleDriversFilter(scope: Scope): SQL {
  return scopeFilter(scope, {
    businessId: vehicleDrivers.businessId,
    vehicleId: vehicleDrivers.vehicleId,
  });
}

// ---------------------------------------------------------------------------
// recheckScopeInTransaction — ARCHITECTURE §3.4 adım 3: "Kısa yazma
// transaction'ı içinde güncel yetki/aktiflik ... kontrol edilir." ve
// STORIES.md S1.5 AC7: "Yetki kontrolü tekrar gönderim sonucu okunurken ve
// yazmanın tamamlandığı noktada da korunur. Arada erişimi iptal edilen
// kullanıcı eski başarılı işlem yanıtını kullanarak yeni yetki kazanamaz."
//
// `../usecases/access/run-access-change-transaction.ts`'in ve
// `../usecases/session/revoke-session.ts`'in "Sync çekirdek" deseniyle
// AYNI nedenle (bkz. o dosyaların üst notları): better-sqlite3'ün native
// `sqlite.transaction(fn)` sarmalayıcısı `fn`'in SENKRON olmasını ister;
// bu yüzden bu fonksiyon Drizzle'ın `await` GEREKTİRMEYEN `.get()` üye
// metodunu kullanır ve `withImmediateTransaction(db.$client, () => {
// recheckScopeInTransaction(db, context, scope); ...yazma... })` biçiminde,
// YAZMADAN HEMEN ÖNCE aynı transaction içinde çağrılır.
//
// Durum kodu kararı — görev tanımının BİREBİR verdiği "401/403" ikilisi
// (404 YOKTUR, bkz. gerekçe): bu fonksiyon YALNIZCA daha önce BİR KEZ
// (guard/scope-resolution aşamasında) var olduğu ve erişilebilir olduğu
// DOĞRULANMIŞ bir hedefin transaction ANINDA hâlâ geçerli olup olmadığını
// yeniden dener — "nesnenin hiç var olmaması" (404) senaryosu burada
// OLUŞAMAZ (ARCHITECTURE §3.1 — "Kişi/araç pasife alınır; ... fiziksel
// olarak SİLİNMEZ"; bir satır transaction'lar arasında YOK OLMAZ, yalnız
// `active` bayrağı değişebilir). Kalan iki durum:
// - Aktörün KENDİ kimliği (oturum/credential/platform_user) artık geçersiz
//   → 401 (SessionError kodlarıyla BİREBİR aynı anlam — `../usecases/
//   session/errors.ts`'teki SESSION_REVOKED/SESSION_EXPIRED kodları
//   YENİDEN KULLANILIR, yeni bir kod İCAT EDİLMEZ).
// - Aktörün kimliği GEÇERLİ ama hedef (scope.businessId/vehicleId) artık
//   pasif → 403 ("işlem yetkisi yok" — nesne bulunabilir/gerçek ama BU
//   İŞLEM ona artık uygulanamaz; `../auth/scope.ts`
//   `resolveStaffVehicleScopeFromHeader`'ın `mode: "write"` + pasif hedef
//   durumuyla AYNI 403 sınıfı, tutarlılık için).
// ---------------------------------------------------------------------------

export class ScopeTargetInactiveError extends Error {
  readonly status = 403 as const;
  readonly code = "TARGET_INACTIVE_FOR_WRITE";
  constructor(message = "İşletme veya araç artık pasif; bu işlem yapılamaz.") {
    super(message);
    this.name = "ScopeTargetInactiveError";
  }
}

/**
 * `recheckScopeInTransaction`in hedef aktiflik denetimini SEÇEREK atlamak
 * için — denetim bulgusu (düzeltme turu 1, `mimari` merceği): "ARCH §2
 * yetki matrisi 'İşletme/araç açma' işlemini staff'a veriyor; aynı
 * transaction içinde ARCH §3.4 adım 3'ün istediği şekilde
 * `recheckScopeInTransaction` çağrılırsa, staff'ın PATCH /admin/vehicles/:id
 * veya /admin/businesses/:id ile tam da PASİF olan bir hedefi `active: true`
 * yapma isteği, hedefin O AN pasif olması YÜZÜNDEN 403 ile reddedilir" —
 * yani bu paylaşılan fonksiyon, kendisinin çözmesi gereken TEK meşru
 * "reaktivasyon" senaryosunu yapısal olarak imkânsız kılıyordu.
 *
 * Aktörün KENDİ kimliği (oturum/credential/platform_user geçerliliği) bu
 * bayraktan ETKİLENMEZ — daima denetlenir (401 sınıfı hiçbir zaman
 * atlanamaz); yalnız businesses/vehicles.active KOŞULU, açıkça istenen
 * alan(lar) için, çağıranın SORUMLULUĞUNDA atlanabilir. İki alan AYRI
 * tutulur çünkü bir vehicle-hedefli StaffScope hem businessId hem
 * vehicleId taşır (`resolveAdminScope`) ve reaktivasyon genelde bunlardan
 * yalnız BİRİNİ hedefler (ör. "aracı aç" işlemi işletmenin aktif KALMASINI
 * gerektirir; yalnız aracın kendi pasiflik bayrağı bu işlemin konusudur).
 *
 * Varsayılan (`{}`, her iki alan `false`) MEVCUT sıkı davranışı KORUR —
 * bugünkü hiçbir çağıran (`find-receipt.ts`, work_entry mutasyonları)
 * etkilenmez. Bu, T2.1/T2.2'nin YAZACAĞI admin aktivasyon route
 * handler'ları için ÖNCEDEN açılan bir kapıdır (görev tanımı — "Yeni
 * E2–E5 endpoint'leri aynı denetimi ... kullanır"); handler'ın kendisi
 * HENÜZ yazılmadığından hangi alanın gerçekte atlanacağı burada
 * VARSAYILMAZ, yalnız mekanizma sağlanır.
 */
export interface RecheckScopeOptions {
  /** `true` ise `scope.businessId`nin `businesses.active` denetimi
   * ATLANIR (yalnız BU mutasyon işletmeyi bizzat aktive ediyorsa
   * kullanılmalıdır). Varsayılan `false`. */
  skipBusinessActiveCheck?: boolean;
  /** `true` ise `scope.vehicleId`nin `vehicles.active` denetimi ATLANIR
   * (yalnız BU mutasyon aracı bizzat aktive ediyorsa kullanılmalıdır).
   * Varsayılan `false`; `scope.vehicleId` yoksa etkisizdir. */
  skipVehicleActiveCheck?: boolean;
}

/**
 * `context` — bu yazmayı başlatan `requireWrite`/`requireSession`'ın
 * ürettiği ORİJİNAL `SessionContext` (guard zamanında çözülmüş `sessionId`/
 * `credentialId`/`platformUserId` taşır). `scope` — aynı isteğin
 * (vehicleId'e göre farklılaşabilen, staff için header'dan çözülmüş)
 * `Scope`'u — VEYA (T2.1, POST /admin/businesses gibi hedef işletme henüz
 * VAR OLMADAN önceki oluşturma uçları için) `../auth/scope.ts`
 * `StaffActorScope` (yalnız ekip aktörünün kendi kimliği, işletme/araç
 * hedefi YOK). İkisi BİRLİKTE gerekir: `context` AKTÖRÜN kendi kimliğini,
 * `scope` YAZILACAK HEDEFİ (staff için context'ten FARKLI olabilir)
 * doğrular. `options` — bkz. `RecheckScopeOptions` üst notu; varsayılan
 * `{}` mevcut sıkı davranışı korur.
 *
 * `scope`'ta `businessId`/`vehicleId` YOKSA (yalnız `StaffActorScope`),
 * bu alanlara bağlı aktiflik denetimleri ATLANIR — henüz VAR OLMAYAN bir
 * hedefin aktifliği sorgulanamaz; AKTÖRÜN KENDİ kimliği (oturum/credential/
 * platform_user geçerliliği) bundan ETKİLENMEZ, HER ZAMAN denetlenir (401
 * sınıfı asla atlanamaz). Var olan HER çağıran zaten tam bir `Scope`
 * (`businessId` her zaman GERÇEK ve DOLU) GEÇTİĞİNDEN, bu genişleme onların
 * davranışını DEĞİŞTİRMEZ.
 *
 * Başarılı dönüş `void`'tir (hiçbir şey fırlatılmadıysa denetim geçmiştir);
 * başarısızlık `SessionExpiredError`/`SessionRevokedError` (401) veya
 * `ScopeTargetInactiveError` (403) FIRLATIR — better-sqlite3'ün native
 * transaction sarmalayıcısı bir `throw`'u YAKALAYIP OTOMATİK `ROLLBACK`
 * yapar (`node_modules/better-sqlite3/lib/methods/transaction.js`), bu
 * yüzden "işlem geri alınır" ayrıca elle YAZILMAZ.
 */
export function recheckScopeInTransaction(
  db: AppDatabase,
  context: SessionContext,
  scope: ReceiptScope,
  clock: Clock = systemClock,
  options: RecheckScopeOptions = {},
): void {
  const now = clock();

  const sessionRow = db
    .select({
      revokedAt: sessions.revokedAt,
      issuedVersion: sessions.issuedVersion,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.id, context.sessionId))
    .get();

  if (!sessionRow || sessionRow.revokedAt !== null) {
    throw new SessionRevokedError();
  }
  if (now.getTime() >= Date.parse(sessionRow.expiresAt)) {
    throw new SessionExpiredError();
  }

  if (context.kind === "vehicle") {
    if (!context.credentialId) {
      throw new SessionRevokedError();
    }
    const credential = db
      .select({ credentialVersion: vehicleCredentials.credentialVersion })
      .from(vehicleCredentials)
      .where(eq(vehicleCredentials.id, context.credentialId))
      .get();
    if (!credential || credential.credentialVersion !== sessionRow.issuedVersion) {
      throw new SessionRevokedError();
    }
  } else {
    if (!context.platformUserId) {
      throw new SessionRevokedError();
    }
    const platformUser = db
      .select({
        credentialVersion: platformUsers.credentialVersion,
        active: platformUsers.active,
      })
      .from(platformUsers)
      .where(eq(platformUsers.id, context.platformUserId))
      .get();
    if (
      !platformUser ||
      !platformUser.active ||
      platformUser.credentialVersion !== sessionRow.issuedVersion
    ) {
      throw new SessionRevokedError();
    }
  }

  if ("businessId" in scope && scope.businessId) {
    const business = db
      .select({ active: businesses.active })
      .from(businesses)
      .where(eq(businesses.id, scope.businessId))
      .get();
    if (!business) {
      throw new ScopeTargetInactiveError();
    }
    if (!options.skipBusinessActiveCheck && !business.active) {
      throw new ScopeTargetInactiveError();
    }
  }

  if ("vehicleId" in scope && scope.vehicleId) {
    const vehicle = db
      .select({ active: vehicles.active })
      .from(vehicles)
      .where(eq(vehicles.id, scope.vehicleId))
      .get();
    if (!vehicle) {
      throw new ScopeTargetInactiveError();
    }
    if (!options.skipVehicleActiveCheck && !vehicle.active) {
      throw new ScopeTargetInactiveError();
    }
  }
}
