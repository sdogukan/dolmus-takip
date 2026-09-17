import { beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "./session";
import {
  checkVehicleLoginRateLimit,
  getRateLimitTrackedKeyCountsForTests,
  IP_LOGIN_RATE_LIMIT,
  MAX_TRACKED_KEYS_PER_STORE,
  PLATE_LOGIN_RATE_LIMIT,
  recordFailedVehicleLoginAttempt,
  resetVehicleLoginRateLimitForTests,
  resolveClientIp,
  UNKNOWN_CLIENT_IP_KEY,
} from "./rate-limit";

/**
 * `rate-limit.ts` birim testleri — T1.2 ADIM 1/2, S1.2, görev tanımı (2).
 * Bellek içi, DB'siz saf bir modül; `unit` Vitest projesindedir.
 */

function fixedClock(iso: string): Clock {
  return () => new Date(iso);
}

function offsetClock(iso: string, deltaMs: number): Clock {
  return () => new Date(new Date(iso).getTime() + deltaMs);
}

describe("checkVehicleLoginRateLimit / recordFailedVehicleLoginAttempt", () => {
  beforeEach(() => {
    resetVehicleLoginRateLimitForTests();
  });

  it("hiç deneme yokken limitli değildir", () => {
    const decision = checkVehicleLoginRateLimit({
      plateKey: "34AAA001",
      ipKey: "198.51.100.1",
    });
    expect(decision.limited).toBe(false);
    expect(decision.retryAfterSeconds).toBe(0);
  });

  it("plaka başına 20. başarısız denemeden SONRA (21. kontrol) 429 sınırına takılır", () => {
    const t0 = "2026-01-01T00:00:00.000Z";
    const clock = fixedClock(t0);
    const keys = { plateKey: "34AAA001", ipKey: "198.51.100.1" };

    for (let i = 0; i < PLATE_LOGIN_RATE_LIMIT.limit; i++) {
      expect(checkVehicleLoginRateLimit(keys, clock).limited).toBe(false);
      recordFailedVehicleLoginAttempt(keys, clock);
    }

    const decision = checkVehicleLoginRateLimit(keys, clock);
    expect(decision.limited).toBe(true);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(
      PLATE_LOGIN_RATE_LIMIT.windowMs / 1000,
    );
  });

  it("aynı plakanın sınırı BAŞKA bir plakayı etkilemez", () => {
    const t0 = "2026-01-01T00:00:00.000Z";
    const clock = fixedClock(t0);
    const keyA = { plateKey: "34AAA001", ipKey: "198.51.100.1" };
    const keyB = { plateKey: "34BBB002", ipKey: "198.51.100.2" };

    for (let i = 0; i < PLATE_LOGIN_RATE_LIMIT.limit; i++) {
      recordFailedVehicleLoginAttempt(keyA, clock);
    }

    expect(checkVehicleLoginRateLimit(keyA, clock).limited).toBe(true);
    expect(checkVehicleLoginRateLimit(keyB, clock).limited).toBe(false);
  });

  it("IP başına 120. başarısız denemeden SONRA 429 sınırına takılır (farklı plakalarla dahi)", () => {
    const t0 = "2026-01-01T00:00:00.000Z";
    const clock = fixedClock(t0);
    const sharedIp = "198.51.100.9";

    for (let i = 0; i < IP_LOGIN_RATE_LIMIT.limit; i++) {
      // Her deneme FARKLI bir plaka dener (plaka sınırına HİÇ takılmadan
      // yalnız IP sınırının kendisini izole sınamak için) — plaka
      // sınırının kendi 20 eşiğinin çok altında kalacak şekilde
      // plakaları döndürüyoruz.
      const plateKey = `34AAA${String(i % 10).padStart(3, "0")}`;
      recordFailedVehicleLoginAttempt({ plateKey, ipKey: sharedIp }, clock);
    }

    const decision = checkVehicleLoginRateLimit(
      { plateKey: "34ZZZ999", ipKey: sharedIp },
      clock,
    );
    expect(decision.limited).toBe(true);
  });

  it("yalnız BAŞARISIZ denemeler sayılır — check çağrısının kendisi sayaç ARTIRMAZ", () => {
    const t0 = "2026-01-01T00:00:00.000Z";
    const clock = fixedClock(t0);
    const keys = { plateKey: "34AAA001", ipKey: "198.51.100.1" };

    for (let i = 0; i < 50; i++) {
      checkVehicleLoginRateLimit(keys, clock);
    }

    expect(checkVehicleLoginRateLimit(keys, clock).limited).toBe(false);
  });

  it("kayan pencere: 15 dk + 1ms sonra eski denemeler düşer, sınır yeniden açılır", () => {
    const t0 = "2026-01-01T00:00:00.000Z";
    const keys = { plateKey: "34AAA001", ipKey: "198.51.100.1" };

    for (let i = 0; i < PLATE_LOGIN_RATE_LIMIT.limit; i++) {
      recordFailedVehicleLoginAttempt(keys, fixedClock(t0));
    }
    expect(checkVehicleLoginRateLimit(keys, fixedClock(t0)).limited).toBe(true);

    const afterWindow = offsetClock(t0, PLATE_LOGIN_RATE_LIMIT.windowMs + 1);
    expect(checkVehicleLoginRateLimit(keys, afterWindow).limited).toBe(false);
  });

  it("kayan pencere: yalnız pencereden DÜŞEN kadarı serbest kalır (tam sıfırlanma değil)", () => {
    const t0 = "2026-01-01T00:00:00.000Z";
    const keys = { plateKey: "34AAA001", ipKey: "198.51.100.1" };

    // İlk 10 deneme t0'da, kalan 10 deneme t0 + 10 dk'da.
    for (let i = 0; i < 10; i++) {
      recordFailedVehicleLoginAttempt(keys, fixedClock(t0));
    }
    const tPlus10 = offsetClock(t0, 10 * 60 * 1000);
    for (let i = 0; i < 10; i++) {
      recordFailedVehicleLoginAttempt(keys, tPlus10);
    }
    // Toplam 20 — sınıra tam ulaşıldı.
    expect(checkVehicleLoginRateLimit(keys, tPlus10).limited).toBe(true);

    // t0 + 15dk + 1ms: yalnız İLK 10'luk grup (t0'da yapılmış) pencereden
    // düşer (15 dk penceresi t0'a göre dolar); ikinci 10'luk grup (t0+10dk)
    // HÂLÂ penceredeymiş gibi (yalnız 5dk + 1ms geçmiş) sayılmalı — toplam
    // 10 kalır, sınırın (20) altında, artık limitli DEĞİL.
    const justAfterFirstWindow = offsetClock(
      t0,
      PLATE_LOGIN_RATE_LIMIT.windowMs + 1,
    );
    expect(
      checkVehicleLoginRateLimit(keys, justAfterFirstWindow).limited,
    ).toBe(false);
  });

  it("resetVehicleLoginRateLimitForTests tüm sayaçları temizler", () => {
    const t0 = "2026-01-01T00:00:00.000Z";
    const clock = fixedClock(t0);
    const keys = { plateKey: "34AAA001", ipKey: "198.51.100.1" };
    for (let i = 0; i < PLATE_LOGIN_RATE_LIMIT.limit; i++) {
      recordFailedVehicleLoginAttempt(keys, clock);
    }
    expect(checkVehicleLoginRateLimit(keys, clock).limited).toBe(true);

    resetVehicleLoginRateLimitForTests();

    expect(checkVehicleLoginRateLimit(keys, clock).limited).toBe(false);
  });

  // Denetim bulgusu, düzeltme turu 1 — "rate-limit.ts sayaç Map'leri
  // sınırsız büyüyebilir — bellek tükenme (DoS) saldırı yüzeyi". Aşağıdaki
  // testler yalnız `MAX_TRACKED_KEYS_PER_STORE` TAVANININ gerçekten
  // uygulandığını (mağazalar sınırsız büyümüyor) doğrular; kayan pencere/
  // sınır davranışı üstteki testlerde zaten kanıtlıdır.
  it("MAX_TRACKED_KEYS_PER_STORE'un ÜZERİNDE, her denemede FARKLI plaka/IP kullanan bir saldırı mağazaları sınırsız BÜYÜTMEZ", () => {
    const clock = fixedClock("2026-01-01T00:00:00.000Z");
    const extraBeyondCap = 100;

    for (let i = 0; i < MAX_TRACKED_KEYS_PER_STORE + extraBeyondCap; i++) {
      recordFailedVehicleLoginAttempt(
        {
          plateKey: `34AAA${String(i).padStart(7, "0")}`,
          ipKey: `ip-${i}`,
        },
        clock,
      );
    }

    const counts = getRateLimitTrackedKeyCountsForTests();
    expect(counts.plate).toBeLessThanOrEqual(MAX_TRACKED_KEYS_PER_STORE);
    expect(counts.ip).toBeLessThanOrEqual(MAX_TRACKED_KEYS_PER_STORE);
    // Tavan gerçekten UYGULANDI (sınırsız büyümedi), boş da KALMADI.
    expect(counts.plate).toBeGreaterThan(0);
    expect(counts.ip).toBeGreaterThan(0);
  });

  it("kapasite tahliyesi SONRASI da hız sınırı yeni denemeler için doğru çalışmaya devam eder", () => {
    const clock = fixedClock("2026-01-01T00:00:00.000Z");

    // Mağazayı tavana kadar (ve biraz ötesine) doldur.
    for (let i = 0; i < MAX_TRACKED_KEYS_PER_STORE + 10; i++) {
      recordFailedVehicleLoginAttempt(
        { plateKey: `34AAA${String(i).padStart(7, "0")}`, ipKey: `ip-${i}` },
        clock,
      );
    }

    // Tahliye baskısı altında bile TAZE bir anahtar normal şekilde
    // izlenmeye devam eder — 20. başarısız denemeden SONRA sınırlanır.
    const freshKey = { plateKey: "34ZZZ999", ipKey: "203.0.113.250" };
    for (let i = 0; i < PLATE_LOGIN_RATE_LIMIT.limit; i++) {
      expect(checkVehicleLoginRateLimit(freshKey, clock).limited).toBe(false);
      recordFailedVehicleLoginAttempt(freshKey, clock);
    }
    expect(checkVehicleLoginRateLimit(freshKey, clock).limited).toBe(true);
  });
});

describe("resolveClientIp", () => {
  function requestWithXff(xff: string | null): Request {
    const headers = new Headers();
    if (xff !== null) {
      headers.set("x-forwarded-for", xff);
    }
    return new Request("http://localhost:3000/api/v1/auth/vehicle-login", {
      method: "POST",
      headers,
    });
  }

  it("TRUSTED_PROXY tanımlı DEĞİLKEN header'a güvenmez — 'unknown' döner", () => {
    const ip = resolveClientIp(requestWithXff("203.0.113.5"), {});
    expect(ip).toBe(UNKNOWN_CLIENT_IP_KEY);
  });

  it("TRUSTED_PROXY tanımlıyken X-Forwarded-For'un İLK değerini kullanır", () => {
    const ip = resolveClientIp(requestWithXff("203.0.113.5, 10.0.0.1"), {
      TRUSTED_PROXY: "127.0.0.1",
    });
    expect(ip).toBe("203.0.113.5");
  });

  it("TRUSTED_PROXY tanımlı ama header YOKSA 'unknown' döner", () => {
    const ip = resolveClientIp(requestWithXff(null), {
      TRUSTED_PROXY: "127.0.0.1",
    });
    expect(ip).toBe(UNKNOWN_CLIENT_IP_KEY);
  });

  it("TRUSTED_PROXY boş dizeyse (env satırı var ama değersiz) güvenmez", () => {
    const ip = resolveClientIp(requestWithXff("203.0.113.5"), {
      TRUSTED_PROXY: "   ",
    });
    expect(ip).toBe(UNKNOWN_CLIENT_IP_KEY);
  });

  it("X-Forwarded-For'daki baştaki/sondaki boşlukları kırpar", () => {
    const ip = resolveClientIp(requestWithXff("  203.0.113.7  , 10.0.0.1"), {
      TRUSTED_PROXY: "127.0.0.1",
    });
    expect(ip).toBe("203.0.113.7");
  });
});
