/**
 * resetVehiclePassword — T2.3, `POST /api/v1/admin/vehicles/[vehicleId]/
 * reset-password`.
 *
 * `./create-vehicle.ts` ile AYNI iskelet: Argon2 doğrulama/hashleme HER ZAMAN
 * `withImmediateTransaction` bloğunun DIŞINDA (hash kuyruğu üzerinden) çalışır
 * — better-sqlite3'ün native transaction sarmalayıcısı SENKRON bir fonksiyon
 * ister. Tek BEGIN IMMEDIATE transaction'ı koşullu hash+credential_version
 * artışı (`../access/reset-vehicle-credential.ts` `resetVehicleCredentialSync`),
 * SADECE hedef credential'ın oturumlarının iptali, TEK bir admin_audit satırı
 * ve mutasyon makbuzunu BİRLİKTE yazar.
 *
 * ## Tekrar gönderim (risk notu — `create-vehicle.ts` ile AYNI desen)
 *
 * `requestHash` YALNIZ `{ access }`i kapsar — `newPassword` KASITLI olarak
 * DIŞLANIR (ARCH §6 — SHA-256 yalnız yüksek entropili oturum tokenları için;
 * kısa bir parolanın SHA-256'sı çevrimdışı kırılabilir). Bilinen bir makbuzla
 * karşılaşınca (transaction'a hiç girmeden, salt-okunur bir ön bakışla)
 * gönderilen `newPassword`, makbuzun `entityId`sindeki (hedef credential)
 * GÜNCEL (sıfırlama SONRASI) özete karşı `verifyReplayNewPassword` ile
 * doğrulanır; eşleşmezse 409 REQUEST_ID_REUSED (hangi parça uyuşmadığı ASLA
 * belirtilmez). Makbuzun `resultVersion`ı, credential'ın O ANKİ sürümüyle
 * ARTIK uyuşmuyorsa (sonraki bir sıfırlama bu makbuzu GEÇERSİZ kılmış
 * demektir) 409 VERSION_CONFLICT — bir 200 burada personelin ARTIK
 * ÇALIŞMAYAN bir parolayı elden teslim etmesine yol açardı.
 *
 * Peşin bakış ile asıl yazma transaction'ı arasında GERÇEKTEN eşzamanlı iki
 * istek varsa `create-vehicle.ts`teki AYNI transaction-içi replay İŞARETİ
 * deseni kullanılır: transaction İÇİNDE parola doğrulanmaz, yalnız
 * `entityId`/`resultVersion`/`responseCode` taşıyan bir işaret döner; asıl
 * doğrulama COMMIT'TEN SONRA (transaction DIŞINDA) tamamlanır.
 *
 * ## TOCTOU — iki eşzamanlı sıfırlama AYNI yeni parolaya (risk notu)
 *
 * Argon2 hashleme transaction DIŞINDA olduğundan, hedef credential'ın
 * `credential_version`i (Argon2'den ÖNCE okunur) transaction içindeki koşullu
 * UPDATE'e (`resetVehicleCredentialSync`) taşınır — `changes !== 1` → 409
 * VERSION_CONFLICT. Bu TEK BAŞINA yeterli DEĞİLDİR: owner ve driver'ı AYNI ANDA
 * AYNI yeni parolaya sıfırlayan iki istek, birbirinin hedefine DOKUNMADIĞINDAN
 * bu koşullu UPDATE'in İKİSİ de geçebilir. Bu yüzden transaction içinde,
 * hedef güncellendikten SONRA, DİĞER rolün credential_version'ı da (Argon2'den
 * ÖNCE okunan gözlemle) karşılaştırılır; DEĞİŞMİŞSE 409 VERSION_CONFLICT —
 * ikisi de committer'sa sahip/şoför şifreleri aynı olamaz kuralı ihlal
 * edilirdi.
 */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { StaffScope } from "../../auth/scope";
import {
  hashVehiclePassword,
  verifyVehiclePassword,
} from "../../auth/vehicle-password";
import type { AppDatabase } from "../../data/db";
import { withImmediateTransaction } from "../../data/db";
import { recheckScopeInTransaction } from "../../data/scoped";
import { adminAudit, mutationReceipts, vehicleCredentials } from "../../data/schema";
import { resetVehicleCredentialSync } from "../access/reset-vehicle-credential";
import type { SessionContext } from "../session/types";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import { computeReceiptScopeKey } from "../receipts/scope-key";
import { RequestIdReusedError } from "../receipts/errors";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { getVehicleDetail } from "./queries";
import { VehicleValidationError, VehicleVersionConflictError } from "./errors";

export type VehicleAccessRole = "owner" | "driver";

export interface ResetVehiclePasswordParams {
  requestId: string;
  access: VehicleAccessRole;
  /** ASLA `.trim()` edilmez — araç girişi aynı ham değeri karşılaştırır. */
  newPassword: string;
}

export interface ResetVehiclePasswordResultBody {
  access: VehicleAccessRole;
  vehicle: { id: string; plateNormalized: string };
  business: { id: string; name: string };
}

export interface ResetVehiclePasswordResult {
  status: number;
  result: ResetVehiclePasswordResultBody;
}

const OTHER_ROLE: Record<VehicleAccessRole, VehicleAccessRole> = {
  owner: "driver",
  driver: "owner",
};

interface CredentialRow {
  id: string;
  passwordHash: string;
  credentialVersion: number;
}

function getVehicleCredentialsByRole(
  db: AppDatabase,
  vehicleId: string,
): Record<VehicleAccessRole, CredentialRow> {
  const rows = db
    .select({
      id: vehicleCredentials.id,
      role: vehicleCredentials.role,
      passwordHash: vehicleCredentials.passwordHash,
      credentialVersion: vehicleCredentials.credentialVersion,
    })
    .from(vehicleCredentials)
    .where(eq(vehicleCredentials.vehicleId, vehicleId))
    .all();
  const owner = rows.find((row) => row.role === "owner");
  const driver = rows.find((row) => row.role === "driver");
  if (!owner || !driver) {
    throw new Error(
      `resetVehiclePassword: araç credential'ları eksik: "${vehicleId}" (programlama hatası).`,
    );
  }
  return { owner, driver };
}

function buildResetResult(
  db: AppDatabase,
  vehicleId: string,
  access: VehicleAccessRole,
): ResetVehiclePasswordResultBody {
  const detail = getVehicleDetail(db, vehicleId);
  return {
    access,
    vehicle: { id: detail.vehicle.id, plateNormalized: detail.vehicle.plateNormalized },
    business: { id: detail.business.id, name: detail.business.name },
  };
}

/**
 * Bilinen bir `vehicle.reset_password` makbuzunun arkasındaki credential için
 * gönderilen `newPassword`u makbuzun `resultVersion`ı GÜNCEL sürümle hâlâ
 * eşleşiyorsa (sonraki bir sıfırlama tarafından GEÇERSİZ kılınmamışsa)
 * saklanan (sıfırlama SONRASI) Argon2 özetine karşı (hash kuyruğu ÜZERİNDEN)
 * doğrular — peşin bakış (transaction'a hiç girmeden) VE transaction-içi
 * replay işareti (transaction COMMIT olduktan SONRA) YOLLARININ PAYLAŞTIĞI
 * TEK doğrulama; sürüm uyuşmazlığında 409 VERSION_CONFLICT, parola
 * uyuşmazlığında 409 REQUEST_ID_REUSED (hangi parçanın uyuşmadığı ASLA
 * belirtilmez) fırlatır.
 */
async function verifyReplayNewPassword(
  db: AppDatabase,
  credentialId: string,
  newPassword: string,
  expectedResultVersion: number,
  clock: Clock,
): Promise<void> {
  const credential = db
    .select({
      passwordHash: vehicleCredentials.passwordHash,
      credentialVersion: vehicleCredentials.credentialVersion,
    })
    .from(vehicleCredentials)
    .where(eq(vehicleCredentials.id, credentialId))
    .get();
  if (!credential) {
    throw new Error(
      `resetVehiclePassword: makbuz kaydı olan credential eksik: "${credentialId}" (programlama hatası).`,
    );
  }
  if (credential.credentialVersion !== expectedResultVersion) {
    throw new VehicleVersionConflictError();
  }
  const matches = await verifyVehiclePassword(credential.passwordHash, newPassword, clock);
  if (!matches) {
    throw new RequestIdReusedError();
  }
}

/** `withImmediateTransaction` içindeki çekirdeğin dönüş şekli —
 * `./create-vehicle.ts` `CreateVehicleTxOutcome` ile AYNI desen. */
type ResetVehiclePasswordTxOutcome =
  | { kind: "reset"; entityId: string; resultVersion: number }
  | { kind: "replay-marker"; entityId: string; resultVersion: number; responseCode: number };

export async function resetVehiclePassword(
  db: AppDatabase,
  context: SessionContext,
  scope: StaffScope,
  params: ResetVehiclePasswordParams,
  clock: Clock = systemClock,
): Promise<ResetVehiclePasswordResult> {
  const vehicleId = scope.vehicleId;
  if (!vehicleId) {
    throw new Error(
      "resetVehiclePassword: scope.vehicleId eksik (programlama hatası — resolveAdminScope " +
        "vehicleId hedefiyle çağrılmış olmalıydı).",
    );
  }

  const requestHash = hashRequestPayload({ access: params.access });

  // --- Peşin bakış (transaction'a hiç girmeden) — `create-vehicle.ts` ile
  // AYNI desen: Argon2'ye HİÇ gitmeden önce bilinen bir makbuz var mı? ---
  const scopeKey = computeReceiptScopeKey(scope);
  const peeked = db
    .select()
    .from(mutationReceipts)
    .where(
      and(eq(mutationReceipts.scopeKey, scopeKey), eq(mutationReceipts.requestId, params.requestId)),
    )
    .get();

  if (peeked) {
    if (peeked.operation !== "vehicle.reset_password") {
      throw new RequestIdReusedError(
        "Bu istek kimliği farklı bir işlem türü için zaten kullanılmış.",
      );
    }
    if (peeked.requestHash !== requestHash) {
      throw new RequestIdReusedError();
    }
    if (!peeked.entityId || peeked.resultVersion === null) {
      throw new Error(
        "resetVehiclePassword: vehicle.reset_password makbuzu entityId/resultVersion taşımıyor " +
          "(programlama hatası).",
      );
    }

    // "erişimi iptal edilen aktör eski makbuz üzerinden veri okuyamaz" —
    // makbuz VARSA hedef daha önce GERÇEKTEN var olmuştur; yine de aktörün
    // oturumu/hedefin aktifliği YENİDEN denetlenir.
    recheckScopeInTransaction(db, context, scope, clock);

    await verifyReplayNewPassword(db, peeked.entityId, params.newPassword, peeked.resultVersion, clock);
    return { status: peeked.responseCode, result: buildResetResult(db, vehicleId, params.access) };
  }

  // --- Taze istek — hedef ve diğer rolün credential'ları okunur (Argon2
  // ayrımlılık denetimi ve TOCTOU sürüm karşılaştırması için), SONRA Argon2
  // (transaction DIŞINDA), SONRA tek yazma transaction'ı. ---
  const credentials = getVehicleCredentialsByRole(db, vehicleId);
  const target = credentials[params.access];
  const other = credentials[OTHER_ROLE[params.access]];

  // Distinctness Argon2 İLE kanıtlanır (iki Argon2 özeti AYNI parola için
  // bile FARKLI salt'tan dolayı HER ZAMAN farklıdır — hash karşılaştırması
  // asla kanıt DEĞİLDİR; risk notu).
  const matchesOther = await verifyVehiclePassword(other.passwordHash, params.newPassword, clock);
  if (matchesOther) {
    throw new VehicleValidationError({
      newPassword: "Yeni şifre diğer rolün şifresiyle aynı olamaz.",
    });
  }

  const newPasswordHash = await hashVehiclePassword(params.newPassword, clock);

  const observedTargetVersion = target.credentialVersion;
  const observedOtherVersion = other.credentialVersion;

  const txResult = withImmediateTransaction<ResetVehiclePasswordTxOutcome>(db.$client, () => {
    const resolved = resolveReceipt(
      db,
      context,
      scope,
      { requestId: params.requestId, operation: "vehicle.reset_password", requestHash },
      clock,
    );
    if (resolved.replay) {
      // Aşırı nadir yarış (peşin bakışla bu transaction arasında AYNI
      // requestId GERÇEKTEN kaydedildi) — Argon2 senkron transaction İÇİNDE
      // ÇALIŞAMAZ; yalnız bir replay İŞARETİ dönülür (bkz. dosya üstü not).
      if (!resolved.receipt.entityId || resolved.receipt.resultVersion === null) {
        throw new Error(
          "resetVehiclePassword: vehicle.reset_password makbuzu entityId/resultVersion " +
            "taşımıyor (programlama hatası).",
        );
      }
      return {
        kind: "replay-marker",
        entityId: resolved.receipt.entityId,
        resultVersion: resolved.receipt.resultVersion,
        responseCode: resolved.receipt.responseCode,
      };
    }

    const updateResult = resetVehicleCredentialSync(
      db,
      target.id,
      newPasswordHash,
      observedTargetVersion,
      clock,
    );
    if (!updateResult.updated) {
      throw new VehicleVersionConflictError();
    }

    const currentOtherVersion = db
      .select({ credentialVersion: vehicleCredentials.credentialVersion })
      .from(vehicleCredentials)
      .where(eq(vehicleCredentials.id, other.id))
      .get()?.credentialVersion;
    if (currentOtherVersion !== observedOtherVersion) {
      throw new VehicleVersionConflictError();
    }

    const now = clock().toISOString();

    // admin_audit — gizli değer içermez (yalnız erişim rolü/sürüm).
    db.insert(adminAudit)
      .values({
        id: crypto.randomUUID(),
        businessId: scope.businessId,
        vehicleId,
        entityType: "vehicle_credential",
        entityId: target.id,
        action: "vehicle.reset_password",
        beforeJson: JSON.stringify({ access: params.access, credentialVersion: observedTargetVersion }),
        afterJson: JSON.stringify({ access: params.access, credentialVersion: updateResult.newVersion }),
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

    recordReceipt(
      db,
      scope,
      {
        requestId: params.requestId,
        operation: "vehicle.reset_password",
        requestHash,
        entityId: target.id,
        resultVersion: updateResult.newVersion,
        responseCode: 200,
      },
      clock,
    );

    return { kind: "reset", entityId: target.id, resultVersion: updateResult.newVersion };
  });

  if (txResult.kind === "reset") {
    return { status: 200, result: buildResetResult(db, vehicleId, params.access) };
  }

  // Transaction-içi replay işareti — commit olmuş receipt'in gerçek sahibi
  // bu istek DEĞİL; kazanan isteğin credential'ı için AYNI parola doğrulaması
  // (transaction DIŞINDA, hash kuyruğu ÜZERİNDEN) burada tamamlanır.
  await verifyReplayNewPassword(
    db,
    txResult.entityId,
    params.newPassword,
    txResult.resultVersion,
    clock,
  );
  return { status: txResult.responseCode, result: buildResetResult(db, vehicleId, params.access) };
}
