/**
 * GET/POST /api/v1/admin/users — S2.6, YALNIZ `platform_user.manage`
 * (admin). `target: "none"`: bir işletme/araç hedefi yoktur; makbuz kapsamı
 * `StaffActorScope`tur (bkz. `../businesses/route.ts`).
 *
 * Gövde alanı `platformRole`dür — `role` FORBIDDEN_CLIENT_SCOPE_FIELDS
 * içinde olduğundan bir şema bu adla TANIMLANAMAZ.
 */
import { z } from "zod";
import { scopeSafeObject } from "../../../../../server/auth/scope";
import { withProtectedRoute } from "../../../../../server/http/handler";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../server/http/errors";
import { createPlatformUser, listPlatformUsers } from "../../../../../server/usecases/admin-users";
import { fieldErrorsFromZodIssues, mapMutationErrorToResponse, parseJsonBody } from "./_http";

// username/fullName biçimi kullanım durumunda doğrulanır (kanonikleştirme
// sonrası); burada yalnız girdi UZUNLUĞU sınırlanır.
const postUserBodySchema = scopeSafeObject({
  requestId: z.string().trim().min(1).max(200),
  username: z.string().max(200),
  fullName: z.string().max(500),
  platformRole: z.enum(["admin", "support"]),
  // KASITLI olarak `.trim()` EDİLMEZ — platform girişi aynı ham değeri karşılaştırır.
  password: z.string().min(1).max(200),
});

export const GET = withProtectedRoute({ permission: "platform_user.manage", target: "none" })(
  (ctx) => jsonSuccessResponse(200, { users: listPlatformUsers(ctx.db) }, { requestId: ctx.requestId }),
);

export const POST = withProtectedRoute({
  permission: "platform_user.manage",
  write: true,
  target: "none",
})(async (ctx) => {
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz JSON gövdesi.", {
      requestId: ctx.requestId,
    });
  }
  const parsed = postUserBodySchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error),
      requestId: ctx.requestId,
    });
  }

  let result;
  try {
    result = await createPlatformUser(ctx.db, ctx.context, parsed.data);
  } catch (error) {
    const mapped = mapMutationErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }
  return jsonSuccessResponse(result.status, { user: result.user }, { requestId: ctx.requestId });
});
