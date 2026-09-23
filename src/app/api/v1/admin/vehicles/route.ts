/**
 * GET/POST /api/v1/admin/vehicles — T2.2.
 *
 * ARCHITECTURE §4 — "GET / POST / PATCH | /admin/vehicles;
 * /admin/vehicles/:id | Araç yönetimi | Staff." Yalnız ekip (support/
 * admin) `vehicle.manage` iznine sahiptir; `target: "none"` kullanılır —
 * bu koleksiyon ucu HENÜZ VAR OLAN bir araç HEDEFİNE bağlı DEĞİLDİR (POST
 * YENİ bir araç YARATIR, hedef İŞLETME gövdedeki `businessRef` ile gelir
 * — `../businesses/route.ts`'in POST'unun "hedef henüz yok" deseniyle AYNI
 * gerekçe, bkz. `../../../../../server/usecases/admin-vehicles/
 * create-vehicle.ts` üst notu).
 */
import { z } from "zod";
import { scopeSafeObject } from "../../../../../server/auth/scope";
import { withProtectedRoute } from "../../../../../server/http/handler";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../server/http/errors";
import { createVehicle, listVehicles } from "../../../../../server/usecases/admin-vehicles";
import { fieldErrorsFromZodIssues, mapMutationErrorToResponse, parseJsonBody } from "./_http";

// scopeSafeObject: role/personId/businessId/ownerId gövdede ASLA kabul
// edilmez — hedef işletme `businessRef` adıyla taşınır (T2.1
// `existingPersonRef` ile AYNI konvansiyon).
const postVehicleBodySchema = scopeSafeObject({
  requestId: z.string().trim().min(1).max(200),
  businessRef: z.string().trim().uuid(),
  // Ham plaka — normalizasyon/biçim doğrulaması usecase içinde yapılır
  // (`../../../../../lib/plate.ts`), burada yalnız TİP/uzunluk sınırlanır.
  plate: z.string().min(1).max(20),
  brandModel: z.string().trim().min(1).max(120).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  routeStop: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().min(1).max(1000).optional(),
  // KASITLI olarak `.trim()` EDİLMEZ — araç girişi (`POST /auth/
  // vehicle-login`) aynı ham değeri karşılaştırır (risk notu).
  ownerPassword: z.string().min(1).max(200),
  driverPassword: z.string().min(1).max(200),
});

export const GET = withProtectedRoute({ permission: "vehicle.manage", target: "none" })(
  (ctx) => {
    const vehiclesList = listVehicles(ctx.db);
    return jsonSuccessResponse(200, { vehicles: vehiclesList }, { requestId: ctx.requestId });
  },
);

export const POST = withProtectedRoute({
  permission: "vehicle.manage",
  write: true,
  target: "none",
})(async (ctx) => {
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz JSON gövdesi.", {
      requestId: ctx.requestId,
    });
  }

  const parsed = postVehicleBodySchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error),
      requestId: ctx.requestId,
    });
  }

  let result;
  try {
    result = await createVehicle(ctx.db, ctx.context, {
      requestId: parsed.data.requestId,
      businessRef: parsed.data.businessRef,
      plate: parsed.data.plate,
      brandModel: parsed.data.brandModel,
      year: parsed.data.year,
      routeStop: parsed.data.routeStop,
      note: parsed.data.note,
      ownerPassword: parsed.data.ownerPassword,
      driverPassword: parsed.data.driverPassword,
    });
  } catch (error) {
    const mapped = mapMutationErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }

  return jsonSuccessResponse(result.status, { ...result.detail }, { requestId: ctx.requestId });
});
