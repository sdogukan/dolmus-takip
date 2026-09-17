/**
 * Kapsam çözümleme + kapsamlı sorgu + transaction-içi yeniden denetim
 * entegrasyon testleri — T1.5 ADIM 1/2, S1.5.
 *
 * Görev tanımı iş adımı 3: "Aynı işletmede farklı araçlar ve farklı
 * işletmeler içeren doğrudan endpoint testlerini oluştur; 401/403/404
 * ayrımını ve bilgi sızdırmayan hata yanıtını doğrula." E2–E5 endpoint'leri
 * bu ADIM'da YAZILMADIĞINDAN (TASKS.md T1.5 — "henüz varmış gibi
 * sunulmaz"), bu dosya aynı denetimi endpoint'lerin DAYANACAĞI çekirdek
 * fonksiyonlara (scope.ts/scoped.ts) karşı GERÇEK, geçici bir SQLite
 * dosyası + gerçek migration + seed ile uygular (QA-PLAN.md §1).
 *
 * Seed verisi (bkz. `scripts/db-seed-dev.ts`): İşletme A (vehicleA1,
 * vehicleA2 — ikisi de aktif), İşletme B (vehicleB1 aktif, vehicleB2
 * PASİF). Bu, "aynı işletmede farklı araçlar" (A1 vs A2) ve "farklı
 * işletmeler" (A vs B) senaryolarını TEK seed'den karşılar.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS } from "../../scripts/db-seed-dev";
import {
  createDb,
  openDatabaseConnection,
  withImmediateTransaction,
  type AppDatabase,
  type SqliteConnection,
} from "../../src/server/data/db";
import { people, vehicleDrivers, vehicles } from "../../src/server/data/schema";
import {
  recheckScopeInTransaction,
  scopedPeopleFilter,
  scopedVehicleDriversFilter,
  scopedVehiclesFilter,
  scopeFilter,
  ScopeMissingVehicleIdError,
  ScopeTargetInactiveError,
  type RecheckScopeOptions,
} from "../../src/server/data/scoped";
import { systemClock } from "../../src/server/auth/session";
import {
  bumpCredentialVersion,
  bumpPlatformUserVersion,
  setBusinessActive,
  setPlatformUserActive,
  setVehicleActive,
} from "../../src/server/usecases/access";
import { createPlatformSession } from "../../src/server/usecases/session/create-platform-session";
import { createVehicleSession } from "../../src/server/usecases/session/create-vehicle-session";
import {
  SessionExpiredError,
  SessionRevokedError,
} from "../../src/server/usecases/session/errors";
import type { SessionContext } from "../../src/server/usecases/session/types";
import {
  InvalidSessionKindForScopeError,
  resolveAdminScope,
  resolveStaffVehicleScopeFromHeader,
  scopeFromVehicleSession,
  TARGET_VEHICLE_HEADER,
  type Scope,
  type StaffScope,
} from "../../src/server/auth/scope";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");

function targetRequest(vehicleId: string | null, extraBody?: unknown): Request {
  const headers = new Headers();
  if (vehicleId !== null) {
    headers.set(TARGET_VEHICLE_HEADER, vehicleId);
  }
  if (extraBody !== undefined) {
    headers.set("content-type", "application/json");
    return new Request("https://example.invalid/api/v1/work-entries", {
      method: "POST",
      headers,
      body: JSON.stringify(extraBody),
    });
  }
  return new Request("https://example.invalid/api/v1/work-entries", {
    headers,
  });
}

describe("scope.ts + scoped.ts — T1.5 ADIM 1/2 (gerçek geçici SQLite + migration + seed)", () => {
  let dir: string;
  let sqlite: SqliteConnection;
  let db: AppDatabase;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-scope-"));
    sqlite = openDatabaseConnection(path.join(dir, "test.sqlite"), {
      createIfMissing: true,
    });
    db = createDb(sqlite);
    migrate(db, { migrationsFolder });
    await seedDevData(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------
  // resolveStaffVehicleScopeFromHeader — müşteri uçları (X-Target-Vehicle)
  // -------------------------------------------------------------------

  describe("resolveStaffVehicleScopeFromHeader", () => {
    it("support oturumu + geçerli X-Target-Vehicle (İşletme A, araç 1) → doğru businessId/vehicleId ile Scope üretir", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const result = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(SEED_IDS.vehicleA1),
        db,
        "read",
      );
      expect(result).toEqual({
        ok: true,
        scope: {
          kind: "staff",
          actor: "support",
          businessId: SEED_IDS.businessA,
          vehicleId: SEED_IDS.vehicleA1,
          platformUserId: SEED_IDS.platformSupport1,
          onBehalfOf: true,
        },
      });
    });

    it("aynı işletmede FARKLI araç (A1 vs A2) FARKLI businessId'ye DÜŞMEZ ama vehicleId doğru ayrışır", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      const r1 = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(SEED_IDS.vehicleA1),
        db,
        "read",
      );
      const r2 = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(SEED_IDS.vehicleA2),
        db,
        "read",
      );
      expect(r1.ok && r1.scope.businessId).toBe(SEED_IDS.businessA);
      expect(r2.ok && r2.scope.businessId).toBe(SEED_IDS.businessA);
      expect(r1.ok && r1.scope.vehicleId).toBe(SEED_IDS.vehicleA1);
      expect(r2.ok && r2.scope.vehicleId).toBe(SEED_IDS.vehicleA2);
    });

    it("FARKLI işletmenin aracı (B1) doğru şekilde businessB'ye çözülür — A'nın kapsamına SIZMAZ", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      const result = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(SEED_IDS.vehicleB1),
        db,
        "read",
      );
      expect(result.ok && result.scope.businessId).toBe(SEED_IDS.businessB);
      expect(result.ok && result.scope.businessId).not.toBe(SEED_IDS.businessA);
    });

    it("header hiç yoksa 422 TARGET_VEHICLE_MISSING döner (401/403/404 DEĞİL)", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const result = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(null),
        db,
        "read",
      );
      expect(result).toMatchObject({ ok: false, status: 422, code: "TARGET_VEHICLE_MISSING" });
    });

    it("header boş/whitespace ise 422 TARGET_VEHICLE_INVALID döner", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const result = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest("   "),
        db,
        "read",
      );
      expect(result).toMatchObject({ ok: false, status: 422, code: "TARGET_VEHICLE_INVALID" });
    });

    it("var olmayan araç ID'si → 404 TARGET_VEHICLE_NOT_FOUND (bilgi sızdırmaz: hangi işletmeye ait olduğu SÖYLENMEZ)", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const result = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest("00000000-0000-4000-8000-000000000000"),
        db,
        "read",
      );
      expect(result).toMatchObject({ ok: false, status: 404, code: "TARGET_VEHICLE_NOT_FOUND" });
      expect(JSON.stringify(result)).not.toContain(SEED_IDS.businessA);
      expect(JSON.stringify(result)).not.toContain(SEED_IDS.businessB);
    });

    it("PASİF araç (vehicleB2) — okuma (mode:'read') KABUL edilir", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const result = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(SEED_IDS.vehicleB2),
        db,
        "read",
      );
      expect(result).toMatchObject({
        ok: true,
        scope: { businessId: SEED_IDS.businessB, vehicleId: SEED_IDS.vehicleB2 },
      });
    });

    it("PASİF araç (vehicleB2) — yazma (mode:'write') 403 TARGET_INACTIVE_FOR_WRITE döner (404 DEĞİL — nesne bulunabilir, işlem yapılamaz)", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const result = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(SEED_IDS.vehicleB2),
        db,
        "write",
      );
      expect(result).toMatchObject({ ok: false, status: 403, code: "TARGET_INACTIVE_FOR_WRITE" });
    });

    it("aktif araç ama PASİF işletme — yazma 403 döner; okuma kabul edilir", async () => {
      setBusinessActive(db, SEED_IDS.businessA, false);
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);

      const writeResult = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(SEED_IDS.vehicleA1),
        db,
        "write",
      );
      expect(writeResult).toMatchObject({ ok: false, status: 403, code: "TARGET_INACTIVE_FOR_WRITE" });

      const readResult = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(SEED_IDS.vehicleA1),
        db,
        "read",
      );
      expect(readResult).toMatchObject({ ok: true });
    });

    it("STORIES S1.5 AC2 — istemcinin gövdeye eklediği businessId/role/personId/ownerId ASLA okunmaz/kullanılmaz (yalnız header + DB kullanılır)", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const request = targetRequest(SEED_IDS.vehicleA1, {
        businessId: SEED_IDS.businessB,
        role: "admin",
        personId: "baska-kisi",
        ownerId: "baska-sahip",
      });

      const result = await resolveStaffVehicleScopeFromHeader(context, request, db, "read");

      expect(result.ok).toBe(true);
      // Gövdenin businessId'si (İşletme B) DEĞİL, header'daki aracın GERÇEK
      // işletmesi (A) döner.
      expect(result.ok && result.scope.businessId).toBe(SEED_IDS.businessA);
      // Oturumun GERÇEK rolü (support) korunur; gövdedeki "admin" YOKSAYILIR.
      expect(result.ok && result.scope.actor).toBe("support");
      // Fonksiyon gövdeyi HİÇ OKUMADI (yapısal kanıt — yalnız header'a bakar).
      expect(request.bodyUsed).toBe(false);
    });

    it("araç (vehicle) oturumuyla çağrılırsa (programlama hatası) fırlatır", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      await expect(
        resolveStaffVehicleScopeFromHeader(context, targetRequest(SEED_IDS.vehicleA1), db, "read"),
      ).rejects.toThrow(InvalidSessionKindForScopeError);
    });
  });

  // -------------------------------------------------------------------
  // resolveAdminScope — /admin/* uçları (hedef path ID'lerinden)
  // -------------------------------------------------------------------

  describe("resolveAdminScope", () => {
    it("yalnız vehicleId verildiğinde businessId'yi DOĞRU türetir", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      const result = await resolveAdminScope(context, { vehicleId: SEED_IDS.vehicleB1 }, db);
      expect(result).toMatchObject({
        ok: true,
        scope: { businessId: SEED_IDS.businessB, vehicleId: SEED_IDS.vehicleB1, actor: "admin" },
      });
    });

    it("businessId + vehicleId TUTARLIYSA kabul eder", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      const result = await resolveAdminScope(
        context,
        { businessId: SEED_IDS.businessA, vehicleId: SEED_IDS.vehicleA1 },
        db,
      );
      expect(result).toMatchObject({ ok: true });
    });

    it("businessId + vehicleId TUTARSIZSA (başka işletmenin aracı path'e yazılmış) 404 döner", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      const result = await resolveAdminScope(
        context,
        { businessId: SEED_IDS.businessA, vehicleId: SEED_IDS.vehicleB1 },
        db,
      );
      expect(result).toMatchObject({ ok: false, status: 404, code: "TARGET_VEHICLE_NOT_FOUND" });
    });

    it("yalnız businessId (var olan) verildiğinde vehicleId OLMAYAN Scope üretir", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      const result = await resolveAdminScope(context, { businessId: SEED_IDS.businessA }, db);
      expect(result.ok).toBe(true);
      expect(result.ok && result.scope).not.toHaveProperty("vehicleId");
    });

    it("var olmayan businessId → 404 TARGET_BUSINESS_NOT_FOUND", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      const result = await resolveAdminScope(
        context,
        { businessId: "00000000-0000-4000-8000-000000000000" },
        db,
      );
      expect(result).toMatchObject({ ok: false, status: 404, code: "TARGET_BUSINESS_NOT_FOUND" });
    });

    it("hiçbir hedef verilmezse (çağıranın programlama hatası) fırlatır", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      await expect(resolveAdminScope(context, {}, db)).rejects.toThrow(
        InvalidSessionKindForScopeError,
      );
    });
  });

  // -------------------------------------------------------------------
  // scopeFilter / scopedXxxFilter — gerçek sorgularda işletme/araç izolasyonu
  // -------------------------------------------------------------------

  describe("scopedPeopleFilter / scopedVehiclesFilter / scopedVehicleDriversFilter", () => {
    it("İşletme A'nın Scope'u yalnız İşletme A'nın kişilerini döner — İşletme B SIZMAZ", () => {
      const scope: Scope = scopeFromVehicleSessionFixture("A");
      const rows = db.select({ id: people.id }).from(people).where(scopedPeopleFilter(scope)).all();
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(SEED_IDS.ownerA);
      expect(ids).not.toContain(SEED_IDS.ownerB);
      expect(ids).not.toContain(SEED_IDS.driverB1a);
    });

    it("staff Scope'u belirli bir araca (vehicleA1) indiğinde scopedVehiclesFilter yalnız O aracı döner (aynı işletmenin A2'si DEĞİL)", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const resolved = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(SEED_IDS.vehicleA1),
        db,
        "read",
      );
      if (!resolved.ok) throw new Error("beklenmeyen hata");
      const rows = db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(scopedVehiclesFilter(resolved.scope))
        .all();
      expect(rows.map((r) => r.id)).toEqual([SEED_IDS.vehicleA1]);
    });

    it("scopedVehicleDriversFilter yalnız o aracın atamalarını döner — aynı işletmedeki DİĞER aracın atamaları SIZMAZ", () => {
      const scopeVehicleA1: Scope = scopeFromVehicleSessionFixture("A");
      const rowsA1 = db
        .select({ personId: vehicleDrivers.personId })
        .from(vehicleDrivers)
        .where(scopedVehicleDriversFilter(scopeVehicleA1))
        .all();
      const idsA1 = rowsA1.map((r) => r.personId);
      // Seed: vehicleA1'in şoförleri driverA1a/b/c/d; vehicleA2'ninki
      // driverA2a — birbirine KARIŞMAMALI.
      expect(idsA1).toContain(SEED_IDS.driverA1a);
      expect(idsA1).not.toContain(SEED_IDS.driverA2a);
    });

    it("scopeFilter, vehicle_id sütunu istenip Scope'ta vehicleId YOKKEN (yalnız işletme hedefli StaffScope) fırlar", () => {
      const businessOnlyScope: StaffScope = {
        kind: "staff",
        actor: "admin",
        businessId: SEED_IDS.businessA,
        platformUserId: SEED_IDS.platformAdmin1,
        onBehalfOf: true,
      };
      expect(() =>
        scopeFilter(businessOnlyScope, { businessId: vehicles.businessId, vehicleId: vehicles.id }),
      ).toThrow(ScopeMissingVehicleIdError);
    });
  });

  function scopeFromVehicleSessionFixture(which: "A" | "B"): Scope {
    return {
      kind: "vehicle",
      actor: "owner",
      businessId: which === "A" ? SEED_IDS.businessA : SEED_IDS.businessB,
      vehicleId: which === "A" ? SEED_IDS.vehicleA1 : SEED_IDS.vehicleB1,
      credentialId: which === "A" ? SEED_IDS.credA1Owner : SEED_IDS.credB1Owner,
    };
  }

  // -------------------------------------------------------------------
  // recheckScopeInTransaction — ARCH §3.4 adım 3 / STORIES S1.5 AC7
  // -------------------------------------------------------------------

  describe("recheckScopeInTransaction", () => {
    function guardedWrite(
      context: SessionContext,
      scope: Scope,
      options?: RecheckScopeOptions,
    ): void {
      withImmediateTransaction(sqlite, () => {
        recheckScopeInTransaction(db, context, scope, systemClock, options);
        db.update(people)
          .set({ fullName: "YAZILDI" })
          .where(eq(people.id, SEED_IDS.ownerA))
          .run();
      });
    }

    it("geçerli/değişmemiş bir kapsam için SESSİZCE geçer (throw ETMEZ) ve yazma commit edilir", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);
      expect(() => guardedWrite(context, scope)).not.toThrow();
      const row = db.select({ fullName: people.fullName }).from(people).where(eq(people.id, SEED_IDS.ownerA)).get();
      expect(row?.fullName).toBe("YAZILDI");
    });

    it("guard SONRASI, commit ÖNCESİ oturum iptal edilirse (bumpCredentialVersion) 401 sınıfı hata fırlatır VE yazma ROLLBACK olur", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      // Aradaki iptal — S1.5 AC7'nin birebir senaryosu: "Arada erişimi
      // iptal edilen kullanıcı eski başarılı işlem yanıtını kullanarak
      // yeni yetki kazanamaz."
      bumpCredentialVersion(db, SEED_IDS.credA1Owner);

      expect(() => guardedWrite(context, scope)).toThrow(SessionRevokedError);
      const row = db.select({ fullName: people.fullName }).from(people).where(eq(people.id, SEED_IDS.ownerA)).get();
      expect(row?.fullName).not.toBe("YAZILDI");
    });

    // NOT: `setVehicleActive(db, id, false)`/`setBusinessActive(db, id,
    // false)` KENDİSİ o araç/işletmenin TÜM oturumlarını AYNI anda iptal
    // eder (bkz. `../../src/server/usecases/access/*` — T1.4'ün KASITLI
    // "iki katman" tasarımı). Araç OTURUMU kendi aracını/işletmesini
    // pasifleştirdiğinde bu yüzden `recheckScopeInTransaction` ÖNCE
    // SessionRevokedError'a (401 — oturumun kendisi artık geçersiz) düşer;
    // ScopeTargetInactiveError (403) YOLU vehicle-actor için bu iki
    // usecase üzerinden hiç ULAŞILAMAZ senaryodur (aşağıdaki ayrı testte
    // doğrulanır). Bu tek başına 403 dalının recheckScopeInTransaction'ın
    // KENDİ, BAĞIMSIZ bir savunma katmanı olduğunu (yalnız cascade'e
    // GÜVENMEDEN) kanıtlamak için, `active` bayrağı burada KASITLI olarak
    // o usecase'ler ATLANARAK doğrudan SQL ile çevrilir — session
    // revoke edilmeden yalnız aktiflik bayrağı değişmiş bir DURUM
    // (ör. ileride eklenecek farklı bir yönetim akışı) simüle edilir.
    it("(izole) araç aktiflik bayrağı, oturum iptal edilmeden değişirse recheckScopeInTransaction KENDİSİ 403 (ScopeTargetInactiveError) fırlatır VE yazma ROLLBACK olur", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      sqlite
        .prepare("UPDATE vehicles SET active = 0 WHERE id = ?")
        .run(SEED_IDS.vehicleA1);

      expect(() => guardedWrite(context, scope)).toThrow(ScopeTargetInactiveError);
      const row = db.select({ fullName: people.fullName }).from(people).where(eq(people.id, SEED_IDS.ownerA)).get();
      expect(row?.fullName).not.toBe("YAZILDI");
    });

    it("(izole) işletme aktiflik bayrağı, oturum iptal edilmeden değişirse recheckScopeInTransaction KENDİSİ 403 (ScopeTargetInactiveError) fırlatır", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      sqlite
        .prepare("UPDATE businesses SET active = 0 WHERE id = ?")
        .run(SEED_IDS.businessA);

      expect(() => guardedWrite(context, scope)).toThrow(ScopeTargetInactiveError);
    });

    // Düzeltme turu 1 — denetim bulgusu (mimari merceği): staff'ın PASİF bir
    // hedefi `active: true` yapan (reaktive eden) yazması, hedefin O AN
    // pasif olması YÜZÜNDEN recheck'te 403'e düşmemelidir — bu, ARCH §2
    // yetki matrisinin staff'a verdiği TEK meşru "işletme/araç açma"
    // senaryosudur. Aşağıdaki iki test `RecheckScopeOptions` ile bu yolun
    // artık YAPISAL olarak mümkün olduğunu kanıtlar.
    it("(izole) skipVehicleActiveCheck: true verildiğinde PASİF araç recheck'i GEÇER — staff'ın aracı reaktive eden yazması artık engellenmez", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      const resolved = await resolveAdminScope(
        context,
        { vehicleId: SEED_IDS.vehicleB2 },
        db,
      );
      if (!resolved.ok) throw new Error("beklenmeyen hata");
      expect(resolved.scope.vehicleId).toBe(SEED_IDS.vehicleB2);

      // Seed'de vehicleB2 zaten PASİF (bkz. dosya üstü notu) — tam olarak
      // "reaktive edilecek hedef" senaryosu, ayrıca SQL ile değiştirmeye
      // gerek yok.
      expect(() =>
        guardedWrite(context, resolved.scope, { skipVehicleActiveCheck: true }),
      ).not.toThrow();
    });

    it("(izole) skipBusinessActiveCheck: true verildiğinde PASİF işletme recheck'i GEÇER; bayrak VERİLMEZSE aynı durum yine 403 fırlatır", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      sqlite
        .prepare("UPDATE businesses SET active = 0 WHERE id = ?")
        .run(SEED_IDS.businessA);

      expect(() =>
        guardedWrite(context, scope, { skipBusinessActiveCheck: true }),
      ).not.toThrow();
      // Varsayılan (bayraksız) davranış BOZULMADI — üsttekiyle AYNI durum,
      // options verilmeden yine 403'tür.
      expect(() => guardedWrite(context, scope)).toThrow(ScopeTargetInactiveError);
    });

    it("(izole) skipVehicleActiveCheck: true verilse bile AKTÖRÜN kendi oturumu geçersizse (401 sınıfı) yine fırlatır — bayrak yalnız HEDEF aktiflik denetimini atlar, aktör kimliğini DEĞİL", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      bumpCredentialVersion(db, SEED_IDS.credA1Owner);

      expect(() =>
        guardedWrite(context, scope, {
          skipBusinessActiveCheck: true,
          skipVehicleActiveCheck: true,
        }),
      ).toThrow(SessionRevokedError);
    });

    it("gerçek dünyada: setVehicleActive KENDİSİ aynı araca ait oturumu ZATEN iptal ettiğinden, recheck 403 DEĞİL 401 (SessionRevokedError) üretir (iki katmanın BİRLİKTE davranışı — T1.4 cascade + T1.5 recheck TUTARLI)", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      setVehicleActive(db, SEED_IDS.vehicleA1, false);

      expect(() => guardedWrite(context, scope)).toThrow(SessionRevokedError);
    });

    it("STAFF senaryosu: platform_user'ın KENDİ kimliği geçerliyken, HEDEF aracın (staff'ın kendi kimliğinden BAĞIMSIZ) pasifleşmesi 403 üretir", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const resolved = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(SEED_IDS.vehicleA1),
        db,
        "write",
      );
      if (!resolved.ok) throw new Error("beklenmeyen hata");

      setVehicleActive(db, SEED_IDS.vehicleA1, false);

      expect(() => guardedWrite(context, resolved.scope)).toThrow(ScopeTargetInactiveError);
    });

    it("STAFF senaryosu: platform_user pasifleştirilirse (kendi kimliği geçersiz) 401 sınıfı hata fırlatır", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const resolved = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(SEED_IDS.vehicleA1),
        db,
        "write",
      );
      if (!resolved.ok) throw new Error("beklenmeyen hata");

      setPlatformUserActive(db, SEED_IDS.platformSupport1, false);

      expect(() => guardedWrite(context, resolved.scope)).toThrow(SessionRevokedError);
    });

    it("STAFF senaryosu: platform_user credential_version artarsa (parola sıfırlandıysa) 401 sınıfı hata fırlatır", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const resolved = await resolveStaffVehicleScopeFromHeader(
        context,
        targetRequest(SEED_IDS.vehicleA1),
        db,
        "write",
      );
      if (!resolved.ok) throw new Error("beklenmeyen hata");

      bumpPlatformUserVersion(db, SEED_IDS.platformSupport1);

      expect(() => guardedWrite(context, resolved.scope)).toThrow(SessionRevokedError);
    });

    it("süresi dolmuş bir oturum (fixedClock ile üretilmiş) recheck anında 401 (SessionExpiredError) fırlatır", async () => {
      const pastClock = () => new Date("2000-01-01T00:00:00.000Z");
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner, pastClock);
      const scope = scopeFromVehicleSession(context);

      expect(() =>
        withImmediateTransaction(sqlite, () => {
          recheckScopeInTransaction(db, context, scope);
        }),
      ).toThrow(SessionExpiredError);
    });
  });
});
