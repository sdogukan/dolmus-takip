/**
 * createPlatformSession(platformUserId, clock) — T1.4 ADIM 1/2, S1.4.
 *
 * `createVehicleSession`'ın (bkz. o dosyanın üst notu) ekip/platform
 * kimliği karşılığı; süre sabitleri platform (12 saat mutlak / 30 dk
 * hareketsizlik) sınırlarını kullanır.
 */
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  deriveCsrfToken,
  generateSessionId,
  generateSessionToken,
  hashSessionToken,
  PLATFORM_SESSION_ABSOLUTE_MS,
  systemClock,
  type Clock,
} from "../../auth/session";
import { platformUsers, sessions, type Schema } from "../../data/schema";
import { PlatformUserNotFoundError } from "./errors";
import type { SessionContext } from "./types";

export interface CreatePlatformSessionResult {
  token: string;
  expiresAt: Date;
  context: SessionContext;
}

export async function createPlatformSession(
  db: BetterSQLite3Database<Schema>,
  platformUserId: string,
  clock: Clock = systemClock,
): Promise<CreatePlatformSessionResult> {
  const rows = await db
    .select()
    .from(platformUsers)
    .where(eq(platformUsers.id, platformUserId))
    .limit(1);
  const platformUser = rows[0];
  if (!platformUser) {
    throw new PlatformUserNotFoundError(platformUserId);
  }

  const now = clock();
  const token = generateSessionToken();
  const sessionId = generateSessionId();
  const expiresAt = new Date(now.getTime() + PLATFORM_SESSION_ABSOLUTE_MS);
  const nowIso = now.toISOString();

  await db.insert(sessions).values({
    id: sessionId,
    tokenHash: hashSessionToken(token),
    credentialId: null,
    platformUserId: platformUser.id,
    issuedVersion: platformUser.credentialVersion,
    createdAt: nowIso,
    lastSeenAt: nowIso,
    expiresAt: expiresAt.toISOString(),
    revokedAt: null,
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
