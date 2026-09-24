/**
 * anonymizePerson — KVKK silme talebi,
 * `POST /api/v1/admin/businesses/:businessId/people/:personId/anonymize`.
 *
 * - Kişinin adı YERİNDE, geri dönüşsüz olarak `anonymousFullName(personId)`
 *   ile değiştirilir; `anonymized_at` dolar, `people.version` artar. Kişi
 *   satırı, kayıtlar, revizyonlar, teslim onayları, makbuzlar ve işlem
 *   geçmişi SİLİNMEZ ve YENİDEN YAZILMAZ — raporlar/toplamlar aynı kalır.
 * - Şoför de sahip kişi de (işletme/araç sahibi) anonimleştirilebilir;
 *   kapsam yalnız yoldaki işletmedir (`scopedPeopleFilter`).
 * - Yeni audit satırı eski adı TAŞIMAZ: önce yalnız sürüm + `anonymized:
 *   false`, sonra anonim ad + `anonymized: true` + yeni sürüm.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { StaffScope } from "../../auth/scope";
import { withImmediateTransaction, type AppDatabase } from "../../data/db";
import { scopedPeopleFilter } from "../../data/scoped";
import { people } from "../../data/schema";
import type { SessionContext } from "../session/types";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import { writeDriverAudit } from "./audit";
import { DriverVersionConflictError, PersonAnonymizedError, PersonNotFoundError } from "./errors";
import { anonymousFullName } from "./person-name";

export interface AnonymizePersonParams {
  requestId: string;
  personId: string;
  version: number;
}

export interface AnonymizedPerson {
  id: string;
  fullName: string;
  active: boolean;
  version: number;
  anonymized: boolean;
}

export interface AnonymizePersonResult {
  status: number;
  person: AnonymizedPerson;
}

const OPERATION = "person.anonymize";

function readPerson(db: AppDatabase, scope: StaffScope, personId: string) {
  return db
    .select({
      id: people.id,
      fullName: people.fullName,
      active: people.active,
      version: people.version,
      anonymizedAt: people.anonymizedAt,
    })
    .from(people)
    .where(and(scopedPeopleFilter(scope), eq(people.id, personId)))
    .get();
}

export function anonymizePerson(
  db: AppDatabase,
  context: SessionContext,
  scope: StaffScope,
  params: AnonymizePersonParams,
  clock: Clock = systemClock,
): AnonymizePersonResult {
  const requestHash = hashRequestPayload({ personId: params.personId, version: params.version });

  const buildResult = (status: number): AnonymizePersonResult => {
    const row = readPerson(db, scope, params.personId);
    if (!row) throw new PersonNotFoundError();
    const { anonymizedAt, ...person } = row;
    return { status, person: { ...person, anonymized: anonymizedAt !== null } };
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

    const current = readPerson(db, scope, params.personId);
    if (!current) throw new PersonNotFoundError();
    if (current.anonymizedAt !== null) throw new PersonAnonymizedError();
    if (current.version !== params.version) throw new DriverVersionConflictError();

    const fullName = anonymousFullName(params.personId);
    const now = clock().toISOString();
    const updateResult = db
      .update(people)
      .set({ fullName, anonymizedAt: now, version: sql`${people.version} + 1` })
      .where(
        and(
          eq(people.businessId, scope.businessId),
          eq(people.id, params.personId),
          eq(people.version, params.version),
          isNull(people.anonymizedAt),
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
        entityType: "person",
        entityId: params.personId,
        action: OPERATION,
        before: { anonymized: false, version: params.version },
        after: { fullName, anonymized: true, version: newVersion },
        vehicleScoped: false,
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

    return buildResult(200);
  });
}
