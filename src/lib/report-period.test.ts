import { describe, expect, it } from "vitest";
import { isValidReportDate, resolveReportPeriod } from "./report-period";

describe("resolveReportPeriod", () => {
  it("hafta Pazartesi başlar: Pazar günü önceki Pazartesi'ye döner", () => {
    // 2026-09-20 Pazar
    expect(resolveReportPeriod("week", "2026-09-20")).toEqual({
      kind: "week",
      startDate: "2026-09-14",
      nextStartDate: "2026-09-21",
    });
  });

  it("Pazartesi kendi haftasının başlangıcıdır", () => {
    expect(resolveReportPeriod("week", "2026-09-14")).toMatchObject({ startDate: "2026-09-14", nextStartDate: "2026-09-21" });
  });

  it("hafta ay ve yıl sınırını aşar", () => {
    // 2026-01-01 Perşembe → 2025-12-29 Pazartesi
    expect(resolveReportPeriod("week", "2026-01-01")).toMatchObject({ startDate: "2025-12-29", nextStartDate: "2026-01-05" });
  });

  it("ay: aylık aralık yarı açıktır", () => {
    expect(resolveReportPeriod("month", "2026-09-15")).toEqual({
      kind: "month",
      startDate: "2026-09-01",
      nextStartDate: "2026-10-01",
    });
  });

  it("Aralık → Ocak devri", () => {
    expect(resolveReportPeriod("month", "2026-12-31")).toMatchObject({ startDate: "2026-12-01", nextStartDate: "2027-01-01" });
  });

  it("şubat artık yıl ve artık olmayan yılda", () => {
    expect(resolveReportPeriod("month", "2028-02-29")).toMatchObject({ startDate: "2028-02-01", nextStartDate: "2028-03-01" });
    expect(resolveReportPeriod("month", "2027-02-28")).toMatchObject({ startDate: "2027-02-01", nextStartDate: "2027-03-01" });
  });

  it("yıl", () => {
    expect(resolveReportPeriod("year", "2026-09-15")).toEqual({
      kind: "year",
      startDate: "2026-01-01",
      nextStartDate: "2027-01-01",
    });
  });

  it("geçersiz takvim günü null döner", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-9-1", "", "2026-09-15T00:00", "1999-01-01", "2027-02-29"]) {
      expect(resolveReportPeriod("month", bad)).toBeNull();
      expect(isValidReportDate(bad)).toBe(false);
    }
    expect(isValidReportDate("2028-02-29")).toBe(true);
  });
});
