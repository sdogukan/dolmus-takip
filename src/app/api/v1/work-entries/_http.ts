/**
 * `/work-entries` uçlarının PAYLAŞTIĞI HTTP-katmanı yardımcıları — T3.5.
 * Alana özgü OLMAYAN hatalar (`../admin/_http.ts`) KOPYALANMAZ. Bir `route.ts`
 * DEĞİLDİR.
 */
import { jsonErrorResponse } from "../../../../server/http/errors";
import {
  WorkEntryConfirmedError,
  WorkEntryNotFoundError,
  WorkEntryVersionConflictError,
  type UpdateWorkEntryResult,
} from "../../../../server/usecases/work-entries";
import { mapKnownAdminMutationErrorToResponse } from "../admin/_http";

export function workEntryNotFoundResponse(requestId: string): Response {
  const error = new WorkEntryNotFoundError();
  return jsonErrorResponse(error.status, error.code, error.message, { requestId });
}

export function mapWorkEntryErrorToResponse(error: unknown, requestId: string): Response | undefined {
  if (
    error instanceof WorkEntryNotFoundError ||
    error instanceof WorkEntryVersionConflictError ||
    error instanceof WorkEntryConfirmedError
  ) {
    return jsonErrorResponse(error.status, error.code, error.message, { requestId });
  }
  return mapKnownAdminMutationErrorToResponse(error, requestId);
}

/** 403/422 sonuçlarının zarfı (`ok: true` çağıranın işidir). */
export function workEntryFailureResponse(
  result: Exclude<UpdateWorkEntryResult, { ok: true }>,
  requestId: string,
): Response {
  if (result.status === 403) {
    return jsonErrorResponse(403, result.code, "Bu işlem için yetkin yok.", { requestId });
  }
  return jsonErrorResponse(422, result.code, "Geçersiz veri.", { fields: result.fields, requestId });
}
