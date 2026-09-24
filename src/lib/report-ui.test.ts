import { describe, expect, it } from "vitest";
import {
  buildVehiclePeriodReportUrl,
  formatReportPeriodRange,
  parseVehiclePeriodReport,
  vehiclePeriodReportView,
} from "./report-ui";

const baseReport = () => ({
  period: { kind: "month", startDate: "2026-09-01", nextStartDate: "2026-10-01" },
  entryCount: 2,
  workDays: 1,
  durationMinutes: 1140,
  grossCents: "2000000",
  fuelCents: "300000",
  otherExpenseCents: "60000",
  shareCents: "200000",
  remainderCents: "1440000",
  confirmedReceivedCents: "620000",
});

const parse = (override: Record<string, unknown> = {}) => parseVehiclePeriodReport({ report: { ...baseReport(), ...override } });

describe("formatReportPeriodRange", () => {
  it("ay: aynı ay içinde kısa aralık", () => {
    expect(formatReportPeriodRange({ startDate: "2026-09-01", nextStartDate: "2026-10-01" })).toBe("1–30 Eylül 2026");
  });

  it("hafta: ay sınırını aşarsa iki ay adı", () => {
    expect(formatReportPeriodRange({ startDate: "2026-09-28", nextStartDate: "2026-10-05" })).toBe("28 Eylül – 4 Ekim 2026");
  });

  it("hafta: yıl sınırını aşarsa iki yıl", () => {
    expect(formatReportPeriodRange({ startDate: "2025-12-29", nextStartDate: "2026-01-05" })).toBe(
      "29 Aralık 2025 – 4 Ocak 2026",
    );
  });

  it("yıl: 1 Ocak – 31 Aralık", () => {
    expect(formatReportPeriodRange({ startDate: "2026-01-01", nextStartDate: "2027-01-01" })).toBe("1 Ocak – 31 Aralık 2026");
  });

  it("artık yıl Şubat'ı 29'a kadar gider", () => {
    expect(formatReportPeriodRange({ startDate: "2028-02-01", nextStartDate: "2028-03-01" })).toBe("1–29 Şubat 2028");
  });
});

describe("parseVehiclePeriodReport", () => {
  it("geçerli gövdeyi BigInt kuruşlarla okur", () => {
    expect(parse()).toEqual({
      period: { kind: "month", startDate: "2026-09-01", nextStartDate: "2026-10-01" },
      entryCount: 2,
      workDays: 1,
      durationMinutes: 1140,
      grossCents: 2000000n,
      fuelCents: 300000n,
      otherExpenseCents: 60000n,
      shareCents: 200000n,
      remainderCents: 1440000n,
      confirmedReceivedCents: 620000n,
    });
  });

  it("2^53 üstü toplamı kesin okur", () => {
    expect(parse({ grossCents: "9007199254740993" })?.grossCents).toBe(9007199254740993n);
  });

  it("yalnız kalan eksi olabilir", () => {
    expect(parse({ remainderCents: "-40000" })?.remainderCents).toBe(-40000n);
    expect(parse({ grossCents: "-1" })).toBeNull();
    expect(parse({ confirmedReceivedCents: "-1" })).toBeNull();
  });

  it("bozuk biçimlerde null döner", () => {
    expect(parseVehiclePeriodReport(null)).toBeNull();
    expect(parseVehiclePeriodReport({})).toBeNull();
    expect(parseVehiclePeriodReport({ report: "x" })).toBeNull();
    expect(parse({ grossCents: 2000000 })).toBeNull();
    expect(parse({ grossCents: "1.5" })).toBeNull();
    expect(parse({ remainderCents: "-0" })).toBeNull();
    expect(parse({ entryCount: -1 })).toBeNull();
    expect(parse({ workDays: 1.5 })).toBeNull();
    expect(parse({ durationMinutes: "60" })).toBeNull();
    expect(parse({ period: { kind: "decade", startDate: "2026-09-01", nextStartDate: "2026-10-01" } })).toBeNull();
    expect(parse({ period: { kind: "month", startDate: "2026-13-01", nextStartDate: "2026-10-01" } })).toBeNull();
    expect(parse({ period: { kind: "month", startDate: "2026-10-01", nextStartDate: "2026-09-01" } })).toBeNull();
    expect(parse({ period: null })).toBeNull();
  });
});

describe("vehiclePeriodReportView", () => {
  it("S5.2 verisi: kalan, alınan, döküm, süre ve gün", () => {
    const view = vehiclePeriodReportView(parse({ grossCents: "2000000" })!);
    expect(view.rangeText).toBe("1–30 Eylül 2026");
    expect(view.isEmpty).toBe(false);
    expect(view.remainder).toBe("14.400,00 TL");
    expect(view.received).toBe("6.200,00 TL");
    expect(view.breakdown).toEqual([
      { label: "Hasılat", value: "20.000,00 TL" },
      { label: "Mazot", value: "3.000,00 TL" },
      { label: "Diğer masraf", value: "600,00 TL" },
      { label: "Şoför payı", value: "2.000,00 TL" },
      { label: "Toplam süre", value: "19 saat" },
      { label: "Çalışılan gün", value: "1 gün" },
      { label: "Kayıt sayısı", value: "2" },
    ]);
  });

  it("gezinme çapaları sunucu dönemindendir: önceki = başlangıcın önceki günü, sonraki = nextStartDate", () => {
    const view = vehiclePeriodReportView(parse()!);
    expect(view.previousDate).toBe("2026-08-31");
    expect(view.nextDate).toBe("2026-10-01");
    const week = vehiclePeriodReportView(
      parse({ period: { kind: "week", startDate: "2026-01-05", nextStartDate: "2026-01-12" } })!,
    );
    expect(week.previousDate).toBe("2026-01-04");
    expect(week.nextDate).toBe("2026-01-12");
  });

  it("eksi kalan eksi işaretiyle gösterilir", () => {
    expect(vehiclePeriodReportView(parse({ remainderCents: "-40000" })!).remainder).toBe("-400,00 TL");
  });

  it("2^53 kuruş üstü toplam kesin biçimlenir", () => {
    const view = vehiclePeriodReportView(parse({ grossCents: "9007199254740993" })!);
    expect(view.breakdown[0]).toEqual({ label: "Hasılat", value: "90.071.992.547.409,93 TL" });
  });

  it("kayıt yoksa boş döner; yasak sözcükler metinde yok", () => {
    const view = vehiclePeriodReportView(
      parse({ entryCount: 0, workDays: 0, durationMinutes: 0, grossCents: "0", fuelCents: "0", otherExpenseCents: "0", shareCents: "0", remainderCents: "0", confirmedReceivedCents: "0" })!,
    );
    expect(view.isEmpty).toBe(true);
    expect(view.remainder).toBe("0,00 TL");
    const text = JSON.stringify(view).toLocaleLowerCase("tr");
    for (const word of ["net kâr", "bakiye", "kasa"]) expect(text).not.toContain(word);
  });
});

describe("buildVehiclePeriodReportUrl", () => {
  it("date yoksa yalnız period gönderir", () => {
    expect(buildVehiclePeriodReportUrl("month", undefined)).toBe("/api/v1/reports/vehicles?period=month");
  });

  it("date varsa ekler", () => {
    expect(buildVehiclePeriodReportUrl("week", "2026-08-31")).toBe("/api/v1/reports/vehicles?period=week&date=2026-08-31");
  });
});
