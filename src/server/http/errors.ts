/**
 * Ortak HTTP hata/yanıt yardımcısı — T1.4 ADIM 1/2, S1.4.
 *
 * Görev tanımı: "ARCHITECTURE §4 hata sözleşmesi: ... her yanıtta
 * request_id, gövde JSON, gizli veri (token/hash) hiçbir yanıt/log'da
 * yok. Ortak hata yanıtı yardımcısı src/server/http/errors.ts (422/401/
 * 403/404/409/429/503 için tek biçim)." ve ARCHITECTURE.md §4: "Hata
 * yanıtı alan hataları ve request_id içerir; SQL, hash veya yığın izi
 * müşteriye dönmez."
 *
 * Bu dosya HERHANGİ bir alana özgü (session/work-entry/...) hata sınıfı
 * BİLMEZ — yalnız durum kodu + kod + mesaj + (422 için) alan hatalarından
 * tutarlı bir JSON gövdesi üretir. Hangi alana özgü hatanın hangi HTTP
 * durumuna/koduna eşleneceğine ilgili route handler karar verir (bkz.
 * `src/app/api/v1/session/route.ts`).
 */
import crypto from "node:crypto";

/**
 * Görev tanımının verdiği durum kodu kümesi — ADIM 1/2: "422/401/403/404/
 * 409/429/503". ADIM 2/2 (T1.4 iş adımı 3, `../auth/guard.ts` `requireWrite`)
 * görev tanımı: "Content-Type: application/json zorunluluğu (415), gövde
 * boyutu sınırı (... 413)" — bu iki kod BURAYA EKLENDİ (genişletme, mevcut
 * yedi kod DEĞİŞMEDİ).
 */
export type HttpErrorStatus =
  | 401
  | 403
  | 404
  | 409
  | 413
  | 415
  | 422
  | 429
  | 503;

export interface HttpErrorBody {
  error: {
    code: string;
    message: string;
    /** Yalnız 422 (alan doğrulama hatası) yanıtlarında dolu. */
    fields?: Record<string, string>;
  };
  request_id: string;
}

/**
 * Her yanıt (başarı/hata) için bir istek izleme kimliği — OPS.md: "Loglar
 * zaman, request_id, ... taşır." Bu, ARCHITECTURE §3.4'teki MÜŞTERİ
 * ÜRETİMLİ mutasyon `request_id`'siyle (tekrar gönderim/idempotency
 * anahtarı) KARIŞTIRILMAMALIDIR; o ayrı bir kavramdır ve yalnız
 * mutasyon endpoint'lerinin gövdesinde taşınır. Buradaki, HER isteğe
 * (GET dahil) sunucunun kendi ürettiği bir izleme kimliğidir.
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * `Cache-Control: private, no-store` — denetim bulgusu (düzeltme turu 1,
 * "medium"): ARCHITECTURE.md §5 "Müşteriye özel API ve sayfa yanıtları
 * private/no-store olur; Caddy bunları ortak cache'e almaz." Bu, TEK
 * merkezi yardımcı olduğundan (`jsonErrorResponse`/`jsonSuccessResponse`
 * her ikisi de burayı çağırır), her API yanıtına (GET /session dahil —
 * oturuma özel kapsam/CSRF bilgisi taşır) otomatik uygulanır; paylaşılan
 * bir cihazda tarayıcı geri/ileri önbelleği veya araya girecek bir ara
 * katmanın bu yanıtı başka bir kullanıcıya servis etmesi engellenir.
 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}

export function jsonErrorResponse(
  status: HttpErrorStatus,
  code: string,
  message: string,
  options: { fields?: Record<string, string>; requestId?: string } = {},
): Response {
  const requestId = options.requestId ?? generateRequestId();
  const body: HttpErrorBody = {
    error: {
      code,
      message,
      ...(options.fields ? { fields: options.fields } : {}),
    },
    request_id: requestId,
  };
  return jsonResponse(status, body);
}

/**
 * Başarı yanıtları da "her yanıtta request_id" kuralına tabidir; bu
 * yardımcı `data`'yı `request_id` ile birlikte düz (nested wrapper
 * OLMADAN) döner — ARCHITECTURE hiçbir yerde başarı gövdesi için bir
 * sarmalayıcı anahtar (ör. "data") tanımlamaz.
 */
export function jsonSuccessResponse<T extends Record<string, unknown>>(
  status: number,
  data: T,
  options: { requestId?: string } = {},
): Response {
  const requestId = options.requestId ?? generateRequestId();
  return jsonResponse(status, { ...data, request_id: requestId });
}
