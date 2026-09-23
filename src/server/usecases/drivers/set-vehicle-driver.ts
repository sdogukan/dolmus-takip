/**
 * setVehicleDriver — T2.4, `PUT /api/v1/vehicles/:vehicleId/drivers/:personId`.
 *
 * Kapsamdaki araçta (vehicle, person) ataması: yoksa OLUŞTURUR (201),
 * varsa AYNI satırı açar/kapatır (200) — mükerrer satır ÜRETMEZ. Var olan
 * satır için `version` zorunludur (bayat/eksik → 409); satır yokken
 * `version` göndermek de 409'dur (durum değişmiş). Tüm okuma-yazma tek
 * IMMEDIATE transaction'da: aynı kişiyi paralel bağlayan iki istekten biri
 * 201, diğeri 409 alır (PK 500'ü yok). Küresel pasif kişiye atama/açma 422
 * (aynı transaction'da okunan `people.active`). Şoför oturumları İPTAL
 * EDİLMEZ (ortak şoför şifresi — F3).
 */
import { and, eq, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { Scope } from "../../auth/scope";
import { withImmediateTransaction, type AppDatabase } from "../../data/db";
import { scopedPeopleFilter, scopedVehicleDriversFilter } from "../../data/scoped";
import { people, vehicleDrivers } from "../../data/schema";
import { DRIVER_FIELD_MESSAGES } from "../../../lib/messages";
import type { SessionContext } from "../session/types";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import { writeDriverAudit } from "./audit";
import { DriverValidationError, DriverVersionConflictError, PersonNotFoundError } from "./errors";
import { getManagedDriver, isOwnerPerson } from "./queries";
import type { DriverMutationResult } from "./create-driver";

export interface SetVehicleDriverParams {
  requestId: string;
  personId: string;
  active: boolean;
  /** Var olan atama satırının sürümü; satır yoksa GÖNDERİLMEZ. */
  version?: number;
}

const OPERATION = "vehicle_driver.set";

export function setVehicleDriver(
  db: AppDatabase,
  context: SessionContext,
  scope: Scope,
  params: SetVehicleDriverParams,
  clock: Clock = systemClock,
): DriverMutationResult {
  const vehicleId = scope.vehicleId;
  if (!vehicleId) {
    throw new Error("setVehicleDriver: scope.vehicleId eksik (programlama hatası).");
  }
  const requestHash = hashRequestPayload({
    personId: params.personId,
    active: params.active,
    version: params.version ?? null,
  });

  return withImmediateTransaction(db.$client, () => {
    const resolved = resolveReceipt(
      db,
      context,
      scope,
      { requestId: params.requestId, operation: OPERATION, requestHash },
      clock,
    );
    const readDriver = () => {
      const driver = getManagedDriver(db, scope, params.personId);
      if (!driver) throw new PersonNotFoundError();
      return driver;
    };
    if (resolved.replay) {
      return { status: resolved.receipt.responseCode, driver: readDriver() };
    }

    const person = db
      .select({ active: people.active })
      .from(people)
      .where(and(scopedPeopleFilter(scope), eq(people.id, params.personId)))
      .get();
    if (!person) throw new PersonNotFoundError();
    if (isOwnerPerson(db, scope.businessId, params.personId)) {
      throw new DriverValidationError({ personId: DRIVER_FIELD_MESSAGES.ownerPerson });
    }

    const existing = db
      .select({ active: vehicleDrivers.active, version: vehicleDrivers.version })
      .from(vehicleDrivers)
      .where(and(scopedVehicleDriversFilter(scope), eq(vehicleDrivers.personId, params.personId)))
      .get();

    const now = clock().toISOString();

    if (!existing) {
      if (params.version !== undefined) throw new DriverVersionConflictError();
      if (!params.active) {
        throw new DriverValidationError({ active: DRIVER_FIELD_MESSAGES.notAssigned });
      }
      if (!person.active) {
        throw new DriverValidationError({ personId: DRIVER_FIELD_MESSAGES.personInactive });
      }
      db.insert(vehicleDrivers)
        .values({
          businessId: scope.businessId,
          vehicleId,
          personId: params.personId,
          active: true,
          version: 1,
        })
        .run();
      writeDriverAudit(
        db,
        context,
        scope,
        {
          entityType: "vehicle_driver",
          entityId: params.personId,
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
          entityId: params.personId,
          resultVersion: 1,
          responseCode: 201,
        },
        clock,
      );
      return { status: 201, driver: readDriver() };
    }

    if (params.version === undefined || params.version !== existing.version) {
      throw new DriverVersionConflictError();
    }
    if (params.active === existing.active) {
      throw new DriverValidationError(
        { change: DRIVER_FIELD_MESSAGES.noChange },
        DRIVER_FIELD_MESSAGES.noChangeMessage,
      );
    }
    if (params.active && !person.active) {
      throw new DriverValidationError({ personId: DRIVER_FIELD_MESSAGES.personInactive });
    }

    const updateResult = db
      .update(vehicleDrivers)
      .set({ active: params.active, version: sql`${vehicleDrivers.version} + 1` })
      .where(
        and(
          eq(vehicleDrivers.businessId, scope.businessId),
          eq(vehicleDrivers.vehicleId, vehicleId),
          eq(vehicleDrivers.personId, params.personId),
          eq(vehicleDrivers.version, params.version),
        ),
      )
      .run();
    if (updateResult.changes !== 1) {
      throw new DriverVersionConflictError();
    }
    const newVersion = params.version + 1;

    writeDriverAudit(
      db,
      context,
      scope,
      {
        entityType: "vehicle_driver",
        entityId: params.personId,
        action: params.active ? "vehicle_driver.activate" : "vehicle_driver.deactivate",
        before: { active: existing.active, version: params.version },
        after: { active: params.active, version: newVersion },
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
        entityId: params.personId,
        resultVersion: newVersion,
        responseCode: 200,
      },
      clock,
    );
    return { status: 200, driver: readDriver() };
  });
}
