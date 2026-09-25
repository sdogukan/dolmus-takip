/**
 * Makbuz (mutation_receipts) kullanım durumu hataları — T1.5 ADIM 2/2,
 * S1.5.
 *
 * Tekrar gönderim kuralı: aynı kapsam/anahtar/işlem/içerik eski sonuç
 * kimliğini döndürür; içerik farklıysa 409 verir. API endpoint listesinde
 * de sürüm/anahtar çatışması 409'dur. `RequestIdReusedError.status`/
 * `.code`, `../../data/scoped.ts` `ScopeTargetInactiveError`'ın AYNI
 * "kendi durum kodunu taşıyan hata sınıfı" desenini izler — çağıran route
 * handler (ileride T3.4) bunu YAKALAYIP `../../http/errors.ts`
 * `jsonErrorResponse(error.status, error.code, error.message, ...)` ile
 * dönebilir.
 */
export class RequestIdReusedError extends Error {
  readonly status = 409 as const;
  readonly code = "REQUEST_ID_REUSED" as const;

  constructor(
    message = "Bu istek kimliği farklı bir işlem için zaten kullanılmış.",
  ) {
    super(message);
    this.name = "RequestIdReusedError";
  }
}
