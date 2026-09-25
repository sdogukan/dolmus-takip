/**
 * createVehicle — T2.2, `POST /api/v1/admin/vehicles`.
 *
 * Tek transaction ve tekrar gönderim kuralı — araç, İKİ
 * vehicle_credentials satırı (owner, driver), admin_audit ve
 * mutation_receipts TEK BEGIN IMMEDIATE transaction içinde yazılır (risk
 * notu — "vehicles satırı ve her iki vehicle_credentials satırı receipt
 * ile AYNI transaction'da; herhangi bir başarısızlık (plaka çakışması,
 * kilit, FK) hepsini geri alır — iki credential'dan AZ credential'ı olan
 * bir araç asla VAR OLMAZ").
 *
 * Yazma transaction'ı içinde parola hash'i yapılmaz — Argon2 hashleme
 * `../../auth/vehicle-password.ts` `hashVehiclePassword` ile HER ZAMAN
 * transaction'ın DIŞINDA (bu fonksiyonun ilk yarısında) çalışır.
 *
 * ## Tekrar gönderim ve parola doğrulaması (risk notu)
 *
 * `requestHash` (bkz. `../admin-businesses/request-hash.ts`
 * `hashRequestPayload`) YALNIZ GİZLİ OLMAYAN alanları kapsar
 * (`businessRef`/`plate`/`brandModel`/`year`/`routeStop`/`note`) —
 * `ownerPassword`/`driverPassword` KASITLI olarak DIŞLANIR (SHA-256 yalnız
 * yüksek entropili oturum tokenları için; kısa bir parolanın SHA-256'sı
 * çevrimdışı kırılabilir). Bu, aynı `requestId` ile
 * FARKLI parolalarla yapılan bir tekrar gönderimin `requestHash` düzeyinde
 * FARK EDİLEMEYECEĞİ anlamına gelir — bu yüzden bu fonksiyon, bilinen bir
 * makbuzla karşılaşınca (transaction'a hiç girmeden, salt-okunur bir ön
 * bakışla) gönderilen iki parolayı da saklanan özetlere karşı (hash
 * kuyruğu ÜZERİNDEN, transaction DIŞINDA) `verifyReplayPasswords` ile
 * DOĞRULAR; eşleşmezse 201 yerine 409 REQUEST_ID_REUSED döner (aksi
 * halde ilk parolalarla başarı raporlanır ama ekip müşteriye ÇALIŞMAYAN
 * bir parola vermiş olurdu).
 *
 * Peşin bakış ile asıl yazma transaction'ı arasında GERÇEKTEN eşzamanlı
 * iki istek varsa (peşin bakış ikisinde de "kayıt yok" görür, ikisi de
 * transaction'a girer, biri BEGIN IMMEDIATE'i kazanıp yazar ve committer,
 * kaybeden `resolveReceipt` çağrısında `replay: true` bulur) — Argon2
 * SENKRON transaction İÇİNDE ÇALIŞAMAZ, bu yüzden bu dal transaction
 * İÇİNDE parola doğrulamaz; yalnız bir REPLAY İŞARETİ (`entityId` +
 * `responseCode`) döner. `createVehicle`, transaction COMMIT olduktan
 * SONRA, kaybeden isteğin kendi `ownerPassword`/`driverPassword`'unu AYNI
 * `verifyReplayPasswords` yardımcısıyla (transaction DIŞINDA) doğrular ve
 * eşleşmezse 409 REQUEST_ID_REUSED döner — bu dar pencere de peşin
 * bakışla AYNI garantiyi taşır, ATLANMAZ.
 */
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import { buildStaffActorScope, type StaffScope } from "../../auth/scope";
import {
  hashVehiclePassword,
  passwordsAreDistinct,
  verifyVehiclePassword,
} from "../../auth/vehicle-password";
import type { AppDatabase } from "../../data/db";
import { withImmediateTransaction } from "../../data/db";
import { recheckScopeInTransaction } from "../../data/scoped";
import {
  adminAudit,
  businessOwners,
  businesses,
  mutationReceipts,
  people,
  vehicleCredentials,
  vehicles,
} from "../../data/schema";
import { normalizePlate, validatePlate } from "../../../lib/plate";
import type { SessionContext } from "../session/types";
import { recordReceipt } from "../receipts/record-receipt";
import { resolveReceipt } from "../receipts/resolve-receipt";
import { computeReceiptScopeKey } from "../receipts/scope-key";
import { RequestIdReusedError } from "../receipts/errors";
import { hashRequestPayload } from "../admin-businesses/request-hash";
import { getVehicleDetail, type VehicleDetail } from "./queries";
import { VehicleValidationError } from "./errors";

export interface CreateVehicleParams {
  requestId: string;
  businessRef: string;
  /** Ham (boşluklu olabilir) plaka — `normalizePlate`/`validatePlate` bu
   * fonksiyon İÇİNDE uygulanır. */
  plate: string;
  brandModel?: string;
  year?: number;
  routeStop?: string;
  note?: string;
  /** ASLA `.trim()` edilmez — araç girişi de aynı ham değeri karşılaştırır
   * (bkz. `../../../app/api/v1/admin/vehicles/route.ts` zod şeması). */
  ownerPassword: string;
  driverPassword: string;
}

export interface CreateVehicleResult {
  status: number;
  detail: VehicleDetail;
}

const MIN_VEHICLE_YEAR = 1950;
const MAX_TEXT_FIELD_LENGTH = 120;
const MAX_NOTE_LENGTH = 1000;

function normalizeOptionalText(
  value: string | undefined,
  maxLength: number,
  fieldName: string,
): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new VehicleValidationError({ [fieldName]: "Metin çok uzun." });
  }
  return trimmed;
}

function validateYear(year: number | undefined, clock: Clock): number | null {
  if (year === undefined) return null;
  const currentYear = clock().getUTCFullYear();
  if (!Number.isInteger(year) || year < MIN_VEHICLE_YEAR || year > currentYear + 1) {
    throw new VehicleValidationError({ year: "Model yılı geçersiz." });
  }
  return year;
}

function isUniqueConstraintError(error: unknown, columnHint: string): boolean {
  return (
    error instanceof Database.SqliteError &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE" &&
    error.message.includes(columnHint)
  );
}

/**
 * Bilinen bir `vehicle.create` makbuzunun arkasındaki araç için gönderilen
 * iki parolayı da saklanan Argon2 özetlerine karşı (hash kuyruğu ÜZERİNDEN)
 * doğrular — peşin bakış (transaction'a hiç girmeden) VE transaction-içi
 * replay işareti (transaction COMMIT olduktan SONRA) YOLLARININ PAYLAŞTIĞI
 * TEK doğrulama; eşleşmezse `RequestIdReusedError` (409) fırlatır, hangi
 * parolanın uyuşmadığını ASLA belirtmez (risk notu).
 */
async function verifyReplayPasswords(
  db: AppDatabase,
  vehicleId: string,
  ownerPassword: string,
  driverPassword: string,
  clock: Clock,
): Promise<void> {
  const credentialRows = db
    .select({ role: vehicleCredentials.role, passwordHash: vehicleCredentials.passwordHash })
    .from(vehicleCredentials)
    .where(eq(vehicleCredentials.vehicleId, vehicleId))
    .all();
  const ownerCredential = credentialRows.find((row) => row.role === "owner");
  const driverCredential = credentialRows.find((row) => row.role === "driver");
  if (!ownerCredential || !driverCredential) {
    throw new Error(
      `createVehicle: makbuz kaydı olan aracın credential'ları eksik: "${vehicleId}" (programlama hatası).`,
    );
  }
  const [ownerMatches, driverMatches] = await Promise.all([
    verifyVehiclePassword(ownerCredential.passwordHash, ownerPassword, clock),
    verifyVehiclePassword(driverCredential.passwordHash, driverPassword, clock),
  ]);
  if (!ownerMatches || !driverMatches) {
    throw new RequestIdReusedError("Bu istek kimliği farklı parolalarla zaten kullanılmış.");
  }
}

/** `withImmediateTransaction` içindeki `createVehicle` çekirdeğinin dönüş
 * şekli — normal oluşturma SONUCU ile transaction-içi replay İŞARETİ
 * (parola doğrulaması henüz YAPILMAMIŞ, transaction COMMIT olduktan sonra
 * `verifyReplayPasswords` ile tamamlanacak) ayrı tutulur. */
type CreateVehicleTxOutcome =
  | { kind: "created"; detail: VehicleDetail }
  | { kind: "replay-marker"; entityId: string; responseCode: number };

export async function createVehicle(
  db: AppDatabase,
  context: SessionContext,
  params: CreateVehicleParams,
  clock: Clock = systemClock,
): Promise<CreateVehicleResult> {
  // --- Sahip/şoför şifresi aynı olamaz (Argon2'ye HİÇ gitmeden, en ucuz
  // kontrol önce). ---
  if (!passwordsAreDistinct(params.ownerPassword, params.driverPassword)) {
    throw new VehicleValidationError(
      {
        ownerPassword: "Sahip ve şoför şifreleri aynı olamaz.",
        driverPassword: "Sahip ve şoför şifreleri aynı olamaz.",
      },
      "Sahip ve şoför şifreleri aynı olamaz.",
    );
  }

  const requestHash = hashRequestPayload({
    businessRef: params.businessRef,
    plate: params.plate,
    brandModel: params.brandModel ?? null,
    year: params.year ?? null,
    routeStop: params.routeStop ?? null,
    note: params.note ?? null,
  });

  const actorScope = buildStaffActorScope(context);
  // Yalnız `scopeKey` HESAPLAMAK için — bkz. dosya üstü not: gerçek
  // işletme VAR OLMASA bile (henüz doğrulanmadı) bu peşin bakış hiçbir
  // yazma/yetki kararı VERMEZ, yalnız "bu requestId daha önce KULLANILMIŞ
  // mı" sorusunu YANITLAR.
  const peekScopeKey = computeReceiptScopeKey({
    kind: "staff",
    actor: actorScope.actor,
    businessId: params.businessRef,
    platformUserId: actorScope.platformUserId,
    onBehalfOf: true,
  } satisfies StaffScope);

  const peeked = db
    .select()
    .from(mutationReceipts)
    .where(
      and(
        eq(mutationReceipts.scopeKey, peekScopeKey),
        eq(mutationReceipts.requestId, params.requestId),
      ),
    )
    .get();

  if (peeked) {
    if (peeked.operation !== "vehicle.create") {
      throw new RequestIdReusedError(
        "Bu istek kimliği farklı bir işlem türü için zaten kullanılmış.",
      );
    }
    if (peeked.requestHash !== requestHash) {
      throw new RequestIdReusedError();
    }
    if (!peeked.entityId) {
      throw new Error(
        "createVehicle: vehicle.create makbuzu entityId taşımıyor (programlama hatası).",
      );
    }
    await verifyReplayPasswords(db, peeked.entityId, params.ownerPassword, params.driverPassword, clock);

    // "erişimi iptal edilen aktör eski makbuz üzerinden veri okuyamaz" —
    // makbuz VARSA işletme daha önce GERÇEKTEN var olmuştur; yine de
    // aktörün oturumu/işletmenin aktifliği YENİDEN denetlenir.
    recheckScopeInTransaction(
      db,
      context,
      {
        kind: "staff",
        actor: actorScope.actor,
        businessId: params.businessRef,
        platformUserId: actorScope.platformUserId,
        onBehalfOf: true,
      } satisfies StaffScope,
      clock,
    );

    return { status: peeked.responseCode, detail: getVehicleDetail(db, peeked.entityId) };
  }

  // --- Taze istek — tüm alan doğrulamaları (422), SONRA Argon2 hashleme
  // (transaction DIŞINDA), SONRA tek yazma transaction'ı. ---
  const plateResult = validatePlate(params.plate);
  if (!plateResult.valid) {
    throw new VehicleValidationError({
      plate:
        plateResult.reason === "empty" ? "Plakayı gir." : "Plaka biçimi geçersiz.",
    });
  }
  const year = validateYear(params.year, clock);
  const brandModel = normalizeOptionalText(params.brandModel, MAX_TEXT_FIELD_LENGTH, "brandModel");
  const routeStop = normalizeOptionalText(params.routeStop, MAX_TEXT_FIELD_LENGTH, "routeStop");
  const note = normalizeOptionalText(params.note, MAX_NOTE_LENGTH, "note");

  const [ownerPasswordHash, driverPasswordHash] = await Promise.all([
    hashVehiclePassword(params.ownerPassword, clock),
    hashVehiclePassword(params.driverPassword, clock),
  ]);

  const txResult = withImmediateTransaction<CreateVehicleTxOutcome>(db.$client, () => {
    const business = db
      .select({ id: businesses.id, active: businesses.active })
      .from(businesses)
      .where(eq(businesses.id, params.businessRef))
      .get();
    if (!business) {
      throw new VehicleValidationError({ businessRef: "Belirtilen işletme bulunamadı." });
    }

    const scope: StaffScope = {
      kind: "staff",
      actor: actorScope.actor,
      businessId: business.id,
      platformUserId: actorScope.platformUserId,
      onBehalfOf: true,
    };

    const resolved = resolveReceipt(
      db,
      context,
      scope,
      { requestId: params.requestId, operation: "vehicle.create", requestHash },
      clock,
    );
    if (resolved.replay) {
      // Aşırı nadir yarış (peşin bakışla bu transaction arasında AYNI
      // requestId GERÇEKTEN kaydedildi) — Argon2 senkron transaction
      // İÇİNDE ÇALIŞAMAZ, bu yüzden parola doğrulaması burada YAPILMAZ;
      // yalnız bir replay İŞARETİ dönülür. Çağıran, transaction COMMIT
      // olduktan SONRA `verifyReplayPasswords` ile aynı doğrulamayı
      // peşin bakış yoluyla AYNEN yapar (bkz. dosya üstü not).
      if (!resolved.receipt.entityId) {
        throw new Error(
          "createVehicle: vehicle.create makbuzu entityId taşımıyor (programlama hatası).",
        );
      }
      return {
        kind: "replay-marker",
        entityId: resolved.receipt.entityId,
        responseCode: resolved.receipt.responseCode,
      };
    }

    const ownerRow = db
      .select({ personId: businessOwners.personId })
      .from(businessOwners)
      .where(eq(businessOwners.businessId, business.id))
      .get();
    if (!ownerRow) {
      throw new VehicleValidationError({ businessRef: "Bu işletmenin sahibi yok." });
    }
    const owner = db
      .select({ id: people.id, fullName: people.fullName })
      .from(people)
      .where(and(eq(people.businessId, business.id), eq(people.id, ownerRow.personId)))
      .get();
    if (!owner) {
      throw new Error(
        `createVehicle: sahip kişi kaydı bulunamadı: "${ownerRow.personId}" (programlama hatası).`,
      );
    }

    const plateExists = db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.plateNormalized, plateResult.normalized))
      .get();
    if (plateExists) {
      throw new VehicleValidationError({ plate: "Bu plaka zaten kayıtlı." });
    }

    const vehicleId = crypto.randomUUID();
    const ownerCredentialId = crypto.randomUUID();
    const driverCredentialId = crypto.randomUUID();
    const now = clock().toISOString();

    try {
      db.insert(vehicles)
        .values({
          businessId: business.id,
          id: vehicleId,
          plateNormalized: plateResult.normalized,
          ownerPersonId: owner.id,
          brandModel,
          year,
          routeStop,
          note,
          active: true,
          version: 1,
        })
        .run();
    } catch (error) {
      if (isUniqueConstraintError(error, "vehicles.plate_normalized")) {
        throw new VehicleValidationError({ plate: "Bu plaka zaten kayıtlı." });
      }
      throw error;
    }

    db.insert(vehicleCredentials)
      .values([
        {
          businessId: business.id,
          id: ownerCredentialId,
          vehicleId,
          role: "owner",
          passwordHash: ownerPasswordHash,
          credentialVersion: 1,
        },
        {
          businessId: business.id,
          id: driverCredentialId,
          vehicleId,
          role: "driver",
          passwordHash: driverPasswordHash,
          credentialVersion: 1,
        },
      ])
      .run();

    // admin_audit — gizli değer içermez (yalnız plaka/marka-model/yıl/hat-
    // durak/not/sahip/sürüm); oluşturmada `beforeJson` NULL.
    db.insert(adminAudit)
      .values({
        id: crypto.randomUUID(),
        businessId: business.id,
        vehicleId,
        entityType: "vehicle",
        entityId: vehicleId,
        action: "vehicle.create",
        beforeJson: null,
        afterJson: JSON.stringify({
          plateNormalized: plateResult.normalized,
          brandModel,
          year,
          routeStop,
          note,
          active: true,
          ownerPersonId: owner.id,
          version: 1,
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

    recordReceipt(
      db,
      scope,
      {
        requestId: params.requestId,
        operation: "vehicle.create",
        requestHash,
        entityId: vehicleId,
        resultVersion: 1,
        responseCode: 201,
      },
      clock,
    );

    return { kind: "created", detail: getVehicleDetail(db, vehicleId) };
  });

  if (txResult.kind === "created") {
    return { status: 201, detail: txResult.detail };
  }

  // Transaction-içi replay işareti — commit olmuş receipt'in gerçek
  // sahibi bu istek DEĞİL; kazanan isteğin araç için AYNI parola
  // doğrulaması (transaction DIŞINDA, hash kuyruğu ÜZERİNDEN) burada
  // tamamlanır. Eşleşmezse `verifyReplayPasswords` 409 REQUEST_ID_REUSED
  // fırlatır.
  await verifyReplayPasswords(
    db,
    txResult.entityId,
    params.ownerPassword,
    params.driverPassword,
    clock,
  );
  return { status: txResult.responseCode, detail: getVehicleDetail(db, txResult.entityId) };
}
