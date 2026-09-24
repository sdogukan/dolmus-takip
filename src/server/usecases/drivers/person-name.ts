/** Kişi adı normalizasyonu — baş/son boşluk kırpılır, iç boşluk tek boşluğa
 * indirilir; sınır 1..120 (POST /admin/businesses sahip `fullName` ile AYNI). */
export const FULL_NAME_MAX_LENGTH = 120;

export function normalizeFullName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function isValidFullName(normalized: string): boolean {
  return normalized.length >= 1 && normalized.length <= FULL_NAME_MAX_LENGTH;
}

/** KVKK anonim adı — YALNIZ kişi kimliğinden türetilir (eski addan asla):
 * "Anonim kişi " + kimliğin ilk 6 karakteri, büyük harf. */
export function anonymousFullName(personId: string): string {
  return `Anonim kişi ${personId.slice(0, 6).toUpperCase()}`;
}
