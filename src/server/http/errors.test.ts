import { describe, expect, it } from "vitest";
import { generateRequestId, jsonErrorResponse, jsonSuccessResponse } from "./errors";

/**
 * Saf birim testleri (DB'ye dokunmaz). Görev tanımı: "422/401/403/404/
 * 409/429/503 için tek biçim". Hata yanıtı alan hataları ve request_id
 * içerir; SQL, hash veya yığın izi müşteriye dönmez; her yanıtta
 * request_id, gövde JSON.
 */

describe("generateRequestId", () => {
  it("her çağrıda farklı bir kimlik üretir", () => {
    expect(generateRequestId()).not.toBe(generateRequestId());
  });
});

describe("jsonErrorResponse", () => {
  it("verilen durum kodunu ve Content-Type: application/json header'ını kullanır", async () => {
    const response = jsonErrorResponse(401, "SESSION_MISSING", "Oturum bulunamadı.");
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("gövde { error: { code, message }, request_id } biçimindedir", async () => {
    const response = jsonErrorResponse(404, "NOT_FOUND", "Bulunamadı.", {
      requestId: "req-1",
    });
    const body = await response.json();
    expect(body).toEqual({
      error: { code: "NOT_FOUND", message: "Bulunamadı." },
      request_id: "req-1",
    });
  });

  it("requestId verilmezse otomatik üretir", async () => {
    const response = jsonErrorResponse(429, "RATE_LIMITED", "Çok fazla istek.");
    const body = await response.json();
    expect(typeof body.request_id).toBe("string");
    expect(body.request_id.length).toBeGreaterThan(0);
  });

  it("422 alan hatalarını `fields` altında taşır; başka statülerde `fields` yoktur", async () => {
    const withFields = await jsonErrorResponse(
      422,
      "VALIDATION_ERROR",
      "Geçersiz veri.",
      { fields: { plate: "Zorunlu alan." } },
    ).json();
    expect(withFields.error.fields).toEqual({ plate: "Zorunlu alan." });

    const withoutFields = await jsonErrorResponse(
      403,
      "FORBIDDEN",
      "Yetkisiz.",
    ).json();
    expect(withoutFields.error.fields).toBeUndefined();
  });

  it.each([401, 403, 404, 409, 413, 415, 422, 429, 503] as const)(
    "durum kodu %i desteklenir",
    async (status) => {
      const response = jsonErrorResponse(status, "X", "mesaj");
      expect(response.status).toBe(status);
    },
  );

  it("gövde yalnız code/message/request_id alanlarını taşır (fields yoksa hiç eklenmez)", async () => {
    const response = jsonErrorResponse(
      401,
      "SESSION_EXPIRED",
      "Oturumun sona erdi. Yeniden giriş yap.",
    );
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["error", "request_id"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
  });
});

describe("jsonSuccessResponse", () => {
  it("veriyi düz (sarmalayıcı olmadan) request_id ile birlikte döner", async () => {
    const response = jsonSuccessResponse(
      200,
      { kind: "vehicle", role: "owner" },
      { requestId: "req-2" },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ kind: "vehicle", role: "owner", request_id: "req-2" });
  });

  it("requestId verilmezse otomatik üretir", async () => {
    const body = await jsonSuccessResponse(200, { ok: true }).json();
    expect(typeof body.request_id).toBe("string");
  });
});
