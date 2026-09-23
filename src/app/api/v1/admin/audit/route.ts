/**
 * GET /api/v1/admin/audit — yönetim işlem geçmişi (salt okunur).
 *
 * Yalnız `audit.read` iznine sahip ekip (support/admin) erişir; araç
 * oturumları izne sahip olmadığından `withProtectedRoute` 403 verir. Hedef
 * işletme/araç path'te değil sorgu parametresindedir (`businessId`,
 * `vehicleId`), bu yüzden `target: "none"` kullanılır ve filtre hedefi
 * handler içinde `resolveAdminScope` ile sunucuda doğrulanır (bilinmeyen
 * işletme/araç veya başka işletmenin aracı → 404). Yalnız GET export edilir.
 */
import { z } from "zod";
import { resolveAdminScope } from "../../../../../server/auth/scope";
import { withProtectedRoute } from "../../../../../server/http/handler";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../server/http/errors";
import { listAdminAudit } from "../../../../../server/usecases/admin-audit";
import { fieldErrorsFromZodIssues } from "../_http";
import {
  cursorParamSchema,
  DEFAULT_LIST_LIMIT,
  limitParamSchema,
  LIST_QUERY_FIELD_MESSAGES,
  pickSearchParams,
} from "../_list-query";

const getAuditQuerySchema = z.object({
  businessId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  // Denetim imleci (occurred_at, id) → iki bileşen.
  cursor: cursorParamSchema(2).optional(),
  limit: limitParamSchema.optional(),
});

const FIELD_MESSAGES: Record<string, string> = {
  businessId: "İşletme kimliği geçerli bir UUID olmalıdır.",
  vehicleId: "Araç kimliği geçerli bir UUID olmalıdır.",
  cursor: LIST_QUERY_FIELD_MESSAGES.cursor!,
  limit: LIST_QUERY_FIELD_MESSAGES.limit!,
};

export const GET = withProtectedRoute({ permission: "audit.read", target: "none" })(
  async (ctx) => {
    const parsed = getAuditQuerySchema.safeParse(
      pickSearchParams(ctx.request, ["businessId", "vehicleId", "cursor", "limit"]),
    );
    if (!parsed.success) {
      return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz sorgu parametresi.", {
        fields: fieldErrorsFromZodIssues(parsed.error, FIELD_MESSAGES),
        requestId: ctx.requestId,
      });
    }
    const { businessId, vehicleId, cursor, limit } = parsed.data;

    let filter: { businessId?: string; vehicleId?: string } = {};
    if (businessId || vehicleId) {
      const resolved = await resolveAdminScope(ctx.context, { businessId, vehicleId }, ctx.db);
      if (!resolved.ok) {
        return jsonErrorResponse(resolved.status, resolved.code, resolved.message, {
          requestId: ctx.requestId,
        });
      }
      filter = { businessId: resolved.scope.businessId, vehicleId: resolved.scope.vehicleId };
    }

    const page = listAdminAudit(ctx.db, {
      ...filter,
      cursor,
      limit: limit ?? DEFAULT_LIST_LIMIT,
    });
    return jsonSuccessResponse(
      200,
      { entries: page.entries, nextCursor: page.nextCursor },
      { requestId: ctx.requestId },
    );
  },
);
