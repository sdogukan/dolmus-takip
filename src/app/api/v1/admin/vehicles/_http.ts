/**
 * `POST /admin/vehicles` ve `PATCH /admin/vehicles/[vehicleId]`'in
 * PAYLAŞTIĞI HTTP-katmanı yardımcıları — T2.2. `../businesses/_http.ts`
 * (T2.1) İLE AYNI kalıp; alana özgü OLMAYAN kısımlar `../_http.ts`'ten
 * KOPYALANMADAN kullanılır (bkz. o dosyanın üst notu) — burada yalnız
 * ARACA ÖZGÜ hata sınıfları ve alan mesajları taşınır. `HashQueueFullError`
 * → 429 `HASH_QUEUE_FULL` eşlemesi `../_http.ts`
 * `mapKnownAdminMutationErrorToResponse` İÇİNDEDİR — burada AYRICA
 * YAZILMAZ (createVehicle Argon2 hashlemesi bu hatayı fırlatabilir, bkz.
 * `../../../../../server/usecases/admin-vehicles/create-vehicle.ts`).
 */
import type { z } from "zod";
import { jsonErrorResponse } from "../../../../../server/http/errors";
import {
  VehicleValidationError,
  VehicleVersionConflictError,
} from "../../../../../server/usecases/admin-vehicles";
import {
  fieldErrorsFromZodIssues as fieldErrorsFromZodIssuesGeneric,
  mapKnownAdminMutationErrorToResponse,
  parseJsonBody,
} from "../_http";

export { parseJsonBody };

/**
 * `createVehicle`/`updateVehicle`'ın FIRLATABİLECEĞİ bilinen hata
 * sınıflarını ARCHITECTURE §4 zarfına çevirir. Bilinmeyen bir hata için
 * `undefined` döner — çağıran bunu YENİDEN fırlatır (programlama hatası,
 * genel 500).
 */
export function mapMutationErrorToResponse(error: unknown, requestId: string): Response | undefined {
  if (error instanceof VehicleVersionConflictError) {
    return jsonErrorResponse(error.status, error.code, error.message, { requestId });
  }
  if (error instanceof VehicleValidationError) {
    return jsonErrorResponse(error.status, error.code, error.message, {
      fields: error.fields,
      requestId,
    });
  }
  return mapKnownAdminMutationErrorToResponse(error, requestId);
}

/** Bilinen alan yolları (dot-join) → Türkçe alan hata metni. Bilinmeyen bir
 * yol için genel "Geçersiz değer." kullanılır. */
const FIELD_MESSAGES: Record<string, string> = {
  "": "Gönderilen değerler mevcut kayıtla aynı; en az bir değişiklik gönder.",
  requestId: "İstek kimliği eksik veya geçersiz.",
  businessRef: "İşletme seçimi eksik veya geçersiz.",
  plate: "Geçerli bir plaka gir.",
  brandModel: "Marka/model bilgisi geçersiz.",
  year: "Model yılı geçersiz.",
  routeStop: "Hat/durak bilgisi geçersiz.",
  note: "Not geçersiz.",
  ownerPassword: "Sahip şifresini gir.",
  driverPassword: "Şoför şifresini gir.",
  version: "Sürüm bilgisi eksik veya geçersiz.",
  active: "Aktiflik değeri geçersiz.",
};

export function fieldErrorsFromZodIssues(error: z.ZodError): Record<string, string> {
  return fieldErrorsFromZodIssuesGeneric(error, FIELD_MESSAGES);
}
