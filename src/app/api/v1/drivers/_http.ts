/**
 * `/drivers` ve `/vehicles/:vehicleId/drivers/:personId` uçlarının PAYLAŞTIĞI
 * HTTP-katmanı yardımcıları — T2.4. Alana özgü OLMAYAN kısımlar
 * (`../admin/_http.ts`) KOPYALANMAZ; burada yalnız şoföre özgü hata sınıfları,
 * alan mesajları ve ortak gövde şemaları taşınır. Bir `route.ts` DEĞİLDİR.
 */
import { z } from "zod";
import { DRIVER_FIELD_MESSAGES } from "../../../../lib/messages";
import { jsonErrorResponse } from "../../../../server/http/errors";
import {
  DriverValidationError,
  DriverVersionConflictError,
  GlobalActiveForbiddenError,
  normalizeFullName,
  PersonAnonymizedError,
  PersonNotFoundError,
} from "../../../../server/usecases/drivers";
import {
  fieldErrorsFromZodIssues as fieldErrorsFromZodIssuesGeneric,
  mapKnownAdminMutationErrorToResponse,
  parseJsonBody,
} from "../admin/_http";

export { parseJsonBody };

export const requestIdSchema = z.string().trim().min(1).max(200);

/** Kırp + iç boşluğu tek boşluğa indir, sonra 1..120 (usecase ile AYNI kural). */
export const fullNameSchema = z
  .string()
  .max(500)
  .transform(normalizeFullName)
  .pipe(z.string().min(1).max(120));

export function mapDriverErrorToResponse(error: unknown, requestId: string): Response | undefined {
  if (
    error instanceof PersonNotFoundError ||
    error instanceof DriverVersionConflictError ||
    error instanceof GlobalActiveForbiddenError ||
    error instanceof PersonAnonymizedError
  ) {
    return jsonErrorResponse(error.status, error.code, error.message, { requestId });
  }
  if (error instanceof DriverValidationError) {
    return jsonErrorResponse(error.status, error.code, error.message, {
      fields: error.fields,
      requestId,
    });
  }
  return mapKnownAdminMutationErrorToResponse(error, requestId);
}

const FIELD_MESSAGES: Record<string, string> = {
  "": "Gönderilen değerler geçersiz.",
  requestId: DRIVER_FIELD_MESSAGES.requestId,
  fullName: DRIVER_FIELD_MESSAGES.fullName,
  version: DRIVER_FIELD_MESSAGES.version,
  active: DRIVER_FIELD_MESSAGES.active,
};

export function fieldErrorsFromZodIssues(error: z.ZodError): Record<string, string> {
  return fieldErrorsFromZodIssuesGeneric(error, FIELD_MESSAGES);
}

export function invalidBodyResponse(requestId: string): Response {
  return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz JSON gövdesi.", { requestId });
}
