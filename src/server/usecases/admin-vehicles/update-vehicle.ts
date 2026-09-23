/**
 * updateVehicle — T2.2, `PATCH /api/v1/admin/vehicles/[vehicleId]`.
 *
 * `../admin-businesses/update-business.ts` ile AYNI desen: tek BEGIN
 * IMMEDIATE transaction içinde sürüm denetimi (koşullu UPDATE `WHERE
 * version = ?`), pasifleşince oturum iptali, admin_audit/mutation_receipts
 * birlikte yazılır. Plaka/işletme/sahip bu uçta DEĞİŞTİRİLEMEZ (T2.2
 * sözleşmesi — yalnız `brandModel`/`year`/`routeStop`/`note`/`active`).
 *
 * "Aynı değerle PATCH" — T2.1 risk notuyla AYNI kural: bir alan yalnız
 * GERÇEKTEN mevcut değerden FARKLIYSA "değişiklik" sayılır; hiçbiri
 * değişmiyorsa 422 VALIDATION_ERROR `{ change: "Değişiklik yok." }`
 * döner, sürüm artırılmaz, audit yazılmaz.
 *
 * Reaktivasyon — yalnız `active: true` GÖNDERİLDİĞİNDE `vehicles.active`
 * denetimi ATLANIR (`skipVehicleActiveCheck`); İŞLETME aktiflik denetimi
 * HİÇBİR ZAMAN atlanmaz (bu uç işletmeyi aktive ETMEZ — risk notu).
 */
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { StaffScope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { withImmediateTransaction } from "../../data/db";
import { adminAudit, vehicles } from "../../data/schema";
import type { SessionContext } from "../session/types";
import { revokeSessionsForVehicleSync } from "../session/revoke-session";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { getVehicleDetail, type VehicleDetail } from "./queries";
import { VehicleValidationError, VehicleVersionConflictError } from "./errors";

export interface UpdateVehicleParams {
  requestId: string;
  version: number;
  /** `undefined` — gönderilmedi (dokunulmaz); `null` — temizle; dize —
   * yeni değer. */
  brandModel?: string | null;
  year?: number | null;
  routeStop?: string | null;
  note?: string | null;
  active?: boolean;
}

export interface UpdateVehicleResult {
  status: number;
  detail: VehicleDetail;
}

const MIN_VEHICLE_YEAR = 1950;
const MAX_TEXT_FIELD_LENGTH = 120;
const MAX_NOTE_LENGTH = 1000;

function normalizeClearableText(
  value: string | null | undefined,
  maxLength: number,
  fieldName: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new VehicleValidationError({ [fieldName]: "Metin çok uzun." });
  }
  return trimmed;
}

function validateClearableYear(year: number | null | undefined, clock: Clock): number | null | undefined {
  if (year === undefined || year === null) return year;
  const currentYear = clock().getUTCFullYear();
  if (!Number.isInteger(year) || year < MIN_VEHICLE_YEAR || year > currentYear + 1) {
    throw new VehicleValidationError({ year: "Model yılı geçersiz." });
  }
  return year;
}

export function updateVehicle(
  db: AppDatabase,
  context: SessionContext,
  scope: StaffScope,
  params: UpdateVehicleParams,
  clock: Clock = systemClock,
): UpdateVehicleResult {
  const vehicleId = scope.vehicleId;
  if (!vehicleId) {
    throw new Error(
      "updateVehicle: scope.vehicleId eksik (programlama hatası — resolveAdminScope " +
        "vehicleId hedefiyle çağrılmış olmalıydı).",
    );
  }

  const brandModel = normalizeClearableText(params.brandModel, MAX_TEXT_FIELD_LENGTH, "brandModel");
  const routeStop = normalizeClearableText(params.routeStop, MAX_TEXT_FIELD_LENGTH, "routeStop");
  const note = normalizeClearableText(params.note, MAX_NOTE_LENGTH, "note");
  const year = validateClearableYear(params.year, clock);

  const requestHash = hashRequestPayload({
    version: params.version,
    brandModel: brandModel ?? null,
    year: year ?? null,
    routeStop: routeStop ?? null,
    note: note ?? null,
    active: params.active ?? null,
  });

  return withImmediateTransaction(db.$client, () => {
    const recheckOptions = { skipVehicleActiveCheck: params.active === true };

    const resolved = resolveReceipt(
      db,
      context,
      scope,
      { requestId: params.requestId, operation: "vehicle.update", requestHash },
      clock,
      recheckOptions,
    );
    if (resolved.replay) {
      return { status: resolved.receipt.responseCode, detail: getVehicleDetail(db, vehicleId) };
    }

    const currentVehicle = db
      .select({
        brandModel: vehicles.brandModel,
        year: vehicles.year,
        routeStop: vehicles.routeStop,
        note: vehicles.note,
        active: vehicles.active,
        version: vehicles.version,
      })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .get();
    if (!currentVehicle) {
      throw new Error(
        `updateVehicle: araç bulunamadı: "${vehicleId}" (programlama hatası — resolveAdminScope zaten doğrulamış olmalıydı).`,
      );
    }

    // Bayat `version` "değişiklik yok" 422'sinden ÖNCE 409 almalı (T2.1
    // ile AYNI sıra kararı) — asıl koruma aşağıdaki koşullu UPDATE'tir.
    if (currentVehicle.version !== params.version) {
      throw new VehicleVersionConflictError();
    }

    const wantsBrandModelChange = brandModel !== undefined && brandModel !== currentVehicle.brandModel;
    const wantsYearChange = year !== undefined && year !== currentVehicle.year;
    const wantsRouteStopChange = routeStop !== undefined && routeStop !== currentVehicle.routeStop;
    const wantsNoteChange = note !== undefined && note !== currentVehicle.note;
    const wantsActiveChange = params.active !== undefined && params.active !== currentVehicle.active;
    const wantsFieldChange =
      wantsBrandModelChange || wantsYearChange || wantsRouteStopChange || wantsNoteChange;

    if (!wantsFieldChange && !wantsActiveChange) {
      throw new VehicleValidationError(
        { change: "Değişiklik yok." },
        "Gönderilen değerler mevcut kayıtla aynı; değişiklik uygulanmadı.",
      );
    }

    const now = clock().toISOString();

    const vehicleChanges: {
      version: ReturnType<typeof sql>;
      brandModel?: string | null;
      year?: number | null;
      routeStop?: string | null;
      note?: string | null;
      active?: boolean;
    } = { version: sql`${vehicles.version} + 1` };
    if (wantsBrandModelChange) vehicleChanges.brandModel = brandModel;
    if (wantsYearChange) vehicleChanges.year = year;
    if (wantsRouteStopChange) vehicleChanges.routeStop = routeStop;
    if (wantsNoteChange) vehicleChanges.note = note;
    if (wantsActiveChange) vehicleChanges.active = params.active;

    const updateResult = db
      .update(vehicles)
      .set(vehicleChanges)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.version, params.version)))
      .run();
    if (updateResult.changes !== 1) {
      throw new VehicleVersionConflictError();
    }
    const newVehicleVersion = params.version + 1;

    // S2.1 AC6 muadili — pasifleşince o aracın TÜM oturumları iptal edilir;
    // `setVehicleActive`'in KENDİ transaction'ı DEĞİL, bu PATCH'in transaction'ı
    // içindeki SENKRON çekirdek kullanılır (risk notu).
    if (wantsActiveChange && params.active === false) {
      revokeSessionsForVehicleSync(db, vehicleId, clock);
    }

    if (wantsFieldChange) {
      db.insert(adminAudit)
        .values({
          id: crypto.randomUUID(),
          businessId: scope.businessId,
          vehicleId,
          entityType: "vehicle",
          entityId: vehicleId,
          action: "vehicle.update",
          beforeJson: JSON.stringify({
            brandModel: currentVehicle.brandModel,
            year: currentVehicle.year,
            routeStop: currentVehicle.routeStop,
            note: currentVehicle.note,
            version: params.version,
          }),
          afterJson: JSON.stringify({
            brandModel: wantsBrandModelChange ? brandModel : currentVehicle.brandModel,
            year: wantsYearChange ? year : currentVehicle.year,
            routeStop: wantsRouteStopChange ? routeStop : currentVehicle.routeStop,
            note: wantsNoteChange ? note : currentVehicle.note,
            version: newVehicleVersion,
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
    }
    if (wantsActiveChange) {
      db.insert(adminAudit)
        .values({
          id: crypto.randomUUID(),
          businessId: scope.businessId,
          vehicleId,
          entityType: "vehicle",
          entityId: vehicleId,
          action: params.active ? "vehicle.reactivate" : "vehicle.deactivate",
          beforeJson: JSON.stringify({ active: currentVehicle.active, version: params.version }),
          afterJson: JSON.stringify({ active: params.active, version: newVehicleVersion }),
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
    }

    recordReceipt(
      db,
      scope,
      {
        requestId: params.requestId,
        operation: "vehicle.update",
        requestHash,
        entityId: vehicleId,
        resultVersion: newVehicleVersion,
        responseCode: 200,
      },
      clock,
    );

    return { status: 200, detail: getVehicleDetail(db, vehicleId) };
  });
}
