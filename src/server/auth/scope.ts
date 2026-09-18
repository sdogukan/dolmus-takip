/**
 * Sunucu yetki kapsamı (Scope) üretimi — T1.5 ADIM 1/2, S1.5.
 *
 * Görev tanımı (birebir): "SessionContext'ten sunucu kapsamı üretimi.
 * Araç oturumu → Scope { businessId, vehicleId, actor: 'owner'|'driver',
 * credentialId }. Ekip oturumu → hedef işletme/araç istemciden gelir ama
 * SUNUCUDA doğrulanır: müşteri uçları (/work-entries, /drivers, /reports,
 * /vehicles/:id/drivers) için `X-Target-Vehicle: <vehicleId>` header'ı
 * (sunucu vehicles tablosundan business_id'yi türetir; araç yoksa 404;
 * okuma için pasif araç kabul, yazma için aktif işletme+araç şart);
 * /admin/* uçları için hedef path ID'lerinden gelir. Scope { businessId,
 * vehicleId?, actor: 'support'|'admin', platformUserId, onBehalfOf: true }."
 *
 * ARCHITECTURE.md §2 — "Platform desteğinde hedef işletme/araç hem ekranda
 * hem sunucuda doğrulanır." ve §4 — "Araç rolü scope'u oturumdan çıkarır;
 * URL'deki ID tek başına erişim hakkı vermez. Staff kapsamı sunucunun
 * doğruladığı açık business/vehicle hedefidir."
 *
 * Bu dosya HENÜZ VAR OLMAYAN E2–E5 endpoint'lerini (work-entries, drivers,
 * reports, admin/*) YAZMAZ (TASKS.md T1.5 — "Yeni E2–E5 endpoint'leri aynı
 * denetimi ve kapsam testlerini kullanır; henüz varmış gibi sunulmaz.").
 * Yalnız o endpoint'lerin GEREKSİNECEĞİ, doğrudan test edilebilir çekirdek
 * kapsam-çözümleme fonksiyonlarını sağlar.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../data/db";
import { businesses, vehicles } from "../data/schema";
import type { SessionContext, SessionRole } from "../usecases/session/types";

// ---------------------------------------------------------------------------
// Scope tipleri.
// ---------------------------------------------------------------------------

/** Görev tanımının kullandığı dört aktör adı — ARCHITECTURE §2 yetki matrisi
 * satırlarıyla birebir (bkz. `./permissions.ts` üst notu). */
export type Actor = "owner" | "driver" | "support" | "admin";

interface ScopeBase {
  businessId: string;
}

/**
 * Araç oturumu kapsamı — görev tanımı: "Scope { businessId, vehicleId,
 * actor: 'owner'|'driver', credentialId }." DB erişimi GEREKMEZ: araç
 * oturumunun kapsamı zaten `resolveSession` tarafından doğrulanmış
 * `SessionContext`'in kendisidir (bkz. `scopeFromVehicleSession`).
 */
export interface VehicleScope extends ScopeBase {
  kind: "vehicle";
  actor: "owner" | "driver";
  vehicleId: string;
  credentialId: string;
}

/**
 * Ekip (platform) oturumu kapsamı — görev tanımı: "Scope { businessId,
 * vehicleId?, actor: 'support'|'admin', platformUserId, onBehalfOf: true }."
 * `vehicleId` yalnız hedefin belirli bir ARACA indiği durumlarda (müşteri
 * uçları, /admin/vehicles/:id, /vehicles/:id/drivers) doludur; salt işletme
 * hedefli yönetim işlemlerinde (/admin/businesses/:id) YOKTUR.
 */
export interface StaffScope extends ScopeBase {
  kind: "staff";
  actor: "support" | "admin";
  vehicleId?: string;
  platformUserId: string;
  onBehalfOf: true;
}

export type Scope = VehicleScope | StaffScope;

/**
 * T2.1 — POST /admin/businesses (işletme OLUŞTURMA) için: hedef işletme
 * henüz VAR OLMADIĞINDAN normal `StaffScope`'un zorunlu `businessId`si
 * ÜRETİLEMEZ (risk notu — "POST oluşturmada Scope yoktur"). Bu, yalnız
 * EKİP aktörünün kendi KALICI kimliğini taşıyan, işletme/araç hedefi
 * OLMAYAN bir kapsamdır; yalnız `computeReceiptScopeKey`/
 * `recheckScopeInTransaction`'ın (bkz. `../data/scoped.ts`,
 * `../usecases/receipts/*`) "işletme kapsamı olmadan da çağrılabilir"
 * genişlemesiyle birlikte kullanılır — `authorize`/`hasPermission`
 * `business.manage` iznini zaten `target: "none"` (Scope'suz) üzerinden
 * denetler (bkz. `../http/handler.ts`).
 */
export interface StaffActorScope {
  kind: "staff";
  actor: "support" | "admin";
  platformUserId: string;
}

/**
 * `computeReceiptScopeKey`/`recheckScopeInTransaction`/`findReceipt`/
 * `resolveReceipt`'in ORTAK parametre tipi — normal (hedefi ÇÖZÜLMÜŞ)
 * `Scope` VEYA yukarıdaki hedefsiz `StaffActorScope`. Var olan HER çağıran
 * zaten tam bir `Scope` GEÇTİĞİNDEN (`businessId` her zaman GERÇEK ve
 * DOLU), bu genişleme onların davranışını DEĞİŞTİRMEZ — yalnız T2.1'in
 * oluşturma akışına yeni bir GİRİŞ açar.
 */
export type ReceiptScope = Scope | StaffActorScope;

export function buildStaffActorScope(context: SessionContext): StaffActorScope {
  assertStaffSession(context);
  return {
    kind: "staff",
    actor: context.role,
    platformUserId: context.platformUserId,
  };
}

function isVehicleActorRole(role: SessionRole): role is "owner" | "driver" {
  return role === "owner" || role === "driver";
}

function isStaffActorRole(role: SessionRole): role is "support" | "admin" {
  return role === "support" || role === "admin";
}

/**
 * `StaffScope` nesne literalinin TEK üretim noktası — denetim bulgusu
 * (düzeltme turu 3, `mimari` merceği): aynı `{ kind: "staff", actor,
 * businessId, vehicleId?, platformUserId, onBehalfOf: true }` biçimi
 * `resolveStaffVehicleScopeFromHeader` ve `resolveAdminScope`'un HER İKİ
 * dalında (üç yerde) neredeyse birebir tekrarlanıyordu; davranışı
 * ETKİLEMİYORDU ama tek bir yardımcıya indirilir.
 */
function buildStaffScope(
  context: SessionContext & { platformUserId: string; role: "support" | "admin" },
  target: { businessId: string; vehicleId?: string },
): StaffScope {
  return {
    kind: "staff",
    actor: context.role,
    businessId: target.businessId,
    ...(target.vehicleId ? { vehicleId: target.vehicleId } : {}),
    platformUserId: context.platformUserId,
    onBehalfOf: true,
  };
}

// ---------------------------------------------------------------------------
// Araç oturumu → Scope (DB erişimi yok — saf dönüşüm).
// ---------------------------------------------------------------------------

/**
 * `resolveSession`'ın ürettiği `SessionContext` zaten TÜM bu alanları
 * (businessId/vehicleId/credentialId/role) taşıyıp doğrulamış olduğundan
 * (bkz. `../usecases/session/resolve-session.ts`), bu fonksiyon yalnız
 * BİÇİM dönüştürür — yeni bir DB sorgusu veya doğrulama YAPMAZ. `kind !==
 * "vehicle"` veya eksik alan durumu (`resolveSession`'ın invaryantı ihlal
 * edilmiş demektir) SAVUNMA amaçlı bir hata fırlatır (bkz. `../../data/
 * schema.ts` ve `../auth/guard.ts`'nin benzer "asla olmaması gereken"
 * denetimleri — birleşik FK/CHECK kısıtları bunu DB düzeyinde zaten
 * engeller, burada yalnız programlama hatasına karşı ikinci bir katmandır).
 */
export class InvalidSessionKindForScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSessionKindForScopeError";
  }
}

export function scopeFromVehicleSession(context: SessionContext): VehicleScope {
  if (
    context.kind !== "vehicle" ||
    !context.businessId ||
    !context.vehicleId ||
    !context.credentialId ||
    !isVehicleActorRole(context.role)
  ) {
    throw new InvalidSessionKindForScopeError(
      "scopeFromVehicleSession yalnız araç (vehicle) oturumu için ve " +
        "businessId/vehicleId/credentialId dolu, role owner/driver iken " +
        "çağrılabilir.",
    );
  }
  return {
    kind: "vehicle",
    actor: context.role,
    businessId: context.businessId,
    vehicleId: context.vehicleId,
    credentialId: context.credentialId,
  };
}

// ---------------------------------------------------------------------------
// İstemciden ASLA kapsam genişletmeyen alanlar — zod ile güvence.
// ---------------------------------------------------------------------------

/**
 * STORIES.md S1.5 AC2 — "İstemciden gelen işletme, rol veya kişi alanı
 * erişim kapsamını genişletmez." Görev tanımı (permissions.ts paragrafı,
 * birebir): "İstemciden gelen role/personId/businessId/ownerId alanları
 * ASLA kapsamı genişletmez (zod şemaları bu alanları reddeder veya yok
 * sayar; test)."
 *
 * Bu dört alan hiçbir Scope çözümleme fonksiyonunun PARAMETRESİ DEĞİLDİR
 * (yalnız `SessionContext` — sunucunun DB'den ürettiği veri — ve, staff
 * için, sunucunun AYRICA DB'de doğruladığı tek bir `vehicleId` girdisi
 * kullanılır). `scopeSafeObject` gelecekteki T2.x+/T3.x+ istek gövdesi
 * şemalarının UYMASI GEREKEN kuraldır: (a) şema TANIMLANIRKEN bu dört
 * alandan biri kullanılmaya çalışılırsa hemen (geliştirme/test anında)
 * fırlatır — bu alanlar için bir istek gövdesi ŞEMASI YAZILAMAZ; (b) zod'un
 * `z.object(...)` varsayılan davranışı (`.strip()`) taşınan HERHANGİ bir
 * FAZLADAN anahtarı (ör. istemci şemada olmayan bir `businessId` eklerse)
 * ayrıştırılmış çıktıdan SESSİZCE ATAR — bu ikinci katman, şemanın
 * KENDİSİ güvenli olsa bile istemcinin GÖVDEYE keyfi ekstra alan
 * eklemesine karşı korur.
 */
export const FORBIDDEN_CLIENT_SCOPE_FIELDS = [
  "role",
  "personId",
  "businessId",
  "ownerId",
] as const;

export class ForbiddenClientScopeFieldError extends Error {
  constructor(field: string) {
    super(
      `Şema yasaklı bir kapsam alanı içeriyor: "${field}". Bu alan ` +
        "istemciden ASLA kabul edilmez (bkz. TASKS.md T1.5 / STORIES.md " +
        "S1.5 AC2).",
    );
    this.name = "ForbiddenClientScopeFieldError";
  }
}

export function scopeSafeObject<Shape extends z.ZodRawShape>(
  shape: Shape,
): z.ZodObject<Shape, z.core.$strip> {
  for (const field of FORBIDDEN_CLIENT_SCOPE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(shape, field)) {
      throw new ForbiddenClientScopeFieldError(field);
    }
  }
  return z.object(shape);
}

// ---------------------------------------------------------------------------
// Ekip (staff) oturumu → Scope — müşteri uçları (`X-Target-Vehicle` header).
// ---------------------------------------------------------------------------

/** Görev tanımının birebir header adı. */
export const TARGET_VEHICLE_HEADER = "x-target-vehicle";

/**
 * Header DEĞERİ yalnız bir kimlik dizesidir — `crypto.randomUUID()`
 * biçimini ZORUNLU KILMAYIZ (`../data/db.ts`/`../data/schema.ts` "id"
 * sütunları "uygulamada üretilen UUID" der ama bu modül bir FORMAT
 * varsayımı yapmaz; DB'de eşleşen satır yoksa zaten 404 üretilir — bu,
 * "varsayımda bulunma" ilkesiyle daha uyumludur). Yalnız boş/whitespace-
 * only bir değeri reddeder.
 */
const targetVehicleHeaderSchema = z.string().trim().min(1);

/** Okuma uçları (GET) pasif araç/işletmeyi KABUL eder; yazma uçları
 * (POST/PATCH/PUT) aktif işletme+araç ŞART koşar (görev tanımı, birebir). */
export type ScopeMode = "read" | "write";

export type ScopeResolutionFailureStatus = 403 | 404 | 422;

export interface ScopeResolutionFailure {
  ok: false;
  status: ScopeResolutionFailureStatus;
  code: string;
  message: string;
}

export type ScopeResolutionResult =
  | { ok: true; scope: StaffScope }
  | ScopeResolutionFailure;

function assertStaffSession(
  context: SessionContext,
): asserts context is SessionContext & {
  kind: "platform";
  platformUserId: string;
  role: "support" | "admin";
} {
  if (
    context.kind !== "platform" ||
    !context.platformUserId ||
    !isStaffActorRole(context.role)
  ) {
    throw new InvalidSessionKindForScopeError(
      "Bu fonksiyon yalnız ekip (support/admin) oturumu için çağrılabilir.",
    );
  }
}

/**
 * Müşteri uçları (`/work-entries`, `/drivers`, `/reports`,
 * `/vehicles/:id/drivers`) için ekip hedefini `X-Target-Vehicle`
 * header'ından ÇÖZER ve DOĞRULAR. Yalnız ekip (platform, support/admin)
 * oturumu için çağrılabilir — araç oturumu KENDİ kapsamını zaten bilir
 * (bkz. `scopeFromVehicleSession`), bu fonksiyona hiç ihtiyaç duymaz.
 *
 * Durum kodu kararları (görev tanımının birebir yazmadığı, buradan
 * TÜRETİLEN mühendislik kararları — ARCHITECTURE §4'ün üç kategorisine
 * (401 oturum yok / 403 işlem yetkisi yok / 404 kapsam dışı nesne)
 * dayanır; bu ayrım aşağıdaki `recheckScopeInTransaction`'ın (bkz.
 * `../data/scoped.ts`) görev tanımının BİREBİR verdiği "401/403" ikilisiyle
 * TUTARLI tutulmuştur — kanıt için o dosyanın üst notuna bakın; docs/
 * DECISIONS.md'de AYRICA kayıtlı DEĞİLDİR, bu ADIM'ın open_issues'ında
 * işaretlenmiştir):
 * - Header hiç YOKSA veya boşsa → 422 (istemcinin eksik/hatalı isteği;
 *   bir "nesne" henüz ADLANMADIĞI için 404 anlamsız, bir "yetki" sorusu da
 *   değil).
 * - Header dolu ama böyle bir araç YOKSA → 404 ("kapsam dışı nesne").
 * - Header geçerli bir araca işaret ediyor ama `mode: "write"` iken araç
 *   VEYA işletme PASİFSE → 403 (nesnenin KENDİSİ gerçek ve bulunabilir —
 *   `mode: "read"` aynı isteği kabul ederdi — bu yüzden "yok" değil,
 *   "şu an bu işlem için İZİN YOK" durumudur).
 */
export async function resolveStaffVehicleScopeFromHeader(
  context: SessionContext,
  request: Request,
  db: AppDatabase,
  mode: ScopeMode,
): Promise<ScopeResolutionResult> {
  assertStaffSession(context);

  const rawHeader = request.headers.get(TARGET_VEHICLE_HEADER);
  if (rawHeader === null) {
    return {
      ok: false,
      status: 422,
      code: "TARGET_VEHICLE_MISSING",
      message: `${TARGET_VEHICLE_HEADER} header'ı zorunludur.`,
    };
  }
  const parsedHeader = targetVehicleHeaderSchema.safeParse(rawHeader);
  if (!parsedHeader.success) {
    return {
      ok: false,
      status: 422,
      code: "TARGET_VEHICLE_INVALID",
      message: `${TARGET_VEHICLE_HEADER} header'ı geçersiz.`,
    };
  }
  const vehicleId = parsedHeader.data;

  const rows = await db
    .select({
      id: vehicles.id,
      businessId: vehicles.businessId,
      vehicleActive: vehicles.active,
      businessActive: businesses.active,
    })
    .from(vehicles)
    .innerJoin(businesses, eq(vehicles.businessId, businesses.id))
    .where(eq(vehicles.id, vehicleId))
    .limit(1);
  const target = rows[0];

  if (!target) {
    return {
      ok: false,
      status: 404,
      code: "TARGET_VEHICLE_NOT_FOUND",
      message: "Belirtilen araç bulunamadı.",
    };
  }

  if (mode === "write" && (!target.vehicleActive || !target.businessActive)) {
    return {
      ok: false,
      status: 403,
      code: "TARGET_INACTIVE_FOR_WRITE",
      message: "İşletme veya araç pasif; bu işlem yapılamaz.",
    };
  }

  return {
    ok: true,
    scope: buildStaffScope(context, { businessId: target.businessId, vehicleId: target.id }),
  };
}

// ---------------------------------------------------------------------------
// Ekip (staff) oturumu → Scope — /admin/* uçları (hedef path ID'lerinden).
// ---------------------------------------------------------------------------

/**
 * `/admin/*` uçlarında hedef, `X-Target-Vehicle` header'ından DEĞİL, Next
 * Route Handler'ın KENDİ path parametrelerinden gelir (görev tanımı —
 * "/admin/* uçları için hedef path ID'lerinden gelir"); bu yüzden çağıran
 * (henüz yazılmamış admin route handler'ı) bu ID'leri KENDİSİ ayrıştırıp
 * burada AÇIKÇA verir — bu fonksiyon hiçbir header/URL AYRIŞTIRMASI YAPMAZ.
 */
export interface AdminScopeTarget {
  businessId?: string;
  vehicleId?: string;
}

/**
 * `/admin/vehicles/:id`, `/admin/vehicles/:id/reset-password`,
 * `/vehicles/:id/drivers` gibi belirli bir ARACA (ve onun işletmesine)
 * bağlı yönetim uçları için — `vehicleId` VERİLDİĞİNDE gerçek `business_id`
 * o araçtan TÜRETİLİR ("sunucu vehicles tablosundan business_id'yi
 * türetir" ilkesi burada da uygulanır); path'te AYRICA bir `businessId`
 * segmenti varsa (ör. iç içe bir rota tasarımı seçilirse) bu iki değerin
 * TUTARSIZLIĞI da (başka işletmenin aracı) 404 sayılır — istemcinin path'e
 * yazdığı `businessId` TEK BAŞINA hiçbir zaman güvenilmez.
 *
 * `/admin/businesses/:id` gibi yalnız İŞLETME hedefli uçlar için `vehicleId`
 * VERİLMEZ; `businessId`'nin GERÇEKTEN var olduğu doğrulanır.
 *
 * `/admin/users` (platform_user.manage) gibi HİÇBİR işletme/araca bağlı
 * OLMAYAN uçlar bu fonksiyonu KULLANMAZ — StaffScope'un `businessId: string`
 * (zorunlu) alanı bu tür global işlemlere UYMAZ (bkz. dosya sonundaki
 * "AÇIK NOKTA" notu); onlar yalnız `../auth/permissions.ts`
 * `permissionsForActor(context.role)` ile ROL bazlı denetlenir, bir Scope
 * NESNESİNE ihtiyaç duymazlar.
 *
 * **KASITLI FARK — `resolveStaffVehicleScopeFromHeader` (yukarısı) `mode:
 * "write"` + pasif hedef kombinasyonunu SCOPE ÇÖZÜMLEME anında 403
 * `TARGET_INACTIVE_FOR_WRITE` ile reddeder; bu fonksiyon böyle bir `mode`
 * parametresi ALMAZ ve businesses/vehicles.active bayrağına HİÇ BAKMAZ.**
 * Bu bir eksiklik/unutma DEĞİLDİR (denetim bulgusu, düzeltme turu 3,
 * `guvenlik` merceği — doğrulandı ve BİLİNÇLİ KORUNDU): ARCH §2 yetki
 * matrisinin staff'a verdiği "İşletme/araç açma" işlemi TAM OLARAK bu
 * fonksiyonun ürettiği Scope üzerinden PATCH edilecek (T2.1/T2.2, henüz
 * yazılmadı) TEK meşru "pasif → aktif" (reaktivasyon) senaryosudur. Eğer bu
 * fonksiyon da `resolveStaffVehicleScopeFromHeader` gibi write+pasif'i
 * SCOPE ÇÖZÜMLEME anında (handler'a hiç girmeden, dolayısıyla o handler'ın
 * "bu yazma tam da hedefi reaktive ediyor" kararını hiç veremeden) reddetse,
 * staff bir işletmeyi/aracı ASLA yeniden aktifleştiremezdi — tam olarak
 * `../data/scoped.ts` `RecheckScopeOptions`'ın (bkz. o dosyanın üst notu)
 * çözdüğü kısır döngü burada YENİDEN doğardı.
 *
 * Sonuç: target:"business" yazmalarında TEK savunma katmanı,
 * `../data/scoped.ts` `recheckScopeInTransaction`'ın YAZMA TRANSACTION'I
 * İÇİNDE, hedefi reaktive ETMEYEN her yazma için `skipBusinessActiveCheck`/
 * `skipVehicleActiveCheck` OLMADAN çağrılmasıdır. Bu çağrı `withProtectedRoute`
 * tarafından yapısal/tip düzeyinde ZORUNLU KILINAMAZ (denetim + yazma AYNI
 * transaction'da olmalıdır — genel bir route wrapper'ının ön-adımı olamaz).
 * T2.1/T2.2'nin izlemesi GEREKEN, canlı bir HTTP isteğiyle kanıtlanmış
 * DOĞRU örnek: `tests/integration/protected-route.test.ts`'in
 * `withProtectedRoute — target:'business' + write:true` bloğu (pasif hedefe
 * sıradan yazma → 403; hedefi reaktive eden yazma → 200).
 */
export async function resolveAdminScope(
  context: SessionContext,
  target: AdminScopeTarget,
  db: AppDatabase,
): Promise<ScopeResolutionResult> {
  assertStaffSession(context);

  if (target.vehicleId) {
    const rows = await db
      .select({ id: vehicles.id, businessId: vehicles.businessId })
      .from(vehicles)
      .where(eq(vehicles.id, target.vehicleId))
      .limit(1);
    const vehicle = rows[0];
    if (!vehicle || (target.businessId && vehicle.businessId !== target.businessId)) {
      return {
        ok: false,
        status: 404,
        code: "TARGET_VEHICLE_NOT_FOUND",
        message: "Belirtilen araç bulunamadı.",
      };
    }
    return {
      ok: true,
      scope: buildStaffScope(context, { businessId: vehicle.businessId, vehicleId: vehicle.id }),
    };
  }

  if (target.businessId) {
    const rows = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.id, target.businessId))
      .limit(1);
    if (!rows[0]) {
      return {
        ok: false,
        status: 404,
        code: "TARGET_BUSINESS_NOT_FOUND",
        message: "Belirtilen işletme bulunamadı.",
      };
    }
    return {
      ok: true,
      scope: buildStaffScope(context, { businessId: target.businessId }),
    };
  }

  throw new InvalidSessionKindForScopeError(
    "resolveAdminScope: businessId veya vehicleId hedefinden en az biri " +
      "verilmelidir (çağıranın kendi path ayrıştırmasındaki bir " +
      "programlama hatasını gösterir).",
  );
}

// ---------------------------------------------------------------------------
// scopeKey — DECISIONS.md T1.4 notu: "GET /session istemciye sessionId/
// credentialId/platformUserId VERMEZ ... T1.5'te yanıta gizli olmayan opak
// `scopeKey` eklenir." `credentialId`/`platformUserId` GET /session
// yanıtında YOKTUR (düzeltme turu 1 — bkz. `../../app/api/v1/session/
// route.ts` üst notu); bu opak `scopeKey`, DECISIONS'ın kararlaştırdığı
// TEK client-state anahtarıdır — `../../lib/client-state.ts` bunu
// doğrudan kullanır.
// ---------------------------------------------------------------------------

/**
 * Görev tanımı (birebir): "sunucuda SHA-256(kind + ':' +
 * credentialId|platformUserId + ':' + vehicleId).slice(0,16)". `vehicleId`
 * yalnız araç oturumunda doludur; ekip oturumunda (henüz bir hedef
 * seçilmemişken, ör. GET /session anında) boş dizeyle YER TUTULUR — bu,
 * "istemciden gelen role/businessId gibi alanların kapsamı
 * GENİŞLETMEMESİ" ilkesiyle aynı doğrultuda, yalnız SUNUCUNUN zaten
 * bildiği (SessionContext) alanlardan türetilir; hiçbir DB erişimi
 * GEREKMEZ.
 *
 * AÇIK NOKTA (denetim bulgusu, düzeltme turu 2 — "open_issues" diye bir
 * dosya/bölüm YOKTUR, yalnız bu yorumda belgelenir): bu boş-dize yer
 * tutucu, AYNI ekip (platform) oturumunun sonraki isteklerde FARKLI bir
 * `X-Target-Vehicle` hedeflemesi durumunda GET /session'ın döndürdüğü
 * `scopeKey`'i DEĞİŞTİRMEZ — çünkü `SessionContext.vehicleId` yalnız
 * `kind === "vehicle"` iken doludur (bkz. `../usecases/session/types.ts`);
 * staff hedefi SESSION'DA değil, HER İSTEKTE header'dan çözülür
 * (`resolveStaffVehicleScopeFromHeader`, aşağıda). Bu, MUTASYON güvenliğini
 * ETKİLEMEZ: `../usecases/receipts/scope-key.ts` `computeReceiptScopeKey`
 * gerçek `Scope`ten (o istekte header'dan doğrulanmış `vehicleId` dahil)
 * türetilir, bu fonksiyondan (`computeScopeKey`) DEĞİL. Etkilediği TEK
 * yer, T3.4/T3.6'da `../../lib/client-state.ts`'in staff destek akışında
 * KULLANILDIĞI an: aynı destek oturumu iki farklı müşteri aracını PEŞ PEŞE
 * hedeflerse, bu iki hedefin `scopeKey`'i (GET /session'dan) AYNI kalır —
 * DECISIONS.md F6'nın "anahtar = kimlik + araç" tam bileşimi staff için
 * yalnız KULLANIM ANINDA (T3.4/T3.6'nın UI'ının o an bildiği hedef araçla,
 * `` `${scopeKey}:${targetVehicleId}` `` gibi bir birleştirmeyle) TAMAMLANIR;
 * bu birleştirmenin KENDİSİ ve "T1.6+/T3.x görev tanımına not düşülmesi"
 * docs/TASKS.md'ye YENİ bir madde eklemeyi gerektirir — bu görevin (T1.5,
 * düzeltme turu 2) docs/*.md'yi salt okunur tutma kuralı gereği burada
 * YAPILMAZ; ürün sahibi T3.4/T3.6'ya başlarken bu yorumu okuyup açık bir
 * DECISIONS.md kararına dönüştürebilir. STORIES.md S1.5'in yedi kabul
 * kriterinden HİÇBİRİ GET /session'ın scopeKey'ini hedefe göre DEĞİŞTİRMESİNİ
 * ZORUNLU KILMAZ (hepsi sunucu YETKİ denetimiyle ilgilidir, istemci
 * localStorage anahtarlamasıyla DEĞİL); bu yüzden bu ADIM'ın (T1.5)
 * kendisi EKSİK sayılmaz.
 */
export function computeScopeKey(context: SessionContext): string {
  const id =
    context.kind === "vehicle" ? context.credentialId : context.platformUserId;
  if (!id) {
    throw new InvalidSessionKindForScopeError(
      "computeScopeKey: credentialId (vehicle) veya platformUserId " +
        "(platform) eksik — resolveSession invaryantı ihlal edilmiş.",
    );
  }
  const vehiclePart = context.vehicleId ?? "";
  return crypto
    .createHash("sha256")
    .update(`${context.kind}:${id}:${vehiclePart}`)
    .digest("hex")
    .slice(0, 16);
}
