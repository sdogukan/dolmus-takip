/**
 * `POST /admin/businesses` ve `PATCH /admin/businesses/[businessId]`'in
 * PAYLAŞTIĞI HTTP-katmanı yardımcıları — T2.1. Bir `route.ts` DEĞİLDİR
 * (hiçbir HTTP metodu export ETMEZ), bu yüzden Next.js App Router bunu bir
 * uç olarak ELE ALMAZ (bkz. `../../../../_components` ile AYNI "_" önek
 * deseni).
 */
import type { z } from "zod";
import { jsonErrorResponse } from "../../../../../server/http/errors";
import { ScopeTargetInactiveError } from "../../../../../server/data/scoped";
import { RequestIdReusedError } from "../../../../../server/usecases/receipts/errors";
import { SessionError } from "../../../../../server/usecases/session/errors";
import {
  BusinessValidationError,
  BusinessVersionConflictError,
} from "../../../../../server/usecases/admin-businesses";

/**
 * `createBusinessWithOwner`/`updateBusiness`'in FIRLATABİLECEĞİ bilinen
 * hata sınıflarını ARCHITECTURE §4 zarfına çevirir. Bilinmeyen bir hata için
 * `undefined` döner — çağıran bunu YENİDEN fırlatır (programlama hatası,
 * genel 500).
 */
export function mapMutationErrorToResponse(error: unknown, requestId: string): Response | undefined {
  if (error instanceof SessionError) {
    return jsonErrorResponse(401, error.code, error.message, { requestId });
  }
  if (error instanceof ScopeTargetInactiveError) {
    return jsonErrorResponse(error.status, error.code, error.message, { requestId });
  }
  if (error instanceof RequestIdReusedError) {
    return jsonErrorResponse(error.status, error.code, error.message, { requestId });
  }
  if (error instanceof BusinessVersionConflictError) {
    return jsonErrorResponse(error.status, error.code, error.message, { requestId });
  }
  if (error instanceof BusinessValidationError) {
    return jsonErrorResponse(error.status, error.code, error.message, {
      fields: error.fields,
      requestId,
    });
  }
  return undefined;
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
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (fields[key] === undefined) {
      fields[key] = FIELD_MESSAGES[key] ?? "Geçersiz değer.";
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
