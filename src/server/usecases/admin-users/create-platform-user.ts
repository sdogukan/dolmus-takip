/**
 * createPlatformUser — S2.6, `POST /api/v1/admin/users`.
 *
 * `../admin-vehicles/reset-vehicle-password.ts` ile AYNI iskelet: Argon2
 * hashleme/doğrulama HER ZAMAN `withImmediateTransaction` DIŞINDA (hash
 * kuyruğu); TEK BEGIN IMMEDIATE transaction'ı aktörün hâlâ yönetici olduğunu
 * yeniden denetler, kullanıcı adı tekilliğini (büyük/küçük harf duyarsız —
 * CLI satırları ham saklanır) denetler, hesabı, admin_audit satırını ve
 * makbuzu BİRLİKTE yazar.
 *
 * Tekrar gönderim: `requestHash` parolayı KAPSAMAZ (kısa parolanın SHA-256'sı
 * çevrimdışı kırılabilir); bilinen makbuzda gönderilen parola saklanan
 * Argon2 özetine karşı doğrulanır (`./shared.ts` `verifyReplayPassword`).
 */
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { buildStaffActorScope } from "../../auth/scope";
import { systemClock, type Clock } from "../../auth/session";
import { hashVehiclePassword } from "../../auth/vehicle-password";
import type { AppDatabase } from "../../data/db";
import { withImmediateTransaction } from "../../data/db";
import { recheckScopeInTransaction } from "../../data/scoped";
import { mutationReceipts, platformUsers } from "../../data/schema";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { normalizeFullName, isValidFullName } from "../drivers/person-name";
import { RequestIdReusedError } from "../receipts/errors";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import { computeReceiptScopeKey } from "../receipts/scope-key";
import type { SessionContext } from "../session/types";
import { AdminUserValidationError } from "./errors";
import { getPlatformUserDetail, type PlatformUserView } from "./queries";
import {
  assertActorIsAdmin,
  auditSnapshot,
  insertPlatformUserAudit,
  isUniqueConstraintError,
  normalizeUsername,
  TAKEN_USERNAME_MESSAGE,
  verifyReplayPassword,
} from "./shared";

export interface CreatePlatformUserParams {
  requestId: string;
  username: string;
  fullName: string;
  platformRole: "admin" | "support";
  /** ASLA `.trim()` edilmez — platform girişi aynı ham değeri karşılaştırır. */
  password: string;
}

export interface CreatePlatformUserResult {
  status: number;
  user: PlatformUserView;
}

const OPERATION = "platform_user.create";

type CreateTxOutcome =
  | { kind: "created"; userId: string }
  | { kind: "replay-marker"; userId: string; resultVersion: number; responseCode: number };

export async function createPlatformUser(
  db: AppDatabase,
  context: SessionContext,
  params: CreatePlatformUserParams,
  clock: Clock = systemClock,
): Promise<CreatePlatformUserResult> {
  const scope = buildStaffActorScope(context);

  const username = normalizeUsername(params.username);
  const fullName = normalizeFullName(params.fullName);
  if (!isValidFullName(fullName)) {
    throw new AdminUserValidationError({ fullName: "Ad soyad 1–120 karakter olmalı." });
  }

  const requestHash = hashRequestPayload({
    username,
    fullName,
    platformRole: params.platformRole,
  });

  // --- Peşin bakış: bilinen makbuz varsa Argon2 hashlemeye HİÇ gitmeden ---
  const peeked = db
    .select()
    .from(mutationReceipts)
    .where(
      and(
        eq(mutationReceipts.scopeKey, computeReceiptScopeKey(scope)),
        eq(mutationReceipts.requestId, params.requestId),
      ),
    )
    .get();
  if (peeked) {
    if (peeked.operation !== OPERATION) {
      throw new RequestIdReusedError("Bu istek kimliği farklı bir işlem türü için zaten kullanılmış.");
    }
    if (peeked.requestHash !== requestHash) {
      throw new RequestIdReusedError();
    }
    if (!peeked.entityId || peeked.resultVersion === null) {
      throw new Error(`createPlatformUser: ${OPERATION} makbuzu entityId/resultVersion taşımıyor (programlama hatası).`);
    }
    recheckScopeInTransaction(db, context, scope, clock);
    assertActorIsAdmin(db, context);
    await verifyReplayPassword(db, peeked.entityId, params.password, peeked.resultVersion, clock);
    return { status: peeked.responseCode, user: getPlatformUserDetail(db, peeked.entityId) };
  }

  const passwordHash = await hashVehiclePassword(params.password, clock);

  const outcome = withImmediateTransaction<CreateTxOutcome>(db.$client, () => {
    const resolved = resolveReceipt(
      db,
      context,
      scope,
      { requestId: params.requestId, operation: OPERATION, requestHash },
      clock,
    );
    assertActorIsAdmin(db, context);

    if (resolved.replay) {
      if (!resolved.receipt.entityId || resolved.receipt.resultVersion === null) {
        throw new Error(`createPlatformUser: ${OPERATION} makbuzu entityId/resultVersion taşımıyor (programlama hatası).`);
      }
      return {
        kind: "replay-marker",
        userId: resolved.receipt.entityId,
        resultVersion: resolved.receipt.resultVersion,
        responseCode: resolved.receipt.responseCode,
      };
    }

    // Yazıcılar BEGIN IMMEDIATE ile serileştiği için bu denetim ile INSERT
    // arasına başka bir yazıcı giremez.
    const taken = db
      .select({ id: platformUsers.id })
      .from(platformUsers)
      .where(sql`lower(${platformUsers.username}) = ${username}`)
      .get();
    if (taken) {
      throw new AdminUserValidationError({ username: TAKEN_USERNAME_MESSAGE });
    }

    const userId = crypto.randomUUID();
    try {
      db.insert(platformUsers)
        .values({
          id: userId,
          username,
          passwordHash,
          platformRole: params.platformRole,
          active: true,
          credentialVersion: 1,
          fullName,
          version: 1,
        })
        .run();
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AdminUserValidationError({ username: TAKEN_USERNAME_MESSAGE });
      }
      throw error;
    }

    insertPlatformUserAudit(db, context, {
      entityId: userId,
      action: "platform_user.create",
      before: null,
      after: auditSnapshot({ username, fullName, platformRole: params.platformRole, active: true }),
      occurredAt: clock().toISOString(),
    });

    recordReceipt(
      db,
      scope,
      {
        requestId: params.requestId,
        operation: OPERATION,
        requestHash,
        entityId: userId,
        // credential_version — sonraki bir sıfırlama tekrar gönderimi geçersiz kılar.
        resultVersion: 1,
        responseCode: 201,
      },
      clock,
    );

    return { kind: "created", userId };
  });

  if (outcome.kind === "created") {
    return { status: 201, user: getPlatformUserDetail(db, outcome.userId) };
  }

  await verifyReplayPassword(db, outcome.userId, params.password, outcome.resultVersion, clock);
  return { status: outcome.responseCode, user: getPlatformUserDetail(db, outcome.userId) };
}
