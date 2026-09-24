/**
 * S5.5 kapsam matrisi: özet, araç raporu, kişi listesi, kişi detayı ve gün gün liste
 * (`/work-entries`) beş okumasında oturum türü × hedef başlığı × sorgu parametresi
 * sınırları TEK yerde. Gerçek geçici SQLite + gerçek route modülleri.
 */
import { describe, expect, it } from "vitest";
import { DAY, driverBody, ownerBody, READ_KINDS, SEED_IDS, setupReportHarness } from "./report-harness";

/** Başka müşteriye (B işletmesi) ait, hiçbir hata gövdesinde görünmemesi gereken değerler. */
const B_SECRETS = ["Fatma Çelik", "Çelik", "Hasan Kurt", "Elif Kaplan", "7777777", "06CCC003", "06 CCC 003"];
const B_GROSS = "7777777";
const PERIOD = `period=month&date=${DAY}`;
const REPORT_KINDS = READ_KINDS.filter((kind) => kind !== "workEntries");

describe("rapor okumaları kapsam matrisi", () => {
  const h = setupReportHarness("reports-scope");

  async function seedBothBusinesses(): Promise<void> {
    await h.create(h.driver, driverBody("a-d1"));
    await h.create(h.owner, ownerBody("a-o1"));
    await h.create(h.ownerB, ownerBody("b-o1", DAY, { grossCents: B_GROSS }));
  }

  it.each(READ_KINDS)("%s: oturumsuz 401", async (kind) => {
    const response = await h.read(kind, null, { query: `?${PERIOD}` });
    expect(response.status).toBe(401);
  });

  it.each(READ_KINDS)("%s: iptal edilmiş (çıkış yapılmış) oturum 401", async (kind) => {
    expect((await h.logout(h.ownerB)).status).toBe(200);
    const response = await h.read(kind, h.ownerB, { query: `?${PERIOD}` });
    expect(response.status).toBe(401);
  });

  it.each(REPORT_KINDS)("%s: şoför oturumu 403", async (kind) => {
    await seedBothBusinesses();
    const response = await h.read(kind, h.driver, { query: `?${PERIOD}` });
    expect(response.status).toBe(403);
  });

  it("workEntries: şoför oturumu rapor uçlarından FARKLI olarak okuyabilir, ama kişi seçmek zorundadır (K1)", async () => {
    await seedBothBusinesses();
    const noPerson = await h.read("workEntries", h.driver, { query: `?${PERIOD}` });
    expect(noPerson.status).toBe(422);
    expect(Object.keys((await noPerson.json()).error.fields)).toEqual(["workerPersonId"]);

    const withPerson = await h.read("workEntries", h.driver, { query: `?${PERIOD}&workerPersonId=${SEED_IDS.driverA1a}` });
    expect(withPerson.status).toBe(200);
    const { workEntries } = await withPerson.json();
    expect(workEntries).toHaveLength(1);
    expect(workEntries[0].person.id).toBe(SEED_IDS.driverA1a);
  });

  it.each(READ_KINDS)("%s: araç oturumu X-Target-Vehicle gönderirse 403 TARGET_HEADER_NOT_ALLOWED", async (kind) => {
    await seedBothBusinesses();
    for (const session of [h.owner, h.driver]) {
      const response = await h.read(kind, session, { query: `?${PERIOD}`, targetVehicle: SEED_IDS.vehicleB1 });
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("TARGET_HEADER_NOT_ALLOWED");
    }
  });

  it.each(READ_KINDS)("%s: ekip oturumunda bilinmeyen hedef araç 404 TARGET_VEHICLE_NOT_FOUND", async (kind) => {
    const response = await h.read(kind, h.admin, { query: `?${PERIOD}`, targetVehicle: "no-such-vehicle" });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("TARGET_VEHICLE_NOT_FOUND");
  });

  it.each(READ_KINDS)("%s: ?vehicleId / ?businessId kapsamı ASLA genişletmez (araç ve ekip oturumu)", async (kind) => {
    await seedBothBusinesses();
    const widening = `&vehicleId=${SEED_IDS.vehicleB1}&businessId=${SEED_IDS.businessB}`;
    const body = async (response: Response) => {
      expect(response.status).toBe(200);
      const json = await response.json();
      delete json.request_id;
      return json;
    };
    const plainOwner = await body(await h.read(kind, h.owner, { query: `?${PERIOD}` }));
    expect(await body(await h.read(kind, h.owner, { query: `?${PERIOD}${widening}` }))).toEqual(plainOwner);
    const plainStaff = await body(await h.read(kind, h.admin, { query: `?${PERIOD}`, targetVehicle: SEED_IDS.vehicleA1 }));
    expect(await body(await h.read(kind, h.admin, { query: `?${PERIOD}${widening}`, targetVehicle: SEED_IDS.vehicleA1 }))).toEqual(plainStaff);
    // A'nın yanıtında B'nin tutarı yok.
    expect(JSON.stringify(plainOwner)).not.toContain(B_GROSS);
    expect(JSON.stringify(plainStaff)).not.toContain(B_GROSS);
  });

  it.each(READ_KINDS)("%s: ekip hedef B iken yalnız B'nin verisi döner, A'nınki değil", async (kind) => {
    await seedBothBusinesses();
    const response = await h.read(kind, h.admin, {
      query: `?${PERIOD}`,
      targetVehicle: SEED_IDS.vehicleB1,
      personId: SEED_IDS.ownerB,
    });
    expect(response.status).toBe(200);
    const text = JSON.stringify(await response.json());
    expect(text).toContain(B_GROSS);
    expect(text).not.toContain("Ali Kaya");
    expect(text).not.toContain("Mehmet Öz");
  });

  it("hiçbir hata gövdesi başka müşterinin adını veya kuruş tutarını taşımaz", async () => {
    await seedBothBusinesses();
    const bodies: string[] = [];
    const collect = async (response: Response) => {
      expect(response.status).toBeGreaterThanOrEqual(400);
      bodies.push(await response.text());
    };
    for (const kind of READ_KINDS) {
      await collect(await h.read(kind, null, { query: `?${PERIOD}` }));
      await collect(await h.read(kind, h.owner, { query: `?${PERIOD}`, targetVehicle: SEED_IDS.vehicleB1 }));
      await collect(await h.read(kind, h.admin, { query: `?${PERIOD}`, targetVehicle: "no-such-vehicle" }));
      await collect(await h.read(kind, h.owner, { query: "?period=day&date=2026-02-30&cursor=bozuk&limit=0" }));
    }
    for (const kind of REPORT_KINDS) await collect(await h.read(kind, h.driver, { query: `?${PERIOD}` }));
    // A oturumu B'nin kişisini ister: kayıtsız kimlikle AYNI 404, ad/tutar sızmaz.
    for (const personId of [SEED_IDS.ownerB, SEED_IDS.driverB1a, "no-such-person"]) {
      await collect(await h.read("person", h.owner, { query: `?${PERIOD}`, personId }));
    }
    // Şoför A, B'nin kişisini seçer: genel "kullanılamıyor" metni.
    await collect(await h.read("workEntries", h.driver, { query: `?${PERIOD}&workerPersonId=${SEED_IDS.driverB1a}` }));

    expect(bodies.length).toBeGreaterThan(20);
    for (const text of bodies) {
      for (const secret of B_SECRETS) expect(text).not.toContain(secret);
    }
  });

  it("kayıtsız/başka kapsamdaki kişi kimlikleri AYNI 404 gövdesini alır", async () => {
    await seedBothBusinesses();
    const seen = new Set<string>();
    for (const personId of [SEED_IDS.ownerB, SEED_IDS.driverA2a, "no-such-person"]) {
      const response = await h.read("person", h.owner, { query: `?${PERIOD}`, personId });
      expect(response.status).toBe(404);
      const { request_id: _requestId, ...rest } = await response.json();
      seen.add(JSON.stringify(rest));
    }
    expect(seen.size).toBe(1);
  });

  it.each(READ_KINDS)("%s: yanıt Cache-Control private, no-store taşır", async (kind) => {
    const response = await h.read(kind, h.owner, { query: `?${PERIOD}` });
    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toMatch(/private/u);
    expect(cacheControl).toMatch(/no-store/u);
  });
});
