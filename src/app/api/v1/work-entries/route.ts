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
import { z } from "zod";
import { scopeSafeObject } from "../../../../server/auth/scope";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../server/http/errors";
import { withProtectedRoute } from "../../../../server/http/handler";
import { createWorkEntry, listWorkEntriesForScope } from "../../../../server/usecases/work-entries";
import {
  fieldErrorsFromZodIssues,
  invalidBodyResponse,
  parseJsonBody,
  requestIdSchema,
} from "../drivers/_http";
import { mapKnownAdminMutationErrorToResponse, fieldErrorsFromZodIssues as listFieldErrors } from "../admin/_http";
import {
  cursorParamSchema,
  DEFAULT_LIST_LIMIT,
  LIST_QUERY_FIELD_MESSAGES,
  limitParamSchema,
  pickSearchParams,
} from "../admin/_list-query";
import { WORK_ENTRY_MESSAGES } from "../../../../lib/messages";
import { workEntryFailureResponse } from "./_http";

const requestEnvelopeSchema = scopeSafeObject({ requestId: requestIdSchema });

// Sorgu YALNIZ URL'den okunur. Şoför oturumunda `workerPersonId` seçilebilir bir
// kişi olmak ZORUNDADIR (K1); sahip/ekip için isteğe bağlı süzgeçtir.
const getWorkEntriesQuerySchema = z.object({
  workerPersonId: z.string().trim().min(1).max(64).optional(),
  cursor: cursorParamSchema(2).optional(),
  limit: limitParamSchema.optional(),
});

const LIST_FIELD_MESSAGES: Record<string, string> = {
  ...LIST_QUERY_FIELD_MESSAGES,
  workerPersonId: WORK_ENTRY_MESSAGES.personUnavailable,
};

export const GET = withProtectedRoute({
  permission: "work_entry.read",
  target: "vehicle",
})((ctx) => {
  if (!ctx.scope) {
    throw new Error("GET /work-entries: scope eksik (programlama hatası).");
  }
  const parsed = getWorkEntriesQuerySchema.safeParse(
    pickSearchParams(ctx.request, ["workerPersonId", "cursor", "limit"] as const),
  );
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: listFieldErrors(parsed.error, LIST_FIELD_MESSAGES),
      requestId: ctx.requestId,
    });
  }

  const page = listWorkEntriesForScope(ctx.db, ctx.scope, {
    ...parsed.data,
    limit: parsed.data.limit ?? DEFAULT_LIST_LIMIT,
  });
  if (!page.ok) {
    return workEntryFailureResponse(
      { ok: false, status: 422, code: "VALIDATION_ERROR", fields: page.fields },
      ctx.requestId,
    );
  }
  return jsonSuccessResponse(
    200,
    { workEntries: page.workEntries, nextCursor: page.nextCursor },
    { requestId: ctx.requestId },
  );
});

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
