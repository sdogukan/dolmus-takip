/**
 * WCAG kontrast oranı hesabı — T1.6 ADIM 1/2, S1.6, görev tanımı:
 * "metin/zemin kontrastı ≥ 4.5:1 — token çiftleri için kontrast hesabını
 * src/lib/contrast.ts + birim testiyle kanıtla."
 *
 * DESIGN.md §3 "Renk paleti": "Normal yazıda en az 4,5:1 kontrast
 * hedeflenir ([WCAG kontrast açıklaması]
 * (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)).
 * Seçilen ana düğmenin beyaz yazısı yaklaşık 6,70:1; ana metin/beyaz
 * 17,85:1; durum metni/kendi açık zemini en az 5,91:1'dir. Bunlar renk
 * hesabıdır; çalışan ekran için erişilebilirlik doğrulamasının yerine
 * geçmez."
 *
 * Bu dosya DESIGN'ın verdiği bu sayıları KANITLAR (bkz. `./contrast.
 * test.ts`) — DB/ağ/React YOK, yalnız iki hex renk arasındaki WCAG bağıl
 * parlaklık (relative luminance) ve kontrast oranını hesaplayan saf bir
 * fonksiyon kümesidir. Renk token'larının KENDİSİ (`../app/globals.css`
 * `:root` değişkenleri, DESIGN.md §4'teki değerlerle BİREBİR) bu dosyaya
 * KOPYALANMAZ — burada yalnız o token'ları hesaba katan, herhangi iki hex
 * değeri kabul eden genel bir yardımcı bulunur; DESIGN §3'ün somut token
 * çiftleri `./contrast.test.ts`te globals.css'teki gerçek değerlerle
 * doğrudan sınanır (tek kaynak: `../app/globals.css`).
 */

type RgbChannels = readonly [number, number, number];

function hexToRgb(hex: string): RgbChannels {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Geçersiz hex renk (6 haneli #rrggbb bekleniyor): ${hex}`);
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * sRGB kanalını WCAG'ın doğrusal (linear) uzayına çevirir.
 * https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
 */
function channelToLinear(channel8Bit: number): number {
  const channel = channel8Bit / 255;
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/**
 * WCAG bağıl parlaklık (relative luminance) — 0 (siyah) ile 1 (beyaz)
 * arasında.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const [rLinear, gLinear, bLinear] = [r, g, b].map(channelToLinear) as unknown as RgbChannels;
  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * WCAG kontrast oranı — 1 (kontrastsız) ile 21 (siyah/beyaz) arasında.
 * Renk sırası SONUCU DEĞİŞTİRMEZ (formül daima açık/koyu ayrımını kendisi
 * yapar).
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexA);
  const luminanceB = relativeLuminance(hexB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** DESIGN §3 — "Normal yazıda en az 4,5:1 kontrast hedeflenir." */
export const MIN_NORMAL_TEXT_CONTRAST = 4.5;

/**
 * Verilen iki rengin normal metin için WCAG AA (4,5:1) eşiğini (veya
 * açıkça verilmiş farklı bir eşiği) karşılayıp karşılamadığını döner.
 */
export function meetsMinimumContrast(
  hexA: string,
  hexB: string,
  minimum: number = MIN_NORMAL_TEXT_CONTRAST,
): boolean {
  return contrastRatio(hexA, hexB) >= minimum;
}
