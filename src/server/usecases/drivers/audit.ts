/**
 * `admin_audit` yazımı — T2.4. Aktör alanları oturumdan gelir: sahip →
 * `vehicle_credential` (on_behalf_of NULL); ekip → `platform_user` ve
 * araç-kapsamlı eylemlerde `on_behalf_of` = hedef aracın sahibi (ekip
 * eylemi ASLA müşterininki gibi görünmez). Yükler yalnız ad/aktiflik/sürüm
 * taşır (KVKK — kişisel veri en aza indirilir).
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { Scope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { adminAudit, vehicles } from "../../data/schema";
import type { SessionContext } from "../session/types";

export interface DriverAuditEntry {
  entityType: "person" | "vehicle_driver";
  entityId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  /** `true` → `vehicle_id` doldurulur; ekipte ayrıca on_behalf_of = araç sahibi. */
  vehicleScoped: boolean;
}

export function writeDriverAudit(
  db: AppDatabase,
  context: SessionContext,
  scope: Scope,
  entry: DriverAuditEntry,
  now: string,
): void {
  const vehicleId = entry.vehicleScoped ? (scope.vehicleId ?? null) : null;

  let onBehalfOfPersonId: string | null = null;
  if (scope.kind === "staff" && entry.vehicleScoped && vehicleId) {
    const vehicle = db
      .select({ ownerPersonId: vehicles.ownerPersonId })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .get();
    onBehalfOfPersonId = vehicle?.ownerPersonId ?? null;
  }

  const common = {
    id: crypto.randomUUID(),
    businessId: scope.businessId,
    vehicleId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    beforeJson: entry.before ? JSON.stringify(entry.before) : null,
    afterJson: JSON.stringify(entry.after),
    actorSessionId: context.sessionId,
    actorRole: context.role,
    onBehalfOfKind: onBehalfOfPersonId ? ("owner" as const) : null,
    onBehalfOfPersonId,
    occurredAt: now,
  };

  if (scope.kind === "vehicle") {
    db.insert(adminAudit)
      .values({
        ...common,
        actorKind: "vehicle_credential",
        actorCredentialId: scope.credentialId,
        actorPlatformUserId: null,
      })
      .run();
    return;
  }
  db.insert(adminAudit)
    .values({
      ...common,
      actorKind: "platform_user",
      actorCredentialId: null,
      actorPlatformUserId: scope.platformUserId,
    })
    .run();
}
