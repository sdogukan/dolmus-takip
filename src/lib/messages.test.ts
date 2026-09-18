import { describe, expect, it } from "vitest";
import {
  COMMON_SCREEN_MESSAGES,
  ERROR_CODE_MESSAGES,
  getErrorMessage,
  VEHICLE_LOGIN_FIELD_MESSAGES,
  VEHICLE_LOGIN_RESULT_MESSAGES,
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

  it("T1.2 — INVALID_CREDENTIALS/RATE_LIMITED/HASH_QUEUE_FULL STORIES/ARCH birebir metinlerini taşır", () => {
    expect(getErrorMessage("INVALID_CREDENTIALS")).toBe(
      "Plaka veya şifre yanlış.",
    );
    expect(getErrorMessage("RATE_LIMITED")).toBe(
      "Çok fazla deneme. Lütfen biraz bekleyip tekrar dene.",
    );
    expect(getErrorMessage("HASH_QUEUE_FULL")).toBe(
      "Sistem şu anda yoğun. Lütfen tekrar dene.",
    );
  });

  it("T1.2 — VEHICLE_LOGIN_FIELD_MESSAGES plaka/şifre alan hatalarını taşır", () => {
    expect(VEHICLE_LOGIN_FIELD_MESSAGES.plateEmpty).toBe("Plakayı gir.");
    expect(VEHICLE_LOGIN_FIELD_MESSAGES.plateInvalidFormat).toBe(
      "Plaka biçimi geçersiz.",
    );
    expect(VEHICLE_LOGIN_FIELD_MESSAGES.passwordEmpty).toBe("Şifreyi gir.");
  });

  it("T1.2 ADIM 2/2 — VEHICLE_LOGIN_RESULT_MESSAGES.networkError giriş ekranının ağ hatası metnini taşır", () => {
    expect(VEHICLE_LOGIN_RESULT_MESSAGES.networkError).toBe(
      "Bağlantı kurulamadı. Tekrar dene.",
    );
  });

  it("T2.1 — VERSION_CONFLICT, COMMON_SCREEN_MESSAGES.concurrentEditConflict ile BİREBİR ve AYNI kaynaktan gelir", () => {
    expect(getErrorMessage("VERSION_CONFLICT")).toBe(
      "Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.",
    );
    expect(getErrorMessage("VERSION_CONFLICT")).toBe(
      COMMON_SCREEN_MESSAGES.concurrentEditConflict,
    );
  });

  it("T2.1 — TARGET_INACTIVE_FOR_WRITE/REQUEST_ID_REUSED/FORBIDDEN kod eşlemeleri tanımlıdır", () => {
    expect(getErrorMessage("TARGET_INACTIVE_FOR_WRITE")).toBe(
      "İşletme veya araç artık pasif; bu işlem yapılamaz.",
    );
    expect(getErrorMessage("REQUEST_ID_REUSED")).toBe(
      "Bu işlem başka bir denemeyle çakıştı. Sayfayı yenileyip tekrar dene.",
    );
    expect(getErrorMessage("FORBIDDEN")).toBe(
      COMMON_SCREEN_MESSAGES.unauthorizedOrInactiveAccess,
    );
  });
});
