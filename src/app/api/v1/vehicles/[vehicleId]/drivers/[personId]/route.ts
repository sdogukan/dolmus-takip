/**
 * PUT /api/v1/vehicles/[vehicleId]/drivers/[personId] — T2.4. Kişiyi araca
 * bağlar / atamayı açar-kapatır (`setVehicleDriver`). `withProtectedRoute`
 * `target: "vehicle"` yolunda `params`'ı OKUMAZ; URL'deki `vehicleId` burada
 * `scope.vehicleId` ile AÇIKÇA karşılaştırılır — uyuşmazlık 404 (başka
 * aracın varlığı doğrulanmaz).
 */
import { z } from "zod";
import { scopeSafeObject } from "../../../../../../../server/auth/scope";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../../../server/http/errors";
import { withProtectedRoute } from "../../../../../../../server/http/handler";
import { setVehicleDriver } from "../../../../../../../server/usecases/drivers";
import {
  fieldErrorsFromZodIssues,
  invalidBodyResponse,
  mapDriverErrorToResponse,
  parseJsonBody,
  requestIdSchema,
} from "../../../../drivers/_http";

const putAssignmentBodySchema = scopeSafeObject({
  requestId: requestIdSchema,
  active: z.boolean(),
  // Var olan atama satırının sürümü; satır yokken (ilk bağlama) gönderilmez.
  version: z.number().int().positive().optional(),
});

export const PUT = withProtectedRoute({
  permission: "driver.manage",
  write: true,
  target: "vehicle",
})((ctx) => {
  const personId = ctx.params?.personId;
  const urlVehicleId = ctx.params?.vehicleId;
  if (!ctx.scope || !personId || !urlVehicleId) {
    throw new Error("PUT /vehicles/[vehicleId]/drivers/[personId]: scope/params eksik (programlama hatası).");
  }
  if (urlVehicleId !== ctx.scope.vehicleId) {
    return jsonErrorResponse(404, "TARGET_VEHICLE_NOT_FOUND", "Belirtilen araç bulunamadı.", {
      requestId: ctx.requestId,
    });
  }
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) return invalidBodyResponse(ctx.requestId);

  const parsed = putAssignmentBodySchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error),
      requestId: ctx.requestId,
    });
  }

  let result;
  try {
    result = setVehicleDriver(ctx.db, ctx.context, ctx.scope, {
      requestId: parsed.data.requestId,
      personId,
      active: parsed.data.active,
      version: parsed.data.version,
    });
  } catch (error) {
    const mapped = mapDriverErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }
  return jsonSuccessResponse(result.status, { driver: result.driver }, { requestId: ctx.requestId });
});
