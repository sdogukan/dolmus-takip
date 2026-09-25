/**
 * resolveSession(token, clock) — T1.4 ADIM 1/2, S1.4.
 *
 * Görev tanımı — "Her çözümlemede denetim: token_hash eşleşmesi, revoked_at
 * boş, expires_at geçmemiş, hareketsizlik sınırı, issued_version == güncel
 * credential_version (vehicle_credentials veya platform_users), aktiflik
 * (businesses.active, vehicles.active, platform_users.active)." Bu
 * fonksiyon TAM OLARAK bu sırayla denetler; hangi başarısızlığın hangi
 * `SessionErrorCode`'a düştüğü `./errors.ts` üstündeki nota bağlıdır.
 *
 * Aralık kuralı: dönem sınırları "[başlangıç, sonraki dönemin
 * başlangıcı)" yarı-açık aralığını kullanır. Oturum süresi kuralı kendi
 * sınırları için aynı açıklığı BİREBİR vermez; burada aynı yarı-açık
 * kuralı ÖRNEKSEME yoluyla uygulanır: `now >= expiresAt` (mutlak sınır) ve
 * `now - lastSeenAt >= inactivityLimit` (hareketsizlik) ANINDA geçersiz
 * sayılır (sınırın tam ucu dahil değil). Bu, birebir yazılmış bir kural
 * değil, bir yorumdur; başka bir yerde AYRICA kayıtlı DEĞİLDİR
 * ("open_issues" diye bir dosya/bölüm YOKTUR — denetim bulgusu, düzeltme
 * turu 2), yalnız bu yorumda belgelenir.
 *
 * "last_seen yazımı aralıklı yapılır" — yalnız BAŞARILI bir çözümlemenin
 * sonunda, en son yazımdan `SESSION_LAST_SEEN_WRITE_INTERVAL_MS` (5 dk)
 * geçtiyse `last_seen_at` güncellenir.
 */
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  deriveCsrfToken,
  hashSessionToken,
  PLATFORM_SESSION_INACTIVITY_MS,
  SESSION_LAST_SEEN_WRITE_INTERVAL_MS,
  systemClock,
  VEHICLE_SESSION_INACTIVITY_MS,
  type Clock,
} from "../../auth/session";
import {
  businesses,
  platformUsers,
  sessions,
  vehicleCredentials,
  vehicles,
  type Schema,
} from "../../data/schema";
import {
  SessionExpiredError,
  SessionMissingError,
  SessionRevokedError,
} from "./errors";
import type { SessionContext } from "./types";

export async function resolveSession(
  db: BetterSQLite3Database<Schema>,
  token: string,
  clock: Clock = systemClock,
): Promise<SessionContext> {
  const tokenHash = hashSessionToken(token);
  const now = clock();

  const rows = await db
    .select()
    .from(sessions)
    .leftJoin(
      vehicleCredentials,
      eq(sessions.credentialId, vehicleCredentials.id),
    )
    .leftJoin(vehicles, eq(vehicleCredentials.vehicleId, vehicles.id))
    .leftJoin(businesses, eq(vehicleCredentials.businessId, businesses.id))
    .leftJoin(platformUsers, eq(sessions.platformUserId, platformUsers.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  const row = rows[0];
  if (!row) {
    // "token_hash eşleşmesi" başarısız — hiç böyle bir oturum yok.
    throw new SessionMissingError();
  }

  const session = row.sessions;

  if (session.revokedAt !== null) {
    throw new SessionRevokedError();
  }

  if (now.getTime() >= Date.parse(session.expiresAt)) {
    throw new SessionExpiredError();
  }

  const lastSeenAtMs = Date.parse(session.lastSeenAt);
  let context: SessionContext;

  if (session.credentialId !== null) {
    const credential = row.vehicle_credentials;
    const vehicle = row.vehicles;
    const business = row.businesses;
    // Birleşik FK bu satırların eksik olmasını normalde engeller;
    // bu yalnız savunma amaçlı bir bütünlük denetimidir.
    if (!credential || !vehicle || !business) {
      throw new SessionRevokedError();
    }

    if (now.getTime() - lastSeenAtMs >= VEHICLE_SESSION_INACTIVITY_MS) {
      throw new SessionExpiredError();
    }
    if (session.issuedVersion !== credential.credentialVersion) {
      throw new SessionRevokedError();
    }
    if (!business.active || !vehicle.active) {
      throw new SessionRevokedError();
    }

    context = {
      kind: "vehicle",
      sessionId: session.id,
      businessId: credential.businessId,
      vehicleId: credential.vehicleId,
      role: credential.role,
      credentialId: credential.id,
      csrfToken: deriveCsrfToken(token),
    };
  } else {
    const platformUser = row.platform_users;
    if (!platformUser) {
      throw new SessionRevokedError();
    }

    if (now.getTime() - lastSeenAtMs >= PLATFORM_SESSION_INACTIVITY_MS) {
      throw new SessionExpiredError();
    }
    if (session.issuedVersion !== platformUser.credentialVersion) {
      throw new SessionRevokedError();
    }
    if (!platformUser.active) {
      throw new SessionRevokedError();
    }

    context = {
      kind: "platform",
      sessionId: session.id,
      role: platformUser.platformRole,
      platformUserId: platformUser.id,
      csrfToken: deriveCsrfToken(token),
    };
  }

  if (now.getTime() - lastSeenAtMs >= SESSION_LAST_SEEN_WRITE_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now.toISOString() })
      .where(eq(sessions.id, session.id));
  }

  return context;
}
