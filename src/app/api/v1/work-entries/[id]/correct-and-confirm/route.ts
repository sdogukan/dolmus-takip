/**
 * POST /api/v1/work-entries/[id]/correct-and-confirm — T4.3 onaylı kaydı tek
 * işlemde düzelt ve yeniden onayla. Kayıt kimliği YALNIZ URL'de taşınır; yetki
 * oturum kapsamından (`work_entry.correct_confirmed`) gelir, şoför oturumu 403
 * alır. Gövde: günlük alanların tamamı + `receivedCents` (AÇIKÇA).
 */
import { z } from "zod";
import { scopeSafeObject } from "../../../../../../server/auth/scope";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../../server/http/errors";
import { withProtectedRoute } from "../../../../../../server/http/handler";
import { correctAndConfirmWorkEntry } from "../../../../../../server/usecases/work-entries";
import {
  fieldErrorsFromZodIssues,
  invalidBodyResponse,
  parseJsonBody,
  requestIdSchema,
} from "../../../drivers/_http";
import { mapWorkEntryErrorToResponse, workEntryFailureResponse } from "../../_http";

const correctAndConfirmEnvelopeSchema = scopeSafeObject({
  requestId: requestIdSchema,
  version: z.number().int().positive(),
});

export const POST = withProtectedRoute({
  permission: "work_entry.correct_confirmed",
  write: true,
  target: "vehicle",
})((ctx) => {
  const entryId = ctx.params?.id;
  if (!ctx.scope || !entryId) {
    throw new Error("POST /work-entries/[id]/correct-and-confirm: scope veya id eksik (programlama hatası).");
  }
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) return invalidBodyResponse(ctx.requestId);

  const envelope = correctAndConfirmEnvelopeSchema.safeParse(parsedBody.value);
  if (!envelope.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(envelope.error),
      requestId: ctx.requestId,
    });
  }

  let result;
  try {
    result = correctAndConfirmWorkEntry(ctx.db, ctx.context, ctx.scope, {
      requestId: envelope.data.requestId,
      entryId,
      version: envelope.data.version,
      body: parsedBody.value,
    });
  } catch (error) {
    const mapped = mapWorkEntryErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }

  if (!result.ok) return workEntryFailureResponse(result, ctx.requestId);
  return jsonSuccessResponse(result.status, { workEntry: result.workEntry }, { requestId: ctx.requestId });
});
