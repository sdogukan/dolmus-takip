/**
 * mutation_receipts kapsam bağı — entegrasyon testleri, T1.5 ADIM 2/2,
 * S1.5.
 *
 * Görev tanımı iş adımı 2 (birebir): "mutation_receipts kapsam bağı:
 * src/server/usecases/receipts/: scope_key = kalıcı aktör
 * kimliği (credentialId | platformUserId) + ':' + businessId + ':' +
 * vehicleId; findReceipt(scope, requestId, operation) ve
 * recordReceipt(...) transaction içinde; aynı request_id + aynı
 * request_hash → eski sonuç (entity_id, result_version, response_code);
 * farklı hash → 409 REQUEST_ID_REUSED; başka kapsamdan aynı request_id →
 * bulunamaz; erişimi iptal edilen aktör eski makbuz üzerinden veri
 * okuyamaz (yetki kontrolü makbuz okumada da yapılır). Entegrasyon
 * testleri gerçek SQLite ile."
 *
 * Bu paket henüz T3.4'ün GERÇEK work_entries mutasyonunu YAZMAZ (o T3.4
 * kapsamıdır); burada `recordReceipt`'e verilen `entityId`/`resultVersion`
 * KURGUSAL (ör. "we-1") değerlerdir — asıl kanıtlanan şey makbuzun KENDİ
 * (aramа/yazma/tekrar gönderim/kapsam/yetki) davranışıdır, iş kuralı
 * DEĞİL. Gerçek geçici SQLite dosyası + gerçek migration + seed
 * (mock/`:memory:` YOK).
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
import { mutationReceipts } from "../../src/server/data/schema";
import type { StaffScope } from "../../src/server/auth/scope";
import { scopeFromVehicleSession } from "../../src/server/auth/scope";
import {
  bumpCredentialVersion,
  setVehicleActive,
} from "../../src/server/usecases/access";
import { createPlatformSession } from "../../src/server/usecases/session/create-platform-session";
import { createVehicleSession } from "../../src/server/usecases/session/create-vehicle-session";
import {
  SessionRevokedError,
} from "../../src/server/usecases/session/errors";
import type { SessionContext } from "../../src/server/usecases/session/types";
import { ScopeTargetInactiveError } from "../../src/server/data/scoped";
import {
  computeReceiptScopeKey,
  findReceipt,
  recordReceipt,
  resolveReceipt,
  RequestIdReusedError,
  type MutationReceiptRecord,
} from "../../src/server/usecases/receipts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");

function staffScope(context: SessionContext, businessId: string, vehicleId?: string): StaffScope {
  if (context.kind !== "platform" || !context.platformUserId) {
    throw new Error("test yardımcı fonksiyonu yalnız platform oturumu bekler");
  }
  return {
    kind: "staff",
    actor: context.role as "support" | "admin",
    businessId,
    ...(vehicleId ? { vehicleId } : {}),
    platformUserId: context.platformUserId,
    onBehalfOf: true,
  };
}

describe("mutation_receipts kapsam bağı (T1.5 ADIM 2/2) — gerçek geçici SQLite + migration + seed", () => {
  let dir: string;
  let sqlite: SqliteConnection;
  let db: AppDatabase;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-receipts-"));
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
  // computeReceiptScopeKey — görev tanımının birebir biçimi.
  // -------------------------------------------------------------------

  describe("computeReceiptScopeKey", () => {
    it("araç oturumu için 'credentialId:businessId:vehicleId' üretir", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);
      expect(computeReceiptScopeKey(scope)).toBe(
        `${SEED_IDS.credA1Owner}:${SEED_IDS.businessA}:${SEED_IDS.vehicleA1}`,
      );
    });

    it("ekip (staff) hedefi için 'platformUserId:businessId:vehicleId' üretir", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const scope = staffScope(context, SEED_IDS.businessA, SEED_IDS.vehicleA1);
      expect(computeReceiptScopeKey(scope)).toBe(
        `${SEED_IDS.platformSupport1}:${SEED_IDS.businessA}:${SEED_IDS.vehicleA1}`,
      );
    });

    it("vehicleId OLMAYAN (salt işletme hedefli) StaffScope için boş dizeyle biter", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformAdmin1);
      const scope = staffScope(context, SEED_IDS.businessA);
      expect(computeReceiptScopeKey(scope)).toBe(
        `${SEED_IDS.platformAdmin1}:${SEED_IDS.businessA}:`,
      );
    });

    it("FARKLI araç (aynı işletme, aynı aktör TÜRÜ ama farklı credential) FARKLI scope_key üretir", async () => {
      const a1 = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const a2 = await createVehicleSession(db, SEED_IDS.credA2Owner);
      expect(computeReceiptScopeKey(scopeFromVehicleSession(a1.context))).not.toBe(
        computeReceiptScopeKey(scopeFromVehicleSession(a2.context)),
      );
    });
  });

  // -------------------------------------------------------------------
  // findReceipt / recordReceipt — arama + yazma, gerçek transaction.
  // -------------------------------------------------------------------

  describe("findReceipt + recordReceipt (transaction içinde)", () => {
    it("hiç yazılmamış bir request_id için findReceipt undefined döner", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      const result = withImmediateTransaction(sqlite, () =>
        findReceipt(db, context, scope, "req-yeni-1", "work_entry.create_driver"),
      );
      expect(result).toBeUndefined();
    });

    it("recordReceipt ile yazılan satır AYNI transaction dışından (yeni transaction) findReceipt ile GERİ okunur", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      withImmediateTransaction(sqlite, () => {
        recordReceipt(db, scope, {
          requestId: "req-1",
          operation: "work_entry.create_driver",
          requestHash: "hash-a",
          entityId: "we-1",
          resultVersion: 1,
          responseCode: 201,
        });
      });

      const found = withImmediateTransaction(sqlite, () =>
        findReceipt(db, context, scope, "req-1", "work_entry.create_driver"),
      );
      expect(found).toMatchObject({
        requestId: "req-1",
        operation: "work_entry.create_driver",
        requestHash: "hash-a",
        entityId: "we-1",
        resultVersion: 1,
        responseCode: 201,
      });
      expect(found?.scopeKey).toBe(computeReceiptScopeKey(scope));
    });

    it("aynı (scope_key, request_id) ikinci kez recordReceipt çağrılırsa (ÖNCE findReceipt İLE kontrol edilmeden — yanlış kullanım) DB'nin KENDİ PRIMARY KEY kısıtı reddeder", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      withImmediateTransaction(sqlite, () => {
        recordReceipt(db, scope, {
          requestId: "req-2",
          operation: "work_entry.create_driver",
          requestHash: "hash-a",
          entityId: "we-2",
          resultVersion: 1,
          responseCode: 201,
        });
      });

      expect(() =>
        withImmediateTransaction(sqlite, () => {
          recordReceipt(db, scope, {
            requestId: "req-2",
            operation: "work_entry.create_driver",
            requestHash: "hash-a",
            entityId: "we-2",
            resultVersion: 1,
            responseCode: 201,
          });
        }),
      ).toThrow(/UNIQUE constraint failed|SQLITE_CONSTRAINT/);
    });

    it("araya giren hata makbuz yazımını GERİ ALDIRIR (transaction rollback) — kayıt+revizyon+makbuz birlikte", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      expect(() =>
        withImmediateTransaction(sqlite, () => {
          recordReceipt(db, scope, {
            requestId: "req-rollback",
            operation: "work_entry.create_driver",
            requestHash: "hash-a",
            entityId: "we-x",
            resultVersion: 1,
            responseCode: 201,
          });
          throw new Error("simüle edilmiş yazma hatası (ör. revizyon INSERT'i başarısız)");
        }),
      ).toThrow("simüle edilmiş yazma hatası");

      const row = db
        .select()
        .from(mutationReceipts)
        .where(eq(mutationReceipts.requestId, "req-rollback"))
        .get();
      expect(row).toBeUndefined();
    });

    it("aynı request_id, FARKLI operation → RequestIdReusedError (409 sınıfı)", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      withImmediateTransaction(sqlite, () => {
        recordReceipt(db, scope, {
          requestId: "req-3",
          operation: "work_entry.create_driver",
          requestHash: "hash-a",
          entityId: "we-3",
          resultVersion: 1,
          responseCode: 201,
        });
      });

      expect(() =>
        withImmediateTransaction(sqlite, () =>
          findReceipt(db, context, scope, "req-3", "work_entry.edit_unconfirmed"),
        ),
      ).toThrow(RequestIdReusedError);
    });

    it("BAŞKA kapsamdan (farklı araç) aynı request_id → bulunamaz (undefined) — 'farklı kapsam' istismarı YOK sayılmaz, YENİ mutasyon sayılır", async () => {
      const a1 = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const a2 = await createVehicleSession(db, SEED_IDS.credA2Owner);
      const scopeA1 = scopeFromVehicleSession(a1.context);
      const scopeA2 = scopeFromVehicleSession(a2.context);

      withImmediateTransaction(sqlite, () => {
        recordReceipt(db, scopeA1, {
          requestId: "req-shared-id",
          operation: "work_entry.create_driver",
          requestHash: "hash-a1",
          entityId: "we-a1",
          resultVersion: 1,
          responseCode: 201,
        });
      });

      const foundInA2 = withImmediateTransaction(sqlite, () =>
        findReceipt(db, a2.context, scopeA2, "req-shared-id", "work_entry.create_driver"),
      );
      expect(foundInA2).toBeUndefined();

      // Kendi kapsamında (A1) hâlâ bulunur — YANLIŞLIKLA "iki kapsam
      // karıştı" değil, GERÇEKTEN ayrı satırlar.
      const foundInA1 = withImmediateTransaction(sqlite, () =>
        findReceipt(db, a1.context, scopeA1, "req-shared-id", "work_entry.create_driver"),
      );
      expect(foundInA1?.entityId).toBe("we-a1");
    });

    it("BAŞKA kapsamdan (farklı İŞLETME) aynı request_id → bulunamaz", async () => {
      const a1 = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const b1 = await createVehicleSession(db, SEED_IDS.credB1Owner);
      const scopeA1 = scopeFromVehicleSession(a1.context);
      const scopeB1 = scopeFromVehicleSession(b1.context);

      withImmediateTransaction(sqlite, () => {
        recordReceipt(db, scopeA1, {
          requestId: "req-cross-business",
          operation: "work_entry.create_driver",
          requestHash: "hash-a1",
          entityId: "we-a1",
          resultVersion: 1,
          responseCode: 201,
        });
      });

      const foundInB1 = withImmediateTransaction(sqlite, () =>
        findReceipt(db, b1.context, scopeB1, "req-cross-business", "work_entry.create_driver"),
      );
      expect(foundInB1).toBeUndefined();
    });

    it("aynı işletmenin İKİ FARKLI staff hedefi (araç A1 vs A2) aynı request_id'yi KARIŞTIRMAZ", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const scopeA1 = staffScope(context, SEED_IDS.businessA, SEED_IDS.vehicleA1);
      const scopeA2 = staffScope(context, SEED_IDS.businessA, SEED_IDS.vehicleA2);

      withImmediateTransaction(sqlite, () => {
        recordReceipt(db, scopeA1, {
          requestId: "req-staff-target",
          operation: "work_entry.confirm",
          requestHash: "hash-staff-a1",
          entityId: "we-staff-a1",
          resultVersion: 2,
          responseCode: 200,
        });
      });

      const foundOnA2 = withImmediateTransaction(sqlite, () =>
        findReceipt(db, context, scopeA2, "req-staff-target", "work_entry.confirm"),
      );
      expect(foundOnA2).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // resolveReceipt — hash karşılaştırması (replay / 409).
  // -------------------------------------------------------------------

  describe("resolveReceipt", () => {
    it("kayıt yoksa { replay: false } döner", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      const result = withImmediateTransaction(sqlite, () =>
        resolveReceipt(db, context, scope, {
          requestId: "req-fresh",
          operation: "work_entry.create_driver",
          requestHash: "hash-a",
        }),
      );
      expect(result).toEqual({ replay: false });
    });

    it("AYNI request_id + AYNI request_hash → eski sonucu (entity_id, result_version, response_code) döner", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      withImmediateTransaction(sqlite, () => {
        recordReceipt(db, scope, {
          requestId: "req-replay",
          operation: "work_entry.create_driver",
          requestHash: "hash-sabit",
          entityId: "we-replay",
          resultVersion: 1,
          responseCode: 201,
        });
      });

      const result = withImmediateTransaction(sqlite, () =>
        resolveReceipt(db, context, scope, {
          requestId: "req-replay",
          operation: "work_entry.create_driver",
          requestHash: "hash-sabit",
        }),
      );
      expect(result.replay).toBe(true);
      const replayResult = result as { replay: true; receipt: MutationReceiptRecord };
      expect(replayResult.receipt.entityId).toBe("we-replay");
      expect(replayResult.receipt.resultVersion).toBe(1);
      expect(replayResult.receipt.responseCode).toBe(201);
    });

    it("AYNI request_id + FARKLI request_hash → 409 RequestIdReusedError (içerik değişmiş, aynı anahtar tekrar kullanılamaz)", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      withImmediateTransaction(sqlite, () => {
        recordReceipt(db, scope, {
          requestId: "req-conflict",
          operation: "work_entry.create_driver",
          requestHash: "hash-eski",
          entityId: "we-eski",
          resultVersion: 1,
          responseCode: 201,
        });
      });

      expect(() =>
        withImmediateTransaction(sqlite, () =>
          resolveReceipt(db, context, scope, {
            requestId: "req-conflict",
            operation: "work_entry.create_driver",
            requestHash: "hash-yeni",
          }),
        ),
      ).toThrow(RequestIdReusedError);

      let caught: unknown;
      try {
        withImmediateTransaction(sqlite, () =>
          resolveReceipt(db, context, scope, {
            requestId: "req-conflict",
            operation: "work_entry.create_driver",
            requestHash: "hash-yeni",
          }),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(RequestIdReusedError);
      expect((caught as RequestIdReusedError).status).toBe(409);
      expect((caught as RequestIdReusedError).code).toBe("REQUEST_ID_REUSED");
    });

    it("100 tekrar (aynı anahtar+içerik) TEK makbuz üretir — çift kayıt önleme", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      for (let i = 0; i < 100; i++) {
        withImmediateTransaction(sqlite, () => {
          const resolved = resolveReceipt(db, context, scope, {
            requestId: "req-100-tekrar",
            operation: "work_entry.create_driver",
            requestHash: "hash-tekrar",
          });
          if (!resolved.replay) {
            recordReceipt(db, scope, {
              requestId: "req-100-tekrar",
              operation: "work_entry.create_driver",
              requestHash: "hash-tekrar",
              entityId: "we-tekrar",
              resultVersion: 1,
              responseCode: 201,
            });
          }
        });
      }

      const rows = db
        .select()
        .from(mutationReceipts)
        .where(eq(mutationReceipts.requestId, "req-100-tekrar"))
        .all();
      expect(rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------
  // Yetki kontrolü makbuz OKUMADA da yapılır (S1.5 AC7 — arada
  // erişimi iptal edilen aktör eski makbuz üzerinden veri OKUYAMAZ).
  // -------------------------------------------------------------------

  describe("erişimi iptal edilen aktör eski makbuz üzerinden veri okuyamaz", () => {
    it("makbuz yazıldıktan SONRA credential_version artarsa (parola sıfırlama benzeri) findReceipt 401 sınıfı (SessionRevokedError) fırlatır — eski sonucu DÖNMEZ", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      withImmediateTransaction(sqlite, () => {
        recordReceipt(db, scope, {
          requestId: "req-iptal-1",
          operation: "work_entry.create_driver",
          requestHash: "hash-a",
          entityId: "we-iptal-1",
          resultVersion: 1,
          responseCode: 201,
        });
      });

      bumpCredentialVersion(db, SEED_IDS.credA1Owner);

      expect(() =>
        withImmediateTransaction(sqlite, () =>
          findReceipt(db, context, scope, "req-iptal-1", "work_entry.create_driver"),
        ),
      ).toThrow(SessionRevokedError);

      // resolveReceipt de AYNI korumayı devralır (findReceipt'i sarar).
      expect(() =>
        withImmediateTransaction(sqlite, () =>
          resolveReceipt(db, context, scope, {
            requestId: "req-iptal-1",
            operation: "work_entry.create_driver",
            requestHash: "hash-a",
          }),
        ),
      ).toThrow(SessionRevokedError);
    });

    it("hedef ARAÇ makbuzdan SONRA pasifleştirilirse findReceipt 403 sınıfı (ScopeTargetInactiveError) fırlatır", async () => {
      const { context } = await createPlatformSession(db, SEED_IDS.platformSupport1);
      const scope = staffScope(context, SEED_IDS.businessA, SEED_IDS.vehicleA1);

      withImmediateTransaction(sqlite, () => {
        recordReceipt(db, scope, {
          requestId: "req-iptal-2",
          operation: "work_entry.confirm",
          requestHash: "hash-a",
          entityId: "we-iptal-2",
          resultVersion: 1,
          responseCode: 200,
        });
      });

      setVehicleActive(db, SEED_IDS.vehicleA1, false);

      expect(() =>
        withImmediateTransaction(sqlite, () =>
          findReceipt(db, context, scope, "req-iptal-2", "work_entry.confirm"),
        ),
      ).toThrow(ScopeTargetInactiveError);
    });

    it("iptalden ÖNCEKİ okuma HÂLÂ başarılıdır (yalnız aradaki iptal SONRASI reddedilir — testin kendi kontrolü)", async () => {
      const { context } = await createVehicleSession(db, SEED_IDS.credA1Owner);
      const scope = scopeFromVehicleSession(context);

      withImmediateTransaction(sqlite, () => {
        recordReceipt(db, scope, {
          requestId: "req-once-ok",
          operation: "work_entry.create_driver",
          requestHash: "hash-a",
          entityId: "we-once-ok",
          resultVersion: 1,
          responseCode: 201,
        });
      });

      const beforeRevoke = withImmediateTransaction(sqlite, () =>
        findReceipt(db, context, scope, "req-once-ok", "work_entry.create_driver"),
      );
      expect(beforeRevoke?.entityId).toBe("we-once-ok");
    });
  });
});
