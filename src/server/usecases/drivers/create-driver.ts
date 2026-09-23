/**
 * createDriver — T2.4, `POST /api/v1/drivers`.
 *
 * Tek BEGIN IMMEDIATE transaction: `people` (1 satır) + `vehicle_drivers`
 * (kapsamdaki araç, aktif) + 2 audit + makbuz. Aynı `requestId` + aynı ad
 * → ikinci satır ÜRETMEDEN aynı kişi döner (replay); farklı ad → 409
 * REQUEST_ID_REUSED.
 */
import crypto from "node:crypto";
import { systemClock, type Clock } from "../../auth/session";
import type { Scope } from "../../auth/scope";
import { withImmediateTransaction, type AppDatabase } from "../../data/db";
import { people, vehicleDrivers } from "../../data/schema";
import { DRIVER_FIELD_MESSAGES } from "../../../lib/messages";
import type { SessionContext } from "../session/types";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import { writeDriverAudit } from "./audit";
import { DriverValidationError } from "./errors";
import { isValidFullName, normalizeFullName } from "./person-name";
import { getManagedDriver, type ManagedDriver } from "./queries";

export interface CreateDriverParams {
  requestId: string;
  fullName: string;
}

export interface DriverMutationResult {
  status: number;
  driver: ManagedDriver;
}

const OPERATION = "driver.create";

export function createDriver(
  db: AppDatabase,
  context: SessionContext,
  scope: Scope,
  params: CreateDriverParams,
  clock: Clock = systemClock,
): DriverMutationResult {
  const vehicleId = scope.vehicleId;
  if (!vehicleId) {
    throw new Error("createDriver: scope.vehicleId eksik (programlama hatası).");
  }
  const fullName = normalizeFullName(params.fullName);
  if (!isValidFullName(fullName)) {
    throw new DriverValidationError({ fullName: DRIVER_FIELD_MESSAGES.fullName });
  }
  const requestHash = hashRequestPayload({ fullName });

  return withImmediateTransaction(db.$client, () => {
    const resolved = resolveReceipt(
      db,
      context,
      scope,
      { requestId: params.requestId, operation: OPERATION, requestHash },
      clock,
    );
    if (resolved.replay) {
      const replayed = resolved.receipt.entityId
        ? getManagedDriver(db, scope, resolved.receipt.entityId)
        : undefined;
      if (!replayed) {
        throw new Error("createDriver: makbuzdaki kişi bulunamadı (veri bütünlüğü hatası).");
      }
      return { status: resolved.receipt.responseCode, driver: replayed };
    }

    const personId = crypto.randomUUID();
    const now = clock().toISOString();

    db.insert(people)
      .values({ businessId: scope.businessId, id: personId, fullName, active: true, version: 1 })
      .run();
    db.insert(vehicleDrivers)
      .values({ businessId: scope.businessId, vehicleId, personId, active: true, version: 1 })
      .run();

    writeDriverAudit(
      db,
      context,
      scope,
      {
        entityType: "person",
        entityId: personId,
        action: "person.create",
        before: null,
        after: { fullName, active: true, version: 1 },
        vehicleScoped: true,
      },
      now,
    );
    writeDriverAudit(
      db,
      context,
      scope,
      {
        entityType: "vehicle_driver",
        entityId: personId,
        action: "vehicle_driver.create",
        before: null,
        after: { active: true, version: 1 },
        vehicleScoped: true,
      },
      now,
    );

    recordReceipt(
      db,
      scope,
      {
        requestId: params.requestId,
        operation: OPERATION,
        requestHash,
        entityId: personId,
        resultVersion: 1,
        responseCode: 201,
      },
      clock,
    );

    const created = getManagedDriver(db, scope, personId);
    if (!created) {
      throw new Error("createDriver: oluşturulan kişi okunamadı (programlama hatası).");
    }
    return { status: 201, driver: created };
  });
}
