import { describe, expect, it } from "vitest";
import {
  buildPeoplePeriodReportUrl,
  buildPersonPeriodReportUrl,
  buildVehiclePeriodReportUrl,
  formatReportPeriodRange,
  parsePeoplePeriodReport,
  parsePersonPeriodReport,
  parseVehiclePeriodReport,
  peoplePeriodReportView,
  personDetailView,
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
    expect(view.startDate).toBe("2026-09-01");
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

const PERIOD = { kind: "month", startDate: "2026-09-01", nextStartDate: "2026-10-01" };

const personTotals = (override: Record<string, unknown> = {}) => ({
  personId: "p1",
  fullName: "Ahmet Yılmaz",
  isOwner: false,
  entryCount: 1,
  workDays: 1,
  durationMinutes: 570,
  grossCents: "1000000",
  fuelCents: "150000",
  otherExpenseCents: "30000",
  shareCents: "200000",
  remainderCents: "620000",
  ...override,
});

const personEntry = (override: Record<string, unknown> = {}) => ({
  id: "e1",
  workDate: "2026-09-10",
  startsAt: "2026-09-10T05:00:00.000Z",
  endsAt: "2026-09-10T14:30:00.000Z",
  durationMinutes: 570,
  grossCents: "1000000",
  shareCents: "200000",
  remainderCents: "620000",
  status: "confirmed",
  ...override,
});

const parsePeople = (people: unknown[], period: unknown = PERIOD) => parsePeoplePeriodReport({ report: { period, people } });
const parsePerson = (override: Record<string, unknown> = {}) =>
  parsePersonPeriodReport({
    report: { period: PERIOD, person: personTotals(), entries: [personEntry()], nextCursor: null, ...override },
  });

describe("parsePeoplePeriodReport", () => {
  it("geçerli gövdeyi BigInt kuruşlarla okur; boş liste geçerlidir", () => {
    const data = parsePeople([personTotals(), personTotals({ personId: "p2", isOwner: true, shareCents: "0" })]);
    expect(data?.people).toHaveLength(2);
    expect(data?.people[0]).toMatchObject({ personId: "p1", grossCents: 1000000n, remainderCents: 620000n, isOwner: false });
    expect(data?.people[1]).toMatchObject({ isOwner: true, shareCents: 0n });
    expect(parsePeople([])?.people).toEqual([]);
  });

  it("2^53 üstü toplamı kesin okur; yalnız kalan eksi olabilir", () => {
    expect(parsePeople([personTotals({ grossCents: "9007199254740993" })])?.people[0]?.grossCents).toBe(9007199254740993n);
    expect(parsePeople([personTotals({ remainderCents: "-40000" })])?.people[0]?.remainderCents).toBe(-40000n);
    expect(parsePeople([personTotals({ grossCents: "-1" })])).toBeNull();
    expect(parsePeople([personTotals({ fuelCents: "-1" })])).toBeNull();
    expect(parsePeople([personTotals({ otherExpenseCents: "-1" })])).toBeNull();
    expect(parsePeople([personTotals({ shareCents: "-1" })])).toBeNull();
  });

  it("bozuk biçimlerde null döner (kısmi veri yok)", () => {
    expect(parsePeoplePeriodReport(null)).toBeNull();
    expect(parsePeoplePeriodReport({})).toBeNull();
    expect(parsePeoplePeriodReport({ report: { period: PERIOD } })).toBeNull();
    expect(parsePeoplePeriodReport({ report: { period: PERIOD, people: "x" } })).toBeNull();
    expect(parsePeople([personTotals()], null)).toBeNull();
    expect(parsePeople([personTotals(), personTotals({ personId: "" })])).toBeNull();
    expect(parsePeople([personTotals({ isOwner: 1 })])).toBeNull();
    expect(parsePeople([personTotals({ fullName: null })])).toBeNull();
    expect(parsePeople([personTotals({ grossCents: 1000000 })])).toBeNull();
    expect(parsePeople([personTotals({ workDays: 1.5 })])).toBeNull();
    expect(parsePeople([personTotals({ entryCount: -1 })])).toBeNull();
    expect(parsePeople([personTotals(), null])).toBeNull();
    expect(parsePeople([personTotals()], { kind: "month", startDate: "2026-10-01", nextStartDate: "2026-09-01" })).toBeNull();
  });
});

describe("parsePersonPeriodReport", () => {
  it("geçerli gövdeyi okur", () => {
    const data = parsePerson({ nextCursor: "abc" });
    expect(data?.person.fullName).toBe("Ahmet Yılmaz");
    expect(data?.entries[0]).toMatchObject({ id: "e1", grossCents: 1000000n, remainderCents: 620000n, status: "confirmed" });
    expect(data?.nextCursor).toBe("abc");
    expect(parsePerson()?.nextCursor).toBeNull();
  });

  it("2^53 üstü kayıt hasılatını kesin okur; yalnız kalan eksi olabilir", () => {
    expect(parsePerson({ entries: [personEntry({ grossCents: "9007199254740993" })] })?.entries[0]?.grossCents).toBe(9007199254740993n);
    expect(parsePerson({ entries: [personEntry({ remainderCents: "-5" })] })?.entries[0]?.remainderCents).toBe(-5n);
    expect(parsePerson({ entries: [personEntry({ grossCents: "-5" })] })).toBeNull();
    expect(parsePerson({ entries: [personEntry({ shareCents: "-5" })] })).toBeNull();
    expect(parsePerson({ person: personTotals({ remainderCents: "-5" }) })?.person.remainderCents).toBe(-5n);
    expect(parsePerson({ person: personTotals({ fuelCents: "-5" }) })).toBeNull();
  });

  it("bozuk biçimlerde null döner", () => {
    expect(parsePersonPeriodReport(undefined)).toBeNull();
    expect(parsePersonPeriodReport({ report: { period: PERIOD } })).toBeNull();
    expect(parsePerson({ person: null })).toBeNull();
    expect(parsePerson({ entries: "x" })).toBeNull();
    expect(parsePerson({ nextCursor: 5 })).toBeNull();
    expect(parsePerson({ nextCursor: "" })).toBeNull();
    expect(parsePerson({ nextCursor: undefined })).toBeNull();
    expect(parsePerson({ entries: [personEntry({ status: "done" })] })).toBeNull();
    expect(parsePerson({ entries: [personEntry({ workDate: "2026-02-30" })] })).toBeNull();
    expect(parsePerson({ entries: [personEntry({ startsAt: "yarın" })] })).toBeNull();
    expect(parsePerson({ entries: [personEntry({ id: "" })] })).toBeNull();
    expect(parsePerson({ entries: [personEntry({ durationMinutes: "570" })] })).toBeNull();
    expect(parsePerson({ entries: [personEntry(), 7] })).toBeNull();
  });
});

describe("kişi adresleri", () => {
  it("liste: date yoksa yalnız period", () => {
    expect(buildPeoplePeriodReportUrl("month", undefined)).toBe("/api/v1/reports/people?period=month");
    expect(buildPeoplePeriodReportUrl("week", "2026-08-31")).toBe("/api/v1/reports/people?period=week&date=2026-08-31");
  });

  it("ayrıntı: kimlik kaçışlanır, cursor yalnız verilince eklenir", () => {
    expect(buildPersonPeriodReportUrl("p 1/x", "year", "2026-01-01")).toBe(
      "/api/v1/reports/people/p%201%2Fx?period=year&date=2026-01-01",
    );
    expect(buildPersonPeriodReportUrl("p1", "month", "2026-09-01", "c=1")).toBe(
      "/api/v1/reports/people/p1?period=month&date=2026-09-01&cursor=c%3D1",
    );
  });
});

describe("peoplePeriodReportView", () => {
  it("kartlar: süre · gün · çalışma, mal sahibi etiketi, hasılat ve pay", () => {
    const view = peoplePeriodReportView(
      parsePeople([personTotals(), personTotals({ personId: "p2", fullName: "Görkem", isOwner: true, shareCents: "0" })])!,
    );
    expect(view.isEmpty).toBe(false);
    expect(view.cards).toEqual([
      {
        personId: "p1",
        fullName: "Ahmet Yılmaz",
        ownerLabel: null,
        summary: "9 saat 30 dakika · 1 gün · 1 çalışma",
        amounts: "Hasılat 10.000,00 TL · Pay 2.000,00 TL",
      },
      {
        personId: "p2",
        fullName: "Görkem",
        ownerLabel: "Mal sahibi",
        summary: "9 saat 30 dakika · 1 gün · 1 çalışma",
        amounts: "Hasılat 10.000,00 TL · Pay 0,00 TL",
      },
    ]);
  });

  it("boş liste boş durumdur", () => {
    expect(peoplePeriodReportView(parsePeople([])!)).toEqual({ isEmpty: true, cards: [] });
  });

  it("kişi günleri araç gün sayısına toplanmaz: her kart kendi gününü gösterir", () => {
    const view = peoplePeriodReportView(parsePeople([personTotals(), personTotals({ personId: "p2" })])!);
    expect(view.cards.map((card) => card.summary)).toEqual([
      "9 saat 30 dakika · 1 gün · 1 çalışma",
      "9 saat 30 dakika · 1 gün · 1 çalışma",
    ]);
  });
});

describe("personDetailView", () => {
  it("toplamlar, kayıt satırı ve sahip kayıt bağlantısı", () => {
    const view = personDetailView(parsePerson({ nextCursor: "c1" })!);
    expect(view.summary).toBe("9 saat 30 dakika · 1 gün · 1 çalışma");
    expect(view.totals).toEqual([
      { label: "Hasılat", value: "10.000,00 TL" },
      { label: "Mazot", value: "1.500,00 TL" },
      { label: "Diğer masraf", value: "300,00 TL" },
      { label: "Pay", value: "2.000,00 TL" },
      { label: "Hesaplanan kalan", value: "6.200,00 TL" },
    ]);
    expect(view.entries).toEqual([
      {
        id: "e1",
        dateText: "10 Eylül 2026",
        timeText: "08:00–17:30",
        durationText: "9 saat 30 dakika",
        amounts: "Hasılat 10.000,00 TL · Pay 2.000,00 TL",
        remainder: "6.200,00 TL",
        statusText: "Teslim doğrulandı",
        href: "/sahip/kayitlar/e1",
      },
    ]);
    expect(view.nextCursor).toBe("c1");
  });

  it("eksi kalan eksi işaretiyle, 2^53 üstü hasılat kesin biçimlenir; yasak sözcük yok", () => {
    const view = personDetailView(
      parsePerson({
        person: personTotals({ remainderCents: "-40000", grossCents: "9007199254740993" }),
        entries: [personEntry({ remainderCents: "-40000" })],
      })!,
    );
    expect(view.totals[0]).toEqual({ label: "Hasılat", value: "90.071.992.547.409,93 TL" });
    expect(view.totals[4]).toEqual({ label: "Hesaplanan kalan", value: "-400,00 TL" });
    expect(view.entries[0]?.remainder).toBe("-400,00 TL");
    const text = JSON.stringify(view).toLocaleLowerCase("tr");
    for (const word of ["net kâr", "bakiye", "kasa"]) expect(text).not.toContain(word);
  });
});
