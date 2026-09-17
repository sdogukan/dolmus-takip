import { afterEach, describe, expect, it } from "vitest";
import {
  InvalidAppOriginError,
  resetTrustedAppOriginForTests,
  resolveTrustedAppOrigin,
} from "./app-origin";

/**
 * Birim testleri — T1.4 düzeltme turu 1.
 *
 * `resolveDbPathFromEnv` (`../data/db.ts`) ile AYNI desen: zorunlu env,
 * sessiz varsayılan YOK, eksik/geçersizse açık hata. DB/ağ erişimi yoktur
 * — saf ortam değişkeni ayrıştırma/doğrulama.
 */
describe("resolveTrustedAppOrigin", () => {
  afterEach(() => {
    resetTrustedAppOriginForTests();
  });

  it("APP_ORIGIN tanımsızsa InvalidAppOriginError fırlatır", () => {
    expect(() => resolveTrustedAppOrigin({})).toThrow(InvalidAppOriginError);
  });

  it("APP_ORIGIN boş dizeyse InvalidAppOriginError fırlatır", () => {
    expect(() => resolveTrustedAppOrigin({ APP_ORIGIN: "   " })).toThrow(
      InvalidAppOriginError,
    );
  });

  it("APP_ORIGIN geçersiz bir URL ise InvalidAppOriginError fırlatır", () => {
    expect(() =>
      resolveTrustedAppOrigin({ APP_ORIGIN: "bu-bir-url-degil" }),
    ).toThrow(InvalidAppOriginError);
  });

  it("APP_ORIGIN http/https DIŞINDA bir şemaysa (ör. ftp) InvalidAppOriginError fırlatır", () => {
    expect(() =>
      resolveTrustedAppOrigin({ APP_ORIGIN: "ftp://ornek.invalid" }),
    ).toThrow(InvalidAppOriginError);
  });

  it("geçerli https origin'i AYNEN (kanonik biçimde) döner", () => {
    expect(
      resolveTrustedAppOrigin({ APP_ORIGIN: "https://dolmus-takip.ornek.com" }),
    ).toBe("https://dolmus-takip.ornek.com");
  });

  it("yol/sorgu/hash İÇEREN bir değer verilse bile yalnız origin'i (şema+host+port) döner", () => {
    expect(
      resolveTrustedAppOrigin({
        APP_ORIGIN: "https://ornek.com:8443/bazi/yol?a=1#parca",
      }),
    ).toBe("https://ornek.com:8443");
  });

  it("dev için http://localhost:3000 kabul edilir", () => {
    expect(
      resolveTrustedAppOrigin({ APP_ORIGIN: "http://localhost:3000" }),
    ).toBe("http://localhost:3000");
  });

  it("değer BİR KEZ ayrıştırılıp önbelleğe alınır: ilk çağrıdan SONRA env değişse de aynı sonucu döner (resetTrustedAppOriginForTests'e kadar)", () => {
    expect(resolveTrustedAppOrigin({ APP_ORIGIN: "https://a.invalid" })).toBe(
      "https://a.invalid",
    );
    // env artık farklı olsa da (gerçek `process.env` üzerinde de aynı
    // önbellekleme geçerlidir — `../data/app-db.ts` `getAppDb()` ile AYNI
    // desen) önbellekteki değer döner.
    expect(resolveTrustedAppOrigin({ APP_ORIGIN: "https://b.invalid" })).toBe(
      "https://a.invalid",
    );
    resetTrustedAppOriginForTests();
    expect(resolveTrustedAppOrigin({ APP_ORIGIN: "https://b.invalid" })).toBe(
      "https://b.invalid",
    );
  });
});
