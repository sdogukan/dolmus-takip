import { describe, expect, it } from "vitest";
import {
  adminReadErrorMessage,
  buildAdminListUrl,
  buildSearchPageHref,
  parseActiveFilter,
} from "./admin-search";

describe("parseActiveFilter", () => {
  it("yalnız active/inactive'i kabul eder, gerisi all", () => {
    expect(parseActiveFilter("active")).toBe("active");
    expect(parseActiveFilter("inactive")).toBe("inactive");
    expect(parseActiveFilter("hepsi")).toBe("all");
    expect(parseActiveFilter(undefined)).toBe("all");
  });
});

describe("buildAdminListUrl", () => {
  it("boş aramada işletme listesini ister", () => {
    expect(buildAdminListUrl({ q: "", active: "all" })).toBe("/api/v1/admin/businesses?limit=20");
  });

  it("dolu aramada araç aramasını ister ve metni kodlar", () => {
    expect(buildAdminListUrl({ q: "35 abc 12", active: "active" })).toBe(
      "/api/v1/admin/vehicles?q=35+abc+12&active=active&limit=20",
    );
  });

  it("imleci yalnız verilince ekler", () => {
    expect(buildAdminListUrl({ q: "x", active: "all", cursor: "c1" })).toContain("cursor=c1");
    expect(buildAdminListUrl({ q: "x", active: "all", cursor: null })).not.toContain("cursor");
  });
});

describe("buildSearchPageHref", () => {
  it("varsayılanlarda çıplak /yonetim döner", () => {
    expect(buildSearchPageHref("", "all")).toBe("/yonetim");
  });

  it("q ve active'i yansıtır", () => {
    expect(buildSearchPageHref("Görkem", "inactive")).toBe("/yonetim?q=G%C3%B6rkem&active=inactive");
  });
});

describe("adminReadErrorMessage", () => {
  it("401 oturum bitti, 403 yetkisiz metnini verir", () => {
    expect(adminReadErrorMessage(401)).toBe("Oturumun sona erdi. Yeniden giriş yap.");
    expect(adminReadErrorMessage(403)).toBe("Bu işlem için erişimin yok.");
  });

  it("5xx ve ağ hatasında genel bağlantı metni verir", () => {
    expect(adminReadErrorMessage(500, "INTERNAL")).toBe("Bağlantı kurulamadı. Tekrar dene.");
    expect(adminReadErrorMessage(null)).toBe("Bağlantı kurulamadı. Tekrar dene.");
  });

  it("422 gibi bilinen kodu metne çevirir", () => {
    expect(adminReadErrorMessage(422, "VALIDATION_ERROR")).toBe(
      "Girilen bilgiler geçersiz. Alanları kontrol edip tekrar dene.",
    );
  });
});
