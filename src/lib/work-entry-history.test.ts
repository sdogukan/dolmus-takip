import { describe, expect, it } from "vitest";
import { diffWorkEntryRevision, type WorkEntryHistoryValues } from "./work-entry-history";

const base: WorkEntryHistoryValues = {
  person: { id: "p1", fullName: "Mehmet Öz" },
  workDate: "2026-09-14",
  startsAt: "2026-09-14T05:00:00.000Z",
  endsAt: "2026-09-14T14:30:00.000Z",
  durationMinutes: 570,
  grossCents: "1000000",
  fuelCents: "150000",
  otherExpenseCents: "30000",
  otherExpenseNote: "otopark",
  shareCents: "200000",
  remainderCents: "620000",
  status: "pending",
};

describe("diffWorkEntryRevision", () => {
  it("aynı değerlerde boş liste döner", () => {
    expect(diffWorkEntryRevision(base, { ...base })).toEqual([]);
  });

  it("yalnız değişen alanları önce/sonra ile ve sabit alan sırasıyla listeler", () => {
    const after = { ...base, grossCents: "800000", workDate: "2026-09-13", shareCents: "160000" };
    expect(diffWorkEntryRevision(base, after)).toEqual([
      { field: "workDate", before: "2026-09-14", after: "2026-09-13" },
      { field: "grossCents", before: "1000000", after: "800000" },
      { field: "shareCents", before: "200000", after: "160000" },
    ]);
  });

  it("kişi kimlikle karşılaştırılır, gösterim ad-soyaddır; aynı kimlikte ad değişimi fark sayılmaz", () => {
    expect(diffWorkEntryRevision(base, { ...base, person: { id: "p2", fullName: "Mehmet Öz" } })).toEqual([
      { field: "person", before: "Mehmet Öz", after: "Mehmet Öz" },
    ]);
    expect(diffWorkEntryRevision(base, { ...base, person: { id: "p1", fullName: "Yeni Ad" } })).toEqual([]);
  });

  it("eksik receivedCents null sayılır: onayla birlikte null → değer, düzeltmede değer → değer", () => {
    const confirmed = { ...base, status: "confirmed", receivedCents: "600000" };
    expect(diffWorkEntryRevision(base, confirmed)).toEqual([{ field: "receivedCents", before: null, after: "600000" }]);
    expect(diffWorkEntryRevision(confirmed, { ...confirmed, receivedCents: "610000" })).toEqual([
      { field: "receivedCents", before: "600000", after: "610000" },
    ]);
  });

  it("not null ↔ metin geçişi ve türetilmiş alanlar (süre, durum) ele alınır", () => {
    expect(diffWorkEntryRevision(base, { ...base, otherExpenseNote: null, durationMinutes: 1, status: "confirmed" })).toEqual([
      { field: "otherExpenseNote", before: "otopark", after: null },
    ]);
  });
});
