import { describe, expect, it } from "vitest";
import { WORK_ENTRY_MESSAGES as TEXT } from "./messages";
import {
  centsToApiString,
  formatTlAmount,
  MAX_CENTS,
  parseApiCents,
  parseSignedApiCents,
  parseTlAmount,
} from "./money";

const cents = (text: string): bigint | string => {
  const result = parseTlAmount(text);
  return result.ok ? result.cents : result.message;
};

describe("parseTlAmount", () => {
  it("binlik noktası ve ondalık virgülü kayıpsız okur", () => {
    expect(cents("10.000,00")).toBe(1000000n);
    expect(cents("1.250,5")).toBe(125050n);
    expect(cents("0,05")).toBe(5n);
    expect(cents("12")).toBe(1200n);
    expect(cents("1.234.567,89")).toBe(123456789n);
    expect(cents("  7,00 ")).toBe(700n);
  });

  it("açık 0 geçerlidir, boş metin 0 sayılmaz", () => {
    expect(cents("0")).toBe(0n);
    expect(cents("0,00")).toBe(0n);
    expect(cents("")).toBe(TEXT.moneyRequired);
    expect(cents("   ")).toBe(TEXT.moneyRequired);
  });

  it("her geçersiz girdi kendi hata metnini verir", () => {
    expect(cents("-5")).toBe(TEXT.moneyNegative);
    expect(cents("1,234")).toBe(TEXT.moneyPrecision);
    expect(cents("1.5")).toBe(TEXT.moneyThousands);
    expect(cents("10.50")).toBe(TEXT.moneyThousands);
    expect(cents("abc")).toBe(TEXT.moneyFormat);
    expect(cents("1,2,3")).toBe(TEXT.moneyFormat);
    expect(cents(",5")).toBe(TEXT.moneyFormat);
    expect(cents("5,")).toBe(TEXT.moneyFormat);
    expect(cents("+5")).toBe(TEXT.moneyFormat);
    expect(cents("1e3")).toBe(TEXT.moneyFormat);
    const messages = new Set([
      TEXT.moneyRequired,
      TEXT.moneyNegative,
      TEXT.moneyPrecision,
      TEXT.moneyThousands,
      TEXT.moneyFormat,
      TEXT.moneyTooLarge,
    ]);
    expect(messages.size).toBe(6);
  });

  it("hata kodunu da döndürür", () => {
    expect(parseTlAmount("")).toMatchObject({ ok: false, code: "required" });
    expect(parseTlAmount("1,234")).toMatchObject({ ok: false, code: "precision" });
  });

  it("MAX_SAFE_INTEGER kuruşa kadar kabul eder, üstünü reddeder", () => {
    expect(cents("90.071.992.547.409,91")).toBe(MAX_CENTS);
    expect(cents("90.071.992.547.409,92")).toBe(TEXT.moneyTooLarge);
    expect(cents("999.999.999.999.999.999,00")).toBe(TEXT.moneyTooLarge);
  });
});

describe("formatTlAmount", () => {
  it("binlik ve kuruş biçimler", () => {
    expect(formatTlAmount(620000)).toBe("6.200,00 TL");
    expect(formatTlAmount(0)).toBe("0,00 TL");
    expect(formatTlAmount(5)).toBe("0,05 TL");
    expect(formatTlAmount(123456789n)).toBe("1.234.567,89 TL");
  });

  it("eksi değeri işaretler", () => {
    expect(formatTlAmount(-100000)).toBe("-1.000,00 TL");
  });

  it("güvenli olmayan sayıyı reddeder", () => {
    expect(() => formatTlAmount(1.5)).toThrow(RangeError);
  });

  it("ayrıştırma ile biçimlendirme gidiş-dönüşte kayıpsızdır", () => {
    const parsed = parseTlAmount("6.200,00");
    expect(parsed.ok && formatTlAmount(parsed.cents)).toBe("6.200,00 TL");
  });
});

describe("API kuruş metni", () => {
  it("centsToApiString ondalık tam sayı metni üretir", () => {
    expect(centsToApiString(620000)).toBe("620000");
    expect(centsToApiString(MAX_CENTS)).toBe("9007199254740991");
  });

  it("parseApiCents yalnız ^(0|[1-9][0-9]*)$ metnini ve sınırı kabul eder", () => {
    expect(parseApiCents("0")).toBe(0n);
    expect(parseApiCents("9007199254740991")).toBe(MAX_CENTS);
    expect(parseApiCents("9007199254740992")).toBeNull();
    for (const bad of ["", "01", "-1", "1.0", "1e3", " 1", "1 ", "abc", "0x10"]) {
      expect(parseApiCents(bad)).toBeNull();
    }
  });

  it("parseSignedApiCents eksi değeri kabul eder; -0, bozuk metin ve sınır aşımı null", () => {
    expect(parseSignedApiCents("-40000")).toBe(-40000n);
    expect(parseSignedApiCents("620000")).toBe(620000n);
    expect(parseSignedApiCents("0")).toBe(0n);
    expect(parseSignedApiCents("-9007199254740991")).toBe(-MAX_CENTS);
    for (const bad of ["-0", "-", "--1", "-01", "+1", "1.0", "", "-9007199254740992"]) {
      expect(parseSignedApiCents(bad)).toBeNull();
    }
  });
});
