/**
 * `../app/yonetim/araclar/[id]/vehicle-detail-form.tsx`'in InfoSection/
 * ActiveSection'ı PAYLAŞIR — bir taslağın (localStorage'da hayatta kalan
 * alan içeriği) hâlâ sunucunun GEÇERLİ `version`'ına mı dayandığını, yoksa
 * ARADA başka bir sekme/ekip üyesinin kaydettiği DAHA YENİ bir sürüme mi
 * BAYATLADIĞINI saptar (review bulgusu C1 — kök neden: taslak, hangi
 * sürüme dayandığı BİLGİSİ OLMADAN saklanıyordu; PATCH'in TAZE `detail.
 * vehicle.version`'ı göndermesi bayat alan değerleriyle iyimser sürüm
 * denetimini ATLATIYORDU).
 *
 * `pending` (sonucu belirsiz — ağ koptu, sunucuya ULAŞIP ULAŞMADIĞI
 * bilinmiyor) taslağı ASLA bayat SAYMAZ: dondurulmuş gövde/sürüm "Tekrar
 * kontrol et" için AYNEN gerekir (risk notu — belirsiz sonuçta taslak
 * atılmaz).
 */
export interface StaleDraftInput {
  baseVersion: number;
  currentVersion: number;
  pending: boolean;
}

export function isDraftStale({ baseVersion, currentVersion, pending }: StaleDraftInput): boolean {
  return !pending && baseVersion !== currentVersion;
}
