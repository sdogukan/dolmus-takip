/**
 * withProtectedRoute — ortak korumalı route deseni, T1.5 ADIM 2/2, S1.5.
 *
 * Görev tanımı (birebir): "Gelecek tüm route handler'ların izleyeceği
 * deseni src/server/http/handler.ts içinde kur: withProtectedRoute({
 * permission, write?: boolean, target?: 'vehicle'|'business'|'none' })
 * (handler) → requireSession/requireWrite → scope çözümleme → authorize →
 * handler(ctx)." Bu dosya BİREBİR bu beş adımı, bu SIRAYLA uygular:
 *
 * 1. `write: true` ise `../auth/guard.ts` `requireWrite` (CSRF/origin/
 *    Content-Type/gövde boyutu + oturum), değilse yalnız `requireSession`.
 *    Bu adım BAŞARISIZSA (401/403/413/415/503) diğer adımlar HİÇ ÇALIŞMAZ.
 * 2. `target`e göre kapsam (`Scope`) çözülür (bkz. aşağıdaki "Kapsam
 *    çözümleme" bölümü). Bu adım kendi durum koduyla (403/404/422)
 *    başarısız olabilir — PERMISSION henüz denetlenmemişken bile: bir
 *    hedefin VAR OLUP OLMADIĞI/aktif olup olmadığı, aktörün o işlem için
 *    yetkisi olup olmamasından BAĞIMSIZ bir sorudur (`../auth/scope.ts`
 *    `resolveStaffVehicleScopeFromHeader`'ın ZATEN uyguladığı sıra —
 *    görev tanımının kendisi bu SIRAYI ["scope çözümleme" SONRA
 *    "authorize"] verir).
 * 3. `authorize(scope ?? role, permission)` — bir `Scope` ÇÖZÜLMÜŞSE (adım
 *    2, `target !== "none"`) `../auth/permissions.ts` `authorize(scope,
 *    permission)` GERÇEKTEN ÇAĞRILIR; `target: "none"` için (Scope YOK)
 *    `hasPermission(context.role, permission)` kullanılır — `authorize`'ın
 *    KENDİSİ bir `Scope` nesnesi ZORUNLU KILAR (bkz. `permissions.ts`
 *    imzası), `target: "none"` uçlarında (ör. `/admin/users`) böyle bir
 *    nesne hiç ÜRETİLMEZ (bkz. aşağıdaki "none" notu). DÜZELTME (denetim
 *    bulgusu, düzeltme turu 1 — "authorize() gerçekte hiç çağrılmıyor,
 *    withProtectedRoute aynı mantığı hasPermission ile AYRICA yeniden
 *    yazmış"): önceki sürüm bu adımda `authorize`'ı HİÇ import/çağır
 *    MIYORDU, doğrudan `hasPermission(actor, ...)` çağırıyordu — bugün
 *    `authorize` da içeriden `hasPermission(scope.actor, permission)`
 *    çağırdığından SONUÇ aynıydı, ama T3/T3.5'in `authorize(scope,
 *    permission, target)`'ın ÜÇÜNCÜ parametresine (K1'in "aynı araçta
 *    seçtiği kişi"/"yalnız çalışma günü" koşulları) ekleyeceği mantık, asıl
 *    istek hattı (bu dosya) o fonksiyonu hiç ÇAĞIRMADIĞI için ETKİSİZ
 *    kalacaktı — iki PARALEL, senkronize olmayan yetki kontrolü kod yolu
 *    doğardı. Artık `Scope` var olduğu HER durumda gerçek `authorize()`
 *    çağrılır; `authorize`'a eklenecek gelecekteki `target`-bazlı mantık bu
 *    yüzden `withProtectedRoute`'tan geçen HER `target: "vehicle"|
 *    "business"` ucunu otomatik kapsar. Başarısızsa 403.
 * 4. `handler(ctx)` çağrılır; `ctx.scope` yalnız `target !== "none"` iken
 *    dolu olur (bkz. `ProtectedRouteContext.scope` notu).
 *
 * ## Kapsam çözümleme (`target`)
 *
 * - **"none"**: Scope ÇÖZÜLMEZ (`ctx.scope` `undefined` kalır); yetki
 *   yalnız `context.role`'e (`Actor` ile AYNI dört değerli tip — bkz.
 *   `../usecases/session/types.ts` `SessionRole`) bakılarak denetlenir.
 *   `/admin/users` gibi HİÇBİR işletme/araca bağlı OLMAYAN uçlar içindir
 *   (bkz. `../auth/scope.ts` dosya sonu notu — bu tür uçlar zaten "bir
 *   Scope NESNESİNE ihtiyaç duymaz" der).
 * - **"vehicle"**: Araç oturumu (`context.kind === "vehicle"`) HER ZAMAN
 *   KENDİ kapsamını kullanır (`scopeFromVehicleSession`) — `X-Target-
 *   Vehicle` header'ı bu oturum türünden GELİRSE (görev tanımının
 *   VERMEDİĞİ, bu ADIM'ın EKLEDİĞİ bir savunma-derinliği kararı, bkz. bu
 *   paketin open_issues'ı) 403 `TARGET_HEADER_NOT_ALLOWED` ile AÇIKÇA
 *   REDDEDİLİR (SESSİZCE yok saymak yerine): yalnız ekip (staff)
 *   oturumları bu header'ı KULLANABİLİR; bir araç oturumundan gelen aynı
 *   header, "başka bir aracı hedeflemeye ÇALIŞMA" sinyalidir ve STORIES
 *   S1.5 AC1/AC2'nin ruhuna (ekrandaki/istemcideki bir alan asla kapsamı
 *   genişletmez) uygun biçimde açıkça işaretlenir. Ekip (staff) oturumu
 *   `resolveStaffVehicleScopeFromHeader`'ı kullanır (401/403/404/422
 *   üretebilir, bkz. o fonksiyonun kendi üst notu).
 * - **"business"**: Araç oturumu yine KENDİ (`scopeFromVehicleSession`)
 *   kapsamını kullanır (yalnız `business.manage` gibi izinler zaten
 *   staff'a özgü olduğundan bu, adım 3'te 403'e düşer — bkz. yukarısı).
 *   Ekip oturumu `../auth/scope.ts` `resolveAdminScope`'u, `routeParams`
 *   (Next.js dinamik route segmentleri — `{ params }`) İÇİNDEN OKUNAN
 *   `businessId`/`vehicleId` İLE çağırır. **AÇIK NOKTA (bu paketin
 *   open_issues'ı):** ARCHITECTURE §4'te bu `target`i kullanacak İLK
 *   gerçek uç (`/admin/businesses/:id`, T2.1) henüz YAZILMADI; bu dal bu
 *   ADIM'da yalnız BİRİM testiyle (sahte `routeParams`, gerçek
 *   `resolveAdminScope` + gerçek SQLite) kanıtlanır — "henüz varmış gibi
 *   sunulmaz" ilkesi gereği canlı bir route ile TEKRAR KANITLANMADAN
 *   T2.1'de KÖRÜ KÖRÜNE doğru sayılmamalıdır.
 *
 * Bu ADIM'ın CANLI, uçtan uca kanıtı `target: "vehicle"` + `write: false`
 * kombinasyonudur — `tests/integration/protected-route.test.ts`in sentetik
 * (gerçek üretim ucu İCAT ETMEYEN) `withProtectedRoute` handler'ı ve
 * `tests/integration/scope-authorization.test.ts`in `readAssignment`/
 * `writeAssignment` handler'ları (düzeltme turu 3 — bkz. `../auth/
 * permissions.ts` "KALDIRILDI" notu: önceki `GET /api/v1/vehicles/current`
 * ucu ARCHITECTURE §4'te karşılığı olmayan, onaysız bir yüzeydi).
 */
import type { Actor } from "../auth/scope";
import { authorize, hasPermission, type Permission } from "../auth/permissions";
import {
  requireSession,
  requireWrite,
  type RequireSessionResult,
  type RequireWriteResult,
} from "../auth/guard";
import {
  resolveAdminScope,
  resolveStaffVehicleScopeFromHeader,
  scopeFromVehicleSession,
  TARGET_VEHICLE_HEADER,
  type Scope,
  type ScopeMode,
} from "../auth/scope";
import type { AppDatabase } from "../data/db";
import { jsonErrorResponse } from "./errors";
import type { SessionContext } from "../usecases/session/types";

export type ProtectedRouteTarget = "vehicle" | "business" | "none";

export interface ProtectedRouteConfig {
  permission: Permission;
  /** Varsayılan `false` (GET/salt okuma). `true` ise `requireWrite`
   * (CSRF/origin/Content-Type/gövde boyutu) kullanılır. */
  write?: boolean;
  /** Varsayılan `"none"`. */
  target?: ProtectedRouteTarget;
}

export interface ProtectedRouteContext {
  request: Request;
  context: SessionContext;
  db: AppDatabase;
  /** Yalnız `target !== "none"` iken dolu — bkz. dosya üstü "Kapsam
   * çözümleme" notu. */
  scope?: Scope;
  requestId: string;
  /** Yalnız `write: true` iken dolu (bkz. `../auth/guard.ts`
   * `RequireWriteSuccess.bodyText` notu — gövde BURADA zaten tüketilmiştir,
   * handler `request.json()` ÇAĞIRAMAZ). */
  bodyText?: string;
  /**
   * Next.js dinamik route segmentleri (`routeParams.params`), OLDUĞU GİBİ
   * (`target: "business"`in `businessId`/`vehicleId` İÇİN ZATEN
   * DOĞRULAYIP `scope`'a KOYDUĞU değerlerin AYNISI DEĞİL — bkz. dosya
   * üstü notu). `target: "vehicle"`/`"none"` bu path segmentlerine hiç
   * bakmaz (kapsam KENDİ oturumundan/header'dan gelir); yine de bir
   * handler'ın kapsam DIŞI bir path parametresine (ör. gelecekteki
   * `/vehicles/:id/drivers/:personId`'nin `personId`'si — `Scope`'un
   * PARÇASI DEĞİLDİR) ihtiyacı OLABİLECEĞİNDEN, ham `routeParams`
   * BURADAN da erişilebilir bırakılır.
   */
  params?: Record<string, string>;
}

export type ProtectedRouteHandler = (
  ctx: ProtectedRouteContext,
) => Promise<Response> | Response;

/**
 * Next.js App Router dinamik route segmentleri — yalnız `target:
 * "business"` için kullanılır (bkz. dosya üstü "AÇIK NOKTA" notu).
 * `params` bir `Promise` OLMAK ZORUNDADIR: Next.js 15+ (bu projede 16.3.5,
 * K9) App Router Route Handler'ları dinamik segmentleri ARTIK BÖYLE verir
 * — kanıt: `npm run build`'ın ürettiği `.next/types/validator.ts`, statik
 * (segmentsiz) bir route için bile ikinci parametreyi `{ params:
 * Promise<{}> }` olarak BEKLER; düz `Record<string, string>` ile derleme
 * BAŞARISIZ olur (bu ADIM'da gerçek `next build` ile doğrulandı).
 */
export interface ProtectedRouteParams {
  params?: Promise<Record<string, string>>;
}

export type WrappedRouteHandler = (
  request: Request,
  routeParams?: ProtectedRouteParams,
) => Promise<Response>;

type ScopeOutcome =
  | { ok: true; scope: Scope | undefined }
  | { ok: false; response: Response };

async function resolveScope(
  config: ProtectedRouteConfig,
  request: Request,
  context: SessionContext,
  db: AppDatabase,
  requestId: string,
  resolvedParams: Record<string, string> | undefined,
): Promise<ScopeOutcome> {
  const target = config.target ?? "none";

  if (target === "none") {
    return { ok: true, scope: undefined };
  }

  if (target === "vehicle") {
    if (context.kind === "vehicle") {
      if (request.headers.get(TARGET_VEHICLE_HEADER) !== null) {
        return {
          ok: false,
          response: jsonErrorResponse(
            403,
            "TARGET_HEADER_NOT_ALLOWED",
            "Bu oturum türü hedef araç seçemez.",
            { requestId },
          ),
        };
      }
      return { ok: true, scope: scopeFromVehicleSession(context) };
    }

    const mode: ScopeMode = config.write ? "write" : "read";
    const result = await resolveStaffVehicleScopeFromHeader(context, request, db, mode);
    if (!result.ok) {
      return {
        ok: false,
        response: jsonErrorResponse(result.status, result.code, result.message, {
          requestId,
        }),
      };
    }
    return { ok: true, scope: result.scope };
  }

  // target === "business"
  if (context.kind === "vehicle") {
    return { ok: true, scope: scopeFromVehicleSession(context) };
  }

  const businessId = resolvedParams?.businessId;
  const vehicleId = resolvedParams?.vehicleId;
  if (!businessId && !vehicleId) {
    // Çağıranın (bir sonraki admin route handler'ının) programlama hatası
    // — routeParams'tan hiçbir hedef ÇIKARILAMADI. `resolveAdminScope`'un
    // KENDİ "hiçbir hedef verilmedi" hatasıyla AYNI sınıf (bkz. onun üst
    // notu); istemciye SIZMAZ, 500'e düşer (bu, bir İSTEK hatası değil bir
    // ROUTE TANIMI hatasıdır).
    throw new Error(
      "withProtectedRoute: target 'business' için routeParams.params." +
        "businessId veya .vehicleId gerekli.",
    );
  }
  const result = await resolveAdminScope(context, { businessId, vehicleId }, db);
  if (!result.ok) {
    return {
      ok: false,
      response: jsonErrorResponse(result.status, result.code, result.message, {
        requestId,
      }),
    };
  }
  return { ok: true, scope: result.scope };
}

function hasBodyText(
  result: RequireSessionResult | RequireWriteResult,
): result is RequireWriteResult & { ok: true } {
  return result.ok && "bodyText" in result;
}

export function withProtectedRoute(
  config: ProtectedRouteConfig,
): (handler: ProtectedRouteHandler) => WrappedRouteHandler {
  return function wrap(handler: ProtectedRouteHandler): WrappedRouteHandler {
    return async function routeHandler(
      request: Request,
      routeParams?: ProtectedRouteParams,
    ): Promise<Response> {
      const guard = config.write
        ? await requireWrite(request)
        : await requireSession(request);
      if (!guard.ok) {
        return guard.response;
      }
      const { context, db, requestId } = guard;

      const resolvedParams = routeParams?.params ? await routeParams.params : undefined;

      const scopeOutcome = await resolveScope(
        config,
        request,
        context,
        db,
        requestId,
        resolvedParams,
      );
      if (!scopeOutcome.ok) {
        return scopeOutcome.response;
      }

      // `SessionRole` (`../usecases/session/types.ts`) ve `Actor` (`../auth/
      // scope.ts`) AYNI dört değerli birleşim tipidir (bkz. handler.ts
      // dosya üstü notu) — dönüşüm GEREKMEZ.
      const actor: Actor = context.role;
      // Düzeltme turu 1 (bkz. dosya üstü adım 3 notu) — Scope varsa GERÇEK
      // `authorize(scope, permission)` çağrılır (T3/T3.5'in `target`
      // parametresini gelecekte BURADAN geçirebilmesi için); Scope yoksa
      // (`target: "none"`) `authorize` bir Scope nesnesi ZORUNLU kıldığından
      // `hasPermission(actor, ...)` kullanılır — davranış BUGÜN için
      // özdeştir (`authorize` içeriden `hasPermission(scope.actor, ...)`
      // çağırır), ama artık TEK, gerçek kod yolundan geçer.
      const authorized = scopeOutcome.scope
        ? authorize(scopeOutcome.scope, config.permission).ok
        : hasPermission(actor, config.permission);
      if (!authorized) {
        return jsonErrorResponse(
          403,
          "FORBIDDEN",
          "Bu işlem için yetkin yok.",
          { requestId },
        );
      }

      const ctx: ProtectedRouteContext = {
        request,
        context,
        db,
        scope: scopeOutcome.scope,
        requestId,
      };
      if (hasBodyText(guard)) {
        ctx.bodyText = guard.bodyText;
      }
      if (resolvedParams) {
        ctx.params = resolvedParams;
      }

      return handler(ctx);
    };
  };
}
