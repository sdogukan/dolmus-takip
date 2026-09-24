/**
 * POST /api/v1/admin/businesses/[businessId]/people/[personId]/anonymize —
 * KVKK silme talebi, YALNIZ `person.anonymize` (platform yöneticisi). İşletme
 * ve kişi kimliği YALNIZ URL'den gelir; gövde tam olarak `{ requestId,
 * version }` — başka her anahtar (`personId`, `businessId`, `role` dahil) 422.
 */
import { z } from "zod";
import { scopeSafeObject, type StaffScope } from "../../../../../../../../../server/auth/scope";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../../../../../server/http/errors";
import { withProtectedRoute } from "../../../../../../../../../server/http/handler";
import { anonymizePerson } from "../../../../../../../../../server/usecases/drivers";
import {
  fieldErrorsFromZodIssues,
  invalidBodyResponse,
  mapDriverErrorToResponse,
  parseJsonBody,
  requestIdSchema,
} from "../../../../../../drivers/_http";

const anonymizePersonBodySchema = scopeSafeObject({
  requestId: requestIdSchema,
  version: z.number().int().positive(),
}).strict();

export const POST = withProtectedRoute({
  permission: "person.anonymize",
  write: true,
  target: "business",
})((ctx) => {
  const personId = ctx.params?.personId;
  if (!ctx.scope || !personId) {
    throw new Error("POST .../people/[personId]/anonymize: scope veya personId eksik (programlama hatası).");
  }
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) return invalidBodyResponse(ctx.requestId);

  const parsed = anonymizePersonBodySchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error),
      requestId: ctx.requestId,
    });
  }

  let result;
  try {
    result = anonymizePerson(ctx.db, ctx.context, ctx.scope as StaffScope, {
      requestId: parsed.data.requestId,
      personId,
      version: parsed.data.version,
    });
  } catch (error) {
    const mapped = mapDriverErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }
  return jsonSuccessResponse(result.status, { person: result.person }, { requestId: ctx.requestId });
});
