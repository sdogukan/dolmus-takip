import { describe, expect, it } from "vitest";
import {
  deriveCsrfToken,
  generateSessionId,
  generateSessionToken,
  hashSessionToken,
  PLATFORM_SESSION_ABSOLUTE_MS,
  PLATFORM_SESSION_INACTIVITY_MS,
  SESSION_LAST_SEEN_WRITE_INTERVAL_MS,
  systemClock,
  VEHICLE_SESSION_ABSOLUTE_MS,
  VEHICLE_SESSION_INACTIVITY_MS,
} from "./session";

/**
 * Saf birim testleri (DB'ye dokunmaz) — oturum ve oturum süresi
 * kurallarının sayısal/kriptografik karşılıklarını sınar.
 * Zaman kontrollü DB davranışı (resolveSession'ın gerçek sınır testleri)
 * `tests/integration/session-usecases.test.ts`'tedir.
 */

describe("generateSessionToken", () => {
  it("32 baytlık rastgele değeri base64url olarak üretir (dolgu/özel karakter yok)", () => {
    const token = generateSessionToken();
    // base64url 32 bayt -> 43 karakter (dolgu olmadan).
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("her çağrıda farklı token üretir", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateSessionToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("hashSessionToken", () => {
  it("aynı token için deterministik SHA-256 hex özeti döner", () => {
    const token = "sabit-test-tokeni";
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("farklı tokenlar farklı özet üretir", () => {
    expect(hashSessionToken("a")).not.toBe(hashSessionToken("b"));
  });

  it("düz tokenı İÇERMEZ (özet tek yönlü)", () => {
    const token = "gizli-ham-token-degeri";
    expect(hashSessionToken(token)).not.toContain(token);
  });
});

describe("generateSessionId", () => {
  it("UUID v4 biçiminde benzersiz kimlik üretir", () => {
    const id = generateSessionId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(generateSessionId()).not.toBe(id);
  });
});

describe("deriveCsrfToken", () => {
  it("aynı ham token için deterministiktir (her istekte aynı sonucu üretebilmeli)", () => {
    const token = generateSessionToken();
    expect(deriveCsrfToken(token)).toBe(deriveCsrfToken(token));
  });

  it("farklı oturum tokenları farklı CSRF tokenı üretir", () => {
    expect(deriveCsrfToken("token-a")).not.toBe(deriveCsrfToken("token-b"));
  });

  it("ham oturum tokenının kendisini İÇERMEZ", () => {
    const token = "gizli-oturum-tokeni-xyz";
    expect(deriveCsrfToken(token)).not.toContain(token);
  });
});

describe("systemClock", () => {
  it("gerçek zamana yakın bir Date döner", () => {
    const before = Date.now();
    const now = systemClock().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe("süre sabitleri — oturum süresi kuralının birebir sayısal karşılığı", () => {
  it("araç oturumu: 30 gün mutlak, 7 gün hareketsizlik", () => {
    expect(VEHICLE_SESSION_ABSOLUTE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(VEHICLE_SESSION_INACTIVITY_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("ekip (platform) oturumu: 12 saat mutlak, 30 dk hareketsizlik", () => {
    expect(PLATFORM_SESSION_ABSOLUTE_MS).toBe(12 * 60 * 60 * 1000);
    expect(PLATFORM_SESSION_INACTIVITY_MS).toBe(30 * 60 * 1000);
  });

  it("last_seen_at yazım aralığı 5 dk'dır", () => {
    expect(SESSION_LAST_SEEN_WRITE_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});
