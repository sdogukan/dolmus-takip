import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSecureCookieOrigin,
  readSessionToken,
  SESSION_COOKIE_NAME,
  serializeLogoutCookie,
  serializeSessionCookie,
} from "./cookie";
import { resetTrustedAppOriginForTests } from "./app-origin";

/**
 * Saf birim testleri (DB'ye dokunmaz). T1.2 ek düzeltme (uygulama
 * kararı): Secure bayrağı APP_ORIGIN şemasından türetilir (https → true,
 * http → false), NODE_ENV'DEN BAĞIMSIZDIR. `process.env.NODE_ENV`'i her
 * iki uçta da AÇIKÇA TERSİNE ayarlayan testler bunu KANITLAR: hiçbiri
 * sonucu ETKİLEMEZ.
 */

describe("isSecureCookieOrigin", () => {
  afterEach(() => {
    resetTrustedAppOriginForTests();
  });

  it("https origin için true döner", () => {
    expect(isSecureCookieOrigin("https://ornek.com")).toBe(true);
  });

  it("http origin için false döner", () => {
    expect(isSecureCookieOrigin("http://127.0.0.1:3100")).toBe(false);
  });

  it("argüman verilmezse resolveTrustedAppOrigin() (APP_ORIGIN) kullanılır", () => {
    try {
      vi.stubEnv("APP_ORIGIN", "https://ornek.com");
      resetTrustedAppOriginForTests();
      // NODE_ENV BİLEREK TERS ayarlanır (development) — sonuç yine de
      // APP_ORIGIN'in şemasına (https) göre true olmalı, NODE_ENV'e göre
      // DEĞİL.
      vi.stubEnv("NODE_ENV", "development");
      expect(isSecureCookieOrigin()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      resetTrustedAppOriginForTests();
    }
  });
});

describe("serializeSessionCookie", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const expiresAt = new Date("2026-01-31T00:00:00.000Z"); // +30 gün

  it("http APP_ORIGIN'de Secure YOK, HttpOnly/SameSite=Lax/Path=/ VAR, Domain YOK", () => {
    const header = serializeSessionCookie("tok-123", {
      now,
      expiresAt,
      appOrigin: "http://127.0.0.1:3100",
    });
    expect(header).toContain("dolmus_session=tok-123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Secure");
    expect(header).not.toContain("Domain");
  });

  it("https APP_ORIGIN'de Secure EKLENİR", () => {
    const header = serializeSessionCookie("tok-123", {
      now,
      expiresAt,
      appOrigin: "https://ornek.com",
    });
    expect(header).toContain("Secure");
  });

  it("NODE_ENV=production olsa da http APP_ORIGIN'de Secure EKLENMEZ (NODE_ENV'den bağımsız)", () => {
    try {
      vi.stubEnv("NODE_ENV", "production");
      const header = serializeSessionCookie("tok-123", {
        now,
        expiresAt,
        appOrigin: "http://127.0.0.1:3100",
      });
      expect(header).not.toContain("Secure");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("NODE_ENV tanımsız olsa da https APP_ORIGIN'de Secure EKLENİR (NODE_ENV'den bağımsız)", () => {
    try {
      vi.stubEnv("NODE_ENV", undefined);
      const header = serializeSessionCookie("tok-123", {
        now,
        expiresAt,
        appOrigin: "https://ornek.com",
      });
      expect(header).toContain("Secure");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("Max-Age kalan mutlak süreyi (saniye) taşır", () => {
    const header = serializeSessionCookie("tok-123", {
      now,
      expiresAt,
      appOrigin: "http://127.0.0.1:3100",
    });
    // 30 gün = 2_592_000 sn.
    expect(header).toContain("Max-Age=2592000");
  });

  it("expiresAt geçmişteyse Max-Age negatif DEĞİL, 0'a kırpılır", () => {
    const past = new Date("2025-01-01T00:00:00.000Z");
    const header = serializeSessionCookie("tok-123", {
      now,
      expiresAt: past,
      appOrigin: "http://127.0.0.1:3100",
    });
    expect(header).toContain("Max-Age=0");
  });
});

describe("serializeLogoutCookie", () => {
  it("boş değer ve Max-Age=0 ile çerezi siler; aynı öznitelikleri korur", () => {
    const header = serializeLogoutCookie("http://127.0.0.1:3100");
    expect(header).toContain("dolmus_session=;");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Secure");
  });

  it("https APP_ORIGIN'de Secure EKLENİR", () => {
    const header = serializeLogoutCookie("https://ornek.com");
    expect(header).toContain("Secure");
  });
});

describe("readSessionToken", () => {
  function requestWithCookie(cookieHeader: string | null): Request {
    const headers = new Headers();
    if (cookieHeader !== null) {
      headers.set("cookie", cookieHeader);
    }
    return new Request("https://example.invalid/api/v1/session", { headers });
  }

  it("Cookie header'ı hiç yoksa null döner", () => {
    expect(readSessionToken(requestWithCookie(null))).toBeNull();
  });

  it("dolmus_session yoksa (başka çerezler varken) null döner", () => {
    expect(readSessionToken(requestWithCookie("baska=deger; ikinci=x"))).toBeNull();
  });

  it("tek başına dolmus_session çerezini okur", () => {
    expect(readSessionToken(requestWithCookie("dolmus_session=abc123"))).toBe(
      "abc123",
    );
  });

  it("birden çok çerez arasından dolmus_session'ı bulur (baş/orta/son)", () => {
    expect(
      readSessionToken(requestWithCookie("a=1; dolmus_session=tok; b=2")),
    ).toBe("tok");
  });

  it("URL-encode edilmiş değeri çözer", () => {
    expect(
      readSessionToken(requestWithCookie("dolmus_session=a%2Fb%3Dc")),
    ).toBe("a/b=c");
  });

  it("boş Cookie header'ında null döner", () => {
    expect(readSessionToken(requestWithCookie(""))).toBeNull();
  });
});

describe("SESSION_COOKIE_NAME", () => {
  it('"dolmus_session"tır', () => {
    expect(SESSION_COOKIE_NAME).toBe("dolmus_session");
  });
});
