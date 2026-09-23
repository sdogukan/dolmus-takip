import { describe, expect, it } from "vitest";
import { WORK_ENTRY_MESSAGES as TEXT } from "../../../lib/messages";
import { ForbiddenClientScopeFieldError, scopeSafeObject } from "../../auth/scope";
import { computeWorkEntryFigures, workEntryInputSchema } from "./index";

const body = {
  date: "2026-09-14",
  startTime: "08:00",
  endTime: "17:30",
  endsNextDay: false,
  grossCents: "1000000",
  fuelCents: "150000",
  otherExpenseCents: "30000",
  otherExpenseNote: "  Otopark  ",
};

function fieldsOf(input: unknown, kind: "driver" | "owner" = "driver"): Record<string, string> {
  const result = computeWorkEntryFigures(kind, input);
  if (result.ok) throw new Error("hata bekleniyordu");
  return result.fields;
}

describe("computeWorkEntryFigures", () => {
  it("şoför: süre, pay ve kalanı sunucuda türetir", () => {
    const result = computeWorkEntryFigures("driver", body);
    expect(result).toEqual({
      ok: true,
      figures: {
        workDate: "2026-09-14",
        startsAt: "2026-09-14T05:00:00.000Z",
        endsAt: "2026-09-14T14:30:00.000Z",
        durationMinutes: 570,
        grossCents: 1000000,
        fuelCents: 150000,
        otherExpenseCents: 30000,
        otherExpenseNote: "Otopark",
        shareBps: 2000,
        shareCents: 200000,
        remainderCents: 620000,
        calculationVersion: 1,
      },
    });
  });

  it("sahip: pay 0, kalan 820000", () => {
    const result = computeWorkEntryFigures("owner", body);
    expect(result.ok && result.figures).toMatchObject({
      shareBps: 0,
      shareCents: 0,
      remainderCents: 820000,
    });
  });

  it("gövdedeki shareCents/remainderCents/shareBps/workKind/calculationVersion yok sayılır", () => {
    const result = computeWorkEntryFigures("driver", {
      ...body,
      shareCents: "0",
      remainderCents: "999999999",
      shareBps: 0,
      workKind: "owner",
      calculationVersion: 99,
      durationMinutes: 1,
    });
    expect(result.ok && result.figures).toMatchObject({
      shareBps: 2000,
      shareCents: 200000,
      remainderCents: 620000,
      calculationVersion: 1,
      durationMinutes: 570,
    });
  });

  it("eksi kalan olduğu gibi döner", () => {
    const result = computeWorkEntryFigures("driver", {
      ...body,
      fuelCents: "900000",
      otherExpenseCents: "0",
      otherExpenseNote: null,
    });
    expect(result.ok && result.figures.remainderCents).toBe(-100000);
  });

  it("diğer gider kullanılmadıysa 0 ve not null olur", () => {
    for (const unused of [{}, { otherExpenseCents: "" }, { otherExpenseCents: "", otherExpenseNote: "  " }]) {
      const { otherExpenseCents: _a, otherExpenseNote: _b, ...rest } = body;
      const result = computeWorkEntryFigures("driver", { ...rest, ...unused });
      expect(result.ok && result.figures).toMatchObject({
        otherExpenseCents: 0,
        otherExpenseNote: null,
        remainderCents: 650000,
      });
    }
  });

  it("notlu ama tutarsız diğer gider tutar hatasıdır", () => {
    expect(fieldsOf({ ...body, otherExpenseCents: "" })).toEqual({
      otherExpenseCents: TEXT.moneyRequired,
    });
    expect(fieldsOf({ ...body, otherExpenseCents: undefined })).toEqual({
      otherExpenseCents: TEXT.moneyRequired,
    });
  });

  it("not 200 karaktere kadar kabul, üstü hata; kırpma sonrası ölçülür", () => {
    const ok = computeWorkEntryFigures("driver", { ...body, otherExpenseNote: ` ${"a".repeat(200)} ` });
    expect(ok.ok).toBe(true);
    expect(fieldsOf({ ...body, otherExpenseNote: "a".repeat(201) })).toEqual({
      otherExpenseNote: TEXT.otherExpenseNoteTooLong,
    });
    expect(fieldsOf({ ...body, otherExpenseNote: 5 })).toHaveProperty("otherExpenseNote");
  });

  it("hasılat ve yakıt zorunlu; boş 0 sayılmaz", () => {
    expect(fieldsOf({ ...body, grossCents: "" })).toEqual({ grossCents: TEXT.moneyRequired });
    expect(fieldsOf({ ...body, fuelCents: undefined })).toEqual({ fuelCents: TEXT.moneyRequired });
    const zero = computeWorkEntryFigures("driver", { ...body, grossCents: "0", fuelCents: "0" });
    expect(zero.ok && zero.figures.shareCents).toBe(0);
  });

  it("kuruş metni yalnız ^(0|[1-9][0-9]*)$ olabilir", () => {
    for (const bad of ["-5", "1.5", "1,5", "01", "abc", " 5", "1e3", 5, null]) {
      expect(fieldsOf({ ...body, grossCents: bad })).toHaveProperty("grossCents");
      expect(fieldsOf({ ...body, otherExpenseCents: bad === null ? 5 : bad })).toHaveProperty(
        "otherExpenseCents",
      );
    }
  });

  it("MAX_SAFE_INTEGER üstü tutar açıklamalı hata verir", () => {
    expect(fieldsOf({ ...body, grossCents: "9007199254740992" })).toEqual({
      grossCents: TEXT.moneyTooLarge,
    });
    expect(fieldsOf({ ...body, otherExpenseCents: "9007199254740992" })).toEqual({
      otherExpenseCents: TEXT.moneyTooLarge,
    });
  });

  it("gider + pay toplamı güvenli sınırı aşarsa hata verir", () => {
    expect(
      fieldsOf({
        ...body,
        grossCents: "0",
        fuelCents: "9007199254740991",
        otherExpenseCents: "1",
        otherExpenseNote: null,
      }),
    ).toEqual({ otherExpenseCents: TEXT.amountsTooLarge });
  });

  it("MAX_SAFE_INTEGER hasılat güvenli sayı olarak döner", () => {
    const result = computeWorkEntryFigures("driver", {
      ...body,
      grossCents: "9007199254740991",
      fuelCents: "0",
      otherExpenseCents: "0",
      otherExpenseNote: null,
    });
    expect(result.ok && Number.isSafeInteger(result.figures.remainderCents)).toBe(true);
  });

  it("saat kuralı hataları alan anahtarıyla döner", () => {
    expect(fieldsOf({ ...body, endTime: "08:00" })).toEqual({ endTime: TEXT.timesEqual });
    expect(fieldsOf({ ...body, endTime: "07:00" })).toEqual({ endTime: TEXT.endBeforeStart });
    expect(fieldsOf({ ...body, date: "2026-02-30" })).toEqual({ date: TEXT.dateInvalid });
    const overnight = computeWorkEntryFigures("driver", {
      ...body,
      startTime: "22:00",
      endTime: "02:00",
      endsNextDay: true,
    });
    expect(overnight.ok && overnight.figures.durationMinutes).toBe(240);
  });

  it("gövde nesne değilse genel hata verir", () => {
    for (const bad of [null, "x", 5, []]) {
      expect(Object.keys(fieldsOf(bad)).length).toBeGreaterThan(0);
    }
  });
});

describe("workEntryInputSchema", () => {
  it("kapsam alanı taşımaz (scopeSafeObject kuralı)", () => {
    expect(Object.keys(workEntryInputSchema.def.in.def.shape)).not.toContain("personId");
    expect(() => scopeSafeObject({ personId: workEntryInputSchema })).toThrow(
      ForbiddenClientScopeFieldError,
    );
  });
});
