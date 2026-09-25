/**
 * GET/POST /api/v1/drivers — T2.4.
 *
 * GET /drivers: şoför seçici veya yönetim listesi; POST /drivers: şoför
 * ekler. `target: "vehicle"` — şoför/sahip oturumu kendi
 * aracını, ekip `X-Target-Vehicle` ile hedef aracı çözer.
 *
 * GET yanıt BİÇİMİ istemci parametresiyle DEĞİL, `driver.manage` izniyle
 * belirlenir (şoför oturumu sorgu parametresiyle görünümünü GENİŞLETEMEZ —
 * parametreler YOK SAYILIR): izinsiz → yalnız seçilebilir şoförler; izinli →
 * yönetim listesi (pasifler + adaylar).
 */
import { z } from "zod";
import { hasPermission } from "../../../../server/auth/permissions";
import { scopeSafeObject } from "../../../../server/auth/scope";
import { jsonSuccessResponse, jsonErrorResponse } from "../../../../server/http/errors";
import { withProtectedRoute } from "../../../../server/http/handler";
import {
  createDriver,
  listSelectableDrivers,
  listVehicleDriversForManagement,
} from "../../../../server/usecases/drivers";
import {
  fieldErrorsFromZodIssues,
  fullNameSchema,
  invalidBodyResponse,
  mapDriverErrorToResponse,
  parseJsonBody,
  requestIdSchema,
} from "./_http";

const postDriverBodySchema = scopeSafeObject({
  requestId: requestIdSchema,
  fullName: fullNameSchema,
});

export const GET = withProtectedRoute({ permission: "driver.read_active", target: "vehicle" })(
  (ctx) => {
    if (!ctx.scope) {
      throw new Error("GET /drivers: scope eksik (programlama hatası).");
    }
    if (hasPermission(ctx.context.role, "driver.manage")) {
      const view = listVehicleDriversForManagement(ctx.db, ctx.scope);
      return jsonSuccessResponse(200, { ...view }, { requestId: ctx.requestId });
    }
    const drivers = listSelectableDrivers(ctx.db, ctx.scope);
    return jsonSuccessResponse(200, { drivers }, { requestId: ctx.requestId });
  },
);

export const POST = withProtectedRoute({
  permission: "driver.manage",
  write: true,
  target: "vehicle",
})((ctx) => {
  if (!ctx.scope) {
    throw new Error("POST /drivers: scope eksik (programlama hatası).");
  }
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) return invalidBodyResponse(ctx.requestId);

  const parsed = postDriverBodySchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error),
      requestId: ctx.requestId,
    });
  }

  let result;
  try {
    result = createDriver(ctx.db, ctx.context, ctx.scope, {
      requestId: parsed.data.requestId,
      fullName: parsed.data.fullName,
    });
  } catch (error) {
    const mapped = mapDriverErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }
  return jsonSuccessResponse(result.status, { driver: result.driver }, { requestId: ctx.requestId });
});
