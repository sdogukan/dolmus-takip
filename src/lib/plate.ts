/**
 * Plaka normalizasyonu ve biçim doğrulaması.
 *
 * Kaynak: ARCHITECTURE.md §1.1 — "Plaka boşluklardan arındırılıp büyük harfe
 * çevrilerek benzersiz tutulur." ve STORIES.md S1.2 kabul kriteri —
 * "35 abc 123" ile "35ABC123" aynı tanımlı araca karşılık gelir.
 *
 * Türkçe yerel ayarda küçük harf "i" büyütüldüğünde "İ" (noktalı büyük I)
 * olur ve küçük harf "ı" büyütüldüğünde "I" (noktasız büyük I) olur. Plaka
 * her zaman ASCII harflerle yazıldığından (Türk plakalarında Q/W/X hariç
 * Latin harfleri kullanılır) bu dönüşüm İngilizce/kök harf eşlemesiyle
 * yapılır; `String.prototype.toUpperCase()` çalışma zamanı yereline göre
 * "i" harfini yanlış büyütebileceğinden kullanılmaz.
 */

const TURKISH_UPPERCASE_MAP: Record<string, string> = {
  i: "I",
  ı: "I",
  İ: "I",
  I: "I",
};

/**
 * Bir karakteri, çalışma zamanı yerel ayarından bağımsız biçimde ASCII
 * büyük harfe çevirir. Yalnız Türkçe I/ı/İ/i belirsizliğini çözer; diğer
 * karakterler için `toUpperCase()` kullanılır.
 */
function toAsciiUpperChar(char: string): string {
  const mapped = TURKISH_UPPERCASE_MAP[char];
  if (mapped) return mapped;
  return char.toUpperCase();
}

/**
 * Plakayı karşılaştırma/saklama için normalize eder:
 * - Baştaki/sondaki ve aradaki bütün boşluklar (ve boşluk benzeri
 *   ayırıcılar) atılır.
 * - Harfler Türkçe yerel ayarından bağımsız biçimde ASCII büyük harfe
 *   çevrilir.
 *
 * Biçim doğrulaması yapmaz; yalnız normalize eder. Boş girdi boş dize
 * döner.
 */
export function normalizePlate(rawPlate: string): string {
  const withoutWhitespace = rawPlate.replace(/\s+/gu, "");
  let result = "";
  for (const char of withoutWhitespace) {
    result += toAsciiUpperChar(char);
  }
  return result;
}

/**
 * Türkiye plaka biçimi: 2 haneli il kodu (01-81) + 1-3 harf + 2-4 rakam.
 * Harf/rakam sayısı kombinasyonları TSE standardına göre değişir; burada
 * MVP kapsamında geniş ama il kodu sınırını (01-81) koruyan bir kural
 * kullanılır. Q, W, X gibi Latin alfabesinde olup Türkçe plakalarda
 * kullanılmayan harfler reddedilir.
 */
const PLATE_PATTERN = /^(0[1-9]|[1-7][0-9]|8[01])([A-PR-VYZ]{1,3})([0-9]{2,4})$/u;

export interface PlateValidationResult {
  valid: boolean;
  normalized: string;
  reason?: "empty" | "invalid_format";
}

/**
 * Ham plaka girdisini normalize eder ve biçim doğrulaması yapar.
 * Geçersiz veya eksik girdide `valid: false` ve anlaşılır bir `reason`
 * döner; hata mesajının kendisi bu modülde üretilmez (ekran/API katmanı
 * Türkçe metni STORIES/DESIGN'a göre kendi üretir).
 */
export function validatePlate(rawPlate: string): PlateValidationResult {
  const normalized = normalizePlate(rawPlate);

  if (normalized.length === 0) {
    return { valid: false, normalized, reason: "empty" };
  }

  if (!PLATE_PATTERN.test(normalized)) {
    return { valid: false, normalized, reason: "invalid_format" };
  }

  return { valid: true, normalized };
}
