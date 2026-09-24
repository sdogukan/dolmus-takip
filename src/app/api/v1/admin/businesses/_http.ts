/**
 * `POST /admin/businesses` ve `PATCH /admin/businesses/[businessId]`'in
 * PAYLAŞTIĞI HTTP-katmanı yardımcıları — T2.1. Bir `route.ts` DEĞİLDİR
 * (hiçbir HTTP metodu export ETMEZ), bu yüzden Next.js App Router bunu bir
 * uç olarak ELE ALMAZ (bkz. `../../../../_components` ile AYNI "_" önek
 * deseni).
 *
 * T2.2 — alana özgü OLMAYAN kısımlar (JSON gövde ayrıştırma, oturum/
 * kapsam/makbuz/hash-kuyruğu/DB-kilidi hata zarfı) `../_http.ts`'e
 * ÇIKARILDI (`./vehicles/_http.ts` AYNI kısımları KOPYALAMADAN kullanır);
 * bu dosyada yalnız İŞLETME'YE ÖZGÜ hata sınıfları ve alan mesajları
 * kalır — durum kodu/kod/mesaj davranışı BİREBİR AYNI (bkz. `tests/
 * integration/admin-businesses-routes.test.ts`).
 */
import type { z } from "zod";
import { jsonErrorResponse } from "../../../../../server/http/errors";
import {
  BusinessValidationError,
  BusinessVersionConflictError,
} from "../../../../../server/usecases/admin-businesses";
import { PersonAnonymizedError } from "../../../../../server/usecases/drivers";
import {
  fieldErrorsFromZodIssues as fieldErrorsFromZodIssuesGeneric,
  mapKnownAdminMutationErrorToResponse,
  parseJsonBody,
} from "../_http";

export { parseJsonBody };

/**
 * `createBusinessWithOwner`/`updateBusiness`'in FIRLATABİLECEĞİ bilinen
 * hata sınıflarını ARCHITECTURE §4 zarfına çevirir. Bilinmeyen bir hata için
 * `undefined` döner — çağıran bunu YENİDEN fırlatır (programlama hatası,
 * genel 500).
 */
export function mapMutationErrorToResponse(error: unknown, requestId: string): Response | undefined {
  if (error instanceof BusinessVersionConflictError || error instanceof PersonAnonymizedError) {
    return jsonErrorResponse(error.status, error.code, error.message, { requestId });
  }
  if (error instanceof BusinessValidationError) {
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
  name: "İşletme adını gir.",
  version: "Sürüm bilgisi eksik veya geçersiz.",
  active: "Aktiflik değeri geçersiz.",
  "owner.fullName": "Sahip adını gir.",
  ownerAssignment: "Mevcut kişi veya yeni ad alanlarından tam birini gönder.",
  "ownerAssignment.existingPersonRef": "Mevcut kişi kimliği geçersiz.",
  "ownerAssignment.newFullName": "Yeni sahip adını gir.",
  "ownerRename.fullName": "Yeni adı gir.",
  "ownerRename.ownerVersion": "Sahip sürüm bilgisi eksik veya geçersiz.",
};

export function fieldErrorsFromZodIssues(error: z.ZodError): Record<string, string> {
  return fieldErrorsFromZodIssuesGeneric(error, FIELD_MESSAGES);
}
