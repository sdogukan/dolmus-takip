import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  meetsMinimumContrast,
  MIN_NORMAL_TEXT_CONTRAST,
  relativeLuminance,
} from "./contrast";

/**
 * Birim testleri — T1.6 ADIM 1/2, S1.6. Saf hesap dosyası; DB/ağ yok
 * (`vitest.config.mts` "unit" projesi).
 *
 * Renk değerleri `../app/globals.css` `:root` değişkenlerinden BİREBİR
 * alınır (tek kaynak — burada AYRI bir renk listesi İCAT EDİLMEZ); aşağıdaki
 * "tek kaynak" testi sabitlerin dosyadaki değerlerle aynı kaldığını sınar.
 * Palet: "Dolmuş Takip" tasarım sistemi (petrol mavisi, açık tema).
 */
const COLOR_PRIMARY = "#0f5168";
const COLOR_ON_PRIMARY = "#ffffff";
const COLOR_PRIMARY_SOFT = "#e0eef3";
const COLOR_PAGE = "#f3f6f7";
const COLOR_SURFACE = "#ffffff";
const COLOR_SURFACE_MUTED = "#e8eef0";
const COLOR_TEXT = "#0f2a33";
const COLOR_TEXT_SECONDARY = "#4b616a";
const COLOR_INPUT_BORDER = "#6e838c";
const COLOR_DIVIDER = "#d4dee2";
const COLOR_FOCUS = "#0f5168";
const COLOR_SUCCESS = "#14663f";
const COLOR_ON_SUCCESS = "#ffffff";
const COLOR_SUCCESS_SURFACE = "#e3f3ea";
const COLOR_WARNING = "#8a4a00";
const COLOR_WARNING_SURFACE = "#fcefd9";
const COLOR_ERROR = "#b3261e";
const COLOR_ERROR_SURFACE = "#fcebea";

/** Kontrol kenarı ve odak halkası gibi metin dışı öğeler için WCAG 1.4.11 eşiği. */
const MIN_NON_TEXT_CONTRAST = 3;

const GLOBALS_CSS = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

function cssColorToken(name: string): string {
  const match = GLOBALS_CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match?.[1]) {
    throw new Error(`globals.css içinde --${name} bulunamadı`);
  }
  return match[1].toLowerCase();
}

describe("palet tek kaynak", () => {
  it("testteki renk sabitleri globals.css :root token değerleriyle birebir aynı", () => {
    const expected: Record<string, string> = {
      "color-primary": COLOR_PRIMARY,
      "color-on-primary": COLOR_ON_PRIMARY,
      "color-primary-soft": COLOR_PRIMARY_SOFT,
      "color-page": COLOR_PAGE,
      "color-surface": COLOR_SURFACE,
      "color-surface-muted": COLOR_SURFACE_MUTED,
      "color-text": COLOR_TEXT,
      "color-text-secondary": COLOR_TEXT_SECONDARY,
      "color-input-border": COLOR_INPUT_BORDER,
      "color-divider": COLOR_DIVIDER,
      "color-focus": COLOR_FOCUS,
      "color-success": COLOR_SUCCESS,
      "color-on-success": COLOR_ON_SUCCESS,
      "color-success-surface": COLOR_SUCCESS_SURFACE,
      "color-warning": COLOR_WARNING,
      "color-warning-surface": COLOR_WARNING_SURFACE,
      "color-error": COLOR_ERROR,
      "color-error-surface": COLOR_ERROR_SURFACE,
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(cssColorToken(token), `--${token}`).toBe(value);
    }
  });
});

describe("relativeLuminance", () => {
  it("siyah 0, beyaz 1 döner", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("geçersiz hex için hata fırlatır (uydurma varsayılan YOK)", () => {
    expect(() => relativeLuminance("mavi")).toThrow();
    expect(() => relativeLuminance("#fff")).toThrow();
  });
});

describe("contrastRatio", () => {
  it("aynı renk için 1:1 döner", () => {
    expect(contrastRatio(COLOR_PRIMARY, COLOR_PRIMARY)).toBeCloseTo(1, 5);
  });

  it("siyah/beyaz için 21:1 döner", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("renk sırası sonucu değiştirmez", () => {
    expect(contrastRatio(COLOR_PRIMARY, COLOR_ON_PRIMARY)).toBeCloseTo(
      contrastRatio(COLOR_ON_PRIMARY, COLOR_PRIMARY),
      10,
    );
  });

  it("renk paleti — ana düğme (primary/on-primary) yaklaşık 8,76:1", () => {
    expect(contrastRatio(COLOR_PRIMARY, COLOR_ON_PRIMARY)).toBeCloseTo(8.76, 1);
  });

  it("renk paleti — ana metin/beyaz yaklaşık 15,01:1", () => {
    expect(contrastRatio(COLOR_TEXT, COLOR_SURFACE)).toBeCloseTo(15.01, 1);
  });

  it("renk paleti — ikincil metin/yüzey en az 4,5:1 (WCAG AA normal metin)", () => {
    expect(contrastRatio(COLOR_TEXT_SECONDARY, COLOR_SURFACE)).toBeGreaterThanOrEqual(
      MIN_NORMAL_TEXT_CONTRAST,
    );
  });

  it("renk paleti — durum metni/kendi açık zemini en az 5,6:1", () => {
    expect(contrastRatio(COLOR_SUCCESS, COLOR_SUCCESS_SURFACE)).toBeGreaterThanOrEqual(5.6);
    expect(contrastRatio(COLOR_WARNING, COLOR_WARNING_SURFACE)).toBeGreaterThanOrEqual(5.6);
    expect(contrastRatio(COLOR_ERROR, COLOR_ERROR_SURFACE)).toBeGreaterThanOrEqual(5.6);
  });
});

describe("meetsMinimumContrast", () => {
  it("giriş formunun kullandığı BÜTÜN metin/zemin token çiftleri WCAG AA (≥4,5:1) geçer", () => {
    // src/app/_components/login-form.tsx'in fiilen kullandığı çiftler:
    // başlık, alt başlık ve etiket (--color-text, --color-text-secondary)
    // → sayfa zemini (--color-page); alan metni → kart zemini
    // (--color-surface); hata bildirimi metni → kendi açık zemini; ana
    // düğme metni → ana düğme zemini; "Göster" (ikincil düğme) → kart zemini.
    expect(meetsMinimumContrast(COLOR_TEXT, COLOR_PAGE)).toBe(true);
    expect(meetsMinimumContrast(COLOR_TEXT_SECONDARY, COLOR_PAGE)).toBe(true);
    expect(meetsMinimumContrast(COLOR_TEXT, COLOR_SURFACE)).toBe(true);
    expect(meetsMinimumContrast(COLOR_TEXT, COLOR_ERROR_SURFACE)).toBe(true);
    expect(meetsMinimumContrast(COLOR_ERROR, COLOR_PAGE)).toBe(true);
    expect(meetsMinimumContrast(COLOR_ON_PRIMARY, COLOR_PRIMARY)).toBe(true);
    expect(meetsMinimumContrast(COLOR_PRIMARY, COLOR_SURFACE)).toBe(true);
  });

  it("tasarım sisteminin metin/zemin çiftlerinin TÜMÜ WCAG AA (≥4,5:1) geçer", () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      // Ana ve ikincil metin: sayfa, kart, sessiz yüzey (tutar özeti, pasif
      // buton), destek bandı / bilgi bildirimi ve durum bildirimi zeminleri.
      [COLOR_TEXT, COLOR_PAGE],
      [COLOR_TEXT, COLOR_SURFACE],
      [COLOR_TEXT, COLOR_SURFACE_MUTED],
      [COLOR_TEXT, COLOR_PRIMARY_SOFT],
      [COLOR_TEXT, COLOR_SUCCESS_SURFACE],
      [COLOR_TEXT, COLOR_WARNING_SURFACE],
      [COLOR_TEXT, COLOR_ERROR_SURFACE],
      [COLOR_TEXT_SECONDARY, COLOR_PAGE],
      [COLOR_TEXT_SECONDARY, COLOR_SURFACE],
      [COLOR_TEXT_SECONDARY, COLOR_SURFACE_MUTED],
      [COLOR_TEXT_SECONDARY, COLOR_PRIMARY_SOFT],
      // Bağlantı, ikincil buton ve seçili sekme / bölümlü seçim metni.
      [COLOR_PRIMARY, COLOR_PAGE],
      [COLOR_PRIMARY, COLOR_SURFACE],
      [COLOR_PRIMARY, COLOR_SURFACE_MUTED],
      [COLOR_PRIMARY, COLOR_PRIMARY_SOFT],
      // Dolu butonlar ve durum etiketleri.
      [COLOR_ON_PRIMARY, COLOR_PRIMARY],
      [COLOR_ON_PRIMARY, COLOR_ERROR],
      [COLOR_ON_SUCCESS, COLOR_SUCCESS],
      [COLOR_SUCCESS, COLOR_SUCCESS_SURFACE],
      [COLOR_WARNING, COLOR_WARNING_SURFACE],
      [COLOR_ERROR, COLOR_ERROR_SURFACE],
      // Alan hatası metni ve tehlikeli işlem butonu metni.
      [COLOR_ERROR, COLOR_SURFACE],
      [COLOR_ERROR, COLOR_PAGE],
    ];
    for (const [foreground, background] of pairs) {
      expect(meetsMinimumContrast(foreground, background), `${foreground} / ${background}`).toBe(true);
    }
  });

  it("kontrol kenarı ve odak halkası sayfa ve kart zemininde en az 3:1 (WCAG 1.4.11)", () => {
    for (const background of [COLOR_PAGE, COLOR_SURFACE]) {
      expect(meetsMinimumContrast(COLOR_INPUT_BORDER, background, MIN_NON_TEXT_CONTRAST)).toBe(true);
      expect(meetsMinimumContrast(COLOR_FOCUS, background, MIN_NON_TEXT_CONTRAST)).toBe(true);
    }
  });

  it("yetersiz kontrastlı bir çifti (ör. ayırıcı çizgi/beyaz) reddeder — kanıt sahte-pozitif DEĞİL", () => {
    // --color-divider yalnız süs çizgisidir; bu yüzden form kenarı olarak kullanılmaz.
    expect(meetsMinimumContrast(COLOR_DIVIDER, COLOR_SURFACE)).toBe(false);
    expect(meetsMinimumContrast(COLOR_DIVIDER, COLOR_SURFACE, MIN_NON_TEXT_CONTRAST)).toBe(false);
  });

  it("özel eşik parametresini kullanır", () => {
    expect(meetsMinimumContrast(COLOR_ERROR, COLOR_ERROR_SURFACE, 5.6)).toBe(true);
    expect(meetsMinimumContrast(COLOR_ERROR, COLOR_ERROR_SURFACE, 10)).toBe(false);
  });
});
