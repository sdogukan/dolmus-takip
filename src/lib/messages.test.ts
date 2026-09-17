import { describe, expect, it } from "vitest";
import {
  COMMON_SCREEN_MESSAGES,
  ERROR_CODE_MESSAGES,
  getErrorMessage,
} from "./messages";

/**
 * Birim testleri — T1.4 ADIM 2/2, S1.4. Saf sabit/eşleme dosyası; DB/ağ
 * yok (`vitest.config.mts` "unit" projesi).
 */
describe("messages", () => {
  it("SESSION_EXPIRED ve SESSION_REVOKED S1.4 AC6 metnini BİREBİR ve AYNI döner", () => {
    expect(getErrorMessage("SESSION_EXPIRED")).toBe(
      "Oturumun sona erdi. Yeniden giriş yap.",
    );
    expect(getErrorMessage("SESSION_REVOKED")).toBe(
      "Oturumun sona erdi. Yeniden giriş yap.",
    );
    expect(getErrorMessage("SESSION_EXPIRED")).toBe(
      getErrorMessage("SESSION_REVOKED"),
    );
  });

  it("bilinmeyen kod için undefined döner (uydurma fallback YOK)", () => {
    expect(getErrorMessage("HIC_BOYLE_BIR_KOD")).toBeUndefined();
  });

  it("CSRF/origin kodları 'Bu işlem için erişimin yok.' metnini kullanır", () => {
    expect(ERROR_CODE_MESSAGES.CSRF_TOKEN_INVALID).toBe(
      "Bu işlem için erişimin yok.",
    );
    expect(ERROR_CODE_MESSAGES.ORIGIN_INVALID).toBe(
      "Bu işlem için erişimin yok.",
    );
  });

  it("DESIGN §2.10 tablosundaki sabit ekran metinleri birebir taşınır", () => {
    expect(COMMON_SCREEN_MESSAGES.loading).toBe("Kayıtlar yükleniyor…");
    expect(COMMON_SCREEN_MESSAGES.trulyEmptyPeriod).toBe("Bu dönemde kayıt yok.");
    expect(COMMON_SCREEN_MESSAGES.saving).toBe("Kaydediliyor…");
    expect(COMMON_SCREEN_MESSAGES.savedSuccessfully).toBe("Kaydedildi.");
    expect(COMMON_SCREEN_MESSAGES.checkingResultAfterDisconnect).toBe(
      "Kaydın sonucu kontrol ediliyor.",
    );
    expect(COMMON_SCREEN_MESSAGES.knownDisconnectBeforeSubmit).toBe(
      "Bağlantı yok. Henüz kaydedilmedi.",
    );
    expect(COMMON_SCREEN_MESSAGES.concurrentEditConflict).toBe(
      "Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.",
    );
    expect(COMMON_SCREEN_MESSAGES.correctedAndConfirmed).toBe(
      "Kayıt düzeltildi ve onaylandı.",
    );
    expect(COMMON_SCREEN_MESSAGES.reportLoadFailed).toBe(
      "Rapor yüklenemedi. Tekrar dene.",
    );
    expect(COMMON_SCREEN_MESSAGES.sessionEnded).toBe(
      "Oturumun sona erdi. Yeniden giriş yap.",
    );
    expect(COMMON_SCREEN_MESSAGES.unauthorizedOrInactiveAccess).toBe(
      "Bu işlem için erişimin yok.",
    );
  });
});
