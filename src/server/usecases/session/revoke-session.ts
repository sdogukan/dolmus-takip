/**
 * Oturum iptali kullanım durumları — T1.4 ADIM 1/2, S1.4 (ADIM 2/2'de
 * senkron çekirdekler eklendi, bkz. altta "Sync çekirdekler" bölümü).
 *
 * Görev tanımından birebir liste: "revokeSession(sessionId),
 * revokeSessionsForCredential(credentialId), revokeSessionsForVehicle
 * (vehicleId), revokeSessionsForBusiness(businessId),
 * revokeSessionsForPlatformUser(platformUserId)."
 *
 * Hepsi İDEMPOTENTTİR: zaten iptal edilmiş bir satır tekrar dokunulmaz
 * (`isNull(sessions.revokedAt)` koşulu), bilinmeyen/eşleşmeyen id sessizce
 * sıfır satır etkiler (hata fırlatmaz) — bu, logout gibi çağıranların
 * "zaten geçersiz bir oturumu iptal etmeye çalışmak" durumunu güvenle ele
 * almasını sağlar (bkz. `src/app/api/v1/auth/logout/route.ts`).
 *
 * ARCHITECTURE §3.2 — "platform_users ... İşletmeye bağlı değildir"; bu
 * yüzden `revokeSessionsForBusiness` yalnız o işletmenin araç
 * credential'larına bağlı oturumları iptal eder, ekip (platform) oturumlarına
 * DOKUNMAZ.
 *
 * ---------------------------------------------------------------------
 * Sync çekirdekler (T1.4 ADIM 2/2, S1.4) — `../access/*` bu dosyanın
 * SAME-SQL senkron karşılıklarını (`*Sync`) BEGIN IMMEDIATE transaction
 * içinden çağırır: `../data/db.ts` `AppDatabase` tipinin üstündeki notta
 * açıklandığı gibi, better-sqlite3'ün native `sqlite.transaction(fn)`
 * sarmalayıcısı `fn`'in KESİNLİKLE senkron olmasını (promise DÖNMEMESİNİ)
 * ister; Drizzle'ın `await db.update(...)` biçimi ise `async execute()`
 * üzerinden çalışır. Bu yüzden her `revokeXxx` fonksiyonunun GERÇEK SQL'i
 * senkron bir `*Sync` çekirdekte yaşar (Drizzle builder'ının `execute()`
 * DIŞINDAKİ senkron `.run()/.all()` üyeleriyle — `node_modules/
 * drizzle-orm/sqlite-core/query-builders/{update,select}.js`); asenkron
 * dış yüz (aşağıdaki `export async function revokeXxx(...)`) YALNIZ bu
 * çekirdeği çağırır ve `Promise<void>` olarak sarar — var olan tüm
 * ÇAĞIRANLARIN (bkz. `tests/integration/session-usecases.test.ts`,
 * route handler'lar) `await revokeXxx(...)` imzası ve davranışı DEĞİŞMEZ;
 * yalnız SQL'in TEK KAYNAĞI bu iki katman arasında paylaşılır.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { systemClock, type Clock } from "../../auth/session";
import { sessions, vehicleCredentials, type Schema } from "../../data/schema";

export function revokeSessionSync(
  db: BetterSQLite3Database<Schema>,
  sessionId: string,
  clock: Clock = systemClock,
): void {
  db.update(sessions)
    .set({ revokedAt: clock().toISOString() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    .run();
}

export async function revokeSession(
  db: BetterSQLite3Database<Schema>,
  sessionId: string,
  clock: Clock = systemClock,
): Promise<void> {
  revokeSessionSync(db, sessionId, clock);
}

export function revokeSessionsForCredentialSync(
  db: BetterSQLite3Database<Schema>,
  credentialId: string,
  clock: Clock = systemClock,
): void {
  db.update(sessions)
    .set({ revokedAt: clock().toISOString() })
    .where(
      and(eq(sessions.credentialId, credentialId), isNull(sessions.revokedAt)),
    )
    .run();
}

export async function revokeSessionsForCredential(
  db: BetterSQLite3Database<Schema>,
  credentialId: string,
  clock: Clock = systemClock,
): Promise<void> {
  revokeSessionsForCredentialSync(db, credentialId, clock);
}

export function revokeSessionsForPlatformUserSync(
  db: BetterSQLite3Database<Schema>,
  platformUserId: string,
  clock: Clock = systemClock,
): void {
  db.update(sessions)
    .set({ revokedAt: clock().toISOString() })
    .where(
      and(
        eq(sessions.platformUserId, platformUserId),
        isNull(sessions.revokedAt),
      ),
    )
    .run();
}

export async function revokeSessionsForPlatformUser(
  db: BetterSQLite3Database<Schema>,
  platformUserId: string,
  clock: Clock = systemClock,
): Promise<void> {
  revokeSessionsForPlatformUserSync(db, platformUserId, clock);
}

function credentialIdsForVehicleSync(
  db: BetterSQLite3Database<Schema>,
  vehicleId: string,
): string[] {
  return db
    .select({ id: vehicleCredentials.id })
    .from(vehicleCredentials)
    .where(eq(vehicleCredentials.vehicleId, vehicleId))
    .all()
    .map((row) => row.id);
}

export function revokeSessionsForVehicleSync(
  db: BetterSQLite3Database<Schema>,
  vehicleId: string,
  clock: Clock = systemClock,
): void {
  const credentialIds = credentialIdsForVehicleSync(db, vehicleId);
  if (credentialIds.length === 0) {
    return;
  }
  db.update(sessions)
    .set({ revokedAt: clock().toISOString() })
    .where(
      and(
        inArray(sessions.credentialId, credentialIds),
        isNull(sessions.revokedAt),
      ),
    )
    .run();
}

export async function revokeSessionsForVehicle(
  db: BetterSQLite3Database<Schema>,
  vehicleId: string,
  clock: Clock = systemClock,
): Promise<void> {
  revokeSessionsForVehicleSync(db, vehicleId, clock);
}

function credentialIdsForBusinessSync(
  db: BetterSQLite3Database<Schema>,
  businessId: string,
): string[] {
  return db
    .select({ id: vehicleCredentials.id })
    .from(vehicleCredentials)
    .where(eq(vehicleCredentials.businessId, businessId))
    .all()
    .map((row) => row.id);
}

export function revokeSessionsForBusinessSync(
  db: BetterSQLite3Database<Schema>,
  businessId: string,
  clock: Clock = systemClock,
): void {
  const credentialIds = credentialIdsForBusinessSync(db, businessId);
  if (credentialIds.length === 0) {
    return;
  }
  db.update(sessions)
    .set({ revokedAt: clock().toISOString() })
    .where(
      and(
        inArray(sessions.credentialId, credentialIds),
        isNull(sessions.revokedAt),
      ),
    )
    .run();
}

export async function revokeSessionsForBusiness(
  db: BetterSQLite3Database<Schema>,
  businessId: string,
  clock: Clock = systemClock,
): Promise<void> {
  revokeSessionsForBusinessSync(db, businessId, clock);
}
