/**
 * İşletme/sahip yönetimi kullanım durumu hataları — T2.1.
 *
 * `../receipts/errors.ts` `RequestIdReusedError`/`../../data/scoped.ts`
 * `ScopeTargetInactiveError` ile AYNI desen: kendi durum kodunu/kodunu
 * taşıyan hata sınıfı, route handler bunu yakalayıp `../../http/errors.ts`
 * `jsonErrorResponse(error.status, error.code, error.message, ...)` ile
 * döner.
 */
import { COMMON_SCREEN_MESSAGES } from "../../../lib/messages";

/**
 * F7 / T1.4 notu — kanonik 409 metni TEK
 * kaynaktan (`../../../lib/messages.ts`) alınır; burada AYRICA
 * YAZILMAZ.
 */
export class BusinessVersionConflictError extends Error {
  readonly status = 409 as const;
  readonly code = "VERSION_CONFLICT" as const;

  constructor(message = COMMON_SCREEN_MESSAGES.concurrentEditConflict) {
    super(message);
    this.name = "BusinessVersionConflictError";
  }
}

/**
 * Alan bazlı iş kuralı doğrulama hatası — zod'un YAKALAYAMADIĞI (DB
 * durumuna bağlı) kurallar için: sahip ataması yalnız sahipsiz işletmeye,
 * belirtilen mevcut kişinin gerçekten bu işletmeye ait olması, sahip adı
 * düzeltmesinin yalnız sahibi olan işletmede yapılabilmesi gibi. Gövde
 * biçimi API hata sözleşmesindeki gibidir: 422 VALIDATION_ERROR + fields
 * (alan anahtarları formdaki alanlarla eşleşir).
 */
export class BusinessValidationError extends Error {
  readonly status = 422 as const;
  readonly code = "VALIDATION_ERROR" as const;
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>, message = "Geçersiz veri.") {
    super(message);
    this.name = "BusinessValidationError";
    this.fields = fields;
  }
}
