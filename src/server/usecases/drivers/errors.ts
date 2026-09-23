/**
 * Şoför yönetimi kullanım durumu hataları — T2.4. `../admin-vehicles/errors.ts`
 * ile AYNI desen (status/code taşıyan sınıf; route `_http.ts` zarfa çevirir).
 */
import { COMMON_SCREEN_MESSAGES } from "../../../lib/messages";

/** Kişi bu işletmede yok / aracın şoför yönetimi kapsamında değil. 404 —
 * başka işletmenin kimliğini DOĞRULAMAMAK için 403 değil (risk notu). */
export class PersonNotFoundError extends Error {
  readonly status = 404 as const;
  readonly code = "PERSON_NOT_FOUND" as const;

  constructor(message = "Kişi bulunamadı.") {
    super(message);
    this.name = "PersonNotFoundError";
  }
}

export class DriverValidationError extends Error {
  readonly status = 422 as const;
  readonly code = "VALIDATION_ERROR" as const;
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>, message = "Geçersiz veri.") {
    super(message);
    this.name = "DriverValidationError";
    this.fields = fields;
  }
}

export class DriverVersionConflictError extends Error {
  readonly status = 409 as const;
  readonly code = "VERSION_CONFLICT" as const;

  constructor(message = COMMON_SCREEN_MESSAGES.concurrentEditConflict) {
    super(message);
    this.name = "DriverVersionConflictError";
  }
}
