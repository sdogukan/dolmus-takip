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
 * alınır (tek kaynak — burada AYRI bir renk listesi İCAT EDİLMEZ); bu
 * değerler DESIGN.md §4 "Framework Config"teki token'larla ve §3 "Renk
 * paleti" tablosuyla birebir aynıdır.
 */
const COLOR_PRIMARY = "#1d4ed8";
const COLOR_ON_PRIMARY = "#ffffff";
const COLOR_TEXT = "#0f172a";
const COLOR_TEXT_SECONDARY = "#475569";
const COLOR_SURFACE = "#ffffff";
const COLOR_SUCCESS = "#166534";
const COLOR_SUCCESS_SURFACE = "#f0fdf4";
const COLOR_WARNING = "#92400e";
const COLOR_WARNING_SURFACE = "#fffbeb";
const COLOR_ERROR = "#b91c1c";
const COLOR_ERROR_SURFACE = "#fef2f2";

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
    expect(contrastRatio("#1d4ed8", "#1d4ed8")).toBeCloseTo(1, 5);
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

  it("DESIGN §3 — ana düğme (primary/on-primary) yaklaşık 6,70:1", () => {
    expect(contrastRatio(COLOR_PRIMARY, COLOR_ON_PRIMARY)).toBeCloseTo(6.7, 1);
  });

  it("DESIGN §3 — ana metin/beyaz yaklaşık 17,85:1", () => {
    expect(contrastRatio(COLOR_TEXT, COLOR_SURFACE)).toBeCloseTo(17.85, 1);
  });

  it("DESIGN §3 — ikincil metin/yüzey en az 4,5:1 (WCAG AA normal metin)", () => {
    expect(contrastRatio(COLOR_TEXT_SECONDARY, COLOR_SURFACE)).toBeGreaterThanOrEqual(
      MIN_NORMAL_TEXT_CONTRAST,
    );
  });

  it("DESIGN §3 — durum metni/kendi açık zemini en az 5,91:1", () => {
    expect(contrastRatio(COLOR_SUCCESS, COLOR_SUCCESS_SURFACE)).toBeGreaterThanOrEqual(5.91);
    expect(contrastRatio(COLOR_WARNING, COLOR_WARNING_SURFACE)).toBeGreaterThanOrEqual(5.91);
    expect(contrastRatio(COLOR_ERROR, COLOR_ERROR_SURFACE)).toBeGreaterThanOrEqual(5.91);
  });
});

describe("meetsMinimumContrast", () => {
  it("giriş formunun kullandığı BÜTÜN metin/zemin token çiftleri WCAG AA (≥4,5:1) geçer", () => {
    // src/app/_components/login-form.tsx'in fiilen kullandığı çiftler:
    // başlık/alt başlık/etiket/giriş metni (--color-text, --color-text-
    // secondary) → sayfa/kart zemini (--color-page, --color-surface); hata
    // metni → kendi açık zemini; ana düğme metni → ana düğme zemini.
    expect(meetsMinimumContrast(COLOR_TEXT, COLOR_SURFACE)).toBe(true);
    expect(meetsMinimumContrast(COLOR_TEXT_SECONDARY, COLOR_SURFACE)).toBe(true);
    expect(meetsMinimumContrast(COLOR_PRIMARY, COLOR_ON_PRIMARY)).toBe(true);
    expect(meetsMinimumContrast(COLOR_ERROR, COLOR_ERROR_SURFACE)).toBe(true);
    expect(meetsMinimumContrast(COLOR_SUCCESS, COLOR_SUCCESS_SURFACE)).toBe(true);
    expect(meetsMinimumContrast(COLOR_WARNING, COLOR_WARNING_SURFACE)).toBe(true);
  });

  it("yetersiz kontrastlı bir çifti (ör. açık gri/beyaz) reddeder — kanıt sahte-pozitif DEĞİL", () => {
    expect(meetsMinimumContrast("#cbd5e1", "#ffffff")).toBe(false);
  });

  it("özel eşik parametresini kullanır", () => {
    expect(meetsMinimumContrast(COLOR_ERROR, COLOR_ERROR_SURFACE, 5.91)).toBe(true);
    expect(meetsMinimumContrast(COLOR_ERROR, COLOR_ERROR_SURFACE, 10)).toBe(false);
  });
});
