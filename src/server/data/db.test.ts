import { describe, expect, it } from "vitest";
import { compareVersions } from "./db";

/**
 * `compareVersions` saf mantık birim testi (DB'ye dokunmaz). Gerçek
 * bağlantıya karşı sürüm kapısının kendisi (geçme/reddetme yolları)
 * `tests/integration/schema.test.ts`'te gerçek `SELECT sqlite_version()`
 * ile sınanır (finansal DB testleri yalnız mock veya :memory: üzerinde
 * kabul edilmez); bu dosya yalnız string karşılaştırma saflığını test
 * eder, DB testi değildir.
 */
describe("compareVersions", () => {
  it("büyük sürümü küçükten büyük sayar", () => {
    expect(compareVersions("3.53.4", "3.51.3")).toBeGreaterThan(0);
  });

  it("eşit sürümlerde 0 döner", () => {
    expect(compareVersions("3.51.3", "3.51.3")).toBe(0);
  });

  it("küçük sürümü büyükten küçük sayar", () => {
    expect(compareVersions("3.51.2", "3.51.3")).toBeLessThan(0);
  });

  it("sayısal karşılaştırma yapar, sözlüksel (lexicographic) DEĞİL — '3.9.0' < '3.51.3'", () => {
    // Sözlüksel karşılaştırmada "9" > "5" olduğundan "3.9.0" yanlışlıkla
    // "3.51.3"ten büyük sayılırdı; burada bileşen bazlı sayısal karşılaştırma
    // doğru sırayı verir.
    expect(compareVersions("3.9.0", "3.51.3")).toBeLessThan(0);
  });

  it("eksik bileşenleri 0 sayar ('3.51' ile '3.51.0' eşit)", () => {
    expect(compareVersions("3.51", "3.51.0")).toBe(0);
  });
});
