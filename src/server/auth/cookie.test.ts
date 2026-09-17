import { describe, expect, it } from "vitest";
import {
  isSecureCookieEnv,
  readSessionToken,
  SESSION_COOKIE_NAME,
  serializeLogoutCookie,
  serializeSessionCookie,
} from "./cookie";

/**
 * Saf birim testleri (DB'ye dokunmaz). Görev tanımı: "ad dolmus_session;
 * HttpOnly; Secure (NODE_ENV production'da zorunlu, geçerli dev'de HTTP
 * için kapalı ama testte her iki mod doğrulanır); SameSite=Lax; Path=/;
 * Domain yok; Max-Age = kalan mutlak süre."
 */

describe("SESSION_COOKIE_NAME", () => {
  it('"dolmus_session"tır', () => {
    expect(SESSION_COOKIE_NAME).toBe("dolmus_session");
  });
});

describe("isSecureCookieEnv", () => {
  it("NODE_ENV=production iken true döner", () => {
    expect(isSecureCookieEnv({ NODE_ENV: "production" })).toBe(true);
  });

  it("NODE_ENV=development iken false döner", () => {
    expect(isSecureCookieEnv({ NODE_ENV: "development" })).toBe(false);
  });

  it("NODE_ENV tanımsızken false döner (varsayılan güvensiz kabul edilmez, ama zorunlu değildir)", () => {
    expect(isSecureCookieEnv({})).toBe(false);
  });
});

describe("serializeSessionCookie", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const expiresAt = new Date("2026-01-31T00:00:00.000Z"); // +30 gün

  it("dev ortamında Secure YOK, HttpOnly/SameSite=Lax/Path=/ VAR, Domain YOK", () => {
    const header = serializeSessionCookie("tok-123", {
      now,
      expiresAt,
      env: { NODE_ENV: "development" },
    });
    expect(header).toContain("dolmus_session=tok-123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Secure");
    expect(header).not.toContain("Domain");
  });

  it("production ortamında Secure EKLENİR", () => {
    const header = serializeSessionCookie("tok-123", {
      now,
      expiresAt,
      env: { NODE_ENV: "production" },
    });
    expect(header).toContain("Secure");
  });

  it("Max-Age kalan mutlak süreyi (saniye) taşır", () => {
    const header = serializeSessionCookie("tok-123", { now, expiresAt });
    // 30 gün = 2_592_000 sn.
    expect(header).toContain("Max-Age=2592000");
  });

  it("expiresAt geçmişteyse Max-Age negatif DEĞİL, 0'a kırpılır", () => {
    const past = new Date("2025-01-01T00:00:00.000Z");
    const header = serializeSessionCookie("tok-123", { now, expiresAt: past });
    expect(header).toContain("Max-Age=0");
  });
});

describe("serializeLogoutCookie", () => {
  it("boş değer ve Max-Age=0 ile çerezi siler; aynı öznitelikleri korur", () => {
    const header = serializeLogoutCookie({ NODE_ENV: "development" });
    expect(header).toContain("dolmus_session=;");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
  });

  it("production ortamında Secure EKLENİR", () => {
    const header = serializeLogoutCookie({ NODE_ENV: "production" });
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
