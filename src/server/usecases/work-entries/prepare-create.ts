/**
 * Günlük kayıt oluşturma HAZIRLIĞI (T3.3): izin, kişi/tür çözümü, sunucu
 * hesabı, durum ve aktör bloğu. HİÇBİR ŞEY YAZMAZ ve senkrondur; kalıcı
 * yazım, ilk revizyon, receipt ve audit T3.4'ündür.
 *
 * TOCTOU: T3.4 bu fonksiyonu KENDİ `BEGIN IMMEDIATE` transaction'ının İÇİNDE
 * (aynı `db` ile) çağırmalıdır; transaction öncesi yapılmış bir çağrı,
 * kişi/atama aktifliği yazımdan önce değişebileceğinden yazım için yetmez.
 *
 * Tür kararı gövdeden değil üçlüden gelir: `workType` + oturumun izni +
 * kişi çözümü. Sahip kişi ASLA `driver` türünde kabul edilmez (sıfır pay
 * atlatması yok), şoför oturumu ASLA `owner` türü alamaz.
 */
import { WORK_ENTRY_MESSAGES as TEXT } from "../../../lib/messages";
import type { WorkKind } from "../../../lib/work-calculation";
import { authorize, type Permission } from "../../auth/permissions";
import type { Scope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import type { SessionContext } from "../session/types";
import { findSelectableDriver } from "../drivers/queries";
import { computeWorkEntryFigures, type WorkEntryFigures } from "./figures";
import { readVehicleOwnerPerson } from "./queries";
import { workEntrySubjectSchema } from "./subject";

/** `work_entry_revisions` aktör sütunlarıyla birebir (CHECK: tam bir kimlik,
 * `onBehalfOf*` ya ikisi dolu ya ikisi boş). */
export type WorkEntryActor =
  | {
      actorKind: "vehicle_credential";
      actorSessionId: string;
      actorRole: "owner" | "driver";
      actorCredentialId: string;
      actorPlatformUserId: null;
      onBehalfOfKind: null;
      onBehalfOfPersonId: null;
    }
  | {
      actorKind: "platform_user";
      actorSessionId: string;
      actorRole: "admin" | "support";
      actorCredentialId: null;
      actorPlatformUserId: string;
      onBehalfOfKind: "owner";
      onBehalfOfPersonId: string;
    };

/** T3.4'ün kalıcılaştıracağı ortak kayıt girdisi. */
export interface WorkEntryCreateInput {
  businessId: string;
  vehicleId: string;
  personId: string;
  workKind: WorkKind;
  status: "pending" | "not_required";
  figures: WorkEntryFigures;
  actor: WorkEntryActor;
}

export type PrepareWorkEntryCreateResult =
  | { ok: true; input: WorkEntryCreateInput }
  | { ok: false; status: 403; code: "FORBIDDEN" }
  | { ok: false; status: 422; code: "VALIDATION_ERROR"; fields: Record<string, string> };

const PERMISSION_BY_WORK_TYPE = {
  owner: "work_entry.create_owner",
  driver: "work_entry.create_driver",
} as const satisfies Record<WorkKind, Permission>;

function validationError(fields: Record<string, string>): PrepareWorkEntryCreateResult {
  return { ok: false, status: 422, code: "VALIDATION_ERROR", fields };
}

function buildActor(context: SessionContext, scope: Scope, ownerPersonId: string): WorkEntryActor {
  if (scope.kind === "vehicle") {
    return {
      actorKind: "vehicle_credential",
      actorSessionId: context.sessionId,
      actorRole: scope.actor,
      actorCredentialId: scope.credentialId,
      actorPlatformUserId: null,
      onBehalfOfKind: null,
      onBehalfOfPersonId: null,
    };
  }
  return {
    actorKind: "platform_user",
    actorSessionId: context.sessionId,
    actorRole: scope.actor === "admin" ? "admin" : "support",
    actorCredentialId: null,
    actorPlatformUserId: scope.platformUserId,
    onBehalfOfKind: "owner",
    onBehalfOfPersonId: ownerPersonId,
  };
}

export function prepareWorkEntryCreate(
  db: AppDatabase,
  context: SessionContext,
  scope: Scope,
  body: unknown,
): PrepareWorkEntryCreateResult {
  if (!scope.vehicleId) {
    throw new Error("work-entries: scope.vehicleId eksik (programlama hatası — hedef 'vehicle' olmalı).");
  }
  const vehicleId = scope.vehicleId;

  const subject = workEntrySubjectSchema.safeParse(body);
  if (!subject.success) {
    const fields: Record<string, string> = {};
    for (const issue of subject.error.issues) {
      fields[issue.path.join(".") || "workType"] ??= issue.message;
    }
    return validationError(fields);
  }
  const { workType, workerPersonId } = subject.data;

  if (!authorize(scope, PERMISSION_BY_WORK_TYPE[workType]).ok) {
    return { ok: false, status: 403, code: "FORBIDDEN" };
  }

  const owner = readVehicleOwnerPerson(db, scope);
  if (!owner) {
    throw new Error("work-entries: kapsamdaki aracın sahip kişisi bulunamadı (veri bütünlüğü hatası).");
  }

  const fields: Record<string, string> = {};
  let personId: string | undefined;
  if (workType === "owner") {
    personId = owner.personId;
  } else if (!workerPersonId) {
    fields.workerPersonId = TEXT.personRequired;
  } else if (findSelectableDriver(db, scope, workerPersonId)) {
    personId = workerPersonId;
  } else {
    // Yok / başka işletme / pasif / atama pasif / sahip: AYNI metin (varlık sızıntısı yok).
    fields.workerPersonId = TEXT.personUnavailable;
  }

  const figures = computeWorkEntryFigures(workType, body);
  if (!figures.ok) Object.assign(fields, figures.fields);
  if (personId === undefined || !figures.ok) return validationError(fields);

  return {
    ok: true,
    input: {
      businessId: scope.businessId,
      vehicleId,
      personId,
      workKind: workType,
      status: workType === "owner" ? "not_required" : "pending",
      figures: figures.figures,
      actor: buildActor(context, scope, owner.personId),
    },
  };
}
