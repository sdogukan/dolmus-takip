/**
 * S5.5 birleşik PRD senaryosu (PRD §4): Ahmet (şoför) 14 Eylül, sahip (Görkem'in karşılığı)
 * 15 Eylül; her biri 10.000 TL hasılat, 1.500 TL mazot, 300 TL diğer masraf, 08:00–17:30.
 * Ahmet'in payı 2.000 TL (kalan 6.200), sahibin payı 0 (kalan 8.200) → toplam kalan 14.400 TL.
 * Doğrulanmış teslim: onay yokken 0, tam onayda 6.200, 6.000 onayında 6.000; sahip çalışması
 * teslime eklenmez. Aynı rakamlar sahip oturumundan ve ekibin X-Target-Vehicle isteklerinden,
 * beş okumanın hepsinde özdeş döner; eski revizyon/onaylar çift sayılmaz.
 */
import { describe, expect, it } from "vitest";
import { openDatabaseConnection } from "../../src/server/data/db";
import { DAY, daily, driverBody, ownerBody, SEED_IDS, setupReportHarness, type Session } from "./report-harness";

const AHMET = SEED_IDS.driverA1a;
const MONTH = `?period=month&date=${DAY}`;
const AHMET_DAY = "2026-09-14";
const OWNER_DAY = "2026-09-15";

describe("birleşik PRD senaryosu", () => {
  const h = setupReportHarness("reports-prd");

  const json = async (response: Response) => {
    expect(response.status).toBe(200);
    const body = await response.json();
    delete body.request_id;
    return body;
  };

  /** Beş okumanın gövdeleri; `session` + isteğe bağlı hedef araçla. */
  async function views(session: Session, targetVehicle?: string, query = MONTH, personId = AHMET) {
    const options = { query, targetVehicle, personId };
    return {
      summary: (await json(await h.read("summary", session, options))).summary,
      vehicles: (await json(await h.read("vehicles", session, options))).report,
      people: (await json(await h.read("people", session, options))).report,
      person: (await json(await h.read("person", session, options))).report,
      workEntries: await json(await h.read("workEntries", session, { ...options, query: `${query}&limit=100` })),
    };
  }

  /** Sahip oturumu ile ekibin X-Target-Vehicle görünümü AYNI olmalı; sahip görünümünü döner. */
  async function bothViews(query = MONTH, personId = AHMET) {
    const asOwner = await views(h.owner, undefined, query, personId);
    const asStaff = await views(h.admin, SEED_IDS.vehicleA1, query, personId);
    expect(asStaff).toEqual(asOwner);
    return asOwner;
  }

  async function seedPrdEntries(): Promise<{ ahmetEntry: string; ownerEntry: string }> {
    const ahmetEntry = await h.create(h.driver, driverBody("prd-a", AHMET_DAY));
    const ownerEntry = await h.create(h.owner, ownerBody("prd-o", OWNER_DAY));
    return { ahmetEntry, ownerEntry };
  }

  const sql = (statement: string, ...params: string[]) => {
    const connection = openDatabaseConnection(h.dbPath, {});
    try {
      connection.prepare(statement).run(...params);
    } finally {
      connection.close();
    }
  };

  it.each([
    { name: "onay yok", received: undefined, confirmed: "0" },
    { name: "6.200 TL eksiksiz onay", received: "620000", confirmed: "620000" },
    { name: "6.000 TL onay (200 TL eksik)", received: "600000", confirmed: "600000" },
  ])("$name: kalan 14.400,00 TL, alınan $confirmed, sahip payı 0; sahip ve ekip görünümü özdeş", async ({ received, confirmed }) => {
    const { ahmetEntry } = await seedPrdEntries();
    if (received) {
      expect((await h.confirm(h.owner, ahmetEntry, { requestId: "k-1", version: 1, receivedCents: received })).status).toBe(200);
    }
    const view = await bothViews();

    const expectedTotals = {
      entryCount: 2,
      workDays: 2,
      durationMinutes: 1140,
      grossCents: "2000000",
      fuelCents: "300000",
      otherExpenseCents: "60000",
      shareCents: "200000",
      remainderCents: "1440000",
    };
    expect(view.summary).toMatchObject({ ...expectedTotals, confirmedReceivedCents: confirmed });
    expect(view.vehicles).toMatchObject({ ...expectedTotals, confirmedReceivedCents: confirmed });

    // Kişi satırları: Ahmet 6.200 / pay 2.000; sahip 8.200 / pay 0 ve isOwner. Toplamları araç toplamına eşit.
    const ahmet = view.people.people.find((row: { personId: string }) => row.personId === AHMET);
    const owner = view.people.people.find((row: { personId: string }) => row.personId === SEED_IDS.ownerA);
    expect(ahmet).toMatchObject({ isOwner: false, shareCents: "200000", remainderCents: "620000", entryCount: 1 });
    expect(owner).toMatchObject({ isOwner: true, shareCents: "0", remainderCents: "820000", entryCount: 1 });
    expect(view.people.people).toHaveLength(2);
    expect(BigInt(ahmet.remainderCents) + BigInt(owner.remainderCents)).toBe(BigInt(view.summary.remainderCents));

    // Gün gün liste: sahip kaydında teslim onayı yok; yalnız şoför kaydı onaya bağlı.
    const listed = view.workEntries.workEntries as { workKind: string; status: string; confirmation: { receivedCents: string } | null }[];
    expect(listed).toHaveLength(2);
    expect(listed.find((entry) => entry.workKind === "owner")).toMatchObject({ status: "not_required", confirmation: null });
    expect(listed.find((entry) => entry.workKind === "driver")).toMatchObject({
      status: received ? "confirmed" : "pending",
      confirmation: received ? { receivedCents: received } : null,
    });

    // Kişi pasifleşse ve yeniden adlandırılsa da toplamlar ve satır sayısı DEĞİŞMEZ; her kişi tek satır.
    sql("UPDATE people SET full_name = ?, version = version + 1 WHERE id = ?", "Ahmet Yeni Ad", AHMET);
    sql("UPDATE vehicle_drivers SET active = 0, version = version + 1 WHERE person_id = ?", AHMET);
    sql("UPDATE people SET active = 0, version = version + 1 WHERE id = ?", AHMET);
    const after = await bothViews();
    expect(after.people.people).toHaveLength(2);
    expect(after.people.people.find((row: { personId: string }) => row.personId === AHMET)).toMatchObject({
      fullName: "Ahmet Yeni Ad",
      remainderCents: "620000",
    });
    expect(after.summary).toMatchObject({ ...expectedTotals, confirmedReceivedCents: confirmed });
    expect(after.person.person.fullName).toBe("Ahmet Yeni Ad");
  });

  it("aynı gün iki kayıt: entryCount 2, workDays 1; toplamlar ve çift sayım yok", async () => {
    const a = await h.create(h.driver, driverBody("s-1", AHMET_DAY, { startTime: "08:00", endTime: "12:00" }));
    await h.create(h.driver, driverBody("s-2", AHMET_DAY, { startTime: "13:00", endTime: "17:30" }));
    expect((await h.confirm(h.owner, a, { requestId: "k-1", version: 1, receivedCents: "620000" })).status).toBe(200);
    const view = await bothViews();
    expect(view.vehicles).toMatchObject({ entryCount: 2, workDays: 1, grossCents: "2000000", confirmedReceivedCents: "620000" });
    expect(view.person.person).toMatchObject({ entryCount: 2, workDays: 1 });
    expect(view.people.people).toHaveLength(1);
  });

  it("kişi ve tarih düzeltmesi: eski sürüm ve eski onay çift sayılmaz, kayıt yeni kişiye/güne taşınır", async () => {
    const { ahmetEntry } = await seedPrdEntries();
    expect((await h.confirm(h.owner, ahmetEntry, { requestId: "k-1", version: 1, receivedCents: "600000" })).status).toBe(200);
    const before = await bothViews();
    expect(before.summary).toMatchObject({ remainderCents: "1440000", confirmedReceivedCents: "600000" });

    // Düzeltme 1: başka şoföre taşı, alınan tutarı 6.200 TL yap. Sürüm 3, onay 3; v1/v2 revizyon ve onayları DB'de kalır.
    const moved = await h.correct(h.owner, ahmetEntry, {
      requestId: "x-1",
      version: 2,
      workType: "driver",
      workerPersonId: SEED_IDS.driverA1b,
      ...daily(AHMET_DAY),
      receivedCents: "620000",
    });
    expect(moved.status).toBe(200);
    const afterPerson = await bothViews(MONTH, SEED_IDS.driverA1b);
    expect(afterPerson.summary).toMatchObject({ entryCount: 2, remainderCents: "1440000", confirmedReceivedCents: "620000" });
    expect(afterPerson.people.people.map((row: { personId: string }) => row.personId).sort()).toEqual([SEED_IDS.driverA1b, SEED_IDS.ownerA].sort());
    expect(afterPerson.person.person).toMatchObject({ personId: SEED_IDS.driverA1b, entryCount: 1 });
    // Eski kişi artık bu dönemde kayıtsız: aynı 404, hem sahip hem ekip için.
    for (const [session, target] of [[h.owner, undefined], [h.admin, SEED_IDS.vehicleA1]] as const) {
      expect((await h.read("person", session, { query: MONTH, targetVehicle: target, personId: AHMET })).status).toBe(404);
    }

    // Düzeltme 2: gün Ekim'e taşınır → Eylül'den çıkar, Ekim'de bir kez sayılır.
    const dated = await h.correct(h.owner, ahmetEntry, {
      requestId: "x-2",
      version: 3,
      workType: "driver",
      workerPersonId: SEED_IDS.driverA1b,
      ...daily("2026-10-05"),
      receivedCents: "620000",
    });
    expect(dated.status).toBe(200);
    const septemberTotals = await views(h.owner, undefined, MONTH, SEED_IDS.ownerA);
    expect(septemberTotals.summary).toMatchObject({ entryCount: 1, remainderCents: "820000", confirmedReceivedCents: "0" });
    const october = await bothViews("?period=month&date=2026-10-05", SEED_IDS.driverA1b);
    expect(october.summary).toMatchObject({ entryCount: 1, remainderCents: "620000", confirmedReceivedCents: "620000" });

    // Çift sayım kanıtı: DB'de bu kayıt için 3 revizyon ve 2+ onay var, rapor yalnız güncelini sayar.
    const connection = openDatabaseConnection(h.dbPath, {});
    try {
      const revisions = connection.prepare("SELECT COUNT(*) AS n FROM work_entry_revisions WHERE entry_id = ?").get(ahmetEntry) as { n: number };
      const confirmations = connection.prepare("SELECT COUNT(*) AS n FROM cash_confirmations WHERE entry_id = ?").get(ahmetEntry) as { n: number };
      expect(revisions.n).toBeGreaterThanOrEqual(3);
      expect(confirmations.n).toBeGreaterThanOrEqual(3);
    } finally {
      connection.close();
    }
  });
});
