import { describe, expect, it } from "vitest";
import { formatPlateForDisplay, normalizePlate, validatePlate } from "./plate";

describe("normalizePlate", () => {
  it("boşlukları atar", () => {
    expect(normalizePlate("35 abc 123")).toBe("35ABC123");
  });

  it("zaten normal olan plakayı değiştirmez", () => {
    expect(normalizePlate("35ABC123")).toBe("35ABC123");
  });

  it("birden fazla / farklı yerdeki boşlukları atar", () => {
    expect(normalizePlate("  35   abc123  ")).toBe("35ABC123");
    expect(normalizePlate("34 a 1")).toBe("34A1");
  });

  it("Türkçe küçük ı/i harflerini yerel ayardan bağımsız ASCII I'ya çevirir", () => {
    // "ı" (noktasız) ve "i" (noktalı) ikisi de ASCII "I"ya normalize edilmeli.
    expect(normalizePlate("34 ıst 1")).toBe("34IST1");
    expect(normalizePlate("34 ist 1")).toBe("34IST1");
  });

  it("Türkçe büyük İ harfini de ASCII I'ya çevirir", () => {
    expect(normalizePlate("34 İST 1")).toBe("34IST1");
  });

  it("boş girdi için boş dize döner", () => {
    expect(normalizePlate("")).toBe("");
    expect(normalizePlate("   ")).toBe("");
  });
});

describe("validatePlate", () => {
  it("35 abc 123 ile 35ABC123 aynı normalize sonucu üretir (S1.2)", () => {
    const a = validatePlate("35 abc 123");
    const b = validatePlate("35ABC123");
    expect(a.valid).toBe(true);
    expect(b.valid).toBe(true);
    expect(a.normalized).toBe(b.normalized);
    expect(a.normalized).toBe("35ABC123");
  });

  it("geçerli 2 haneli il kodu + 1 harf + 4 rakam kabul eder", () => {
    const result = validatePlate("06 A 1234");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("06A1234");
  });

  it("geçerli 3 harf + 2 rakam kabul eder", () => {
    const result = validatePlate("34 ABC 12");
    expect(result.valid).toBe(true);
  });

  it("il kodu 00 veya 82+ reddedilir", () => {
    expect(validatePlate("00A1234").valid).toBe(false);
    expect(validatePlate("82A1234").valid).toBe(false);
    expect(validatePlate("99A1234").valid).toBe(false);
  });

  it("Türk plakalarında kullanılmayan Q/W/X harfleri reddedilir", () => {
    expect(validatePlate("34QAB12").valid).toBe(false);
    expect(validatePlate("34WAB12").valid).toBe(false);
    expect(validatePlate("34XAB12").valid).toBe(false);
  });

  it("harf olmadan yalnız rakamlar reddedilir", () => {
    expect(validatePlate("341234567").valid).toBe(false);
  });

  it("boş girdi 'empty' nedeniyle reddedilir", () => {
    const result = validatePlate("   ");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("empty");
  });

  it("biçimsiz girdi 'invalid_format' nedeniyle reddedilir", () => {
    const result = validatePlate("ABCDEFG");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_format");
  });
});

describe("formatPlateForDisplay", () => {
  it("normalize plakayı 'İL HARF RAKAM' biçiminde tek boşlukla ayırır (T1.2)", () => {
    expect(formatPlateForDisplay("35ABC123")).toBe("35 ABC 123");
  });

  it("kısa harf/rakam kombinasyonlarında da doğru gruplar", () => {
    expect(formatPlateForDisplay("06A1234")).toBe("06 A 1234");
    expect(formatPlateForDisplay("34ABC12")).toBe("34 ABC 12");
  });

  it("normalizePlate + validatePlate ile üretilen değer için giriş biçimiyle aynı görüntü üretir", () => {
    const { normalized } = validatePlate("35 abc 123");
    expect(formatPlateForDisplay(normalized)).toBe("35 ABC 123");
  });

  it("PLATE_PATTERN'e uymayan bozuk girdi için değeri OLDUĞU GİBİ döner (uydurma biçim üretmez)", () => {
    expect(formatPlateForDisplay("BOZUK")).toBe("BOZUK");
  });
});
