/**
 * POST /api/v1/work-entries — T3.4.
 *
 * ARCHITECTURE §4 — günlük çalışma kaydı oluşturma. `target: "vehicle"`:
 * şoför/sahip oturumu kendi aracını, ekip `X-Target-Vehicle` ile hedef aracı
 * çözer. Kayıt türüne göre asıl izin (`work_entry.create_owner`/`_driver`)
 * `prepareWorkEntryCreate` içinde denetlenir; rota izni tabandır (şoför izni,
 * her rolde vardır). Başarı 201 ancak commit'ten sonra döner; replay aynı
 * durum kodunu ve aynı kaydı döner.
 */
import { scopeSafeObject } from "../../../../server/auth/scope";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../server/http/errors";
import { withProtectedRoute } from "../../../../server/http/handler";
import { createWorkEntry } from "../../../../server/usecases/work-entries";
import {
  fieldErrorsFromZodIssues,
  invalidBodyResponse,
  parseJsonBody,
  requestIdSchema,
} from "../drivers/_http";
import { mapKnownAdminMutationErrorToResponse } from "../admin/_http";

const requestEnvelopeSchema = scopeSafeObject({ requestId: requestIdSchema });

export const POST = withProtectedRoute({
  permission: "work_entry.create_driver",
  write: true,
  target: "vehicle",
})((ctx) => {
  if (!ctx.scope) {
    throw new Error("POST /work-entries: scope eksik (programlama hatası).");
  }
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) return invalidBodyResponse(ctx.requestId);

  const envelope = requestEnvelopeSchema.safeParse(parsedBody.value);
  if (!envelope.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(envelope.error),
      requestId: ctx.requestId,
    });
  }

  let result;
  try {
    result = createWorkEntry(ctx.db, ctx.context, ctx.scope, {
      requestId: envelope.data.requestId,
      body: parsedBody.value,
    });
  } catch (error) {
    const mapped = mapKnownAdminMutationErrorToResponse(error, ctx.requestId);
    if (mapped) return mapped;
    throw error;
  }

  if (!result.ok) {
    if (result.status === 403) {
      return jsonErrorResponse(403, result.code, "Bu işlem için yetkin yok.", {
        requestId: ctx.requestId,
      });
    }
    return jsonErrorResponse(422, result.code, "Geçersiz veri.", {
      fields: result.fields,
      requestId: ctx.requestId,
    });
  }
  return jsonSuccessResponse(result.status, { workEntry: result.workEntry }, { requestId: ctx.requestId });
});
