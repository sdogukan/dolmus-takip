import { describe, expect, it } from "vitest";
import {
  buildWorkEntriesUrl,
  buildWorkEntryBody,
  buildWorkEntryPatchBody,
  canEditEntry,
  classifyWorkEntryResponse,
  classifyWorkEntryUpdateResponse,
  editDraftFromEntry,
  editPersonOptions,
  emptyWorkEntryDraft,
  hasEarlierAttempt,
  isEditDraftDirty,
  isWorkEntryDraftDirty,
  parseWorkEntryDetail,
  parseWorkEntryList,
  rebaseEditDraft,
  releaseEditDraft,
  selectableFromDriversResponse,
  shouldReleaseAfterError,
  shouldReleaseAfterUpdateError,
  updateErrorNeedsReread,
  workEntryDetailHref,
  workEntryDraftName,
  workEntryEditDraftName,
  workEntryEditDraftPrefix,
  workEntryErrorMessage,
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
