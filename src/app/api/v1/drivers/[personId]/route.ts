/**
 * PATCH /api/v1/drivers/[personId] — T2.4. Kişi kimliği YALNIZ URL'de taşınır
 * (gövdede `personId` yasak — `scopeSafeObject`). Sahip yalnız oturum
 * aracına bağlı kişinin adını düzenler; `active` yalnız ekip içindir (sahip
 * için 403, `person.set_global_active`).
 */
import { z } from "zod";
import { hasPermission } from "../../../../../server/auth/permissions";
import { scopeSafeObject } from "../../../../../server/auth/scope";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../server/http/errors";
import { withProtectedRoute } from "../../../../../server/http/handler";
import { updatePerson } from "../../../../../server/usecases/drivers";
import {
  fieldErrorsFromZodIssues,
  fullNameSchema,
  invalidBodyResponse,
  mapDriverErrorToResponse,
  parseJsonBody,
  requestIdSchema,
} from "../_http";

const patchPersonBodySchema = scopeSafeObject({
  requestId: requestIdSchema,
  version: z.number().int().positive(),
  fullName: fullNameSchema.optional(),
  active: z.boolean().optional(),
}).refine((value) => value.fullName !== undefined || value.active !== undefined);

export const PATCH = withProtectedRoute({
  permission: "driver.manage",
  write: true,
  target: "vehicle",
})((ctx) => {
  const personId = ctx.params?.personId;
  if (!ctx.scope || !personId) {
    throw new Error("PATCH /drivers/[personId]: scope veya personId eksik (programlama hatası).");
  }
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) return invalidBodyResponse(ctx.requestId);

  const parsed = patchPersonBodySchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error),
      requestId: ctx.requestId,
    });
  }
  // Rota izni `driver.manage` (sahip de sahiptir); küresel aktiflik alan
  // düzeyinde ayrıca denetlenir.
  if (parsed.data.active !== undefined && !hasPermission(ctx.context.role, "person.set_global_active")) {
    return jsonErrorResponse(403, "FORBIDDEN", "Bu işlem için yetkin yok.", {
      requestId: ctx.requestId,
    });
  }

  let result;
  try {
    result = updatePerson(ctx.db, ctx.context, ctx.scope, {
      requestId: parsed.data.requestId,
      personId,
      version: parsed.data.version,
      fullName: parsed.data.fullName,
      active: parsed.data.active,
    });
  } catch (error) {
    const mapped = mapDriverErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }
  return jsonSuccessResponse(
    result.status,
    { driver: result.driver, ...(result.affectedVehicles ? { affectedVehicles: result.affectedVehicles } : {}) },
    { requestId: ctx.requestId },
  );
});
