/**
 * updateBusiness — T2.1, `PATCH /api/v1/admin/businesses/[businessId]`.
 *
 * Tek BEGIN IMMEDIATE transaction içinde: sürüm denetimi (ARCH §3.4 —
 * "koşullu UPDATE ... version"), sahip atama (yalnız sahipsiz işletmeye),
 * sahip adı düzeltme (people.version ile ayrı sürüm denetimi), aktiflik
 * değişimi (pasifleşince oturum iptali) ve admin_audit/mutation_receipts
 * birlikte yazılır.
 *
 * "Aynı değerle PATCH" (T2.1 risk notu) — `name`/`active` yalnız GERÇEKTEN
 * mevcut değerden FARKLIYSA bir "değişiklik" sayılır (businesses.version
 * artırılır, audit satırı yazılır); hiçbir alan gerçek bir değişiklik
 * getirmiyorsa (hepsi aynı veya PATCH gövdesi zaten boşsa — ikincisi zod
 * düzeyinde zaten reddedilir) 422 VALIDATION_ERROR "Değişiklik yok."
 * döner, sürüm artırılmaz, audit yazılmaz.
 */
import crypto from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { StaffScope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { withImmediateTransaction } from "../../data/db";
import { adminAudit, businessOwners, businesses, people } from "../../data/schema";
import type { SessionContext } from "../session/types";
import { revokeSessionsForBusinessSync } from "../session/revoke-session";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import { hashRequestPayload } from "./request-hash";
import { getBusinessDetail, type BusinessDetail } from "./queries";
import { BusinessValidationError, BusinessVersionConflictError } from "./errors";
import { PersonAnonymizedError } from "../drivers/errors";

export interface UpdateBusinessOwnerAssignment {
  /** Aynı işletmedeki mevcut, aktif bir kişiyi sahip yapar. */
  existingPersonRef?: string;
  /** Yeni bir kişi oluşturup sahip yapar. */
  newFullName?: string;
}

export interface UpdateBusinessOwnerRename {
  fullName: string;
  ownerVersion: number;
}

export interface UpdateBusinessParams {
  requestId: string;
  version: number;
  name?: string;
  active?: boolean;
  ownerAssignment?: UpdateBusinessOwnerAssignment;
  ownerRename?: UpdateBusinessOwnerRename;
}

export interface UpdateBusinessResult {
  status: number;
  detail: BusinessDetail;
}

function insertAudit(
  db: AppDatabase,
  context: SessionContext,
  businessId: string,
  now: string,
  fields: {
    entityType: string;
    entityId: string;
    action: string;
    beforeJson: string | null;
    afterJson: string;
  },
): void {
  db.insert(adminAudit)
    .values({
      id: crypto.randomUUID(),
      businessId,
      vehicleId: null,
      entityType: fields.entityType,
      entityId: fields.entityId,
      action: fields.action,
      beforeJson: fields.beforeJson,
      afterJson: fields.afterJson,
      actorKind: "platform_user",
      actorSessionId: context.sessionId,
      actorRole: context.role,
      actorCredentialId: null,
      actorPlatformUserId: context.platformUserId ?? null,
      onBehalfOfKind: null,
      onBehalfOfPersonId: null,
      occurredAt: now,
    })
    .run();
}

export function updateBusiness(
  db: AppDatabase,
  context: SessionContext,
  scope: StaffScope,
  params: UpdateBusinessParams,
  clock: Clock = systemClock,
): UpdateBusinessResult {
  const businessId = scope.businessId;
  const requestHash = hashRequestPayload({
    version: params.version,
    name: params.name ?? null,
    active: params.active ?? null,
    ownerAssignment: params.ownerAssignment ?? null,
    ownerRename: params.ownerRename ?? null,
  });

  return withImmediateTransaction(db.$client, () => {
    // "yalnız BU mutasyon işletmeyi bizzat aktive ediyorsa" (T2.1 risk
    // notu) — reaktivasyon istisnası yalnız `active: true` GÖNDERİLDİĞİNDE
    // uygulanır; diğer her yazma pasif işletmede normal 403 alır. Bu
    // istisna `resolveReceipt`'e (dolayısıyla onun İÇİNDEKİ
    // `recheckScopeInTransaction`'a) da geçirilir — aksi halde reaktivasyon
    // isteğinin İLK denemesi, henüz makbuz aranmadan, sıkı denetimde 403'e
    // düşerdi (bkz. `../receipts/find-receipt.ts`'in güncellenmiş üst notu).
    const recheckOptions = { skipBusinessActiveCheck: params.active === true };

    const resolved = resolveReceipt(
      db,
      context,
      scope,
      { requestId: params.requestId, operation: "business.update", requestHash },
      clock,
      recheckOptions,
    );
    if (resolved.replay) {
      return { status: resolved.receipt.responseCode, detail: getBusinessDetail(db, businessId) };
    }

    const currentBusiness = db
      .select({ name: businesses.name, active: businesses.active, version: businesses.version })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .get();
    if (!currentBusiness) {
      throw new Error(
        `updateBusiness: işletme bulunamadı: "${businessId}" (programlama hatası — resolveAdminScope zaten doğrulamış olmalıydı).`,
      );
    }

    // Bayat `version` "değişiklik yok"/"zaten sahibi var" 422'lerinden ÖNCE
    // 409 almalı (istemci önce güncel kaydı görmeli). Bu okuma yalnız erken
    // bir denetimdir; yarışa karşı asıl koruma aşağıdaki koşullu UPDATE'tir
    // (`WHERE version = ?`, `changes = 1`).
    if (currentBusiness.version !== params.version) {
      throw new BusinessVersionConflictError();
    }

    const wantsNameChange = params.name !== undefined && params.name !== currentBusiness.name;
    const wantsActiveChange =
      params.active !== undefined && params.active !== currentBusiness.active;

    if (
      !wantsNameChange &&
      !wantsActiveChange &&
      params.ownerAssignment === undefined &&
      params.ownerRename === undefined
    ) {
      throw new BusinessValidationError(
        { change: "Değişiklik yok." },
        "Gönderilen değerler mevcut kayıtla aynı; değişiklik uygulanmadı.",
      );
    }

    const now = clock().toISOString();

    // --- Sahip atama — yalnız sahipsiz işletmeye, devir yok. ---
    if (params.ownerAssignment) {
      const existingOwner = db
        .select({ personId: businessOwners.personId })
        .from(businessOwners)
        .where(eq(businessOwners.businessId, businessId))
        .get();
      if (existingOwner) {
        throw new BusinessValidationError({
          ownerAssignment: "Bu işletmenin zaten bir sahibi var.",
        });
      }

      let ownerPersonId: string;
      let ownerFullName: string;
      if (params.ownerAssignment.existingPersonRef) {
        const person = db
          .select({ id: people.id, active: people.active, fullName: people.fullName })
          .from(people)
          .where(
            and(
              eq(people.businessId, businessId),
              eq(people.id, params.ownerAssignment.existingPersonRef),
            ),
          )
          .get();
        if (!person || !person.active) {
          throw new BusinessValidationError({
            ownerAssignment: "Belirtilen kişi bu işletmede bulunamadı.",
          });
        }
        ownerPersonId = person.id;
        ownerFullName = person.fullName;
      } else {
        // zod şeması `existingPersonRef`/`newFullName`'den TAM BİRİNİ
        // zorunlu kılar (bkz. route handler) — buraya ulaşıldıysa
        // `newFullName` dolu olmalıdır.
        ownerPersonId = crypto.randomUUID();
        ownerFullName = params.ownerAssignment.newFullName!;
        db.insert(people)
          .values({
            businessId,
            id: ownerPersonId,
            fullName: ownerFullName,
            active: true,
            version: 1,
          })
          .run();
      }

      db.insert(businessOwners).values({ businessId, personId: ownerPersonId }).run();
      insertAudit(db, context, businessId, now, {
        entityType: "business",
        entityId: businessId,
        action: "business.owner_assign",
        beforeJson: JSON.stringify({ ownerPersonId: null }),
        afterJson: JSON.stringify({ ownerPersonId, ownerFullName }),
      });
    }

    // --- Sahip adı düzeltmesi — aynı person id korunur, people.version artar.
    // Adı anonimleştirilmiş sahip yeniden adlandırılamaz (geri dönüşsüz). ---
    if (params.ownerRename) {
      const owner = db
        .select({ personId: businessOwners.personId })
        .from(businessOwners)
        .where(eq(businessOwners.businessId, businessId))
        .get();
      if (!owner) {
        throw new BusinessValidationError({ ownerRename: "Bu işletmenin sahibi yok." });
      }
      const beforePerson = db
        .select({ fullName: people.fullName, anonymizedAt: people.anonymizedAt })
        .from(people)
        .where(and(eq(people.businessId, businessId), eq(people.id, owner.personId)))
        .get();
      if (!beforePerson) {
        throw new Error(
          `updateBusiness: sahip kişi kaydı bulunamadı: "${owner.personId}" (programlama hatası).`,
        );
      }
      if (beforePerson.anonymizedAt !== null) {
        throw new PersonAnonymizedError();
      }

      const renameResult = db
        .update(people)
        .set({ fullName: params.ownerRename.fullName, version: sql`${people.version} + 1` })
        .where(
          and(
            eq(people.businessId, businessId),
            eq(people.id, owner.personId),
            eq(people.version, params.ownerRename.ownerVersion),
            isNull(people.anonymizedAt),
          ),
        )
        .run();
      if (renameResult.changes !== 1) {
        throw new BusinessVersionConflictError();
      }

      insertAudit(db, context, businessId, now, {
        entityType: "person",
        entityId: owner.personId,
        action: "person.rename",
        beforeJson: JSON.stringify({
          fullName: beforePerson.fullName,
          version: params.ownerRename.ownerVersion,
        }),
        afterJson: JSON.stringify({
          fullName: params.ownerRename.fullName,
          version: params.ownerRename.ownerVersion + 1,
        }),
      });
    }

    // --- İşletme adı/aktiflik + sürüm (her başarılı PATCH sürümü artırır). ---
    const businessChanges: { version: ReturnType<typeof sql>; name?: string; active?: boolean } = {
      version: sql`${businesses.version} + 1`,
    };
    if (wantsNameChange) businessChanges.name = params.name;
    if (wantsActiveChange) businessChanges.active = params.active;

    const businessUpdateResult = db
      .update(businesses)
      .set(businessChanges)
      .where(and(eq(businesses.id, businessId), eq(businesses.version, params.version)))
      .run();
    if (businessUpdateResult.changes !== 1) {
      throw new BusinessVersionConflictError();
    }
    const newBusinessVersion = params.version + 1;

    // "işletme pasife alındığında o işletmenin tüm araç oturumları
    // revoked_at alır" (S2.1 AC6 — bu risk notu `setBusinessActive`'in
    // AYNI SQL'ini burada tekrar kullanır, kopyalamaz).
    if (wantsActiveChange && params.active === false) {
      revokeSessionsForBusinessSync(db, businessId, clock);
    }

    if (wantsNameChange) {
      insertAudit(db, context, businessId, now, {
        entityType: "business",
        entityId: businessId,
        action: "business.update",
        beforeJson: JSON.stringify({ name: currentBusiness.name, version: params.version }),
        afterJson: JSON.stringify({ name: params.name, version: newBusinessVersion }),
      });
    }
    if (wantsActiveChange) {
      insertAudit(db, context, businessId, now, {
        entityType: "business",
        entityId: businessId,
        action: params.active ? "business.reactivate" : "business.deactivate",
        beforeJson: JSON.stringify({ active: currentBusiness.active, version: params.version }),
        afterJson: JSON.stringify({ active: params.active, version: newBusinessVersion }),
      });
    }

    recordReceipt(
      db,
      scope,
      {
        requestId: params.requestId,
        operation: "business.update",
        requestHash,
        entityId: businessId,
        resultVersion: newBusinessVersion,
        responseCode: 200,
      },
      clock,
    );

    return { status: 200, detail: getBusinessDetail(db, businessId) };
  });
}
