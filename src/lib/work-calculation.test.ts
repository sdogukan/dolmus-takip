import { describe, expect, it } from "vitest";
import {
  AmountOutOfRangeError,
  CALCULATION_VERSION,
  calculateWorkEntryAmounts as calculate,
  SHARE_BPS_BY_WORK_KIND,
} from "./work-calculation";

describe("calculateWorkEntryAmounts", () => {
  it("şoför: hasılat üzerinden 2000 bps pay, kalan giderler ve pay düşülerek", () => {
    expect(calculate("driver", 1000000, 150000, 30000)).toEqual({
      shareBps: 2000,
      shareCents: 200000,
      remainderCents: 620000,
      calculationVersion: 1,
    });
  });

  it("sahip: pay 0, kalan hasılat − giderler", () => {
    expect(calculate("owner", 1000000, 150000, 30000)).toMatchObject({
      shareBps: 0,
      shareCents: 0,
      remainderCents: 820000,
    });
  });

  it("yuvarlama: 3 kuruş → 1 (yarım yukarı), 2 kuruş → 0, 7 kuruş → 1, 8 kuruş → 2", () => {
    expect(calculate("driver", 3, 0, 0).shareCents).toBe(1);
    expect(calculate("driver", 2, 0, 0).shareCents).toBe(0);
    expect(calculate("driver", 7, 0, 0).shareCents).toBe(1);
    expect(calculate("driver", 8, 0, 0).shareCents).toBe(2);
  });

  it("eksi kalan olduğu gibi döner, 0'a kırpılmaz", () => {
    expect(calculate("driver", 1000000, 900000, 0).remainderCents).toBe(-100000);
  });

  it("hepsi 0 iken 0 döner", () => {
    expect(calculate("driver", 0, 0, 0)).toMatchObject({ shareCents: 0, remainderCents: 0 });
  });

  it("BigInt girdi kabul eder ve büyük hasılatta kayıpsızdır", () => {
    const gross = BigInt(Number.MAX_SAFE_INTEGER);
    const result = calculate("driver", gross, 0n, 0n);
    // floor((9007199254740991*2000+5000)/10000) = 1801439850948198
    expect(result.shareCents).toBe(1801439850948198);
    expect(result.remainderCents).toBe(Number.MAX_SAFE_INTEGER - 1801439850948198);
  });

  it("gider + pay güvenli sınırı aşarsa açıklamalı hata fırlatır", () => {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    expect(() => calculate("owner", 0n, max, 1n)).toThrow(AmountOutOfRangeError);
    expect(() => calculate("driver", max, max, 0n)).toThrow(AmountOutOfRangeError);
  });

  it("negatif veya güvenli olmayan girdiyi reddeder", () => {
    expect(() => calculate("driver", -1, 0, 0)).toThrow(RangeError);
    expect(() => calculate("driver", 1.5, 0, 0)).toThrow(RangeError);
    expect(() => calculate("driver", 0, 0, BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
  });

  it("kural v1 sabitleri", () => {
    expect(SHARE_BPS_BY_WORK_KIND).toEqual({ driver: 2000, owner: 0 });
    expect(CALCULATION_VERSION).toBe(1);
  });
});
