/**
 * Araç yönetimi kullanım durumu hataları — T2.2.
 *
 * `../admin-businesses/errors.ts` ile AYNI desen (kendi durum kodunu/
 * kodunu taşıyan hata sınıfı; route handler bunu yakalayıp
 * `../../http/errors.ts` `jsonErrorResponse(...)` ile döner) — burada
 * KOPYALANMAZ, çünkü araç ve işletme hataları FARKLI kullanım durumu
 * sınıflarıdır (bir `instanceof BusinessValidationError` denetimi bir
 * `VehicleValidationError`'ı YAKALAMAZ); yalnız BİÇİM (status/code/
 * fields) aynıdır.
 */
import { COMMON_SCREEN_MESSAGES } from "../../../lib/messages";

/** F7 / T1.4 notu — kanonik 409 metni TEK
 * kaynaktan (`../../../lib/messages.ts`) alınır. */
export class VehicleVersionConflictError extends Error {
  readonly status = 409 as const;
  readonly code = "VERSION_CONFLICT" as const;

  constructor(message = COMMON_SCREEN_MESSAGES.concurrentEditConflict) {
    super(message);
    this.name = "VehicleVersionConflictError";
  }
}

/**
 * Alan bazlı iş kuralı doğrulama hatası — zod'un YAKALAYAMADIĞI (DB
 * durumuna veya iş kuralına bağlı) durumlar için: plaka biçimi/tekilliği,
 * hedef işletmenin bulunamaması/sahipsiz olması, sahip/şoför şifrelerinin
 * aynı olması, model yılı aralığı, "değişiklik yok" gibi. Gövde biçimi
 * API hata sözleşmesindeki gibidir: 422 VALIDATION_ERROR + fields.
 */
export class VehicleValidationError extends Error {
  readonly status = 422 as const;
  readonly code = "VALIDATION_ERROR" as const;
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>, message = "Geçersiz veri.") {
    super(message);
    this.name = "VehicleValidationError";
    this.fields = fields;
  }
}
