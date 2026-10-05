import { WORK_ENTRY_MESSAGES as TEXT } from "../../lib/messages";

/**
 * Teslim durumu → tasarım sistemi durum etiketi (`ds-badge`) sınıfı. Metin
 * DEĞİŞMEZ (sabit kelimeler `../../lib/messages.ts`te); yalnız görünüm:
 * bekleyen açık amber zemin + saat ikonu, doğrulanan dolu yeşil + onay
 * işareti, onay gerekmeyen gri + çizgi. Renk körlüğünde de açıklık ve
 * ikonla ayrışır. Esnek sütun içinde etiketin genişlemesin diye çağıran
 * gerekirse `self-start` ekler.
 */
export function deliveryBadgeClass(status: string): string {
  if (status === "pending") return "ds-badge ds-badge-pending";
  if (status === "confirmed") return "ds-badge ds-badge-confirmed";
  return "ds-badge ds-badge-neutral";
}

/** Yalnız durum METNİNİ taşıyan görünüm modelleri için (rapor kartları, teslim durumu). */
export function deliveryBadgeClassForLabel(label: string): string {
  if (label === TEXT.statusPending) return deliveryBadgeClass("pending");
  if (label === TEXT.deliveryConfirmed || label === TEXT.statusConfirmed) return deliveryBadgeClass("confirmed");
  return deliveryBadgeClass("not_required");
}
