/**
 * Ekip hesabı yönetimi kullanım durumu hataları — S2.6.
 *
 * `../admin-vehicles/errors.ts` ile AYNI desen (kendi durum kodunu/kodunu
 * taşıyan hata sınıfı; route'un `_http.ts`'i bunu API hata zarfına çevirir).
 */
import { COMMON_SCREEN_MESSAGES } from "../../../lib/messages";

export class AdminUserVersionConflictError extends Error {
  readonly status = 409 as const;
  readonly code = "VERSION_CONFLICT" as const;

  constructor(message = COMMON_SCREEN_MESSAGES.concurrentEditConflict) {
    super(message);
    this.name = "AdminUserVersionConflictError";
  }
}

/** Alan bazlı iş kuralı hatası: kullanıcı adı biçimi/tekilliği, ad-soyad,
 * "değişiklik yok", son aktif yöneticinin kaybı. */
export class AdminUserValidationError extends Error {
  readonly status = 422 as const;
  readonly code = "VALIDATION_ERROR" as const;
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>, message = "Geçersiz veri.") {
    super(message);
    this.name = "AdminUserValidationError";
    this.fields = fields;
  }
}

/** İşlemi yapan aktör guard ile yazma transaction'ı ARASINDA yönetici
 * olmaktan çıktı (rol TOCTOU'su) — transaction geri alınır. */
export class AdminUserForbiddenError extends Error {
  readonly status = 403 as const;
  readonly code = "FORBIDDEN" as const;

  constructor(message = "Bu işlem için yetkin yok.") {
    super(message);
    this.name = "AdminUserForbiddenError";
  }
}

export class AdminUserNotFoundError extends Error {
  readonly status = 404 as const;
  readonly code = "NOT_FOUND" as const;

  constructor(message = "Ekip hesabı bulunamadı.") {
    super(message);
    this.name = "AdminUserNotFoundError";
  }
}
