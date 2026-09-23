/**
 * `/admin/users` uçlarının PAYLAŞTIĞI HTTP-katmanı yardımcıları — S2.6.
 * `../vehicles/_http.ts` ile AYNI kalıp: alana özgü OLMAYAN hatalar
 * `../_http.ts`'ten KOPYALANMADAN kullanılır, burada yalnız ekip hesabı
 * hata sınıfları ve alan mesajları taşınır.
 */
import type { z } from "zod";
import { jsonErrorResponse } from "../../../../../server/http/errors";
import {
  AdminUserForbiddenError,
  AdminUserNotFoundError,
  AdminUserValidationError,
  AdminUserVersionConflictError,
} from "../../../../../server/usecases/admin-users";
import {
  fieldErrorsFromZodIssues as fieldErrorsFromZodIssuesGeneric,
  mapKnownAdminMutationErrorToResponse,
  parseJsonBody,
} from "../_http";

export { parseJsonBody };

export function mapMutationErrorToResponse(error: unknown, requestId: string): Response | undefined {
  if (error instanceof AdminUserValidationError) {
    return jsonErrorResponse(error.status, error.code, error.message, {
      fields: error.fields,
      requestId,
    });
  }
  if (
    error instanceof AdminUserVersionConflictError ||
    error instanceof AdminUserForbiddenError ||
    error instanceof AdminUserNotFoundError
  ) {
    return jsonErrorResponse(error.status, error.code, error.message, { requestId });
  }
  return mapKnownAdminMutationErrorToResponse(error, requestId);
}

const FIELD_MESSAGES: Record<string, string> = {
  requestId: "İstek kimliği eksik veya geçersiz.",
  username: "Kullanıcı adı geçersiz.",
  fullName: "Ad soyad geçersiz.",
  platformRole: "Yetki yalnız yönetici veya destek olabilir.",
  password: "Şifreyi gir.",
  newPassword: "Yeni şifreyi gir.",
  version: "Sürüm bilgisi geçersiz.",
  active: "Aktiflik değeri geçersiz.",
};

export function fieldErrorsFromZodIssues(error: z.ZodError): Record<string, string> {
  return fieldErrorsFromZodIssuesGeneric(error, FIELD_MESSAGES);
}
