/**
 * createPlatformSession(platformUserId, clock) — T1.4 ADIM 1/2, S1.4.
 *
 * `createVehicleSession`'ın (bkz. o dosyanın üst notu) ekip/platform
 * kimliği karşılığı; süre sabitleri platform (12 saat mutlak / 30 dk
 * hareketsizlik) sınırlarını kullanır.
 *
 * ## Giriş/pasifleştirme ve giriş/parola sıfırlama yarışı (S2.6)
 *
 * `../auth/platform-login.ts` Argon2'yi (asenkron, hash kuyruğu) satırı
 * okuduktan SONRA çalıştırır; bu sürede bir yönetici hesabı pasifleştirebilir
 * veya parolasını sıfırlayabilir. `active` ve (verildiyse)
 * `credential_version` bu yüzden `sessions` INSERT'iyle AYNI BEGIN IMMEDIATE
 * transaction içinde YENİDEN okunur (`createVehicleSession` ile AYNI desen —
 * Drizzle'ın senkron `.get()/.run()` üyeleri; dış `async` yüz yalnız sonucu
 * sarar). `active` HER çağrıda denetlenir; sürüm denetimi yalnız
 * `expectedCredentialVersion` verilirse yapılır.
 */
import { eq } from "drizzle-orm";
import {
  deriveCsrfToken,
  generateSessionId,
  generateSessionToken,
  hashSessionToken,
  PLATFORM_SESSION_ABSOLUTE_MS,
  systemClock,
  type Clock,
} from "../../auth/session";
import type { AppDatabase } from "../../data/db";
import { withImmediateTransaction } from "../../data/db";
import { platformUsers, sessions } from "../../data/schema";
import {
  PlatformCredentialVersionChangedError,
  PlatformSessionTargetInactiveError,
  PlatformUserNotFoundError,
} from "./errors";
import type { SessionContext } from "./types";

export interface CreatePlatformSessionResult {
  token: string;
  expiresAt: Date;
  context: SessionContext;
}

export async function createPlatformSession(
  db: AppDatabase,
  platformUserId: string,
  clock: Clock = systemClock,
  /** `platformLogin`in Argon2 doğrulamasından ÖNCE okuduğu `credential_version`
   * (bkz. dosya üstü not). Verilmezse sürüm denetimi yapılmaz. */
  expectedCredentialVersion?: number,
): Promise<CreatePlatformSessionResult> {
  const now = clock();
  const token = generateSessionToken();
  const sessionId = generateSessionId();
  const expiresAt = new Date(now.getTime() + PLATFORM_SESSION_ABSOLUTE_MS);
  const nowIso = now.toISOString();

  const platformUser = withImmediateTransaction(db.$client, () => {
    const row = db
      .select()
      .from(platformUsers)
      .where(eq(platformUsers.id, platformUserId))
      .get();
    if (!row) {
      throw new PlatformUserNotFoundError(platformUserId);
    }
    if (!row.active) {
      throw new PlatformSessionTargetInactiveError();
    }
    if (
      expectedCredentialVersion !== undefined &&
      row.credentialVersion !== expectedCredentialVersion
    ) {
      throw new PlatformCredentialVersionChangedError();
    }

    db.insert(sessions)
      .values({
        id: sessionId,
        tokenHash: hashSessionToken(token),
        credentialId: null,
        platformUserId: row.id,
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
      kind: "platform",
      sessionId,
      role: platformUser.platformRole,
      platformUserId: platformUser.id,
      csrfToken: deriveCsrfToken(token),
    },
  };
}
