/**
 * POST /api/v1/admin/vehicles/[vehicleId]/reset-password — T2.3.
 *
 * Dinamik segment klasör adı `[vehicleId]` OLMAK ZORUNDA — `../../../../../../
 * ../server/http/handler.ts` `withProtectedRoute`'un `target: "business"` dalı
 * `routeParams.params.vehicleId` OKUR (bkz. o dosyanın üst notu); başka bir ad
 * 500'e düşer. `resolveAdminScope` bu ID'den gerçek `businessId`yi TÜRETİR.
 *
 * `permission: "vehicle.reset_password"` — PERMISSION_MATRIX'te yalnız
 * support/admin taşır; araç oturumu (`context.kind === "vehicle"`) buraya
 * `target: "business"` üzerinden KENDİ kapsamıyla girse bile `authorize()`
 * bu izni asla VERMEZ (bkz. `../../../../../../../server/auth/permissions.ts`)
 * — 403 FORBIDDEN.
 */
import { z } from "zod";
import { scopeSafeObject, type StaffScope } from "../../../../../../../server/auth/scope";
import { withProtectedRoute } from "../../../../../../../server/http/handler";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../../../server/http/errors";
import { resetVehiclePassword } from "../../../../../../../server/usecases/admin-vehicles";
import { fieldErrorsFromZodIssues, mapMutationErrorToResponse, parseJsonBody } from "../../_http";

// scopeSafeObject: rol seçici alan KASITLI olarak `role` DEĞİL `access`
// adını taşır — `role` FORBIDDEN_CLIENT_SCOPE_FIELDS içinde olduğundan bir
// şema bu alanla TANIMLANAMAZ (bkz. `../../../../../../../server/auth/
// scope.ts`).
const resetVehiclePasswordBodySchema = scopeSafeObject({
  requestId: z.string().trim().min(1).max(200),
  access: z.enum(["owner", "driver"]),
  // KASITLI olarak `.trim()` EDİLMEZ — araç girişi (`POST /auth/
  // vehicle-login`) aynı ham değeri karşılaştırır.
  newPassword: z.string().min(1).max(200),
});

export const POST = withProtectedRoute({
  permission: "vehicle.reset_password",
  write: true,
  target: "business",
})(async (ctx) => {
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz JSON gövdesi.", {
      requestId: ctx.requestId,
    });
  }

  const parsed = resetVehiclePasswordBodySchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error),
      requestId: ctx.requestId,
    });
  }

  const scope = ctx.scope as StaffScope;
  if (!scope.vehicleId) {
    throw new Error(
      "POST /admin/vehicles/[vehicleId]/reset-password: scope.vehicleId eksik (programlama hatası).",
    );
  }

  let result;
  try {
    result = await resetVehiclePassword(ctx.db, ctx.context, scope, {
      requestId: parsed.data.requestId,
      access: parsed.data.access,
      newPassword: parsed.data.newPassword,
    });
  } catch (error) {
    const mapped = mapMutationErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }

  return jsonSuccessResponse(result.status, { ...result.result }, { requestId: ctx.requestId });
});
