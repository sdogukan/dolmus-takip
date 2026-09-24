import { describe, expect, it } from "vitest";
import {
  buildHistoryRows,
  currentHistorySummary,
  formatHistoryActor,
  formatHistoryFieldValue,
  formatHistoryOnBehalf,
  type HistoryActor,
  type HistoryView,
} from "./work-entry-history-ui";
import type { WorkEntryHistoryValues } from "./work-entry-history";

const values: WorkEntryHistoryValues = {
  person: { id: "p1", fullName: "Hüseyin Ak" },
  workDate: "2026-06-20",
  startsAt: "2026-06-20T05:00:00.000Z",
  endsAt: "2026-06-20T14:00:00.000Z",
  durationMinutes: 540,
  grossCents: "1000000",
  fuelCents: "150000",
  otherExpenseCents: "30000",
  otherExpenseNote: null,
  shareCents: "164000",
  remainderCents: "620000",
  status: "pending",
};

const owner: HistoryActor = { kind: "vehicle_credential", access: "owner", plateNormalized: "34ABC123" };
const staff: HistoryActor = {
  kind: "platform_user",
  username: "destek1",
  fullName: null,
  role: "support",
  onBehalfOf: { kind: "owner", fullName: "Ali Veli" },
};

const view: HistoryView = {
  entry: { id: "e1", version: 4, status: "confirmed", workKind: "driver" },
  revisions: [
    { version: 1, action: "create", createdAt: "2026-06-20T14:10:00.000Z", actor: owner, values, changes: [] },
    {
      version: 2,
      action: "update",
      createdAt: "2026-06-20T14:20:00.000Z",
      actor: staff,
      values: { ...values, grossCents: "1200000" },
      changes: [{ field: "grossCents", before: "1000000", after: "1200000" }],
    },
    {
      version: 3,
      action: "confirm",
      createdAt: "2026-06-20T14:30:00.000Z",
      actor: owner,
      values: { ...values, grossCents: "1200000", receivedCents: "600000" },
      changes: [{ field: "receivedCents", before: null, after: "600000" }],
    },
    {
      version: 4,
      action: "correct_and_confirm",
      createdAt: "2026-06-20T14:40:00.000Z",
      actor: owner,
      values: { ...values, grossCents: "1200000", receivedCents: "610000" },
      changes: [{ field: "receivedCents", before: "600000", after: "610000" }],
    },
  ],
  confirmations: [
    { entryVersion: 3, receivedCents: "600000", confirmedAt: "2026-06-20T14:30:00.000Z", actor: owner, current: false },
    { entryVersion: 4, receivedCents: "610000", confirmedAt: "2026-06-20T14:40:00.000Z", actor: owner, current: true },
  ],
};

describe("buildHistoryRows", () => {
  it("kronolojik: oluşturma, düzenleme (önce → sonra) ve iki AYRI onay satırı; yalnız sonuncu güncel", () => {
    const rows = buildHistoryRows(view);
    expect(rows.map((r) => [r.kind, r.version])).toEqual([
      ["created", 1],
      ["updated", 2],
      ["confirmation", 3],
      ["confirmation", 4],
    ]);
    expect(rows[1]).toMatchObject({
      changes: [{ label: "Hasılat", before: "10.000,00 TL", after: "12.000,00 TL" }],
      actor: "destek1 · Destek",
      onBehalf: "Sahip adına Ali Veli",
    });
    expect(rows[2]).toMatchObject({ received: "6.000,00 TL", current: false });
    expect(rows[3]).toMatchObject({ received: "6.100,00 TL", current: true });
  });

  it("sürüm 1 değişiklik taşımaz; alınan tutar değişim satırlarında tekrarlanmaz", () => {
    const rows = buildHistoryRows(view);
    expect(rows[0]).toMatchObject({ kind: "created", changes: [] });
    expect(JSON.stringify(rows.filter((r) => r.kind !== "confirmation"))).not.toContain("Alınan tutar");
  });

  it("onaylı düzeltmede başka alan da değiştiyse o alan ayrı satırda ve onay satırından önce gelir", () => {
    const changed: HistoryView = {
      ...view,
      revisions: [
        view.revisions[0]!,
        {
          ...view.revisions[3]!,
          version: 2,
          changes: [
            { field: "fuelCents", before: "150000", after: "100000" },
            { field: "receivedCents", before: null, after: "610000" },
          ],
        },
      ],
      confirmations: [{ ...view.confirmations[1]!, entryVersion: 2 }],
    };
    const rows = buildHistoryRows(changed);
    expect(rows.map((r) => r.kind)).toEqual(["created", "updated", "confirmation"]);
    expect(rows[1]).toMatchObject({ changes: [{ label: "Mazot", before: "1.500,00 TL", after: "1.000,00 TL" }] });
  });

  it("hiçbir satır toplam taşımaz", () => {
    expect(JSON.stringify(buildHistoryRows(view))).not.toMatch(/toplam/iu);
  });
});

describe("currentHistorySummary", () => {
  it("son revizyon değerlerini ve yalnız güncel onayı alır", () => {
    expect(currentHistorySummary(view)).toMatchObject({
      version: 4,
      received: "6.100,00 TL",
      values: { grossCents: "1200000" },
    });
  });

  it("güncel onay yoksa alınan tutar null; revizyon yoksa null", () => {
    expect(currentHistorySummary({ ...view, confirmations: [] })?.received).toBeNull();
    expect(currentHistorySummary({ ...view, revisions: [] })).toBeNull();
  });
});

describe("aktör ve alan biçimi", () => {
  it("ekip: '<kullanıcı adı> · <rol>'; araç credential'ı: erişim + plaka (kişi adı yok)", () => {
    expect(formatHistoryActor(staff)).toBe("destek1 · Destek");
    expect(formatHistoryActor(owner)).toBe("Sahip oturumu · 34 ABC 123");
    expect(formatHistoryActor({ ...owner, plateNormalized: null })).toBe("Sahip oturumu");
    expect(formatHistoryActor({ ...staff, username: "" })).toBe("— · Destek");
  });

  it("'adına' metni yalnız ekip satırında", () => {
    expect(formatHistoryOnBehalf(staff)).toBe("Sahip adına Ali Veli");
    expect(
      formatHistoryOnBehalf({ ...staff, onBehalfOf: { kind: "driver", fullName: "Hüseyin Ak" } }),
    ).toBe("Şoför adına Hüseyin Ak");
    expect(formatHistoryOnBehalf({ ...staff, onBehalfOf: null })).toBeNull();
    expect(formatHistoryOnBehalf(owner)).toBeNull();
  });

  it("alan değerleri: tutar BigInt-güvenli, gün ve saat İstanbul, boş → —, bozuk tutar → —", () => {
    expect(formatHistoryFieldValue("grossCents", "9007199254740991")).toBe("90.071.992.547.409,91 TL");
    expect(formatHistoryFieldValue("grossCents", "abc")).toBe("—");
    expect(formatHistoryFieldValue("workDate", "2026-09-14")).toBe("14 Eylül 2026");
    expect(formatHistoryFieldValue("startsAt", "2026-06-20T05:00:00.000Z")).toBe("20 Haziran 2026 · 08:00");
    expect(formatHistoryFieldValue("otherExpenseNote", null)).toBe("—");
    expect(formatHistoryFieldValue("person", "Mehmet Öz")).toBe("Mehmet Öz");
  });
});
