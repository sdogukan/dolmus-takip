import { describe, expect, it } from "vitest";
import { sanitizeAuditPayload } from "./sanitize";

describe("sanitizeAuditPayload", () => {
  it("null girdiyi null bırakır (oluşturma satırında before)", () => {
    expect(sanitizeAuditPayload(null)).toBeNull();
  });

  it("gizli anahtarları büyük-küçük harf duyarsız ve iç içe çıkarır", () => {
    const json = JSON.stringify({
      name: "A",
      passwordHash: "x",
      NewPassword: "y",
      csrfToken: "z",
      nested: { Cookie: "c", client_secret: "s", keep: 1, list: [{ token: "t", ok: true }] },
    });
    expect(sanitizeAuditPayload(json)).toEqual({
      name: "A",
      nested: { keep: 1, list: [{ ok: true }] },
    });
  });

  it("zararsız anahtarları (ör. credentialVersion) korur", () => {
    expect(sanitizeAuditPayload('{"access":"owner","credentialVersion":2}')).toEqual({
      access: "owner",
      credentialVersion: 2,
    });
  });

  it("bozuk veya nesne olmayan JSON için ham metni sızdırmadan {} döner", () => {
    expect(sanitizeAuditPayload("{bozuk")).toEqual({});
    expect(sanitizeAuditPayload('"password=abc"')).toEqual({});
    expect(sanitizeAuditPayload("[1,2]")).toEqual({});
  });
});
