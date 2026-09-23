/**
 * updatePlatformUser — S2.6, `PATCH /api/v1/admin/users/[userId]`.
 *
 * `../admin-vehicles/update-vehicle.ts` ile AYNI desen: TEK BEGIN IMMEDIATE
 * transaction'ında aktörün hâlâ yönetici olduğu yeniden denetlenir, sürüm
 * koşullu UPDATE (`WHERE version = ?`) yapılır, pasifleşince hesabın TÜM
 * oturumları iptal edilir, admin_audit ve makbuz birlikte yazılır.
 *
 * - Rol değişimi credential_version'ı ARTIRMAZ ve oturum İPTAL ETMEZ
 *   (`../access/set-platform-user-role.ts` sözleşmesi — `resolveSession` rolü
 *   her istekte taze okur; indirilen yöneticinin sonraki /admin/users isteği
 *   403 alır).
 * - Yeniden aktifleştirme HİÇBİR oturumu geri getirmez.
 * - Son aktif yöneticinin pasifleştirilmesi/indirilmesi (kendisi dahil) 422:
 *   diğer aktif yönetici sayısı AYNI transaction'da okunur, böylece iki
 *   yöneticinin eşzamanlı birbirini indirmesiyle sıfır yönetici kalamaz.
 * - `version` eksik/bayat → 409 (aynı değerle PATCH'ten ÖNCE); hiçbir alan
 *   değişmiyorsa 422 `change`.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { buildStaffActorScope } from "../../auth/scope";
import { systemClock, type Clock } from "../../auth/session";
import type { AppDatabase } from "../../data/db";
import { withImmediateTransaction } from "../../data/db";
import { platformUsers } from "../../data/schema";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { isValidFullName, normalizeFullName } from "../drivers/person-name";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import { revokeSessionsForPlatformUserSync } from "../session/revoke-session";
import type { SessionContext } from "../session/types";
import { AdminUserNotFoundError, AdminUserValidationError, AdminUserVersionConflictError } from "./errors";
import { getPlatformUserDetail, type PlatformUserView } from "./queries";
import { assertActorIsAdmin, auditSnapshot, insertPlatformUserAudit } from "./shared";

export interface UpdatePlatformUserParams {
  requestId: string;
  userId: string;
  /** Eksik → bayat sayılır (409). */
  version?: number;
  fullName?: string;
  platformRole?: "admin" | "support";
  active?: boolean;
}

export interface UpdatePlatformUserResult {
  status: number;
  user: PlatformUserView;
}

const OPERATION = "platform_user.update";

export function updatePlatformUser(
  db: AppDatabase,
  context: SessionContext,
  params: UpdatePlatformUserParams,
  clock: Clock = systemClock,
): UpdatePlatformUserResult {
  const scope = buildStaffActorScope(context);

  let fullName: string | undefined;
  if (params.fullName !== undefined) {
    fullName = normalizeFullName(params.fullName);
    if (!isValidFullName(fullName)) {
      throw new AdminUserValidationError({ fullName: "Ad soyad 1–120 karakter olmalı." });
    }
  }

  const requestHash = hashRequestPayload({
    userId: params.userId,
    version: params.version ?? null,
    fullName: fullName ?? null,
    platformRole: params.platformRole ?? null,
    active: params.active ?? null,
  });

  return withImmediateTransaction(db.$client, () => {
    const resolved = resolveReceipt(
      db,
      context,
      scope,
      { requestId: params.requestId, operation: OPERATION, requestHash },
      clock,
    );
    assertActorIsAdmin(db, context);
    if (resolved.replay) {
      return { status: resolved.receipt.responseCode, user: getPlatformUserDetail(db, params.userId) };
    }

    const current = db
      .select({
        username: platformUsers.username,
        fullName: platformUsers.fullName,
        platformRole: platformUsers.platformRole,
        active: platformUsers.active,
        version: platformUsers.version,
      })
      .from(platformUsers)
      .where(eq(platformUsers.id, params.userId))
      .get();
    if (!current) {
      throw new AdminUserNotFoundError();
    }

    // Bayat `version`, "değişiklik yok" 422'sinden ÖNCE 409 almalı; asıl
    // koruma aşağıdaki koşullu UPDATE'tir.
    if (params.version !== current.version) {
      throw new AdminUserVersionConflictError();
    }

    const wantsFullNameChange = fullName !== undefined && fullName !== current.fullName;
    const wantsRoleChange = params.platformRole !== undefined && params.platformRole !== current.platformRole;
    const wantsActiveChange = params.active !== undefined && params.active !== current.active;
    if (!wantsFullNameChange && !wantsRoleChange && !wantsActiveChange) {
      throw new AdminUserValidationError(
        { change: "Değişiklik yok." },
        "Gönderilen değerler mevcut kayıtla aynı; değişiklik uygulanmadı.",
      );
    }

    const nextRole = wantsRoleChange ? params.platformRole! : current.platformRole;
    const nextActive = wantsActiveChange ? params.active! : current.active;

    // Sıfır-yönetici kilidi: hedef şu an aktif yönetici ve değişiklik onu
    // aktif yönetici OLMAKTAN çıkarıyorsa, başka aktif yönetici kalmalı.
    const staysActiveAdmin = nextRole === "admin" && nextActive;
    if (current.platformRole === "admin" && current.active && !staysActiveAdmin) {
      const otherActiveAdmins = db
        .select({ count: sql<number>`count(*)` })
        .from(platformUsers)
        .where(
          and(
            ne(platformUsers.id, params.userId),
            eq(platformUsers.platformRole, "admin"),
            eq(platformUsers.active, true),
          ),
        )
        .get()?.count;
      if (!otherActiveAdmins) {
        const message = "Son aktif yönetici pasifleştirilemez veya destek rolüne indirilemez.";
        throw new AdminUserValidationError(
          wantsRoleChange && nextRole !== "admin" ? { platformRole: message } : { active: message },
        );
      }
    }

    const changes: {
      version: ReturnType<typeof sql>;
      fullName?: string;
      platformRole?: "admin" | "support";
      active?: boolean;
    } = { version: sql`${platformUsers.version} + 1` };
    if (wantsFullNameChange) changes.fullName = fullName;
    if (wantsRoleChange) changes.platformRole = nextRole;
    if (wantsActiveChange) changes.active = nextActive;

    const updateResult = db
      .update(platformUsers)
      .set(changes)
      .where(and(eq(platformUsers.id, params.userId), eq(platformUsers.version, params.version)))
      .run();
    if (updateResult.changes !== 1) {
      throw new AdminUserVersionConflictError();
    }
    const newVersion = params.version + 1;

    // Pasifleşince KALICI iptal (`revoked_at`); yeniden aktifleştirme hiçbir
    // şeyi geri getirmez. `setPlatformUserActive`in KENDİ transaction'ı değil,
    // bu PATCH'in transaction'ı içindeki senkron çekirdek kullanılır.
    if (wantsActiveChange && !nextActive) {
      revokeSessionsForPlatformUserSync(db, params.userId, clock);
    }

    const before = auditSnapshot(current);
    const after = auditSnapshot({
      username: current.username,
      fullName: wantsFullNameChange ? fullName! : current.fullName,
      platformRole: nextRole,
      active: nextActive,
    });
    const occurredAt = clock().toISOString();
    if (wantsFullNameChange) {
      insertPlatformUserAudit(db, context, { entityId: params.userId, action: "platform_user.update", before, after, occurredAt });
    }
    if (wantsRoleChange) {
      insertPlatformUserAudit(db, context, { entityId: params.userId, action: "platform_user.role_change", before, after, occurredAt });
    }
    if (wantsActiveChange) {
      insertPlatformUserAudit(db, context, {
        entityId: params.userId,
        action: nextActive ? "platform_user.reactivate" : "platform_user.deactivate",
        before,
        after,
        occurredAt,
      });
    }

    recordReceipt(
      db,
      scope,
      {
        requestId: params.requestId,
        operation: OPERATION,
        requestHash,
        entityId: params.userId,
        resultVersion: newVersion,
        responseCode: 200,
      },
      clock,
    );

    return { status: 200, user: getPlatformUserDetail(db, params.userId) };
  });
}
