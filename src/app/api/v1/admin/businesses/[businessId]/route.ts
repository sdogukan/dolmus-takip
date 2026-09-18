/**
 * GET/PATCH /api/v1/admin/businesses/[businessId] — T2.1.
 *
 * Dinamik segment klasör adı `[businessId]` OLMAK ZORUNDA — `../../../../
 * ../../server/http/handler.ts` `withProtectedRoute`'un `target: "business"`
 * dalı `routeParams.params.businessId` OKUR (bkz. o dosyanın üst notu);
 * `[id]` gibi başka bir ad 500'e düşer.
 */
import { z } from "zod";
import { scopeSafeObject, type StaffScope } from "../../../../../../server/auth/scope";
import { withProtectedRoute } from "../../../../../../server/http/handler";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../../server/http/errors";
import {
  getBusinessDetail,
  updateBusiness,
} from "../../../../../../server/usecases/admin-businesses";
import { fieldErrorsFromZodIssues, mapMutationErrorToResponse, parseJsonBody } from "../_http";

const ownerAssignmentSchema = scopeSafeObject({
  existingPersonRef: z.string().trim().uuid().optional(),
  newFullName: z.string().trim().min(1).max(120).optional(),
}).refine(
  (value) => (value.existingPersonRef ? 1 : 0) + (value.newFullName ? 1 : 0) === 1,
);

const ownerRenameSchema = scopeSafeObject({
  fullName: z.string().trim().min(1).max(120),
  ownerVersion: z.number().int().positive(),
});

const patchBusinessBodySchema = scopeSafeObject({
  requestId: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
  ownerAssignment: ownerAssignmentSchema.optional(),
  ownerRename: ownerRenameSchema.optional(),
}).refine(
  (value) =>
    value.name !== undefined ||
    value.active !== undefined ||
    value.ownerAssignment !== undefined ||
    value.ownerRename !== undefined,
);

export const GET = withProtectedRoute({ permission: "business.manage", target: "business" })(
  (ctx) => {
    // `target: "business"` yalnız staff (support/admin) için gerçek bir
    // `StaffScope` (businessId path'ten doğrulanmış) üretir — araç
    // oturumu bu izne ZATEN sahip DEĞİLDİR (bkz. `../../../../../server/
    // auth/permissions.ts`), bu yüzden `authorize()` handler'a hiç
    // ULAŞMADAN 403 verir.
    const scope = ctx.scope as StaffScope;
    const detail = getBusinessDetail(ctx.db, scope.businessId);
    return jsonSuccessResponse(200, { ...detail }, { requestId: ctx.requestId });
  },
);

export const PATCH = withProtectedRoute({
  permission: "business.manage",
  write: true,
  target: "business",
})((ctx) => {
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz JSON gövdesi.", {
      requestId: ctx.requestId,
    });
  }

  const parsed = patchBusinessBodySchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error),
      requestId: ctx.requestId,
    });
  }

  const scope = ctx.scope as StaffScope;
  let result;
  try {
    result = updateBusiness(ctx.db, ctx.context, scope, {
      requestId: parsed.data.requestId,
      version: parsed.data.version,
      name: parsed.data.name,
      active: parsed.data.active,
      ownerAssignment: parsed.data.ownerAssignment,
      ownerRename: parsed.data.ownerRename,
    });
  } catch (error) {
    const mapped = mapMutationErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }

  return jsonSuccessResponse(result.status, { ...result.detail }, { requestId: ctx.requestId });
});
