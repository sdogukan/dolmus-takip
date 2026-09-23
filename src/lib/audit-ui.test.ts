import { describe, expect, it } from "vitest";
import {
  auditActionLabel,
  buildAuditUrl,
  buildBeforeAfterRows,
  formatAuditActor,
  formatAuditTime,
  isCreationAction,
} from "./audit-ui";

describe("auditActionLabel", () => {
  it("bilinen kodu Türkçe etikete çevirir", () => {
    expect(auditActionLabel("business.update")).toBe("İşletme bilgisi değişti");
    expect(auditActionLabel("vehicle.reset_password")).toBe("Araç şifresi sıfırlandı");
  });

  it("bilinmeyen kodu gizlemez, ham kodu döner", () => {
    expect(auditActionLabel("gelecek.islem")).toBe("gelecek.islem");
  });
});

describe("isCreationAction", () => {
  it("yalnız *.create ve platform_user.bootstrap oluşturmadır", () => {
    expect(isCreationAction("business.create")).toBe(true);
    expect(isCreationAction("vehicle_driver.create")).toBe(true);
    expect(isCreationAction("platform_user.bootstrap")).toBe(true);
    expect(isCreationAction("platform_user.reset_password")).toBe(false);
    expect(isCreationAction("business.update")).toBe(false);
  });
});

describe("formatAuditActor", () => {
  it("ekip aktörünü gerçek kullanıcı adı ve rol etiketiyle yazar", () => {
    expect(formatAuditActor({ kind: "platform_user", username: "admin.test", role: "admin" })).toBe(
      "admin.test (Yönetici)",
    );
    expect(formatAuditActor({ kind: "platform_user", username: "destek.test", role: "support" })).toBe(
      "destek.test (Destek)",
    );
  });

  it("araç credential'ını erişim rolü + plaka olarak yazar, kişi adı türetmez", () => {
    expect(
      formatAuditActor({ kind: "vehicle_credential", access: "owner", plateNormalized: "35ABC123" }),
    ).toBe("Sahip oturumu · 35 ABC 123");
    expect(
      formatAuditActor({ kind: "vehicle_credential", access: "driver", plateNormalized: null }),
    ).toBe("Şoför oturumu");
  });
});

describe("buildBeforeAfterRows", () => {
  it("güncellemede yalnız değişen alanları, sürümü gizleyerek listeler", () => {
    const view = buildBeforeAfterRows(
      "business.update",
      { name: "Görkem Dolmuş", version: 1 },
      { name: "Görkem işletmesi", version: 2 },
    );
    expect(view.noPreviousValue).toBe(false);
    expect(view.rows).toEqual([
      { key: "name", label: "Ad", before: "Görkem Dolmuş", after: "Görkem işletmesi" },
    ]);
  });

  it("oluşturmada önceki değeri null bırakır ve kimlik/sürüm alanlarını gizler", () => {
    const view = buildBeforeAfterRows("vehicle.create", null, {
      plateNormalized: "35ABC123",
      brandModel: null,
      active: true,
      ownerPersonId: "kisi-1",
      version: 1,
    });
    expect(view.noPreviousValue).toBe(true);
    expect(view.rows.map((row) => row.key)).toEqual(["plateNormalized", "brandModel", "active"]);
    expect(view.rows.every((row) => row.before === null)).toBe(true);
    expect(view.rows[0]).toMatchObject({ label: "Plaka", after: "35 ABC 123" });
    expect(view.rows[1]?.after).toBe("—");
    expect(view.rows[2]?.after).toBe("Aktif");
  });

  it("şifre sıfırlamada oluşturma iddiası yapmaz, hiçbir alan değişmese de erişimi gösterir", () => {
    const view = buildBeforeAfterRows(
      "vehicle.reset_password",
      { access: "owner", credentialVersion: 1 },
      { access: "owner", credentialVersion: 2 },
    );
    expect(view.noPreviousValue).toBe(false);
    expect(view.rows).toEqual([
      { key: "access", label: "Erişim", before: "Mal sahibi şifresi", after: "Mal sahibi şifresi" },
    ]);
  });

  it("before null olsa da oluşturma olmayan işlemde noPreviousValue false döner", () => {
    const view = buildBeforeAfterRows("platform_user.reset_password", null, { username: "destek.a" });
    expect(view.noPreviousValue).toBe(false);
  });

  it("parola/özet benzeri anahtarları API dönse bile göstermez", () => {
    const view = buildBeforeAfterRows(
      "vehicle.update",
      { note: "a", newPassword: "gizli-1", passwordHash: "x", csrfToken: "y" },
      { note: "b", newPassword: "gizli-2", passwordHash: "z", csrfToken: "w" },
    );
    expect(view.rows.map((row) => row.key)).toEqual(["note"]);
    expect(JSON.stringify(view)).not.toContain("gizli");
  });

  it("nesne değerini metin olarak serileştirir, HTML'e dokunmaz", () => {
    const view = buildBeforeAfterRows("vehicle.update", { note: "a" }, { note: "<b>kalın</b>" });
    expect(view.rows[0]?.after).toBe("<b>kalın</b>");
  });
});

describe("formatAuditTime", () => {
  it("UTC zamanı Türkiye saatiyle yazar", () => {
    expect(formatAuditTime("2026-09-21T11:05:00.000Z")).toBe("21 Eyl 2026 14:05");
  });

  it("geçersiz tarihte ham metni döner", () => {
    expect(formatAuditTime("bozuk")).toBe("bozuk");
  });
});

describe("buildAuditUrl", () => {
  it("boş filtreleri eklemez, limit her zaman vardır", () => {
    expect(buildAuditUrl({ limit: 20 })).toBe("/api/v1/admin/audit?limit=20");
  });

  it("filtre ve imleci kodlayarak ekler", () => {
    expect(buildAuditUrl({ vehicleId: "v-1", cursor: "a b", limit: 20 })).toBe(
      "/api/v1/admin/audit?vehicleId=v-1&cursor=a+b&limit=20",
    );
  });
});
