/**
 * POST /api/v1/admin/users/[userId]/reset-password — S2.6, YALNIZ
 * `platform_user.manage` (admin). Yanıt yalnız `{ user: { id, username } }`.
 */
import { z } from "zod";
import { scopeSafeObject } from "../../../../../../../server/auth/scope";
import { withProtectedRoute } from "../../../../../../../server/http/handler";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../../../server/http/errors";
import { resetPlatformUserPassword } from "../../../../../../../server/usecases/admin-users";
import { fieldErrorsFromZodIssues, mapMutationErrorToResponse, parseJsonBody } from "../../_http";

const resetUserPasswordBodySchema = scopeSafeObject({
  requestId: z.string().trim().min(1).max(200),
  // KASITLI olarak `.trim()` EDİLMEZ — platform girişi aynı ham değeri karşılaştırır.
  newPassword: z.string().min(1).max(200),
});

export const POST = withProtectedRoute({
  permission: "platform_user.manage",
  write: true,
  target: "none",
})(async (ctx) => {
  const userId = ctx.params?.userId;
  if (!userId) {
    throw new Error("/admin/users/[userId]/reset-password: routeParams.userId eksik (programlama hatası).");
  }
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz JSON gövdesi.", {
      requestId: ctx.requestId,
    });
  }
  const parsed = resetUserPasswordBodySchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error),
      requestId: ctx.requestId,
    });
  }

  let result;
  try {
    result = await resetPlatformUserPassword(ctx.db, ctx.context, {
      requestId: parsed.data.requestId,
      userId,
      newPassword: parsed.data.newPassword,
    });
  } catch (error) {
    const mapped = mapMutationErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }
  return jsonSuccessResponse(result.status, { user: result.user }, { requestId: ctx.requestId });
});
