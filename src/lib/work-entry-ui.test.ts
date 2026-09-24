import { describe, expect, it } from "vitest";
import {
  buildWorkEntriesUrl,
  buildWorkEntryBody,
  buildWorkEntryConfirmBody,
  buildWorkEntryCorrectBody,
  buildWorkEntryPatchBody,
  canEditEntry,
  canResolveUnknown,
  classifyWorkEntryConfirmResponse,
  classifyWorkEntryCorrectResponse,
  classifyWorkEntryResponse,
  classifyWorkEntryUpdateResponse,
  confirmErrorNeedsReread,
  correctDraftFromEntry,
  correctErrorNeedsReread,
  draftAfterCreated,
  draftAfterRelease,
  editDraftFromEntry,
  editPersonOptions,
  emptyConfirmDraft,
  emptyWorkEntryDraft,
  formatWorkTimeRange,
  frozenReceivedText,
  hasEarlierAttempt,
  isCorrectDraftDirty,
  isEditDraftDirty,
  isWorkEntryDraftDirty,
  parseWorkEntryDetail,
  parseWorkEntryList,
  rebaseCorrectDraft,
  rebaseEditDraft,
  receivedDifference,
  receivedPrefill,
  releaseConfirmDraft,
  releaseCorrectDraft,
  releaseEditDraft,
  savedEntryFromDetail,
  selectableFromDriversResponse,
  shouldReleaseAfterConfirmError,
  shouldReleaseAfterCorrectError,
  shouldReleaseAfterError,
  shouldReleaseAfterUpdateError,
  updateErrorNeedsReread,
  workEntryConfirmDraftName,
  workEntryCorrectDraftName,
  workEntryDetailHref,
  workEntryDraftName,
  workEntryEditDraftName,
  workEntryEditDraftPrefix,
  workEntryErrorMessage,
  workEntryLoginHref,
  type WorkEntryDetail,
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
    startsAt: "2026-09-14T05:00:00.000Z",
    endsAt: "2026-09-14T14:30:00.000Z",
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
        startsAt: "2026-09-14T05:00:00.000Z",
        endsAt: "2026-09-14T14:30:00.000Z",
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
    // Sonuç ekranı saat aralığını gösterir: saatsiz 201 kaydedildi SAYILMAZ.
    expect(classifyWorkEntryResponse({ status: 201, body: createdBody({ startsAt: undefined }) })).toEqual({
      kind: "ambiguous",
    });
    expect(classifyWorkEntryResponse({ status: 201, body: createdBody({ endsAt: 5 }) })).toEqual({
      kind: "ambiguous",
    });
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

const serverEntry = (overrides: Partial<WorkEntryDetail> = {}): WorkEntryDetail => ({
  id: "e-1",
  version: 3,
  status: "pending",
  workKind: "driver",
  workDate: "2026-09-14",
  startsAt: "2026-09-14T05:00:00.000Z",
  endsAt: "2026-09-14T14:30:00.000Z",
  durationMinutes: 570,
  grossCents: "1000000",
  fuelCents: "150050",
  otherExpenseCents: "0",
  shareCents: "200000",
  remainderCents: "649950",
  otherExpenseNote: null,
  person: { id: "p-1", fullName: "Mehmet Öz" },
  confirmation: null,
  ...overrides,
});

describe("workEntryEditDraftName / workEntryDetailHref", () => {
  it("düzenleme taslağı araç ve kayıtla anahtarlanır, oluşturma taslağından ayrıdır", () => {
    expect(workEntryEditDraftName("v1", "e1")).toBe("kayit-duzenle-v1-e1");
    expect(workEntryEditDraftName("v1", "e1").startsWith(workEntryEditDraftPrefix("v1"))).toBe(true);
    expect(workEntryEditDraftName("v1", "e1")).not.toBe(workEntryDraftName("v1"));
  });

  it("detay adresi moda göre; staff modunda araç kimliği URL'dedir", () => {
    expect(workEntryDetailHref("owner", "e1", "v1")).toBe("/sahip/kayitlar/e1");
    expect(workEntryDetailHref("driver", "e1", "v1")).toBe("/sofor/kayitlar/e1");
    expect(workEntryDetailHref("staff", "e1", "v1")).toBe("/yonetim/araclar/v1/kayitlar/e1");
  });
});

describe("parseWorkEntryDetail", () => {
  it("geçerli kaydı okur; fazladan alanları taşımaz", () => {
    const parsed = parseWorkEntryDetail({ ...serverEntry(), shareBps: 2000, calculationVersion: 1 });
    expect(parsed).toEqual(serverEntry());
  });

  it("bozuk biçimde null döner (sessizce 0 gösterilmez)", () => {
    expect(parseWorkEntryDetail(null)).toBeNull();
    expect(parseWorkEntryDetail({ ...serverEntry(), grossCents: 1000 })).toBeNull();
    expect(parseWorkEntryDetail({ ...serverEntry(), grossCents: "10,5" })).toBeNull();
    expect(parseWorkEntryDetail({ ...serverEntry(), grossCents: "01" })).toBeNull();
    expect(parseWorkEntryDetail({ ...serverEntry(), status: "unknown" })).toBeNull();
    expect(parseWorkEntryDetail({ ...serverEntry(), version: 1.5 })).toBeNull();
    expect(parseWorkEntryDetail({ ...serverEntry(), person: { id: "p" } })).toBeNull();
    expect(parseWorkEntryDetail({ ...serverEntry(), otherExpenseNote: 5 })).toBeNull();
  });
});

describe("editDraftFromEntry / isEditDraftDirty", () => {
  it("sunucu kaydından temiz taslak kurar: İstanbul saatleri, TL metinleri, dayandığı sürüm", () => {
    const draft = editDraftFromEntry(serverEntry(), () => "req-1");
    expect(draft).toEqual({
      requestId: "req-1",
      baseVersion: 3,
      date: "2026-09-14",
      personId: "p-1",
      startTime: "08:00",
      endTime: "17:30",
      endsNextDay: false,
      grossText: "10.000,00",
      fuelText: "1.500,50",
      expenseOpen: false,
      otherText: "",
      otherNote: "",
      pending: false,
      frozenBody: null,
      attemptSent: false,
    });
  });

  it("ertesi güne taşan bitişi ve diğer masrafı taslağa yansıtır", () => {
    const draft = editDraftFromEntry(
      serverEntry({
        startsAt: "2026-09-14T19:00:00.000Z",
        endsAt: "2026-09-15T03:00:00.000Z",
        otherExpenseCents: "30000",
        otherExpenseNote: "Otopark",
      }),
      () => "r",
    );
    expect(draft).toMatchObject({
      startTime: "22:00",
      endTime: "06:00",
      endsNextDay: true,
      expenseOpen: true,
      otherText: "300,00",
      otherNote: "Otopark",
    });
  });

  it("temiz taslak kirli değildir; herhangi bir değişiklik veya bekleyen gönderim kirlidir", () => {
    const entry = serverEntry();
    const clean = editDraftFromEntry(entry, () => "r");
    expect(isEditDraftDirty(clean, entry)).toBe(false);
    expect(isEditDraftDirty({ ...clean, grossText: "10.001,00" }, entry)).toBe(true);
    expect(isEditDraftDirty({ ...clean, personId: "p-2" }, entry)).toBe(true);
    expect(isEditDraftDirty({ ...clean, endsNextDay: true }, entry)).toBe(true);
    expect(isEditDraftDirty({ ...clean, pending: true }, entry)).toBe(true);
  });

  it("baştaki/sondaki boşluk değişiklik sayılmaz", () => {
    const entry = serverEntry();
    const clean = editDraftFromEntry(entry, () => "r");
    expect(isEditDraftDirty({ ...clean, grossText: " 10.000,00 " }, entry)).toBe(false);
  });
});

describe("releaseEditDraft / rebaseEditDraft", () => {
  const pendingDraft = {
    ...editDraftFromEntry(serverEntry(), () => "old"),
    grossText: "9.000",
    pending: true,
    frozenBody: "{}",
    attemptSent: true,
  };

  it("bırakma dondurulmuş gövdeyi siler, yeni requestId verir, kullanıcının değerlerini ve sürümünü korur", () => {
    const released = releaseEditDraft(pendingDraft, () => "new");
    expect(released).toMatchObject({
      pending: false,
      frozenBody: null,
      attemptSent: false,
      requestId: "new",
      grossText: "9.000",
      baseVersion: 3,
    });
  });

  it("yeniden bağlama değerleri korur ve taslağı güncel sürüme bağlar", () => {
    const rebased = rebaseEditDraft(pendingDraft, 5, () => "new");
    expect(rebased).toMatchObject({ baseVersion: 5, grossText: "9.000", requestId: "new", pending: false });
  });
});

describe("canEditEntry", () => {
  it("onaylı kayıt hiçbir modda düzenlenmez", () => {
    for (const mode of ["owner", "staff", "driver"] as const) {
      expect(canEditEntry(mode, { status: "confirmed", workDate: "2026-09-14" }, "2026-09-14")).toBe(false);
    }
  });

  it("sahip ve ekip onaysız (bekleyen veya onay gerekmeyen) kaydı düzenler", () => {
    expect(canEditEntry("owner", { status: "not_required", workDate: "2026-01-01" }, "2026-09-14")).toBe(true);
    expect(canEditEntry("staff", { status: "pending", workDate: "2026-01-01" }, "2026-09-14")).toBe(true);
  });

  it("şoför yalnız bugünün bekleyen kaydını düzenler", () => {
    expect(canEditEntry("driver", { status: "pending", workDate: "2026-09-14" }, "2026-09-14")).toBe(true);
    expect(canEditEntry("driver", { status: "pending", workDate: "2026-09-13" }, "2026-09-14")).toBe(false);
    expect(canEditEntry("driver", { status: "not_required", workDate: "2026-09-14" }, "2026-09-14")).toBe(false);
  });
});

describe("buildWorkEntryPatchBody", () => {
  const draft = () => editDraftFromEntry(serverEntry(), () => "req-1");

  it("taslağın sürümünü ve requestId'sini yollar; tür/işletme/rol/pay/durum alanı yoktur", () => {
    const body = buildWorkEntryPatchBody({ ...draft(), grossText: "10.500" }, "driver");
    expect(body).toEqual({
      requestId: "req-1",
      version: 3,
      workerPersonId: "p-1",
      date: "2026-09-14",
      startTime: "08:00",
      endTime: "17:30",
      endsNextDay: false,
      grossCents: "1050000",
      fuelCents: "150050",
    });
    for (const key of ["workType", "personId", "businessId", "shareCents", "status", "role"]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("sahip kaydında workerPersonId gitmez", () => {
    expect(buildWorkEntryPatchBody(draft(), "owner")).not.toHaveProperty("workerPersonId");
  });

  it("diğer masraf ve açıklaması yalnız kullanılıyorsa gider; kapalı bölüm hiç göndermez", () => {
    const open = { ...draft(), expenseOpen: true, otherText: "300", otherNote: " Otopark " };
    expect(buildWorkEntryPatchBody(open, "driver")).toMatchObject({
      otherExpenseCents: "30000",
      otherExpenseNote: "Otopark",
    });
    const closed = { ...draft(), expenseOpen: false, otherText: "300", otherNote: "x" };
    const body = buildWorkEntryPatchBody(closed, "driver");
    expect(body).not.toHaveProperty("otherExpenseCents");
    expect(body).not.toHaveProperty("otherExpenseNote");
  });

  it("geçersiz tutarda null döner; açıklamalı boş masraf tutarı 0 sayılmaz", () => {
    expect(buildWorkEntryPatchBody({ ...draft(), grossText: "1.5" }, "driver")).toBeNull();
    expect(buildWorkEntryPatchBody({ ...draft(), fuelText: "" }, "driver")).toBeNull();
    expect(
      buildWorkEntryPatchBody({ ...draft(), expenseOpen: true, otherText: "", otherNote: "Not" }, "driver"),
    ).toBeNull();
  });

  it("gövde metni sabit: aynı taslak aynı JSON'u üretir (dondurulmuş gövde karşılaştırması)", () => {
    expect(JSON.stringify(buildWorkEntryPatchBody(draft(), "driver"))).toBe(
      JSON.stringify(buildWorkEntryPatchBody(draft(), "driver")),
    );
  });
});

describe("classifyWorkEntryUpdateResponse", () => {
  it("200 + geçerli kayıt = kaydedildi", () => {
    expect(classifyWorkEntryUpdateResponse({ status: 200, body: { workEntry: serverEntry({ version: 4 }) } })).toEqual({
      kind: "saved",
      entry: serverEntry({ version: 4 }),
    });
  });

  it("ağ hatası, okunamayan gövde, 5xx ve biçimi bozuk 200 belirsizdir", () => {
    expect(classifyWorkEntryUpdateResponse(null)).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryUpdateResponse({ status: 200, body: undefined })).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryUpdateResponse({ status: 502, body: {} })).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryUpdateResponse({ status: 200, body: { workEntry: { id: "x" } } })).toEqual({
      kind: "ambiguous",
    });
  });

  it("kesin hata durum, kod ve alan metinlerini taşır; string olmayan alan atılır", () => {
    expect(
      classifyWorkEntryUpdateResponse({
        status: 422,
        body: { error: { code: "VALIDATION_ERROR", fields: { grossCents: "Tutarı gir.", x: 1 } } },
      }),
    ).toEqual({ kind: "error", status: 422, code: "VALIDATION_ERROR", fields: { grossCents: "Tutarı gir." } });
    expect(classifyWorkEntryUpdateResponse({ status: 409, body: { error: { code: "VERSION_CONFLICT" } } })).toEqual({
      kind: "error",
      status: 409,
      code: "VERSION_CONFLICT",
      fields: {},
    });
  });
});

describe("shouldReleaseAfterUpdateError / updateErrorNeedsReread", () => {
  it("ilk denemede her kesin hata bırakır", () => {
    for (const status of [401, 403, 404, 409, 422]) {
      expect(shouldReleaseAfterUpdateError({ status }, false)).toBe(true);
    }
  });

  it("daha önce ulaşmış olabilecek denemeden sonra yalnız yazılmadığını kanıtlayanlar bırakır", () => {
    expect(shouldReleaseAfterUpdateError({ status: 422 }, true)).toBe(true);
    expect(shouldReleaseAfterUpdateError({ status: 409, code: "REQUEST_ID_REUSED" }, true)).toBe(true);
    expect(shouldReleaseAfterUpdateError({ status: 409, code: "VERSION_CONFLICT" }, true)).toBe(true);
    expect(shouldReleaseAfterUpdateError({ status: 409, code: "ENTRY_CONFIRMED" }, true)).toBe(true);
  });

  it("401/403/404 taslağı bekleyen tutar", () => {
    for (const status of [401, 403, 404]) {
      expect(shouldReleaseAfterUpdateError({ status, code: "FORBIDDEN" }, true)).toBe(false);
    }
    expect(shouldReleaseAfterUpdateError({ status: 409 }, true)).toBe(false);
  });

  it("yalnız VERSION_CONFLICT ve ENTRY_CONFIRMED güncel kaydı yeniden okutur", () => {
    expect(updateErrorNeedsReread({ status: 409, code: "VERSION_CONFLICT" })).toBe(true);
    expect(updateErrorNeedsReread({ status: 409, code: "ENTRY_CONFIRMED" })).toBe(true);
    expect(updateErrorNeedsReread({ status: 409, code: "REQUEST_ID_REUSED" })).toBe(false);
    expect(updateErrorNeedsReread({ status: 422 })).toBe(false);
  });
});

describe("workEntryErrorMessage (düzenleme kodları)", () => {
  it("VERSION_CONFLICT kanonik çakışma metnini, ENTRY_CONFIRMED ve 404 kendi metnini alır", () => {
    expect(workEntryErrorMessage(409, "VERSION_CONFLICT")).toBe(
      "Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.",
    );
    expect(workEntryErrorMessage(409, "ENTRY_CONFIRMED")).toBe("Bu kayıt onaylanmış; buradan düzenlenemez.");
    expect(workEntryErrorMessage(404, "WORK_ENTRY_NOT_FOUND")).toBe("Kayıt bulunamadı.");
    expect(workEntryErrorMessage(403, "FORBIDDEN")).toBe("Bu işlem için erişimin yok.");
  });
});

describe("editPersonOptions", () => {
  const selectable = [
    { personId: "p-1", fullName: "Mehmet Öz" },
    { personId: "p-2", fullName: "Hüseyin Ak" },
  ];

  it("kaydın kişisi seçilebilirse liste olduğu gibidir", () => {
    expect(editPersonOptions(selectable, { id: "p-1", fullName: "Mehmet Öz" })).toEqual([
      { personId: "p-1", label: "Mehmet Öz" },
      { personId: "p-2", label: "Hüseyin Ak" },
    ]);
  });

  it("kaydın pasif kişisi '(pasif)' etiketiyle başa eklenir; başka pasif kişi önerilmez", () => {
    const options = editPersonOptions(selectable, { id: "p-9", fullName: "Kemal Şahin" });
    expect(options[0]).toEqual({ personId: "p-9", label: "Kemal Şahin (pasif)" });
    expect(options.map((option) => option.personId)).toEqual(["p-9", "p-1", "p-2"]);
  });
});

describe("parseWorkEntryList / buildWorkEntriesUrl", () => {
  it("kayıtları ve imleci okur; bozuk kayıt tüm listeyi reddeder", () => {
    expect(parseWorkEntryList({ workEntries: [serverEntry()], nextCursor: "c" })).toEqual({
      entries: [serverEntry()],
      nextCursor: "c",
    });
    expect(parseWorkEntryList({ workEntries: [], nextCursor: null })).toEqual({ entries: [], nextCursor: null });
    expect(parseWorkEntryList({ workEntries: [{ id: "x" }], nextCursor: null })).toBeNull();
    expect(parseWorkEntryList({ workEntries: [], nextCursor: 1 })).toBeNull();
    expect(parseWorkEntryList({})).toBeNull();
    expect(parseWorkEntryList(null)).toBeNull();
  });

  it("adres kişiyi ve imleci kodlar", () => {
    expect(buildWorkEntriesUrl("p 1")).toBe("/api/v1/work-entries?workerPersonId=p+1");
    expect(buildWorkEntriesUrl("p1", "a/b")).toBe("/api/v1/work-entries?workerPersonId=p1&cursor=a%2Fb");
  });
});

describe("formatWorkTimeRange", () => {
  it("İstanbul duvar saatiyle HH:MM–HH:MM verir", () => {
    expect(formatWorkTimeRange("2026-09-14T05:00:00.000Z", "2026-09-14T14:30:00.000Z")).toBe("08:00–17:30");
  });

  it("bitiş ertesi güne düşüyorsa '(ertesi gün)' ekler; gece yarısı sınırı İstanbul saatine göre", () => {
    expect(formatWorkTimeRange("2026-09-14T19:00:00.000Z", "2026-09-15T03:00:00.000Z")).toBe(
      "22:00–06:00 (ertesi gün)",
    );
    // UTC'de aynı gün (20:30Z–21:30Z), İstanbul'da ertesi güne taşar (23:30–00:30).
    expect(formatWorkTimeRange("2026-09-14T20:30:00.000Z", "2026-09-14T21:30:00.000Z")).toBe("23:30–00:30 (ertesi gün)");
  });
});

describe("savedEntryFromDetail", () => {
  it("Yenile ile okunan kaydı sonuç ekranı verisine çevirir (onaylanmış durum dahil)", () => {
    const detail = parseWorkEntryDetail({
      id: "e-9",
      version: 3,
      status: "confirmed",
      workKind: "driver",
      workDate: "2026-09-14",
      startsAt: "2026-09-14T05:00:00.000Z",
      endsAt: "2026-09-14T14:30:00.000Z",
      durationMinutes: 570,
      grossCents: "1000000",
      fuelCents: "150000",
      otherExpenseCents: "0",
      shareCents: "200000",
      remainderCents: "620000",
      otherExpenseNote: null,
      person: { id: "p-1", fullName: "Hüseyin Ak" },
      confirmation: { receivedCents: "620000", confirmedAt: "2026-09-14T15:00:00.000Z", entryVersion: 2 },
    });
    expect(detail).not.toBeNull();
    expect(savedEntryFromDetail(detail!)).toEqual({
      id: "e-9",
      status: "confirmed",
      workKind: "driver",
      workDate: "2026-09-14",
      startsAt: "2026-09-14T05:00:00.000Z",
      endsAt: "2026-09-14T14:30:00.000Z",
      durationMinutes: 570,
      remainderCents: "620000",
      shareCents: "200000",
      personName: "Hüseyin Ak",
    });
  });
});

describe("canResolveUnknown", () => {
  const unknown = { pending: true, frozenBody: '{"requestId":"r"}', attemptSent: true };
  const ready = { online: true, disabled: false };

  it("dondurulmuş gövdesi olan, daha önce ulaşmış olabilecek bekleyen taslak çevrimiçiyken çözülür", () => {
    expect(canResolveUnknown(unknown, ready)).toBe(true);
  });

  it("çevrimdışıyken hiçbir şey yollanmaz", () => {
    expect(canResolveUnknown(unknown, { online: false, disabled: false })).toBe(false);
  });

  it("kilitli (pasif hedef) formda çözülmez", () => {
    expect(canResolveUnknown(unknown, { online: true, disabled: true })).toBe(false);
  });

  it("bekleyen olmayan veya gövdesi olmayan taslak çözülmez", () => {
    expect(canResolveUnknown({ ...unknown, pending: false }, ready)).toBe(false);
    expect(canResolveUnknown({ ...unknown, frozenBody: null }, ready)).toBe(false);
  });

  it("denemesi işaretlenmemiş bekleyen taslak otomatik çözülmez", () => {
    expect(canResolveUnknown({ ...unknown, attemptSent: false }, ready)).toBe(false);
  });
});

describe("draftAfterCreated / draftAfterRelease (bayat sekme koruması)", () => {
  const fresh = () => emptyWorkEntryDraft("2026-09-14", () => "new-id");
  const pendingDraft: WorkEntryDraft = {
    ...emptyWorkEntryDraft("2026-09-14", () => "req-1"),
    pending: true,
    frozenBody: "{}",
    attemptSent: true,
  };

  it("çözülen istek taslağın kendisiyse oluşumda taslak boşalır", () => {
    expect(draftAfterCreated(pendingDraft, "req-1", fresh)).toEqual(fresh());
  });

  it("taslak başka bir isteğe ilerlemişse (öbür sekme çözdü) yeni taslak silinmez", () => {
    const next = { ...fresh(), requestId: "req-2", grossText: "500" };
    expect(draftAfterCreated(next, "req-1", fresh)).toBe(next);
  });

  it("kesin hatada aynı istek serbest bırakılır: yeni requestId, alanlar korunur", () => {
    const released = draftAfterRelease({ ...pendingDraft, grossText: "10" }, "req-1", "req-9");
    expect(released).toMatchObject({
      requestId: "req-9",
      pending: false,
      frozenBody: null,
      attemptSent: false,
      grossText: "10",
    });
  });

  it("başka isteğe ait taslak serbest bırakılmaz", () => {
    const other = { ...fresh(), requestId: "req-2", grossText: "5" };
    expect(draftAfterRelease(other, "req-1", "req-9")).toBe(other);
  });
});

describe("workEntryLoginHref", () => {
  it("sabit iç yol: araç rolleri /giris, ekip /yonetim/giris; parametre taşımaz", () => {
    expect(workEntryLoginHref("driver")).toBe("/giris");
    expect(workEntryLoginHref("owner")).toBe("/giris");
    expect(workEntryLoginHref("staff")).toBe("/yonetim/giris");
  });
});

const confirmation = { receivedCents: "620000", confirmedAt: "2026-09-14T15:00:00.000Z", entryVersion: 4, actor: null };

describe("parseWorkEntryDetail (teslim onayı)", () => {
  it("onay null ya da geçerli { receivedCents, confirmedAt, entryVersion } olabilir", () => {
    expect(parseWorkEntryDetail(serverEntry())?.confirmation).toBeNull();
    expect(parseWorkEntryDetail(serverEntry({ status: "confirmed", confirmation }))?.confirmation).toEqual(confirmation);
  });

  it("onaylayan: araç credential'ı ve ekip kullanıcı adı korunur", () => {
    const parse = (actor: unknown) =>
      parseWorkEntryDetail({ ...serverEntry({ status: "confirmed" }), confirmation: { ...confirmation, actor } })?.confirmation;
    expect(parse({ kind: "vehicle_credential" })?.actor).toEqual({ kind: "vehicle_credential" });
    expect(parse({ kind: "platform_user", username: "destek1", role: "support" })?.actor).toEqual({
      kind: "platform_user",
      username: "destek1",
    });
  });

  it("onaylayan eksik/bilinmeyen/bozuksa kayıt reddedilmez; iz satırı için actor null olur", () => {
    const { actor: _omit, ...withoutActor } = confirmation;
    const missing = parseWorkEntryDetail({ ...serverEntry({ status: "confirmed" }), confirmation: withoutActor });
    expect(missing?.confirmation).toEqual({ ...withoutActor, actor: null });
    for (const bad of [null, "x", [], {}, { kind: "robot" }, { kind: "platform_user" }, { kind: "platform_user", username: "" }, { kind: "platform_user", username: 5 }]) {
      const parsed = parseWorkEntryDetail({ ...serverEntry({ status: "confirmed" }), confirmation: { ...confirmation, actor: bad } });
      expect(parsed).not.toBeNull();
      expect(parsed?.confirmation?.actor).toBeNull();
    }
  });

  it("alanı olmayan, başka türde ya da bozuk onay kaydı bozuk sayar", () => {
    const { confirmation: _omit, ...withoutField } = serverEntry();
    expect(parseWorkEntryDetail(withoutField)).toBeNull();
    for (const bad of [
      "x",
      [],
      { ...confirmation, receivedCents: "-1" },
      { ...confirmation, receivedCents: 620000 },
      { ...confirmation, confirmedAt: 5 },
      { ...confirmation, entryVersion: 1.5 },
      { receivedCents: "1", confirmedAt: "x" },
    ]) {
      expect(parseWorkEntryDetail({ ...serverEntry(), confirmation: bad })).toBeNull();
    }
  });

  it("gider hasılatı aşınca eksi kalan okunur (K5); diğer tutarlar eksi olamaz", () => {
    expect(parseWorkEntryDetail(serverEntry({ remainderCents: "-40000" }))?.remainderCents).toBe("-40000");
    expect(parseWorkEntryDetail(serverEntry({ remainderCents: "-0" }))).toBeNull();
    expect(parseWorkEntryDetail(serverEntry({ remainderCents: "-x" }))).toBeNull();
    expect(parseWorkEntryDetail(serverEntry({ shareCents: "-1" }))).toBeNull();
  });
});

describe("receivedPrefill", () => {
  it("bekleyen şoför kaydında beklenen teslimle dolar", () => {
    expect(receivedPrefill(serverEntry({ remainderCents: "620000" }))).toBe("6.200,00");
    expect(receivedPrefill(serverEntry({ remainderCents: "0" }))).toBe("0,00");
  });

  it("eksi beklenen, sahip kaydı ve onaylı/gerekmeyen kayıt için boş kalır", () => {
    expect(receivedPrefill(serverEntry({ remainderCents: "-40000" }))).toBe("");
    expect(receivedPrefill(serverEntry({ workKind: "owner", status: "not_required" }))).toBe("");
    expect(receivedPrefill(serverEntry({ status: "confirmed", confirmation }))).toBe("");
  });

  it("ön dolum geri okunabilir metindir (parseTlAmount ile aynı kuruş)", () => {
    expect(buildWorkEntryConfirmBody({ requestId: "r", version: 1, receivedText: receivedPrefill(serverEntry()) })).toEqual({
      ok: true,
      body: { requestId: "r", version: 1, receivedCents: "649950" },
    });
  });
});

describe("frozenReceivedText", () => {
  it("dondurulmuş gövdedeki tutarı alan metnine çevirir", () => {
    expect(frozenReceivedText('{"requestId":"r","version":1,"receivedCents":"600000"}')).toBe("6.000,00");
    expect(frozenReceivedText('{"requestId":"r","version":1,"receivedCents":"0"}')).toBe("0,00");
  });

  it("gövde yok, bozuk ya da tutarı geçersizse null", () => {
    expect(frozenReceivedText(null)).toBeNull();
    expect(frozenReceivedText("not json")).toBeNull();
    expect(frozenReceivedText("null")).toBeNull();
    expect(frozenReceivedText('{"receivedCents":600000}')).toBeNull();
    expect(frozenReceivedText('{"receivedCents":"-1"}')).toBeNull();
  });
});

describe("receivedDifference", () => {
  it("beklenenden az ya da fazla tutarı kuruş olarak verir", () => {
    expect(receivedDifference("620000", "6.000,00")).toEqual({ kind: "shortfall", cents: 20000n });
    expect(receivedDifference("620000", "6.250")).toEqual({ kind: "excess", cents: 5000n });
  });

  it("eşit, geçersiz ya da boş giriş fark göstermez; eksi beklenene göre de çalışır", () => {
    expect(receivedDifference("620000", "6.200,00")).toBeNull();
    expect(receivedDifference("620000", "")).toBeNull();
    expect(receivedDifference("620000", "6.2")).toBeNull();
    expect(receivedDifference("-40000", "0")).toEqual({ kind: "excess", cents: 40000n });
  });
});

describe("buildWorkEntryConfirmBody", () => {
  it("receivedCents her zaman açık ondalık tam sayı metnidir; anahtarlar sabit sırada", () => {
    const built = buildWorkEntryConfirmBody({ requestId: "r-1", version: 3, receivedText: "6.200,00" });
    expect(built).toEqual({ ok: true, body: { requestId: "r-1", version: 3, receivedCents: "620000" } });
    expect(JSON.stringify(built.ok && built.body)).toBe('{"requestId":"r-1","version":3,"receivedCents":"620000"}');
    expect(buildWorkEntryConfirmBody({ requestId: "r", version: 1, receivedText: "0" })).toMatchObject({
      ok: true,
      body: { receivedCents: "0" },
    });
  });

  it("boş, eksi ve bozuk tutar istek kurmadan alan hatası verir", () => {
    for (const receivedText of ["", "  ", "-5", "1.5", "abc", "1,234"]) {
      const built = buildWorkEntryConfirmBody({ requestId: "r", version: 1, receivedText });
      expect(built.ok).toBe(false);
      expect(!built.ok && built.message.length).toBeGreaterThan(0);
    }
  });
});

describe("classifyWorkEntryConfirmResponse", () => {
  const confirmedEntry = serverEntry({ status: "confirmed", version: 4, confirmation });

  it("yalnız onaylı durum + dolu onay taşıyan 200 başarıdır", () => {
    expect(classifyWorkEntryConfirmResponse({ status: 200, body: { workEntry: confirmedEntry } })).toEqual({
      kind: "confirmed",
      entry: confirmedEntry,
    });
  });

  it("onaysız/bekleyen/bozuk 200, ağ hatası, okunamayan gövde ve 5xx belirsizdir", () => {
    expect(classifyWorkEntryConfirmResponse({ status: 200, body: { workEntry: serverEntry() } })).toEqual({ kind: "ambiguous" });
    expect(
      classifyWorkEntryConfirmResponse({ status: 200, body: { workEntry: { ...confirmedEntry, confirmation: null } } }),
    ).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryConfirmResponse({ status: 200, body: { workEntry: { id: "x" } } })).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryConfirmResponse(null)).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryConfirmResponse({ status: 200, body: undefined })).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryConfirmResponse({ status: 503, body: {} })).toEqual({ kind: "ambiguous" });
  });

  it("kesin hata durum, kod ve alan metinlerini taşır", () => {
    expect(
      classifyWorkEntryConfirmResponse({
        status: 422,
        body: { error: { code: "VALIDATION_ERROR", fields: { receivedCents: "Tutarı gir. Yoksa 0 yaz." } } },
      }),
    ).toEqual({
      kind: "error",
      status: 422,
      code: "VALIDATION_ERROR",
      fields: { receivedCents: "Tutarı gir. Yoksa 0 yaz." },
    });
    expect(classifyWorkEntryConfirmResponse({ status: 409, body: { error: { code: "VERSION_CONFLICT" } } })).toMatchObject({
      kind: "error",
      status: 409,
      code: "VERSION_CONFLICT",
    });
  });
});

describe("shouldReleaseAfterConfirmError / confirmErrorNeedsReread", () => {
  it("ilk denemede her kesin hata bırakır", () => {
    for (const status of [401, 403, 404, 409, 422]) {
      expect(shouldReleaseAfterConfirmError({ status }, false)).toBe(true);
    }
  });

  it("daha önce ulaşmış olabilecek denemeden sonra yalnız yazılmadığı kanıtlanan hatalar bırakır", () => {
    expect(shouldReleaseAfterConfirmError({ status: 422, code: "CONFIRMATION_NOT_REQUIRED" }, true)).toBe(true);
    expect(shouldReleaseAfterConfirmError({ status: 409, code: "VERSION_CONFLICT" }, true)).toBe(true);
    expect(shouldReleaseAfterConfirmError({ status: 409, code: "ENTRY_CONFIRMED" }, true)).toBe(true);
    for (const status of [401, 403, 404]) {
      expect(shouldReleaseAfterConfirmError({ status }, true)).toBe(false);
    }
  });

  it("yalnız sürüm çakışması ve onaylı kayıt güncel kaydı yeniden okutur", () => {
    expect(confirmErrorNeedsReread({ status: 409, code: "VERSION_CONFLICT" })).toBe(true);
    expect(confirmErrorNeedsReread({ status: 409, code: "ENTRY_CONFIRMED" })).toBe(true);
    expect(confirmErrorNeedsReread({ status: 422, code: "VALIDATION_ERROR" })).toBe(false);
  });
});

describe("onay taslağı", () => {
  it("adı düzenleme taslağı önekiyle başlar (kapsam/çıkış süpürmesi siler) ve düzenleme taslağından ayrıdır", () => {
    const name = workEntryConfirmDraftName("v1", "e1");
    expect(name.startsWith(workEntryEditDraftPrefix("v1"))).toBe(true);
    expect(name).not.toBe(workEntryEditDraftName("v1", "e1"));
    expect(name).not.toBe(workEntryConfirmDraftName("v2", "e1"));
  });

  it("boş taslak dokunulmamıştır; bırakma yeni requestId verir, yazılan tutarı korur, dondurulmuş gövdeyi siler", () => {
    expect(emptyConfirmDraft(() => "r0")).toEqual({
      requestId: "r0",
      touched: false,
      receivedText: "",
      pending: false,
      frozenBody: null,
      attemptSent: false,
    });
    const pending = {
      ...emptyConfirmDraft(() => "old"),
      touched: true,
      receivedText: "6.000,00",
      pending: true,
      frozenBody: '{"requestId":"old"}',
      attemptSent: true,
    };
    expect(releaseConfirmDraft(pending, () => "new")).toEqual({
      requestId: "new",
      touched: true,
      receivedText: "6.000,00",
      pending: false,
      frozenBody: null,
      attemptSent: false,
    });
  });
});

describe("onaylı kaydı düzelt ve onayla (T4.3) — taslak", () => {
  // Onaylı kayıt: alınan 6.000,00, hasılat sonrası beklenen (kalan) 6.499,50 — ikisi FARKLI.
  const confirmed = serverEntry({
    status: "confirmed",
    version: 4,
    confirmation: { receivedCents: "600000", confirmedAt: "2026-09-14T15:00:00.000Z", entryVersion: 4, actor: null },
  });

  it("adı düzenleme önekiyle başlar; düzenleme ve onay taslaklarından ayrıdır", () => {
    const name = workEntryCorrectDraftName("v1", "e1");
    expect(name.startsWith(workEntryEditDraftPrefix("v1"))).toBe(true);
    expect(name).not.toBe(workEntryEditDraftName("v1", "e1"));
    expect(name).not.toBe(workEntryConfirmDraftName("v1", "e1"));
    expect(name).not.toBe(workEntryCorrectDraftName("v2", "e1"));
  });

  it("alınan tutar güncel onayın tutarıdır, beklenen (kalan) tutar DEĞİL; sürüme bağlanır", () => {
    const draft = correctDraftFromEntry(confirmed, () => "r0");
    expect(draft.receivedText).toBe("6.000,00");
    expect(draft.receivedText).not.toBe(receivedPrefill({ ...confirmed, status: "pending" }));
    expect(draft).toMatchObject({ requestId: "r0", baseVersion: 4, pending: false, frozenBody: null, attemptSent: false });
    expect(draft.grossText).toBe("10.000,00");
  });

  it("hasılat değişse de alınan tutar aynı kalır; yalnız hasılat değişimi ve yalnız alınan değişimi kirlidir", () => {
    const clean = correctDraftFromEntry(confirmed, () => "r");
    expect(isCorrectDraftDirty(clean, confirmed)).toBe(false);
    const grossChanged = { ...clean, grossText: "12.000" };
    expect(grossChanged.receivedText).toBe("6.000,00");
    expect(isCorrectDraftDirty(grossChanged, confirmed)).toBe(true);
    expect(buildWorkEntryCorrectBody(grossChanged)).toMatchObject({ grossCents: "1200000", receivedCents: "600000" });
    expect(isCorrectDraftDirty({ ...clean, receivedText: "6.100" }, confirmed)).toBe(true);
    expect(isCorrectDraftDirty({ ...clean, receivedText: " 6.000,00 " }, confirmed)).toBe(false);
  });

  it("onay bilgisi yoksa alınan alan boştur; bekleyen gönderim her zaman kirlidir", () => {
    expect(correctDraftFromEntry(serverEntry(), () => "r").receivedText).toBe("");
    const pending = { ...correctDraftFromEntry(confirmed, () => "r"), pending: true, frozenBody: "{}" };
    expect(isCorrectDraftDirty(pending, confirmed)).toBe(true);
  });

  it("bırakma yeni requestId verir, alanları korur, dondurulmuş gövdeyi siler; rebase ayrıca sürümü günceller", () => {
    const pending = {
      ...correctDraftFromEntry(confirmed, () => "old"),
      receivedText: "6.100",
      pending: true,
      frozenBody: '{"requestId":"old"}',
      attemptSent: true,
    };
    expect(releaseCorrectDraft(pending, () => "new")).toMatchObject({
      requestId: "new",
      receivedText: "6.100",
      pending: false,
      frozenBody: null,
      attemptSent: false,
      baseVersion: 4,
    });
    expect(rebaseCorrectDraft(pending, 5, () => "n2")).toMatchObject({ requestId: "n2", baseVersion: 5, receivedText: "6.100" });
  });
});

describe("buildWorkEntryCorrectBody", () => {
  const confirmed = serverEntry({
    status: "confirmed",
    version: 4,
    confirmation: { receivedCents: "600000", confirmedAt: "2026-09-14T15:00:00.000Z", entryVersion: 4, actor: null },
  });

  it("günlük alanlar + açık receivedCents; yalnız tutar 6.100 olunca gövde tam bu alanları taşır", () => {
    const draft = { ...correctDraftFromEntry(confirmed, () => "r-1"), receivedText: "6.100" };
    const body = buildWorkEntryCorrectBody(draft);
    expect(body).toEqual({
      requestId: "r-1",
      version: 4,
      workerPersonId: "p-1",
      date: "2026-09-14",
      startTime: "08:00",
      endTime: "17:30",
      endsNextDay: false,
      grossCents: "1000000",
      fuelCents: "150050",
      receivedCents: "610000",
    });
    expect(Object.keys(body!)).not.toEqual(expect.arrayContaining(["workType", "status", "shareCents", "businessId"]));
  });

  it("kullanılan diğer masraf ve not gövdeye girer", () => {
    const draft = {
      ...correctDraftFromEntry(confirmed, () => "r"),
      expenseOpen: true,
      otherText: "300",
      otherNote: " lastik ",
    };
    expect(buildWorkEntryCorrectBody(draft)).toMatchObject({ otherExpenseCents: "30000", otherExpenseNote: "lastik" });
  });

  it("geçersiz alınan tutar ya da geçersiz hasılat istek kurmaz", () => {
    const clean = correctDraftFromEntry(confirmed, () => "r");
    for (const receivedText of ["", "-5", "abc", "1,234"]) {
      expect(buildWorkEntryCorrectBody({ ...clean, receivedText })).toBeNull();
    }
    expect(buildWorkEntryCorrectBody({ ...clean, grossText: "x" })).toBeNull();
  });
});

describe("classifyWorkEntryCorrectResponse", () => {
  const corrected = serverEntry({
    status: "confirmed",
    version: 5,
    confirmation: { receivedCents: "610000", confirmedAt: "2026-09-14T16:00:00.000Z", entryVersion: 5, actor: null },
  });

  it("yalnız onaylı, onayı GÜNCEL sürüme ait 200 başarıdır", () => {
    expect(classifyWorkEntryCorrectResponse({ status: 200, body: { workEntry: corrected } })).toEqual({
      kind: "corrected",
      entry: corrected,
    });
  });

  it("eski sürümün onayını taşıyan, onaysız, bekleyen ve bozuk 200 ile ağ/5xx belirsizdir", () => {
    const staleConfirmation = { ...corrected, confirmation: { ...corrected.confirmation!, entryVersion: 4 } };
    expect(classifyWorkEntryCorrectResponse({ status: 200, body: { workEntry: staleConfirmation } })).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryCorrectResponse({ status: 200, body: { workEntry: { ...corrected, confirmation: null } } })).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryCorrectResponse({ status: 200, body: { workEntry: { ...corrected, status: "pending" } } })).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryCorrectResponse({ status: 200, body: { workEntry: { id: "x" } } })).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryCorrectResponse(null)).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryCorrectResponse({ status: 200, body: undefined })).toEqual({ kind: "ambiguous" });
    expect(classifyWorkEntryCorrectResponse({ status: 502, body: {} })).toEqual({ kind: "ambiguous" });
  });

  it("kesin hata durum, kod ve alan metinlerini taşır", () => {
    expect(
      classifyWorkEntryCorrectResponse({
        status: 422,
        body: { error: { code: "VALIDATION_ERROR", fields: { change: "Değişiklik yok.", receivedCents: "Tutarı gir.", x: 1 } } },
      }),
    ).toEqual({
      kind: "error",
      status: 422,
      code: "VALIDATION_ERROR",
      fields: { change: "Değişiklik yok.", receivedCents: "Tutarı gir." },
    });
    expect(classifyWorkEntryCorrectResponse({ status: 409, body: { error: { code: "VERSION_CONFLICT" } } })).toMatchObject({
      kind: "error",
      status: 409,
      code: "VERSION_CONFLICT",
    });
  });
});

describe("shouldReleaseAfterCorrectError / correctErrorNeedsReread", () => {
  it("ilk denemede her kesin hata bırakır", () => {
    for (const status of [401, 403, 404, 409, 422]) {
      expect(shouldReleaseAfterCorrectError({ status }, false)).toBe(true);
    }
  });

  it("daha önce ulaşmış olabilecek denemeden sonra yalnız yazılmadığı kanıtlanan hatalar bırakır", () => {
    expect(shouldReleaseAfterCorrectError({ status: 422 }, true)).toBe(true);
    expect(shouldReleaseAfterCorrectError({ status: 409, code: "VERSION_CONFLICT" }, true)).toBe(true);
    expect(shouldReleaseAfterCorrectError({ status: 409, code: "ENTRY_NOT_CONFIRMED" }, true)).toBe(true);
    expect(shouldReleaseAfterCorrectError({ status: 409, code: "REQUEST_ID_REUSED" }, true)).toBe(true);
    for (const status of [401, 403, 404]) {
      expect(shouldReleaseAfterCorrectError({ status }, true)).toBe(false);
    }
  });

  it("yalnız sürüm çakışması ve onaysız kayıt güncel kaydı yeniden okutur", () => {
    expect(correctErrorNeedsReread({ status: 409, code: "VERSION_CONFLICT" })).toBe(true);
    expect(correctErrorNeedsReread({ status: 409, code: "ENTRY_NOT_CONFIRMED" })).toBe(true);
    expect(correctErrorNeedsReread({ status: 422, code: "VALIDATION_ERROR" })).toBe(false);
    expect(correctErrorNeedsReread({ status: 409, code: "REQUEST_ID_REUSED" })).toBe(false);
  });
});
