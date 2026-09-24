/**
 * updatePerson — T2.4, `PATCH /api/v1/drivers/:personId`.
 *
 * - Yeniden adlandırma: `people.id` KORUNUR, `people.version` artar, audit
 *   before/after adı taşır. Sahip (K2) yalnız OTURUM aracına bağlı kişiyi
 *   yeniden adlandırabilir; ekip işletmedeki her şoförü.
 * - `active` (küresel kişi aktifliği) YALNIZ ekip: sahip oturumu için
 *   `allowGlobalActive=false` iken `active` verilmesi FORBIDDEN'dır
 *   (`GlobalActiveForbiddenError`); vehicle_drivers satırlarına DOKUNULMAZ
 *   (kaskad yok) ve araç oturumları iptal EDİLMEZ.
 * - Sahip kişiler (işletme/araç sahibi) BU uçta 404 döner — adları yalnız
 *   `PATCH /admin/businesses` ile düzenlenir (people.version paylaşımı).
 * - Adı anonimleştirilmiş kişiye `fullName` gönderilirse 409
 *   PERSON_ANONYMIZED (geri dönüşsüz); yalnız `active` değişimi serbesttir.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
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
import {
  DriverValidationError,
  DriverVersionConflictError,
  PersonAnonymizedError,
  PersonNotFoundError,
} from "./errors";
import { isValidFullName, normalizeFullName } from "./person-name";
import {
  getManagedDriver,
  isOwnerPerson,
  listAffectedVehicles,
  type AffectedVehicle,
  type ManagedDriver,
} from "./queries";

/** Sahip oturumu `active` göndermeye çalıştı — küresel aktiflik yalnız ekip. */
export class GlobalActiveForbiddenError extends Error {
  readonly status = 403 as const;
  readonly code = "FORBIDDEN" as const;

  constructor(message = "Bu işlem için yetkin yok.") {
    super(message);
    this.name = "GlobalActiveForbiddenError";
  }
}

export interface UpdatePersonParams {
  requestId: string;
  personId: string;
  version: number;
  fullName?: string;
  active?: boolean;
}

export interface UpdatePersonResult {
  status: number;
  driver: ManagedDriver;
  /** Yalnız ekip için — kişinin işletmedeki tüm atama araçları. */
  affectedVehicles?: AffectedVehicle[];
}

const OPERATION = "person.update";

export function updatePerson(
  db: AppDatabase,
  context: SessionContext,
  scope: Scope,
  params: UpdatePersonParams,
  clock: Clock = systemClock,
): UpdatePersonResult {
  if (!scope.vehicleId) {
    throw new Error("updatePerson: scope.vehicleId eksik (programlama hatası).");
  }
  const isStaff = scope.kind === "staff";
  if (params.active !== undefined && !isStaff) {
    throw new GlobalActiveForbiddenError();
  }

  const fullName = params.fullName === undefined ? undefined : normalizeFullName(params.fullName);
  if (fullName !== undefined && !isValidFullName(fullName)) {
    throw new DriverValidationError({ fullName: DRIVER_FIELD_MESSAGES.fullName });
  }

  const requestHash = hashRequestPayload({
    personId: params.personId,
    version: params.version,
    fullName: fullName ?? null,
    active: params.active ?? null,
  });

  const buildResult = (status: number): UpdatePersonResult => {
    const driver = getManagedDriver(db, scope, params.personId);
    if (!driver) throw new PersonNotFoundError();
    return isStaff
      ? { status, driver, affectedVehicles: listAffectedVehicles(db, scope, params.personId) }
      : { status, driver };
  };

  return withImmediateTransaction(db.$client, () => {
    const resolved = resolveReceipt(
      db,
      context,
      scope,
      { requestId: params.requestId, operation: OPERATION, requestHash },
      clock,
    );
    if (resolved.replay) {
      return buildResult(resolved.receipt.responseCode);
    }

    const current = db
      .select({
        fullName: people.fullName,
        active: people.active,
        version: people.version,
        anonymizedAt: people.anonymizedAt,
      })
      .from(people)
      .where(and(scopedPeopleFilter(scope), eq(people.id, params.personId)))
      .get();
    if (!current || isOwnerPerson(db, scope.businessId, params.personId)) {
      throw new PersonNotFoundError();
    }
    if (!isStaff) {
      // Sahip (K2): yalnız oturum aracına bağlı (aktif/pasif) kişi.
      const link = db
        .select({ personId: vehicleDrivers.personId })
        .from(vehicleDrivers)
        .where(and(scopedVehicleDriversFilter(scope), eq(vehicleDrivers.personId, params.personId)))
        .get();
      if (!link) throw new PersonNotFoundError();
    }

    // Anonim ad kalıcıdır: bayat sürümden de önce, istemci neden
    // reddedildiğini görsün.
    if (fullName !== undefined && current.anonymizedAt !== null) {
      throw new PersonAnonymizedError();
    }

    // Bayat sürüm "değişiklik yok" 422'sinden ÖNCE 409 alır (T2.1/T2.2 sırası).
    if (current.version !== params.version) {
      throw new DriverVersionConflictError();
    }

    const wantsRename = fullName !== undefined && fullName !== current.fullName;
    const wantsActive = params.active !== undefined && params.active !== current.active;
    if (!wantsRename && !wantsActive) {
      throw new DriverValidationError(
        { change: DRIVER_FIELD_MESSAGES.noChange },
        DRIVER_FIELD_MESSAGES.noChangeMessage,
      );
    }

    const changes: { version: ReturnType<typeof sql>; fullName?: string; active?: boolean } = {
      version: sql`${people.version} + 1`,
    };
    if (wantsRename) changes.fullName = fullName;
    if (wantsActive) changes.active = params.active;

    const updateResult = db
      .update(people)
      .set(changes)
      .where(
        and(
          eq(people.businessId, scope.businessId),
          eq(people.id, params.personId),
          eq(people.version, params.version),
          wantsRename ? isNull(people.anonymizedAt) : undefined,
        ),
      )
      .run();
    if (updateResult.changes !== 1) {
      throw new DriverVersionConflictError();
    }
    const newVersion = params.version + 1;
    const now = clock().toISOString();

    if (wantsRename) {
      writeDriverAudit(
        db,
        context,
        scope,
        {
          entityType: "person",
          entityId: params.personId,
          action: "person.rename",
          before: { fullName: current.fullName, version: params.version },
          after: { fullName, version: newVersion },
          vehicleScoped: true,
        },
        now,
      );
    }
    if (wantsActive) {
      writeDriverAudit(
        db,
        context,
        scope,
        {
          entityType: "person",
          entityId: params.personId,
          action: params.active ? "person.reactivate" : "person.deactivate",
          before: { active: current.active, version: params.version },
          after: { active: params.active, version: newVersion },
          vehicleScoped: false,
        },
        now,
      );
    }

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

    return buildResult(200);
  });
}
