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
 */
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  deriveCsrfToken,
  generateSessionId,
  generateSessionToken,
  hashSessionToken,
  systemClock,
  VEHICLE_SESSION_ABSOLUTE_MS,
  type Clock,
} from "../../auth/session";
import { sessions, vehicleCredentials, type Schema } from "../../data/schema";
import { VehicleCredentialNotFoundError } from "./errors";
import type { SessionContext } from "./types";

export interface CreateVehicleSessionResult {
  /** Yalnız burada (bir kez) döner — istemciye HttpOnly çerezle taşınacak
   * ham değer. Çağıran DIŞINDA hiçbir yerde (log, DB, audit) saklanmaz. */
  token: string;
  expiresAt: Date;
  context: SessionContext;
}

export async function createVehicleSession(
  db: BetterSQLite3Database<Schema>,
  credentialId: string,
  clock: Clock = systemClock,
): Promise<CreateVehicleSessionResult> {
  const rows = await db
    .select()
    .from(vehicleCredentials)
    .where(eq(vehicleCredentials.id, credentialId))
    .limit(1);
  const credential = rows[0];
  if (!credential) {
    throw new VehicleCredentialNotFoundError(credentialId);
  }

  const now = clock();
  const token = generateSessionToken();
  const sessionId = generateSessionId();
  const expiresAt = new Date(now.getTime() + VEHICLE_SESSION_ABSOLUTE_MS);
  const nowIso = now.toISOString();

  await db.insert(sessions).values({
    id: sessionId,
    tokenHash: hashSessionToken(token),
    credentialId: credential.id,
    platformUserId: null,
    issuedVersion: credential.credentialVersion,
    createdAt: nowIso,
    lastSeenAt: nowIso,
    expiresAt: expiresAt.toISOString(),
    revokedAt: null,
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
