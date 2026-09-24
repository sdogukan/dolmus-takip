/**
 * POST /api/v1/admin/businesses/:businessId/people/:personId/anonymize — KVKK ad
 * anonimleştirme. Gerçek geçici SQLite + gerçek migration + seed (mock/`:memory:` YOK).
 * Yalnız admin; ad yerinde ve geri dönüşsüz değişir; kayıtlar, revizyonlar, teslimler,
 * makbuzlar ve önceki işlem geçmişi aynen kalır; rapor toplamları değişmez; iki yeniden
 * adlandırma yolu da 409 PERSON_ANONYMIZED verir.
 */
import { describe, expect, it } from "vitest";
import { SEED_TEST_PASSWORDS, SEED_USERNAMES } from "../../scripts/db-seed-dev";
import { POST as platformLoginRoute } from "../../src/app/api/v1/auth/platform-login/route";
import { POST as anonymizeRoute } from "../../src/app/api/v1/admin/businesses/[businessId]/people/[personId]/anonymize/route";
import {
  GET as getBusinessDetailRoute,
  PATCH as patchBusinessRoute,
} from "../../src/app/api/v1/admin/businesses/[businessId]/route";
import { PATCH as patchPersonRoute } from "../../src/app/api/v1/drivers/[personId]/route";
import { openDatabaseConnection } from "../../src/server/data/db";
import { isValidFullName } from "../../src/server/usecases/drivers/person-name";
import { DAY, driverBody, ownerBody, SEED_IDS, setupReportHarness, type Session } from "./report-harness";

const SELF_ORIGIN = "https://example.invalid";
const API = "https://example.invalid/api/v1";
const MONTH = `?period=month&date=${DAY}`;
const DRIVER = SEED_IDS.driverA1a;
const UNIQUE_OLD_NAME = "Selimcan Yıldırımoğlu";

const expectedAnonymousName = (personId: string) => `Anonim kişi ${personId.slice(0, 6).toUpperCase()}`;

const writeHeaders = (session: Session, targetVehicle?: string) => ({
  cookie: `dolmus_session=${session.token}`,
  origin: SELF_ORIGIN,
  "x-csrf-token": session.csrfToken,
  "content-type": "application/json",
  ...(targetVehicle ? { "x-target-vehicle": targetVehicle } : {}),
});

async function loginSupport(): Promise<Session> {
  const response = await platformLoginRoute(
    new Request(`${API}/auth/platform-login`, {
      method: "POST",
      headers: { origin: SELF_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ username: SEED_USERNAMES.support, password: SEED_TEST_PASSWORDS.support }),
    }),
  );
  expect(response.status).toBe(201);
  const match = /dolmus_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "");
  return { token: decodeURIComponent(match![1]!), csrfToken: (await response.json()).csrfToken };
}

function anonymize(
  session: Session | null,
  body: unknown,
  personId: string = DRIVER,
  businessId: string = SEED_IDS.businessA,
): Promise<Response> {
  const url = `${API}/admin/businesses/${businessId}/people/${personId}/anonymize`;
  const headers = session
    ? writeHeaders(session)
    : { origin: SELF_ORIGIN, "content-type": "application/json" };
  return anonymizeRoute(new Request(url, { method: "POST", headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ businessId, personId }),
  });
}

function patchPerson(session: Session, personId: string, body: unknown, targetVehicle?: string): Promise<Response> {
  return patchPersonRoute(
    new Request(`${API}/drivers/${personId}`, {
      method: "PATCH",
      headers: writeHeaders(session, targetVehicle),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ personId }) },
  );
}

function patchBusiness(session: Session, body: unknown, businessId: string = SEED_IDS.businessA): Promise<Response> {
  return patchBusinessRoute(
    new Request(`${API}/admin/businesses/${businessId}`, {
      method: "PATCH",
      headers: writeHeaders(session),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ businessId }) },
  );
}

async function businessDetail(session: Session, businessId: string = SEED_IDS.businessA) {
  const response = await getBusinessDetailRoute(
    new Request(`${API}/admin/businesses/${businessId}`, { headers: { cookie: `dolmus_session=${session.token}` } }),
    { params: Promise.resolve({ businessId }) },
  );
  expect(response.status).toBe(200);
  return response.json();
}

describe("POST /admin/businesses/:businessId/people/:personId/anonymize", () => {
  const h = setupReportHarness("person-anonymize");

  function query<T>(statement: string, ...params: unknown[]): T[] {
    const sqlite = openDatabaseConnection(h.dbPath);
    try {
      return sqlite.prepare(statement).all(...params) as T[];
    } finally {
      sqlite.close();
    }
  }

  const personRow = (personId: string = DRIVER) =>
    query<{ full_name: string; active: number; version: number; anonymized_at: string | null }>(
      "SELECT full_name, active, version, anonymized_at FROM people WHERE id = ?",
      personId,
    )[0]!;

  const auditRows = (action: string, personId: string = DRIVER) =>
    query<{ before_json: string | null; after_json: string; actor_role: string; vehicle_id: string | null }>(
      "SELECT before_json, after_json, actor_role, vehicle_id FROM admin_audit WHERE entity_id = ? AND action = ?",
      personId,
      action,
    );

  const table = (name: string) => query<Record<string, unknown>>(`SELECT * FROM ${name} ORDER BY rowid`);

  async function readReport(kind: "people" | "vehicles") {
    const response = await h.read(kind, h.owner, { query: MONTH });
    expect(response.status).toBe(200);
    return (await response.json()).report;
  }

  /** İşlem geçmişinde eski adı taşıyan bir satır, rapora giren kayıtlar ve bir teslim onayı. */
  async function seedHistory(): Promise<void> {
    const renamed = await patchPerson(h.owner, DRIVER, { requestId: "rename-1", version: 1, fullName: UNIQUE_OLD_NAME });
    expect(renamed.status).toBe(200);
    const driverEntry = await h.create(h.driver, driverBody("entry-d", DAY, {}, DRIVER));
    await h.create(h.owner, ownerBody("entry-o", "2026-09-16"));
    const confirmed = await h.confirm(h.owner, driverEntry, { requestId: "confirm-1", version: 1, receivedCents: "620000" });
    expect(confirmed.status).toBe(200);
  }

  it("admin 200 döner; ad kimlikten türetilen anonim adla değişir, anonymized_at dolar, sürüm artar; hiçbir satır silinmez veya yeniden yazılmaz", async () => {
    await seedHistory();
    const before = {
      people: table("people"),
      workEntries: table("work_entries"),
      revisions: table("work_entry_revisions"),
      confirmations: table("cash_confirmations"),
      receipts: table("mutation_receipts"),
      audit: table("admin_audit"),
    };
    expect(personRow().version).toBe(2);

    const response = await anonymize(h.admin, { requestId: "anon-1", version: 2 });
    expect(response.status).toBe(200);
    const body = await response.json();
    const anonymousName = expectedAnonymousName(DRIVER);
    expect(body.request_id).toEqual(expect.any(String));
    expect(body.person).toEqual({ id: DRIVER, fullName: anonymousName, active: true, version: 3, anonymized: true });
    expect(isValidFullName(anonymousName)).toBe(true);

    const row = personRow();
    expect(row.full_name).toBe(anonymousName);
    expect(row.version).toBe(3);
    expect(row.anonymized_at).not.toBeNull();
    expect(new Date(row.anonymized_at!).toISOString()).toBe(row.anonymized_at);

    // Kişi satırı yerinde: yalnız bu kişinin adı/sürümü/anonymized_at'i değişti.
    const peopleAfter = table("people");
    expect(peopleAfter).toHaveLength(before.people.length);
    expect(peopleAfter.filter((p) => p.id !== DRIVER)).toEqual(before.people.filter((p) => p.id !== DRIVER));
    // Mali kayıtlar ve geçmişi bit bit aynı.
    expect(table("work_entries")).toEqual(before.workEntries);
    expect(table("work_entry_revisions")).toEqual(before.revisions);
    expect(table("cash_confirmations")).toEqual(before.confirmations);
    // Makbuz ve işlem geçmişi: önceki satırlar aynen durur; yalnız bu işlemin kendi satırı eklenir.
    const receiptsAfter = table("mutation_receipts");
    expect(receiptsAfter.slice(0, before.receipts.length)).toEqual(before.receipts);
    expect(receiptsAfter.slice(before.receipts.length)).toEqual([
      expect.objectContaining({ request_id: "anon-1", operation: "person.anonymize", entity_id: DRIVER, response_code: 200 }),
    ]);
    const auditAfter = table("admin_audit");
    expect(auditAfter.slice(0, before.audit.length)).toEqual(before.audit);
    expect(auditAfter.slice(before.audit.length)).toEqual([
      expect.objectContaining({ action: "person.anonymize", entity_type: "person", entity_id: DRIVER }),
    ]);
    // Eski yeniden adlandırma satırı eski adı taşımaya devam eder (geçmiş append-only).
    expect(auditRows("person.rename")[0]!.after_json).toContain(UNIQUE_OLD_NAME);
  });

  it("yeni audit satırı eski adı taşımaz: önce yalnız sürüm + anonymized false, sonra anonim ad + anonymized true + yeni sürüm", async () => {
    await seedHistory();
    expect((await anonymize(h.admin, { requestId: "anon-1", version: 2 })).status).toBe(200);

    const rows = auditRows("person.anonymize");
    expect(rows).toHaveLength(1);
    const [audit] = rows;
    expect(audit!.actor_role).toBe("admin");
    expect(audit!.vehicle_id).toBeNull();
    expect(JSON.parse(audit!.before_json!)).toEqual({ anonymized: false, version: 2 });
    expect(JSON.parse(audit!.after_json)).toEqual({
      fullName: expectedAnonymousName(DRIVER),
      anonymized: true,
      version: 3,
    });
    for (const json of [audit!.before_json!, audit!.after_json]) {
      expect(json).not.toContain(UNIQUE_OLD_NAME);
      expect(json).not.toContain("Selimcan");
    }
  });

  it("dönem toplamları anonimleştirmeden önce ve sonra aynıdır; kişi satırı anonim adı gösterir", async () => {
    await seedHistory();
    const peopleBefore = await readReport("people");
    const vehiclesBefore = await readReport("vehicles");
    expect(peopleBefore.people.find((p: { personId: string }) => p.personId === DRIVER).fullName).toBe(UNIQUE_OLD_NAME);

    expect((await anonymize(h.admin, { requestId: "anon-1", version: 2 })).status).toBe(200);

    const peopleAfter = await readReport("people");
    const vehiclesAfter = await readReport("vehicles");
    expect(vehiclesAfter).toEqual(vehiclesBefore);

    const withoutName = (report: { people: Record<string, unknown>[] }) =>
      report.people.map(({ fullName: _ignored, ...totals }) => totals).sort((a, b) => String(a.personId).localeCompare(String(b.personId)));
    expect(withoutName(peopleAfter)).toEqual(withoutName(peopleBefore));
    expect(peopleAfter.period).toEqual(peopleBefore.period);
    const row = peopleAfter.people.find((p: { personId: string }) => p.personId === DRIVER);
    expect(row.fullName).toBe(expectedAnonymousName(DRIVER));
    expect(row.entryCount).toBe(1);
    expect(JSON.stringify(peopleAfter)).not.toContain(UNIQUE_OLD_NAME);
  });

  it("destek, sahip ve şoför oturumu 403 FORBIDDEN alır; oturumsuz istek 401; kişi değişmez", async () => {
    const support = await loginSupport();
    for (const session of [support, h.owner, h.driver]) {
      const response = await anonymize(session, { requestId: "anon-x", version: 1 });
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
    }
    expect((await anonymize(null, { requestId: "anon-x", version: 1 })).status).toBe(401);
    expect(personRow()).toMatchObject({ full_name: "Mehmet Öz", version: 1, anonymized_at: null });
    expect(auditRows("person.anonymize")).toHaveLength(0);
  });

  it("başka işletmenin kişisi 404 PERSON_NOT_FOUND, olmayan işletme 404 TARGET_BUSINESS_NOT_FOUND", async () => {
    const otherBusinessPerson = await anonymize(h.admin, { requestId: "anon-b", version: 1 }, SEED_IDS.driverB1a);
    expect(otherBusinessPerson.status).toBe(404);
    expect((await otherBusinessPerson.json()).error.code).toBe("PERSON_NOT_FOUND");
    expect(personRow(SEED_IDS.driverB1a)).toMatchObject({ full_name: "Hasan Kurt", anonymized_at: null });

    const missingBusiness = await anonymize(h.admin, { requestId: "anon-c", version: 1 }, DRIVER, "no-such-business");
    expect(missingBusiness.status).toBe(404);
    expect((await missingBusiness.json()).error.code).toBe("TARGET_BUSINESS_NOT_FOUND");
  });

  it("bayat sürüm 409 VERSION_CONFLICT; kişi değişmez", async () => {
    const response = await anonymize(h.admin, { requestId: "anon-1", version: 7 });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("VERSION_CONFLICT");
    expect(personRow()).toMatchObject({ full_name: "Mehmet Öz", version: 1, anonymized_at: null });
    expect(auditRows("person.anonymize")).toHaveLength(0);
  });

  it("ikinci anonimleştirme (yeni requestId) 409 PERSON_ANONYMIZED — Türkçe mesaj; yeni audit/güncelleme yok", async () => {
    expect((await anonymize(h.admin, { requestId: "anon-1", version: 1 })).status).toBe(200);
    const again = await anonymize(h.admin, { requestId: "anon-2", version: 2 });
    expect(again.status).toBe(409);
    const body = await again.json();
    expect(body.error).toEqual({ code: "PERSON_ANONYMIZED", message: "Bu kişinin adı anonimleştirildi; değiştirilemez." });
    expect(personRow().version).toBe(2);
    expect(auditRows("person.anonymize")).toHaveLength(1);
  });

  it("aynı requestId + aynı gövde replay 200 ve aynı kişi; ikinci UPDATE/audit yok. Farklı gövde 409 REQUEST_ID_REUSED", async () => {
    const first = await anonymize(h.admin, { requestId: "anon-1", version: 1 });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const replay = await anonymize(h.admin, { requestId: "anon-1", version: 1 });
    expect(replay.status).toBe(200);
    expect((await replay.json()).person).toEqual(firstBody.person);
    expect(personRow().version).toBe(2);
    expect(auditRows("person.anonymize")).toHaveLength(1);

    const reused = await anonymize(h.admin, { requestId: "anon-1", version: 2 });
    expect(reused.status).toBe(409);
    expect((await reused.json()).error.code).toBe("REQUEST_ID_REUSED");
  });

  it("gövdede kapsam alanı veya başka anahtar 422 VALIDATION_ERROR; eksik/geçersiz sürüm 422", async () => {
    for (const body of [
      { requestId: "anon-1", version: 1, personId: SEED_IDS.driverA1b },
      { requestId: "anon-1", version: 1, businessId: SEED_IDS.businessB },
      { requestId: "anon-1", version: 1, role: "admin" },
      { requestId: "anon-1", version: 1, fullName: "Başka Ad" },
      { requestId: "anon-1" },
      { requestId: "anon-1", version: 0 },
      { version: 1 },
    ]) {
      const response = await anonymize(h.admin, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    }
    expect(personRow()).toMatchObject({ full_name: "Mehmet Öz", version: 1, anonymized_at: null });
  });

  it("anonim kişiye PATCH /drivers ile ad 409 PERSON_ANONYMIZED (sahip ve ekip); yalnız aktiflik değişimi çalışır", async () => {
    expect((await anonymize(h.admin, { requestId: "anon-1", version: 1 })).status).toBe(200);

    const byOwner = await patchPerson(h.owner, DRIVER, { requestId: "rn-1", version: 2, fullName: "Yeni Ad" });
    expect(byOwner.status).toBe(409);
    expect((await byOwner.json()).error.code).toBe("PERSON_ANONYMIZED");
    // Anonimleştirmeden önce açılmış ekranın bayat sürümü de aynı nedeni görür.
    const stale = await patchPerson(h.owner, DRIVER, { requestId: "rn-2", version: 1, fullName: "Yeni Ad" });
    expect((await stale.json()).error.code).toBe("PERSON_ANONYMIZED");
    const byStaff = await patchPerson(h.admin, DRIVER, { requestId: "rn-3", version: 2, fullName: "Yeni Ad" }, SEED_IDS.vehicleA1);
    expect(byStaff.status).toBe(409);
    expect((await byStaff.json()).error.code).toBe("PERSON_ANONYMIZED");
    expect(personRow()).toMatchObject({ full_name: expectedAnonymousName(DRIVER), version: 2 });

    const deactivate = await patchPerson(h.admin, DRIVER, { requestId: "act-1", version: 2, active: false }, SEED_IDS.vehicleA1);
    expect(deactivate.status).toBe(200);
    const driver = (await deactivate.json()).driver;
    expect(driver).toMatchObject({
      personId: DRIVER,
      fullName: expectedAnonymousName(DRIVER),
      personActive: false,
      personVersion: 3,
      anonymized: true,
    });
    expect(personRow().full_name).toBe(expectedAnonymousName(DRIVER));
  });

  it("anonimleştirilmemiş kişiler anonymized false taşır; ad değişimi çalışmaya devam eder", async () => {
    const response = await patchPerson(h.owner, SEED_IDS.driverA1b, { requestId: "rn-1", version: 1, fullName: "Mehmet Özkan" });
    expect(response.status).toBe(200);
    expect((await response.json()).driver).toMatchObject({ fullName: "Mehmet Özkan", anonymized: false });
    expect((await businessDetail(h.admin)).owner.anonymized).toBe(false);
  });

  it("anonim işletme sahibine ownerRename 409 PERSON_ANONYMIZED; işletme detayı owner.anonymized true ve anonim adı gösterir", async () => {
    const detail = await businessDetail(h.admin);
    expect(detail.owner.personId).toBe(SEED_IDS.ownerA);

    const anonymized = await anonymize(h.admin, { requestId: "anon-o", version: detail.owner.version }, SEED_IDS.ownerA);
    expect(anonymized.status).toBe(200);
    const ownerName = expectedAnonymousName(SEED_IDS.ownerA);

    const after = await businessDetail(h.admin);
    expect(after.owner).toEqual({
      personId: SEED_IDS.ownerA,
      fullName: ownerName,
      active: true,
      version: detail.owner.version + 1,
      anonymized: true,
    });

    const rename = await patchBusiness(h.admin, {
      requestId: "biz-rn-1",
      version: after.business.version,
      ownerRename: { fullName: "Ali Kaya", ownerVersion: after.owner.version },
    });
    expect(rename.status).toBe(409);
    expect((await rename.json()).error).toEqual({
      code: "PERSON_ANONYMIZED",
      message: "Bu kişinin adı anonimleştirildi; değiştirilemez.",
    });
    const final = await businessDetail(h.admin);
    expect(final.owner.fullName).toBe(ownerName);
    expect(final.business.version).toBe(after.business.version);
    expect(auditRows("person.rename", SEED_IDS.ownerA)).toHaveLength(0);
  });
});
