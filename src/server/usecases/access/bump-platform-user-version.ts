/**
 * bumpPlatformUserVersion(platformUserId) — T1.4 ADIM 2/2, S1.4.
 *
 * `./bump-credential-version.ts`'in ekip (platform) hesabı karşılığı —
 * görev tanımı: "platform_users.active=0 VEYA credential_version artışı →
 * ekip oturumu reddedilir." Ekip hesapları için ayrı bir "parola sıfırlama"
 * ekranı henüz yok (S2.6); bu, o ekranın DAYANACAĞI çekirdek atomik
 * işlemdir: `platform_users.credential_version`'ı `+ 1` artırır ve AYNI
 * transaction'da o hesabın TÜM ekip oturumlarını (`revokeSessionsForPlatform
 * UserSync`) iptal eder.
 */
import { eq, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { AppDatabase } from "../../data/db";
import { platformUsers } from "../../data/schema";
import { revokeSessionsForPlatformUserSync } from "../session/revoke-session";
import { runAccessChangeTransaction } from "./run-access-change-transaction";

export function bumpPlatformUserVersion(
  db: AppDatabase,
  platformUserId: string,
  clock: Clock = systemClock,
): void {
  runAccessChangeTransaction(
    db,
    () => {
      db.update(platformUsers)
        .set({ credentialVersion: sql`${platformUsers.credentialVersion} + 1` })
        .where(eq(platformUsers.id, platformUserId))
        .run();
    },
    () => revokeSessionsForPlatformUserSync(db, platformUserId, clock),
  );
}
