/**
 * createBusinessWithOwner — T2.1, `POST /api/v1/admin/businesses`.
 *
 * ARCHITECTURE §3.4 (tek transaction, tekrar gönderim) — işletme, sahip
 * kişi kaydı, sahip bağı, admin_audit ve mutation_receipts TEK BEGIN
 * IMMEDIATE transaction içinde yazılır (risk notu — "Makbuz araması ve
 * kaydı aynı IMMEDIATE transaction içinde olmalı; aksi halde aynı
 * requestId ile paralel iki POST iki işletme üretebilir (TOCTOU)").
 *
 * Bu uçta henüz bir hedef İŞLETME YOKTUR (§3.4 risk notu — "POST
 * oluşturmada Scope yoktur"); bu yüzden makbuz kapsamı `../../auth/
 * scope.ts` `StaffActorScope` (yalnız ekip aktörünün kalıcı kimliği) ile
 * kurulur — `../../data/scoped.ts` `recheckScopeInTransaction`'ın
 * businessId'siz dalı (T2.1) yalnız oturum/platform kullanıcısı
 * geçerliliğini denetler.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import { buildStaffActorScope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { withImmediateTransaction } from "../../data/db";
import { adminAudit, businessOwners, businesses, people } from "../../data/schema";
import type { SessionContext } from "../session/types";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import { hashRequestPayload } from "./request-hash";

export interface CreateBusinessParams {
  requestId: string;
  name: string;
  ownerFullName: string;
}

export interface CreatedBusinessRepresentation {
  id: string;
  name: string;
  active: boolean;
  version: number;
  createdAt: string;
  owner: { personId: string; fullName: string; version: number };
}

export interface CreateBusinessResult {
  /** Yeni oluşturmada 201; tekrar gönderimde makbuzun kendi
   * `responseCode`'u (bu akışta HER ZAMAN 201, çünkü bu operasyon yalnız
   * BAŞARILI oluşturmada makbuz yazar). */
  status: number;
  business: CreatedBusinessRepresentation;
}

function readCreatedBusiness(db: AppDatabase, businessId: string): CreatedBusinessRepresentation {
  const business = db
    .select({
      id: businesses.id,
      name: businesses.name,
      active: businesses.active,
      version: businesses.version,
      createdAt: businesses.createdAt,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .get();
  if (!business) {
    throw new Error(
      `createBusinessWithOwner: oluşturulan işletme okunamadı: "${businessId}" (programlama hatası).`,
    );
  }
  const ownerRow = db
    .select({ personId: people.id, fullName: people.fullName, version: people.version })
    .from(businessOwners)
    .innerJoin(people, eq(people.id, businessOwners.personId))
    .where(eq(businessOwners.businessId, businessId))
    .get();
  if (!ownerRow) {
    throw new Error(
      `createBusinessWithOwner: oluşturulan işletmenin sahibi bulunamadı: "${businessId}" (programlama hatası).`,
    );
  }
  return { ...business, owner: ownerRow };
}

export function createBusinessWithOwner(
  db: AppDatabase,
  context: SessionContext,
  params: CreateBusinessParams,
  clock: Clock = systemClock,
): CreateBusinessResult {
  const scope = buildStaffActorScope(context);
  const requestHash = hashRequestPayload({ name: params.name, ownerFullName: params.ownerFullName });

  return withImmediateTransaction(db.$client, () => {
    const resolved = resolveReceipt(
      db,
      context,
      scope,
      { requestId: params.requestId, operation: "business.create", requestHash },
      clock,
    );

    if (resolved.replay) {
      const businessId = resolved.receipt.entityId;
      if (!businessId) {
        throw new Error(
          "createBusinessWithOwner: business.create makbuzu entityId taşımıyor (programlama hatası).",
        );
      }
      return { status: resolved.receipt.responseCode, business: readCreatedBusiness(db, businessId) };
    }

    const businessId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const now = clock().toISOString();

    db.insert(businesses)
      .values({ id: businessId, name: params.name, active: true, createdAt: now, version: 1 })
      .run();
    db.insert(people)
      .values({ businessId, id: ownerId, fullName: params.ownerFullName, active: true, version: 1 })
      .run();
    db.insert(businessOwners).values({ businessId, personId: ownerId }).run();

    // admin_audit — "gerçek platform_user_id, hedef, zaman ve parola/hash/
    // token içermeyen önce/sonra JSON" (T2.1 acceptance). Oluşturmada
    // `beforeJson` NULL (ARCH §3.2 — "ilk sürüm oluşturmayı temsil eder").
    db.insert(adminAudit)
      .values({
        id: crypto.randomUUID(),
        businessId,
        vehicleId: null,
        entityType: "business",
        entityId: businessId,
        action: "business.create",
        beforeJson: null,
        afterJson: JSON.stringify({
          name: params.name,
          active: true,
          ownerPersonId: ownerId,
          ownerFullName: params.ownerFullName,
          version: 1,
        }),
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

    recordReceipt(
      db,
      scope,
      {
        requestId: params.requestId,
        operation: "business.create",
        requestHash,
        entityId: businessId,
        resultVersion: 1,
        responseCode: 201,
      },
      clock,
    );

    return { status: 201, business: readCreatedBusiness(db, businessId) };
  });
}
