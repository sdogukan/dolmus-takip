/**
 * Arama karşılaştırması için Türkçe duyarlı katlama.
 *
 * SQLite `LIKE`/`NOCASE` yalnız ASCII harfleri katlar (Ö/ö, Ş/ş, İ/i
 * eşleşmez); yerel ayara bağlı `toLowerCase()` de çalışma zamanına göre
 * değişir. Bu yüzden I/İ/ı önce yerel ayardan bağımsız `i`ye eşlenir
 * (aramada noktalı/noktasız i ayrımı yapılmaz), kalan harfler
 * `toLowerCase()` ile küçültülür.
 */
export function foldForSearch(text: string): string {
  return text.normalize("NFC").replace(/[İIı]/gu, "i").toLowerCase();
}
