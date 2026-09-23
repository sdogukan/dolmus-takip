/**
 * GET / PATCH /api/v1/work-entries/[id] — T3.5. Kayıt kimliği YALNIZ URL'de
 * taşınır (gövdede yok sayılır); kayıt oturum/hedef aracın kapsamından
 * okunur, başka araç/işletme kaydı ve şoför için görünmez (K1) kayıtlar
 * bilinmeyen kimlikle AYNI 404'ü alır. PATCH onaylı olmayan kaydı düzenler;
 * şoför oturumu yalnız bugünün şoför kaydını.
 */
import { z } from "zod";
import { scopeSafeObject } from "../../../../../server/auth/scope";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../server/http/errors";
import { withProtectedRoute } from "../../../../../server/http/handler";
import { readWorkEntryForScope, updateWorkEntry } from "../../../../../server/usecases/work-entries";
import {
  fieldErrorsFromZodIssues,
  invalidBodyResponse,
  parseJsonBody,
  requestIdSchema,
} from "../../drivers/_http";
import { mapWorkEntryErrorToResponse, workEntryFailureResponse, workEntryNotFoundResponse } from "../_http";

const patchEnvelopeSchema = scopeSafeObject({
  requestId: requestIdSchema,
  version: z.number().int().positive(),
});

export const GET = withProtectedRoute({
  permission: "work_entry.read",
  target: "vehicle",
})((ctx) => {
  const entryId = ctx.params?.id;
  if (!ctx.scope || !entryId) {
    throw new Error("GET /work-entries/[id]: scope veya id eksik (programlama hatası).");
  }
  const workEntry = readWorkEntryForScope(ctx.db, ctx.scope, entryId);
  if (!workEntry) return workEntryNotFoundResponse(ctx.requestId);
  return jsonSuccessResponse(200, { workEntry }, { requestId: ctx.requestId });
});

export const PATCH = withProtectedRoute({
  permission: "work_entry.edit_unconfirmed",
  write: true,
  target: "vehicle",
})((ctx) => {
  const entryId = ctx.params?.id;
  if (!ctx.scope || !entryId) {
    throw new Error("PATCH /work-entries/[id]: scope veya id eksik (programlama hatası).");
  }
  const parsedBody = parseJsonBody(ctx.bodyText ?? "");
  if (!parsedBody.ok) return invalidBodyResponse(ctx.requestId);

  const envelope = patchEnvelopeSchema.safeParse(parsedBody.value);
  if (!envelope.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(envelope.error),
      requestId: ctx.requestId,
    });
  }

  let result;
  try {
    result = updateWorkEntry(ctx.db, ctx.context, ctx.scope, {
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
