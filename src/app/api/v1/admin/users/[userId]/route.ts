/**
 * GET/PATCH /api/v1/admin/users/[userId] — S2.6, YALNIZ `platform_user.manage`
 * (admin). `target: "none"` — `userId` bir işletme/araç kapsamı DEĞİL, ham
 * path parametresidir (`ctx.params`); bilinmeyen/UUID olmayan kimlik 404.
 */
import { z } from "zod";
import { scopeSafeObject } from "../../../../../../server/auth/scope";
import { withProtectedRoute } from "../../../../../../server/http/handler";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../../server/http/errors";
import {
  AdminUserNotFoundError,
  getPlatformUserDetail,
  updatePlatformUser,
} from "../../../../../../server/usecases/admin-users";
import { fieldErrorsFromZodIssues, mapMutationErrorToResponse, parseJsonBody } from "../_http";

// `version` KASITLI olarak zorunlu DEĞİL: eksik sürüm 422 değil 409'dur
// (kullanım durumu bayat sayar).
const patchUserBodySchema = scopeSafeObject({
  requestId: z.string().trim().min(1).max(200),
  version: z.number().int().positive().optional(),
  fullName: z.string().max(500).optional(),
  platformRole: z.enum(["admin", "support"]).optional(),
  active: z.boolean().optional(),
});

function readUserId(params: Record<string, string> | undefined): string {
  const userId = params?.userId;
  if (!userId) {
    throw new Error("/admin/users/[userId]: routeParams.userId eksik (programlama hatası).");
  }
  return userId;
}

export const GET = withProtectedRoute({ permission: "platform_user.manage", target: "none" })(
  (ctx) => {
    try {
      const user = getPlatformUserDetail(ctx.db, readUserId(ctx.params));
      return jsonSuccessResponse(200, { user }, { requestId: ctx.requestId });
    } catch (error) {
      if (error instanceof AdminUserNotFoundError) {
        return jsonErrorResponse(error.status, error.code, error.message, { requestId: ctx.requestId });
      }
      throw error;
    }
  },
);

export const PATCH = withProtectedRoute({
  permission: "platform_user.manage",
  write: true,
  target: "none",
})((ctx) => {
  const userId = readUserId(ctx.params);
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz JSON gövdesi.", {
      requestId: ctx.requestId,
    });
  }
  const parsed = patchUserBodySchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error),
      requestId: ctx.requestId,
    });
  }

  let result;
  try {
    result = updatePlatformUser(ctx.db, ctx.context, { userId, ...parsed.data });
  } catch (error) {
    const mapped = mapMutationErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }
  return jsonSuccessResponse(result.status, { user: result.user }, { requestId: ctx.requestId });
});
