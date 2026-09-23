/**
 * GET/POST /api/v1/admin/businesses — T2.1.
 *
 * ARCHITECTURE §4 — "GET / POST / PATCH | /admin/businesses;
 * /admin/businesses/:id | İşletme yönetimi | Staff." Yalnız ekip
 * (support/admin) `business.manage` iznine sahiptir (bkz. `../../../../
 * ../server/auth/permissions.ts`); `target: "none"` kullanılır — bu
 * koleksiyon ucu HENÜZ VAR OLAN bir işletme/araç HEDEFİNE bağlı değildir
 * (POST'un kendisi YENİ bir işletme YARATIR, bkz. `../../../../../server/
 * usecases/admin-businesses/create-business.ts`'in üst notu).
 */
import { z } from "zod";
import { scopeSafeObject } from "../../../../../server/auth/scope";
import { withProtectedRoute } from "../../../../../server/http/handler";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../server/http/errors";
import {
  createBusinessWithOwner,
  listBusinessesPage,
} from "../../../../../server/usecases/admin-businesses";
import { fieldErrorsFromZodIssues, mapMutationErrorToResponse, parseJsonBody } from "./_http";
import { fieldErrorsFromZodIssues as listFieldErrors } from "../_http";
import {
  DEFAULT_LIST_LIMIT,
  LIST_QUERY_FIELD_MESSAGES,
  listQuerySchema,
  pickSearchParams,
} from "../_list-query";

// İşletme imleci (created_at, id) → iki bileşen.
const getBusinessesQuerySchema = listQuerySchema(2);

// scopeSafeObject: role/personId/businessId/ownerId gövdede ASLA kabul
// edilmez (bkz. `../../../../server/auth/scope.ts` üst notu) — bu uçta
// zaten hiçbiri kullanılmıyor.
const postBusinessBodySchema = scopeSafeObject({
  requestId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  owner: scopeSafeObject({
    fullName: z.string().trim().min(1).max(120),
  }),
});

export const GET = withProtectedRoute({ permission: "business.manage", target: "none" })(
  (ctx) => {
    const parsed = getBusinessesQuerySchema.safeParse(
      pickSearchParams(ctx.request, ["q", "active", "cursor", "limit"]),
    );
    if (!parsed.success) {
      return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz sorgu parametresi.", {
        fields: listFieldErrors(parsed.error, LIST_QUERY_FIELD_MESSAGES),
        requestId: ctx.requestId,
      });
    }
    const page = listBusinessesPage(ctx.db, {
      ...parsed.data,
      limit: parsed.data.limit ?? DEFAULT_LIST_LIMIT,
    });
    return jsonSuccessResponse(
      200,
      { businesses: page.items, nextCursor: page.nextCursor },
      { requestId: ctx.requestId },
    );
  },
);

export const POST = withProtectedRoute({
  permission: "business.manage",
  write: true,
  target: "none",
})((ctx) => {
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz JSON gövdesi.", {
      requestId: ctx.requestId,
    });
  }

  const parsed = postBusinessBodySchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error),
      requestId: ctx.requestId,
    });
  }

  let result;
  try {
    result = createBusinessWithOwner(ctx.db, ctx.context, {
      requestId: parsed.data.requestId,
      name: parsed.data.name,
      ownerFullName: parsed.data.owner.fullName,
    });
  } catch (error) {
    const mapped = mapMutationErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }

  return jsonSuccessResponse(result.status, { business: result.business }, {
    requestId: ctx.requestId,
  });
});
