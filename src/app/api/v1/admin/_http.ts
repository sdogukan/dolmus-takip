/**
 * `/admin/*` uçlarının PAYLAŞTIĞI HTTP-katmanı yardımcıları — T2.2.
 *
 * `./businesses/_http.ts` (T2.1) bu türden yardımcıları İLK yazandı;
 * `./vehicles/_http.ts` (T2.2) AYNI kalıbı gerektirdiğinde, alan-özgü
 * OLMAYAN kısımlar (JSON gövde ayrıştırma, oturum/kapsam/makbuz/hash-
 * kuyruğu/DB-kilidi hata sınıflarının HTTP zarfına çevrimi) BURAYA
 * ÇIKARILDI — iki dosya BİRBİRİNDEN KOPYALAMAZ (görev tanımı: "reusing
 * (not copying) the businesses _http.ts helpers"). `businesses/_http.ts`
 * da bu modülü kullanacak şekilde YENİDEN YAZILDI; davranışı (durum kodu/
 * kod/mesaj) BİREBİR AYNI kalır — `tests/integration/admin-businesses-
 * routes.test.ts` bunu doğrular.
 *
 * Bir `route.ts` DEĞİLDİR (hiçbir HTTP metodu export ETMEZ) — Next.js App
 * Router bunu bir uç olarak ELE ALMAZ (`_` önek deseni, bkz. `../../../
 * _components` ile AYNI).
 */
import type { z } from "zod";
import { extractTransientSqliteLockError } from "../../../../server/data/db";
import { jsonErrorResponse } from "../../../../server/http/errors";
import { ScopeTargetInactiveError } from "../../../../server/data/scoped";
import { HashQueueFullError } from "../../../../server/auth/hash-queue";
import { logThrottled } from "../../../../server/auth/throttle-log";
import { RequestIdReusedError } from "../../../../server/usecases/receipts/errors";
import { SessionError } from "../../../../server/usecases/session/errors";

/**
 * Her `/admin/*` mutasyon kullanım durumunun FIRLATABİLECEĞİ, ALANA ÖZGÜ
 * OLMAYAN hata sınıflarını API hata zarfına çevirir. Bilinmeyen bir
 * hata (alana özgü sınıflar DAHİL — ör. `BusinessValidationError`/
 * `VehicleValidationError`) için `undefined` döner; çağıranın KENDİ
 * `_http.ts`'i KENDİ alana özgü sınıflarını BUNDAN ÖNCE denetleyip, yoksa
 * bu fonksiyona DEVREDER.
 */
export function mapKnownAdminMutationErrorToResponse(
  error: unknown,
  requestId: string,
): Response | undefined {
  if (error instanceof SessionError) {
    return jsonErrorResponse(401, error.code, error.message, { requestId });
  }
  if (error instanceof ScopeTargetInactiveError) {
    return jsonErrorResponse(error.status, error.code, error.message, { requestId });
  }
  if (error instanceof RequestIdReusedError) {
    return jsonErrorResponse(error.status, error.code, error.message, { requestId });
  }
  if (error instanceof HashQueueFullError) {
    logThrottled("admin", "HASH_QUEUE_FULL", requestId);
    return jsonErrorResponse(429, "HASH_QUEUE_FULL", error.message, { requestId });
  }
  const lockError = extractTransientSqliteLockError(error);
  if (lockError) {
    // Ayrıntı (SQL/hata mesajı) istemciye DÖNMEZ — yalnız sunucu logu
    // (bkz. `../../../../server/data/db.ts` `extractTransientSqliteLockError`
    // üst notu). Transaction geri alındığı için makbuz yazılmamıştır; aynı
    // requestId ile tekrar deneme geçerlidir.
    console.error(`[admin] veritabanı kilitli (request_id=${requestId}): ${lockError.message}`);
    return jsonErrorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      "Sunucu şu anda hazır değil. Az sonra tekrar deneyin.",
      { requestId },
    );
  }
  return undefined;
}

/** `zod`'un ürettiği alan hatalarını, ÇAĞIRANIN KENDİ alan→Türkçe metin
 * eşlemesiyle (`fieldMessages`) HTTP `fields` gövdesine çevirir. Bilinmeyen
 * bir yol için genel "Geçersiz değer." kullanılır. */
export function fieldErrorsFromZodIssues(
  error: z.ZodError,
  fieldMessages: Record<string, string>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (fields[key] === undefined) {
      fields[key] = fieldMessages[key] ?? "Geçersiz değer.";
    }
  }
  if (Object.keys(fields).length === 0) {
    fields[""] = "Geçersiz gövde.";
  }
  return fields;
}

export function parseJsonBody(bodyText: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: bodyText.length > 0 ? JSON.parse(bodyText) : {} };
  } catch {
    return { ok: false };
  }
}
