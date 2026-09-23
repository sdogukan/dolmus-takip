/**
 * createVehicleSession(credentialId, clock) — T1.4 ADIM 1/2, S1.4.
 *
 * Görev tanımı: bu kullanım durumu, T1.2/T1.3'ün (bu paketin KAPSAMI
 * DIŞINDA — "Bu paketin GİRİŞ endpoint'leri YAZILMAZ") parola doğrulaması
 * BAŞARILI olduktan SONRA çağrılacağı varsayılan tek adımdır: yeni bir
 * sunucu oturumu üretir. ARCHITECTURE §6 "Yenileme ve iptal" — "Her giriş
 * yeni token üretir."
 *
 * `issued_version` burada credential'ın O ANKİ `credential_version`'ıdır
 * (§3.2 sessions.issued_version = "ilgili credential_version"); parola
 * sıfırlaması bu sürümü artırdığında `resolveSession` eski oturumları
 * SESSION_REVOKED ile reddeder (bkz. `./errors.ts` üstündeki not).
 *
 * ## Giriş/pasifleştirme yarışı (T2.2 risk notu)
 *
 * `../auth/vehicle-login.ts` aracın/işletmenin aktifliğini Argon2
 * doğrulamasından ÖNCE bir kez okur; doğrulama ASENKRON olduğundan (hash
 * kuyruğu üzerinden, saniyeler sürebilir), bu okuma ile BURADAKİ session
 * INSERT'i ARASINDA bir admin PATCH'i aracı/işletmeyi pasifleştirebilir —
 * eski (erken okunmuş) sonuca güvenilirse, artık pasif bir hedef için
 * YENİ, İPTAL EDİLMEMİŞ bir oturum açılır (reaktivasyonda "pasifleştirmenin
 * kestiği erişim canlanmaz" kuralını ihlal eder). Bu yüzden `vehicles.
 * active`/`businesses.active` BURADA, `sessions` INSERT'iyle AYNI BEGIN
 * IMMEDIATE transaction içinde YENİDEN okunur (`../../data/db.ts`
 * `withImmediateTransaction`) — better-sqlite3'ün native transaction
 * sarmalayıcısı SENKRON bir fonksiyon istediğinden (bkz. o dosyanın
 * `AppDatabase` üst notu), bu iç işlev Drizzle'ın senkron `.get()/.run()`
 * üyelerini kullanır; DIŞTAKİ `async` yüz yalnız SONUCU sarar — var olan
 * `await createVehicleSession(...)` çağıranların (bkz. `../auth/
 * vehicle-login.ts`, testler) imzası/davranışı DEĞİŞMEZ.
 */
import { eq } from "drizzle-orm";
import {
  deriveCsrfToken,
  generateSessionId,
  generateSessionToken,
  hashSessionToken,
  systemClock,
  VEHICLE_SESSION_ABSOLUTE_MS,
  type Clock,
} from "../../auth/session";
import type { AppDatabase } from "../../data/db";
import { withImmediateTransaction } from "../../data/db";
import { businesses, sessions, vehicleCredentials, vehicles } from "../../data/schema";
import {
  VehicleCredentialNotFoundError,
  VehicleCredentialVersionChangedError,
  VehicleSessionTargetInactiveError,
} from "./errors";
import type { SessionContext } from "./types";

export interface CreateVehicleSessionResult {
  /** Yalnız burada (bir kez) döner — istemciye HttpOnly çerezle taşınacak
   * ham değer. Çağıran DIŞINDA hiçbir yerde (log, DB, audit) saklanmaz. */
  token: string;
  expiresAt: Date;
  context: SessionContext;
}

interface CredentialWithTargetRow {
  id: string;
  businessId: string;
  vehicleId: string;
  role: "owner" | "driver";
  credentialVersion: number;
  vehicleActive: boolean;
  businessActive: boolean;
}

export async function createVehicleSession(
  db: AppDatabase,
  credentialId: string,
  clock: Clock = systemClock,
  /** T2.3 — `../auth/vehicle-login.ts`in Argon2 doğrulamasından ÖNCE
   * okuduğu `credential_version`; verildiğinde transaction içinde YENİDEN
   * okunan güncel sürümle karşılaştırılır (bkz. dosya üstü not — giriş/
   * parola sıfırlama yarışı). Verilmezse (ör. `resolveSession` gibi bu
   * denetime ihtiyacı OLMAYAN çağıranlar) hiçbir ek kontrol yapılmaz —
   * var olan HER çağıranın (bu dosyanın üst notundaki testler dahil)
   * davranışı DEĞİŞMEZ. */
  expectedCredentialVersion?: number,
): Promise<CreateVehicleSessionResult> {
  const now = clock();
  const token = generateSessionToken();
  const sessionId = generateSessionId();
  const expiresAt = new Date(now.getTime() + VEHICLE_SESSION_ABSOLUTE_MS);
  const nowIso = now.toISOString();

  const credential = withImmediateTransaction(db.$client, (): CredentialWithTargetRow => {
    const row = db
      .select({
        id: vehicleCredentials.id,
        businessId: vehicleCredentials.businessId,
        vehicleId: vehicleCredentials.vehicleId,
        role: vehicleCredentials.role,
        credentialVersion: vehicleCredentials.credentialVersion,
        vehicleActive: vehicles.active,
        businessActive: businesses.active,
      })
      .from(vehicleCredentials)
      .innerJoin(vehicles, eq(vehicleCredentials.vehicleId, vehicles.id))
      .innerJoin(businesses, eq(vehicles.businessId, businesses.id))
      .where(eq(vehicleCredentials.id, credentialId))
      .get();
    if (!row) {
      throw new VehicleCredentialNotFoundError(credentialId);
    }
    if (!row.vehicleActive || !row.businessActive) {
      throw new VehicleSessionTargetInactiveError();
    }
    if (
      expectedCredentialVersion !== undefined &&
      row.credentialVersion !== expectedCredentialVersion
    ) {
      throw new VehicleCredentialVersionChangedError();
    }

    db.insert(sessions)
      .values({
        id: sessionId,
        tokenHash: hashSessionToken(token),
        credentialId: row.id,
        platformUserId: null,
        issuedVersion: row.credentialVersion,
        createdAt: nowIso,
        lastSeenAt: nowIso,
        expiresAt: expiresAt.toISOString(),
        revokedAt: null,
      })
      .run();

    return row;
  });

  return {
    token,
    expiresAt,
    context: {
      kind: "vehicle",
      sessionId,
      businessId: credential.businessId,
      vehicleId: credential.vehicleId,
      role: credential.role,
      credentialId: credential.id,
      csrfToken: deriveCsrfToken(token),
    },
  };
}
