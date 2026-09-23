/**
 * Yönetim işlem geçmişi okuma sorgusu — GET /admin/audit.
 *
 * Aktör izi oturumdan BAĞIMSIZ çözülür: `actor_platform_user_id` →
 * `platform_users`, `actor_credential_id` → `vehicle_credentials` →
 * `vehicles`. `sessions` ASLA join edilmez ve `actor_session_id` yanıta
 * girmez (oturum temizliği aktör izini silmez). Tüm join'ler LEFT'tir:
 * CLI'den yazılan `business_id` NULL satırlar da listelenir. `targetUser`
 * yalnız `entity_type = 'platform_user'` satırlarında `entity_id` üzerinden
 * çözülür (hedef pasifleşse de satır kalır — hesaplar silinmez).
 */
import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { AppDatabase } from "../../data/db";
import {
  adminAudit,
  businesses,
  people,
  platformUsers,
  vehicleCredentials,
  vehicles,
} from "../../data/schema";
import { encodeCursor, requireCursor } from "../list-cursor";
import { sanitizeAuditPayload } from "./sanitize";

export type AuditActor =
  | { kind: "platform_user"; username: string; role: "support" | "admin" }
  | { kind: "vehicle_credential"; access: "owner" | "driver"; plateNormalized: string | null };

export interface AuditEntry {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string;
  business: { id: string; name: string } | null;
  vehicle: { id: string; plateNormalized: string } | null;
  actor: AuditActor;
  targetUser: { id: string; username: string } | null;
  onBehalfOf: { kind: "owner" | "driver"; fullName: string } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface AuditListOptions {
  /** Doluysa `vehicle_id = X`; yoksa `businessId` doluysa `business_id = X`. */
  businessId?: string;
  vehicleId?: string;
  cursor?: string;
  limit: number;
}

export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}

export function listAdminAudit(db: AppDatabase, options: AuditListOptions): AuditPage {
  const credentialVehicle = alias(vehicles, "credential_vehicle");
  const targetPlatformUser = alias(platformUsers, "target_platform_user");
  const conditions: SQL[] = [];
  if (options.vehicleId) conditions.push(eq(adminAudit.vehicleId, options.vehicleId));
  else if (options.businessId) conditions.push(eq(adminAudit.businessId, options.businessId));
  if (options.cursor !== undefined) {
    // (occurred_at, id) sıralı katı demet karşılaştırması: aynı transaction'da
    // yazılan satırlar aynı `occurred_at`'i paylaşır.
    const [occurredAt, id] = requireCursor(options.cursor, 2) as [string, string];
    conditions.push(
      or(
        sql`${adminAudit.occurredAt} < ${occurredAt}`,
        and(eq(adminAudit.occurredAt, occurredAt), sql`${adminAudit.id} < ${id}`),
      )!,
    );
  }

  const rows = db
    .select({
      id: adminAudit.id,
      occurredAt: adminAudit.occurredAt,
      action: adminAudit.action,
      entityType: adminAudit.entityType,
      entityId: adminAudit.entityId,
      beforeJson: adminAudit.beforeJson,
      afterJson: adminAudit.afterJson,
      actorKind: adminAudit.actorKind,
      actorRole: adminAudit.actorRole,
      businessId: businesses.id,
      businessName: businesses.name,
      vehicleId: vehicles.id,
      vehiclePlate: vehicles.plateNormalized,
      username: platformUsers.username,
      targetUserId: targetPlatformUser.id,
      targetUsername: targetPlatformUser.username,
      credentialPlate: credentialVehicle.plateNormalized,
      onBehalfOfKind: adminAudit.onBehalfOfKind,
      onBehalfOfFullName: people.fullName,
    })
    .from(adminAudit)
    .leftJoin(businesses, eq(adminAudit.businessId, businesses.id))
    .leftJoin(vehicles, eq(adminAudit.vehicleId, vehicles.id))
    .leftJoin(platformUsers, eq(adminAudit.actorPlatformUserId, platformUsers.id))
    .leftJoin(
      targetPlatformUser,
      and(
        eq(adminAudit.entityType, "platform_user"),
        eq(adminAudit.entityId, targetPlatformUser.id),
      ),
    )
    .leftJoin(vehicleCredentials, eq(adminAudit.actorCredentialId, vehicleCredentials.id))
    .leftJoin(credentialVehicle, eq(vehicleCredentials.vehicleId, credentialVehicle.id))
    .leftJoin(people, eq(adminAudit.onBehalfOfPersonId, people.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adminAudit.occurredAt), desc(adminAudit.id))
    .limit(options.limit + 1)
    .all();

  const pageRows = rows.slice(0, options.limit);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    rows.length > options.limit && last ? encodeCursor([last.occurredAt, last.id]) : null;

  const entries = pageRows.map((row): AuditEntry => {
    const isPlatform = row.actorKind === "platform_user";
    const actor: AuditActor = isPlatform
      ? {
          kind: "platform_user",
          username: row.username ?? "",
          role: row.actorRole as "support" | "admin",
        }
      : {
          kind: "vehicle_credential",
          access: row.actorRole as "owner" | "driver",
          plateNormalized: row.credentialPlate ?? null,
        };
    return {
      id: row.id,
      occurredAt: row.occurredAt,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      business: row.businessId && row.businessName ? { id: row.businessId, name: row.businessName } : null,
      vehicle: row.vehicleId && row.vehiclePlate ? { id: row.vehicleId, plateNormalized: row.vehiclePlate } : null,
      actor,
      targetUser:
        row.targetUserId && row.targetUsername
          ? { id: row.targetUserId, username: row.targetUsername }
          : null,
      // Ortak parola dürüstlüğü: araç credential'ı kişi adıyla gösterilmez;
      // "adına" yalnız ekip aktörleri için anlamlıdır.
      onBehalfOf:
        isPlatform && row.onBehalfOfKind && row.onBehalfOfFullName
          ? { kind: row.onBehalfOfKind, fullName: row.onBehalfOfFullName }
          : null,
      before: sanitizeAuditPayload(row.beforeJson),
      after: sanitizeAuditPayload(row.afterJson),
    };
  });

  return { entries, nextCursor };
}
