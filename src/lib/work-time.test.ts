import { describe, expect, it } from "vitest";
import { WORK_ENTRY_MESSAGES as TEXT } from "./messages";
import {
  addDays,
  evaluateWorkTime,
  formatDuration,
  formatWorkDate,
  istanbulToday,
} from "./work-time";

const base = { date: "2026-09-14", startTime: "08:00", endTime: "17:30", endsNextDay: false };

describe("istanbulToday", () => {
  it("00:00-03:00 İstanbul'da UTC günü dünkü olsa da İstanbul gününü verir", () => {
    // 2026-09-13T22:30Z = 14 Eylül 01:30 İstanbul
    expect(istanbulToday(new Date("2026-09-13T22:30:00Z"))).toBe("2026-09-14");
  });

  it("İstanbul gün sınırında: 20:59Z hâlâ aynı gün, 21:00Z ertesi gün", () => {
    expect(istanbulToday(new Date("2026-09-13T20:59:00Z"))).toBe("2026-09-13");
    expect(istanbulToday(new Date("2026-09-13T21:00:00Z"))).toBe("2026-09-14");
  });
});

describe("addDays", () => {
  it("ay ve yıl sınırını geçer", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("evaluateWorkTime", () => {
  it("08:00-17:30 aynı gün 570 dakika, UTC anları İstanbul (+03) saatine göre", () => {
    const result = evaluateWorkTime(base);
    expect(result).toEqual({
      ok: true,
      workDate: "2026-09-14",
      startsAt: "2026-09-14T05:00:00.000Z",
      endsAt: "2026-09-14T14:30:00.000Z",
      durationMinutes: 570,
      endDate: "2026-09-14",
    });
  });

  it("00:30 başlangıcı UTC'de önceki güne düşse de workDate başlangıç gününde kalır", () => {
    const result = evaluateWorkTime({ ...base, startTime: "00:30", endTime: "02:00" });
    expect(result).toMatchObject({
      ok: true,
      workDate: "2026-09-14",
      startsAt: "2026-09-13T21:30:00.000Z",
      durationMinutes: 90,
    });
  });

  it("22:00-06:00 açık ertesi gün 8 saat, workDate başlangıç günü", () => {
    const result = evaluateWorkTime({
      date: "2026-09-14",
      startTime: "22:00",
      endTime: "06:00",
      endsNextDay: true,
    });
    expect(result).toMatchObject({
      ok: true,
      workDate: "2026-09-14",
      endDate: "2026-09-15",
      durationMinutes: 480,
      startsAt: "2026-09-14T19:00:00.000Z",
      endsAt: "2026-09-15T03:00:00.000Z",
    });
  });

  it("aynı gün eşit saat reddedilir (24 saat sayılmaz)", () => {
    expect(evaluateWorkTime({ ...base, startTime: "08:00", endTime: "08:00" })).toEqual({
      ok: false,
      errors: { endTime: TEXT.timesEqual },
    });
  });

  it("aynı gün bitiş < başlangıç ertesi gün sayılmaz, hata verir", () => {
    expect(evaluateWorkTime({ ...base, startTime: "22:00", endTime: "06:00" })).toEqual({
      ok: false,
      errors: { endTime: TEXT.endBeforeStart },
    });
  });

  it("ertesi gün + eşit saat tam 1440 dakikadır ve geçerlidir", () => {
    const result = evaluateWorkTime({ ...base, endTime: "08:00", endsNextDay: true });
    expect(result).toMatchObject({ ok: true, durationMinutes: 1440 });
  });

  it("1440 dakikayı aşan süre reddedilir", () => {
    expect(evaluateWorkTime({ ...base, endTime: "08:01", endsNextDay: true })).toEqual({
      ok: false,
      errors: { endTime: TEXT.durationTooLong },
    });
  });

  it("gece yarısını aşan 1 dakikalık süre (23:59 → ertesi gün 00:00) geçerlidir", () => {
    const result = evaluateWorkTime({
      date: "2026-09-14",
      startTime: "23:59",
      endTime: "00:00",
      endsNextDay: true,
    });
    expect(result).toMatchObject({ ok: true, durationMinutes: 1 });
  });

  it("eksik/geçersiz alanlar yalnız kendi hatasını alır", () => {
    expect(evaluateWorkTime({ date: "", startTime: "", endTime: "17:30", endsNextDay: false })).toEqual({
      ok: false,
      errors: { date: TEXT.dateInvalid, startTime: TEXT.startRequired },
    });
    expect(evaluateWorkTime({ ...base, endTime: "" })).toEqual({
      ok: false,
      errors: { endTime: TEXT.endRequired },
    });
  });

  it("olmayan takvim günü ve biçim dışı değerler geçersizdir", () => {
    for (const date of ["2026-02-30", "2026-13-01", "26-09-14", "0001-01-01", "2026-9-4"]) {
      expect(evaluateWorkTime({ ...base, date })).toEqual({
        ok: false,
        errors: { date: TEXT.dateInvalid },
      });
    }
    expect(evaluateWorkTime({ ...base, startTime: "24:00" })).toMatchObject({ ok: false });
    expect(evaluateWorkTime({ ...base, endTime: "9:5" })).toMatchObject({ ok: false });
  });
});

describe("formatWorkDate", () => {
  it("gün Ay yıl biçimi verir", () => {
    expect(formatWorkDate("2026-09-14")).toBe("14 Eylül 2026");
    expect(formatWorkDate("2026-01-05")).toBe("5 Ocak 2026");
  });

  it("geçersiz tarih için boş dize döner", () => {
    expect(formatWorkDate("")).toBe("");
    expect(formatWorkDate("2026-02-30")).toBe("");
  });
});

describe("formatDuration", () => {
  it("saat ve dakikayı Türkçe yazar", () => {
    expect(formatDuration(570)).toBe("9 saat 30 dakika");
    expect(formatDuration(480)).toBe("8 saat");
    expect(formatDuration(45)).toBe("45 dakika");
    expect(formatDuration(1440)).toBe("24 saat");
  });
});
