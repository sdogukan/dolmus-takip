/**
 * resetPlatformUserPassword — S2.6, `POST /api/v1/admin/users/[userId]/
 * reset-password`.
 *
 * `../admin-vehicles/reset-vehicle-password.ts` ile AYNI iskelet: Argon2
 * HER ZAMAN transaction DIŞINDA (hash kuyruğu); tek BEGIN IMMEDIATE
 * transaction'ı aktörün hâlâ yönetici olduğunu yeniden denetler, Argon2'den
 * ÖNCE okunan `credential_version`a KOŞULLU hash+sürüm artışını yapar
 * (eşzamanlı sıfırlama → 409 VERSION_CONFLICT), hesabın TÜM oturumlarını
 * iptal eder (kendi hesabını sıfırlayan yönetici kendi oturumunu da
 * kaybeder — yanıt commit sonrası yine döner), admin_audit ve makbuzu
 * birlikte yazar. `platform_users.version` DEĞİŞMEZ.
 *
 * Tekrar gönderim: `requestHash` hedef `userId`yi kapsar, parolayı KAPSAMAZ;
 * bilinen makbuzda parola saklanan özete karşı doğrulanır, sonraki bir
 * sıfırlama makbuzu geçersiz kılmışsa 409 VERSION_CONFLICT.
 */
import { and, eq, sql } from "drizzle-orm";
import { buildStaffActorScope } from "../../auth/scope";
import { systemClock, type Clock } from "../../auth/session";
import { hashVehiclePassword } from "../../auth/vehicle-password";
import type { AppDatabase } from "../../data/db";
import { withImmediateTransaction } from "../../data/db";
import { recheckScopeInTransaction } from "../../data/scoped";
import { mutationReceipts, platformUsers } from "../../data/schema";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { RequestIdReusedError } from "../receipts/errors";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import { computeReceiptScopeKey } from "../receipts/scope-key";
import { revokeSessionsForPlatformUserSync } from "../session/revoke-session";
import type { SessionContext } from "../session/types";
import { AdminUserNotFoundError, AdminUserVersionConflictError } from "./errors";
import { getPlatformUserDetail } from "./queries";
import { assertActorIsAdmin, auditSnapshot, insertPlatformUserAudit, verifyReplayPassword } from "./shared";

export interface ResetPlatformUserPasswordParams {
  requestId: string;
  userId: string;
  /** ASLA `.trim()` edilmez — platform girişi aynı ham değeri karşılaştırır. */
  newPassword: string;
}

export interface ResetPlatformUserPasswordResult {
  status: number;
  user: { id: string; username: string };
}

const OPERATION = "platform_user.reset_password";

type ResetTxOutcome =
  | { kind: "reset" }
  | { kind: "replay-marker"; resultVersion: number; responseCode: number };

function readIdentity(db: AppDatabase, userId: string): { id: string; username: string } {
  const row = db
    .select({ id: platformUsers.id, username: platformUsers.username })
    .from(platformUsers)
    .where(eq(platformUsers.id, userId))
    .get();
  if (!row) {
    throw new AdminUserNotFoundError();
  }
  return row;
}

export async function resetPlatformUserPassword(
  db: AppDatabase,
  context: SessionContext,
  params: ResetPlatformUserPasswordParams,
  clock: Clock = systemClock,
): Promise<ResetPlatformUserPasswordResult> {
  const scope = buildStaffActorScope(context);
  const requestHash = hashRequestPayload({ userId: params.userId });

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
    if (peeked.resultVersion === null) {
      throw new Error(`resetPlatformUserPassword: ${OPERATION} makbuzu resultVersion taşımıyor (programlama hatası).`);
    }
    recheckScopeInTransaction(db, context, scope, clock);
    assertActorIsAdmin(db, context);
    await verifyReplayPassword(db, params.userId, params.newPassword, peeked.resultVersion, clock);
    return { status: peeked.responseCode, user: readIdentity(db, params.userId) };
  }

  const target = db
    .select({ credentialVersion: platformUsers.credentialVersion })
    .from(platformUsers)
    .where(eq(platformUsers.id, params.userId))
    .get();
  if (!target) {
    throw new AdminUserNotFoundError();
  }
  const observedCredentialVersion = target.credentialVersion;

  const newPasswordHash = await hashVehiclePassword(params.newPassword, clock);

  const outcome = withImmediateTransaction<ResetTxOutcome>(db.$client, () => {
    const resolved = resolveReceipt(
      db,
      context,
      scope,
      { requestId: params.requestId, operation: OPERATION, requestHash },
      clock,
    );
    assertActorIsAdmin(db, context);
    if (resolved.replay) {
      if (resolved.receipt.resultVersion === null) {
        throw new Error(`resetPlatformUserPassword: ${OPERATION} makbuzu resultVersion taşımıyor (programlama hatası).`);
      }
      return {
        kind: "replay-marker",
        resultVersion: resolved.receipt.resultVersion,
        responseCode: resolved.receipt.responseCode,
      };
    }

    const updateResult = db
      .update(platformUsers)
      .set({
        passwordHash: newPasswordHash,
        credentialVersion: sql`${platformUsers.credentialVersion} + 1`,
      })
      .where(
        and(
          eq(platformUsers.id, params.userId),
          eq(platformUsers.credentialVersion, observedCredentialVersion),
        ),
      )
      .run();
    if (updateResult.changes !== 1) {
      throw new AdminUserVersionConflictError();
    }
    revokeSessionsForPlatformUserSync(db, params.userId, clock);

    const current = getPlatformUserDetail(db, params.userId);
    const snapshot = auditSnapshot(current);
    insertPlatformUserAudit(db, context, {
      entityId: params.userId,
      action: "platform_user.reset_password",
      before: snapshot,
      after: snapshot,
      occurredAt: clock().toISOString(),
    });

    recordReceipt(
      db,
      scope,
      {
        requestId: params.requestId,
        operation: OPERATION,
        requestHash,
        entityId: params.userId,
        resultVersion: observedCredentialVersion + 1,
        responseCode: 200,
      },
      clock,
    );

    return { kind: "reset" };
  });

  if (outcome.kind === "replay-marker") {
    await verifyReplayPassword(db, params.userId, params.newPassword, outcome.resultVersion, clock);
    return { status: outcome.responseCode, user: readIdentity(db, params.userId) };
  }
  return { status: 200, user: readIdentity(db, params.userId) };
}
