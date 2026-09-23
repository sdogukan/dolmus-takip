import { describe, expect, it } from "vitest";
import {
  buildWorkEntryBody,
  classifyWorkEntryResponse,
  emptyWorkEntryDraft,
  hasEarlierAttempt,
  isWorkEntryDraftDirty,
  selectableFromDriversResponse,
  shouldReleaseAfterError,
  workEntryDraftName,
  workEntryErrorMessage,
  type WorkEntryDraft,
} from "./work-entry-ui";

const managed = (overrides: Record<string, unknown>) => ({
  personId: "p",
  fullName: "Ad Soyad",
  personActive: true,
  personVersion: 1,
  assignment: { active: true, version: 1 },
  ...overrides,
});

describe("selectableFromDriversResponse", () => {
  it("şoför biçimi: satırları olduğu gibi döndürür", () => {
    expect(
      selectableFromDriversResponse({ drivers: [{ personId: "a", fullName: "Ali" }] }),
    ).toEqual([{ personId: "a", fullName: "Ali" }]);
  });

  it("yönetim görünümü: yalnız aktif atama + aktif kişi seçilebilir", () => {
    const body = {
      drivers: [
        managed({ personId: "ok", fullName: "Aktif" }),
        managed({ personId: "inactive-assignment", assignment: { active: false, version: 2 } }),
        managed({ personId: "inactive-person", personActive: false }),
        managed({ personId: "no-assignment", assignment: null }),
      ],
      candidates: [{ personId: "c", fullName: "Aday" }],
    };
    expect(selectableFromDriversResponse(body)).toEqual([{ personId: "ok", fullName: "Aktif" }]);
  });

  it("aynı adlı iki kişi iki ayrı satırdır; yalnız kimlik ve ad taşınır", () => {
    const result = selectableFromDriversResponse({
      drivers: [managed({ personId: "1", fullName: "Mehmet Öz" }), managed({ personId: "2", fullName: "Mehmet Öz" })],
    });
    expect(result).toEqual([
      { personId: "1", fullName: "Mehmet Öz" },
      { personId: "2", fullName: "Mehmet Öz" },
    ]);
  });

  it("boş liste geçerlidir (boş durum), bozuk yanıt null döner", () => {
    expect(selectableFromDriversResponse({ drivers: [] })).toEqual([]);
    expect(selectableFromDriversResponse(null)).toBeNull();
    expect(selectableFromDriversResponse({})).toBeNull();
    expect(selectableFromDriversResponse({ drivers: "x" })).toBeNull();
    expect(selectableFromDriversResponse({ drivers: [null] })).toBeNull();
    expect(selectableFromDriversResponse({ drivers: [{ personId: 1, fullName: "x" }] })).toBeNull();
    expect(selectableFromDriversResponse({ drivers: [{ personId: "a" }] })).toBeNull();
  });

  it("yönetim satırında bozuk aktiflik alanı listeyi reddeder (sessizce seçilebilir yapmaz)", () => {
    expect(selectableFromDriversResponse({ drivers: [managed({ personActive: "yes" })] })).toBeNull();
    expect(
      selectableFromDriversResponse({ drivers: [managed({ assignment: { active: "yes" } })] }),
    ).toBeNull();
  });
});

const filled = (overrides: Partial<WorkEntryDraft> = {}): WorkEntryDraft => ({
  ...emptyWorkEntryDraft("2026-09-14", () => "req-1"),
  date: "2026-09-14",
  personId: "p-1",
  startTime: "08:00",
  endTime: "17:30",
  grossText: "10.000",
  fuelText: "1.500,50",
  ...overrides,
});

describe("workEntryDraftName / emptyWorkEntryDraft / isWorkEntryDraftDirty", () => {
  it("taslak adı araç kimliğiyle anahtarlanır", () => {
    expect(workEntryDraftName("abc")).toBe("kayit-abc");
  });

  it("boş taslak bugünün tarihini ve verilen requestId'yi taşır, bekleyen değildir", () => {
    const draft = emptyWorkEntryDraft("2026-09-14", () => "req-9");
    expect(draft).toMatchObject({
      requestId: "req-9",
      date: "2026-09-14",
      workType: "",
      pending: false,
      frozenBody: null,
      attemptSent: false,
    });
    expect(isWorkEntryDraftDirty(draft, "2026-09-14")).toBe(false);
  });

  it("herhangi bir alan, farklı tarih veya bekleyen gönderim taslağı kirli yapar", () => {
    const empty = emptyWorkEntryDraft("2026-09-14", () => "r");
    expect(isWorkEntryDraftDirty({ ...empty, grossText: "1" }, "2026-09-14")).toBe(true);
    expect(isWorkEntryDraftDirty({ ...empty, date: "2026-09-13" }, "2026-09-14")).toBe(true);
    expect(isWorkEntryDraftDirty({ ...empty, endsNextDay: true }, "2026-09-14")).toBe(true);
    expect(isWorkEntryDraftDirty({ ...empty, pending: true }, "2026-09-14")).toBe(true);
  });
});

describe("buildWorkEntryBody", () => {
  it("şoför modu: kuruşlar ondalık tam sayı metni, workerPersonId dahil, masraf alanları yok", () => {
    expect(buildWorkEntryBody(filled(), "driver")).toEqual({
      requestId: "req-1",
      workType: "driver",
      workerPersonId: "p-1",
      date: "2026-09-14",
      startTime: "08:00",
      endTime: "17:30",
      endsNextDay: false,
      grossCents: "1000000",
      fuelCents: "150050",
    });
  });

  it("sahip türü: workerPersonId gitmez; kırpılmış açıklamalı masraf gider", () => {
    const body = buildWorkEntryBody(
      filled({
        workType: "owner",
        personId: "",
        expenseOpen: true,
        otherText: "300",
        otherNote: "  Otopark  ",
      }),
      "owner",
    );
    expect(body).not.toBeNull();
    expect(body).not.toHaveProperty("workerPersonId");
    expect(body).toMatchObject({
      workType: "owner",
      otherExpenseCents: "30000",
      otherExpenseNote: "Otopark",
    });
  });

  it("kişi, işletme, rol ve pay alanları gövdeye asla konmaz", () => {
    const body = buildWorkEntryBody(filled({ workType: "driver" }), "staff")!;
    for (const key of ["personId", "businessId", "vehicleId", "role", "shareBps", "shareCents"]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("kapalı masraf bölümü ve boş tutar+açıklama masraf alanı göndermez; açık 0 hasılat gider", () => {
    const body = buildWorkEntryBody(
      filled({ grossText: "0", fuelText: "0", expenseOpen: true, otherText: "", otherNote: "" }),
      "driver",
    )!;
    expect(body).not.toHaveProperty("otherExpenseCents");
    expect(body).not.toHaveProperty("otherExpenseNote");
    expect(body.grossCents).toBe("0");
    expect(
      buildWorkEntryBody(filled({ expenseOpen: false, otherText: "5", otherNote: "x" }), "driver"),
    ).not.toHaveProperty("otherExpenseCents");
  });

  it("tür seçilmemiş, geçersiz tutar veya açıklamalı boş tutar için null", () => {
    expect(buildWorkEntryBody(filled({ workType: "" }), "owner")).toBeNull();
    expect(buildWorkEntryBody(filled({ grossText: "1.5" }), "driver")).toBeNull();
    expect(buildWorkEntryBody(filled({ fuelText: "" }), "driver")).toBeNull();
    expect(
      buildWorkEntryBody(filled({ expenseOpen: true, otherText: "", otherNote: "Not" }), "driver"),
    ).toBeNull();
  });
});

const createdBody = (overrides: Record<string, unknown> = {}) => ({
  workEntry: {
    id: "e-1",
    status: "pending",
    workKind: "driver",
    workDate: "2026-09-14",
    durationMinutes: 570,
    shareCents: "200000",
    remainderCents: "620000",
    person: { id: "p-1", fullName: "Hüseyin Ak" },
    ...overrides,
  },
});

describe("classifyWorkEntryResponse", () => {
  it("201 + beklenen gövde: created", () => {
    expect(classifyWorkEntryResponse({ status: 201, body: createdBody() })).toEqual({
      kind: "created",
      entry: {
        id: "e-1",
        status: "pending",
        workKind: "driver",
        workDate: "2026-09-14",
        durationMinutes: 570,
        remainderCents: "620000",
        shareCents: "200000",
        personName: "Hüseyin Ak",
      },
    });
    expect(
      classifyWorkEntryResponse({
        status: 201,
        body: createdBody({ status: "not_required", workKind: "owner" }),
      }),
    ).toMatchObject({ kind: "created", entry: { status: "not_required", workKind: "owner" } });
  });

  it("ağ hatası, okunamayan gövde ve 5xx belirsizdir", () => {
    expect(classifyWorkEntryResponse(null)).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryResponse({ status: 200, body: undefined })).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryResponse({ status: 403, body: undefined })).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryResponse({ status: 500, body: { error: { code: "X" } } })).toEqual({
      kind: "ambiguous",
    });
    expect(classifyWorkEntryResponse({ status: 503, body: {} })).toEqual({ kind: "ambiguous" });
  });

  it("biçimi bozuk 201 belirsizdir (kayıt yazılmış olabilir)", () => {
    expect(classifyWorkEntryResponse({ status: 201, body: {} })).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryResponse({ status: 201, body: createdBody({ status: "confirmed" }) })).toEqual({
      kind: "ambiguous",
    });
    expect(classifyWorkEntryResponse({ status: 201, body: null })).toEqual({ kind: "ambiguous" });
  });

  it("4xx kesindir: kod ve yalnız metin alan hataları taşınır", () => {
    expect(
      classifyWorkEntryResponse({
        status: 422,
        body: { error: { code: "VALIDATION_ERROR", fields: { date: "Geçerli bir tarih gir.", x: 1 } } },
      }),
    ).toEqual({
      kind: "error",
      status: 422,
      code: "VALIDATION_ERROR",
      fields: { date: "Geçerli bir tarih gir." },
    });
    expect(classifyWorkEntryResponse({ status: 401, body: {} })).toEqual({
      kind: "error",
      status: 401,
      code: undefined,
      fields: {},
    });
    expect(classifyWorkEntryResponse({ status: 409, body: { error: { code: "REQUEST_ID_REUSED" } } })).toMatchObject({
      kind: "error",
      status: 409,
      code: "REQUEST_ID_REUSED",
    });
  });
});

describe("workEntryErrorMessage", () => {
  it("401 oturum bitti, 403 yetki, 409 çakışma metnini verir", () => {
    expect(workEntryErrorMessage(401, "SESSION_REVOKED")).toBe("Oturumun sona erdi. Yeniden giriş yap.");
    expect(workEntryErrorMessage(403, "FORBIDDEN")).toBe("Bu işlem için erişimin yok.");
    expect(workEntryErrorMessage(409, "REQUEST_ID_REUSED")).toMatch(/başka bir denemeyle çakıştı/);
    expect(workEntryErrorMessage(409, undefined)).toMatch(/başka bir denemeyle çakıştı/);
    expect(workEntryErrorMessage(409, "TARGET_INACTIVE_FOR_WRITE")).toBe(
      "İşletme veya araç artık pasif; bu işlem yapılamaz.",
    );
  });

  it("bilinmeyen kodda sunucu metni basılmaz, genel metin döner", () => {
    expect(workEntryErrorMessage(400, "BILINMEYEN")).toBe("Bağlantı yok. Henüz kaydedilmedi.");
  });
});

describe("shouldReleaseAfterError", () => {
  it("ilk denemede her kesin hata formu serbest bırakır", () => {
    for (const status of [401, 403, 404, 409, 413, 415, 422, 429]) {
      expect(shouldReleaseAfterError({ status }, false)).toBe(true);
    }
  });

  it("daha önceki denemeden sonra yalnız 422 ve 409 REQUEST_ID_REUSED bırakır", () => {
    expect(shouldReleaseAfterError({ status: 422, code: "VALIDATION_ERROR" }, true)).toBe(true);
    expect(shouldReleaseAfterError({ status: 409, code: "REQUEST_ID_REUSED" }, true)).toBe(true);
  });

  it("daha önceki denemeden sonra 401, 403 (her kod), 404 ve diğerleri taslağı bekleyen tutar", () => {
    expect(shouldReleaseAfterError({ status: 401, code: "SESSION_REVOKED" }, true)).toBe(false);
    expect(shouldReleaseAfterError({ status: 403, code: "FORBIDDEN" }, true)).toBe(false);
    expect(shouldReleaseAfterError({ status: 403, code: "TARGET_INACTIVE_FOR_WRITE" }, true)).toBe(false);
    expect(shouldReleaseAfterError({ status: 403 }, true)).toBe(false);
    expect(shouldReleaseAfterError({ status: 404, code: "NOT_FOUND" }, true)).toBe(false);
    expect(shouldReleaseAfterError({ status: 409, code: "TARGET_INACTIVE_FOR_WRITE" }, true)).toBe(false);
    expect(shouldReleaseAfterError({ status: 409 }, true)).toBe(false);
    for (const status of [400, 413, 415, 429]) {
      expect(shouldReleaseAfterError({ status }, true)).toBe(false);
    }
  });
});

describe("hasEarlierAttempt", () => {
  it("bekleyen olmayan taslakta daha önceki deneme yoktur", () => {
    expect(hasEarlierAttempt(filled({ pending: false, attemptSent: true }))).toBe(false);
  });

  it("bekleyen ve işaretli taslak daha önceki denemeyi taşır", () => {
    expect(hasEarlierAttempt(filled({ pending: true, attemptSent: true, frozenBody: "{}" }))).toBe(true);
  });

  it("işaretten önce yazılmış bekleyen taslak (alan yok) gönderilmiş sayılır", () => {
    const legacy = { ...filled({ pending: true, frozenBody: "{}" }) } as Partial<WorkEntryDraft>;
    delete legacy.attemptSent;
    expect(hasEarlierAttempt(legacy as WorkEntryDraft)).toBe(true);
  });
});
