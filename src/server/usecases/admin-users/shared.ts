/**
 * Ekip hesabı yönetimi yazma kullanım durumlarının ORTAK parçaları — S2.6.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { Clock } from "../../auth/session";
import { verifyVehiclePassword } from "../../auth/vehicle-password";
import type { AppDatabase } from "../../data/db";
import { adminAudit, platformUsers } from "../../data/schema";
import { RequestIdReusedError } from "../receipts/errors";
import type { SessionContext } from "../session/types";
import {
  AdminUserForbiddenError,
  AdminUserValidationError,
  AdminUserVersionConflictError,
} from "./errors";
import type { PlatformUserView } from "./queries";

/** `recheckScopeInTransaction` oturumu/credential_version/active'i denetler
 * ama `platform_role`'ü DENETLEMEZ — guard ile yazma arasında yöneticilikten
 * indirilen aktör yazmayı tamamlayamasın. Transaction İÇİNDE (veya salt
 * okunur ön bakışta) çağrılır. */
export function assertActorIsAdmin(db: AppDatabase, context: SessionContext): void {
  const actor = context.platformUserId
    ? db
        .select({ platformRole: platformUsers.platformRole })
        .from(platformUsers)
        .where(eq(platformUsers.id, context.platformUserId))
        .get()
    : undefined;
  if (!actor || actor.platformRole !== "admin") {
    throw new AdminUserForbiddenError();
  }
}

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

/** Kanonik biçim: kırpılmış + küçük harf. Geçersizse 422 fields.username. */
export function normalizeUsername(raw: string): string {
  const username = raw.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new AdminUserValidationError({
      username: "Kullanıcı adı 3–32 karakter olmalı; yalnız harf, rakam, nokta, alt çizgi ve tire içerebilir.",
    });
  }
  return username;
}

export const TAKEN_USERNAME_MESSAGE = "Bu kullanıcı adı zaten kullanılıyor.";

/** SQLite UNIQUE ihlali (Drizzle bazı yollarda `SqliteError`ı `.cause`a sarar). */
export function isUniqueConstraintError(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 3; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (code === "SQLITE_CONSTRAINT_UNIQUE") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** admin_audit / makbuz için sır İÇERMEYEN anlık görüntü. */
export function auditSnapshot(view: Pick<PlatformUserView, "username" | "fullName" | "platformRole" | "active">) {
  return {
    username: view.username,
    fullName: view.fullName,
    platformRole: view.platformRole,
    active: view.active,
  };
}

export function insertPlatformUserAudit(
  db: AppDatabase,
  context: SessionContext,
  entry: {
    entityId: string;
    action: string;
    before: ReturnType<typeof auditSnapshot> | null;
    after: ReturnType<typeof auditSnapshot>;
    occurredAt: string;
  },
): void {
  db.insert(adminAudit)
    .values({
      id: crypto.randomUUID(),
      businessId: null,
      vehicleId: null,
      entityType: "platform_user",
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: entry.before ? JSON.stringify(entry.before) : null,
      afterJson: JSON.stringify(entry.after),
      actorKind: "platform_user",
      actorSessionId: context.sessionId,
      actorRole: context.role,
      actorCredentialId: null,
      actorPlatformUserId: context.platformUserId ?? null,
      onBehalfOfKind: null,
      onBehalfOfPersonId: null,
      occurredAt: entry.occurredAt,
    })
    .run();
}

/**
 * Bilinen bir makbuzun arkasındaki hesap için gönderilen parolayı (hash
 * kuyruğu ÜZERİNDEN, transaction DIŞINDA) saklanan özete karşı doğrular:
 * makbuzun `resultVersion`ı güncel `credential_version` ile uyuşmuyorsa
 * (sonraki bir sıfırlama parolayı geçersiz kıldı) 409 VERSION_CONFLICT,
 * parola uyuşmuyorsa 409 REQUEST_ID_REUSED (`../admin-vehicles/reset-vehicle-
 * password.ts` `verifyReplayNewPassword` ile AYNI sözleşme).
 */
export async function verifyReplayPassword(
  db: AppDatabase,
  userId: string,
  password: string,
  expectedCredentialVersion: number,
  clock: Clock,
): Promise<void> {
  const row = db
    .select({
      passwordHash: platformUsers.passwordHash,
      credentialVersion: platformUsers.credentialVersion,
    })
    .from(platformUsers)
    .where(eq(platformUsers.id, userId))
    .get();
  if (!row) {
    throw new Error(`admin-users: makbuz kaydı olan hesap eksik: "${userId}" (programlama hatası).`);
  }
  if (row.credentialVersion !== expectedCredentialVersion) {
    throw new AdminUserVersionConflictError();
  }
  if (!(await verifyVehiclePassword(row.passwordHash, password, clock))) {
    throw new RequestIdReusedError();
  }
}
