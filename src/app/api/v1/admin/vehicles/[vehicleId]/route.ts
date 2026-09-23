/**
 * GET/PATCH /api/v1/admin/vehicles/[vehicleId] — T2.2.
 *
 * Dinamik segment klasör adı `[vehicleId]` OLMAK ZORUNDA — `../../../../
 * ../../server/http/handler.ts` `withProtectedRoute`'un `target: "business"`
 * dalı `routeParams.params.vehicleId` OKUR (bkz. o dosyanın üst notu);
 * `resolveAdminScope` bu ID'den gerçek `businessId`yi TÜRETİR — başka bir
 * ad 500'e düşer.
 *
 * Plaka/işletme/sahip bu uçta DÜZENLENEMEZ (T2.2 sözleşmesi) — yalnız
 * `brandModel`/`year`/`routeStop`/`note`/`active`.
 */
import { z } from "zod";
import { scopeSafeObject, type StaffScope } from "../../../../../../server/auth/scope";
import { withProtectedRoute } from "../../../../../../server/http/handler";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../../server/http/errors";
import { getVehicleDetail, updateVehicle } from "../../../../../../server/usecases/admin-vehicles";
import { fieldErrorsFromZodIssues, mapMutationErrorToResponse, parseJsonBody } from "../_http";

const patchVehicleBodySchema = scopeSafeObject({
  requestId: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
  // `null` — alanı temizle; dize — yeni değer; `undefined` — dokunma.
  brandModel: z.string().trim().max(120).nullable().optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  routeStop: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  active: z.boolean().optional(),
}).refine(
  (value) =>
    value.brandModel !== undefined ||
    value.year !== undefined ||
    value.routeStop !== undefined ||
    value.note !== undefined ||
    value.active !== undefined,
);

export const GET = withProtectedRoute({ permission: "vehicle.manage", target: "business" })(
  (ctx) => {
    // `target: "business"` yalnız staff için gerçek bir `StaffScope`
    // (vehicleId path'ten doğrulanmış, businessId ondan türetilmiş)
    // üretir — araç oturumu bu izne ZATEN sahip DEĞİLDİR (bkz. `../../
    // ../../../server/auth/permissions.ts`), `authorize()` handler'a hiç
    // ULAŞMADAN 403 verir.
    const scope = ctx.scope as StaffScope;
    if (!scope.vehicleId) {
      throw new Error(
        "GET /admin/vehicles/[vehicleId]: scope.vehicleId eksik (programlama hatası).",
      );
    }
    const detail = getVehicleDetail(ctx.db, scope.vehicleId);
    return jsonSuccessResponse(200, { ...detail }, { requestId: ctx.requestId });
  },
);

export const PATCH = withProtectedRoute({
  permission: "vehicle.manage",
  write: true,
  target: "business",
})((ctx) => {
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz JSON gövdesi.", {
      requestId: ctx.requestId,
    });
  }

  const parsed = patchVehicleBodySchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error),
      requestId: ctx.requestId,
    });
  }

  const scope = ctx.scope as StaffScope;
  let result;
  try {
    result = updateVehicle(ctx.db, ctx.context, scope, {
      requestId: parsed.data.requestId,
      version: parsed.data.version,
      brandModel: parsed.data.brandModel,
      year: parsed.data.year,
      routeStop: parsed.data.routeStop,
      note: parsed.data.note,
      active: parsed.data.active,
    });
  } catch (error) {
    const mapped = mapMutationErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }

  return jsonSuccessResponse(result.status, { ...result.detail }, { requestId: ctx.requestId });
});
