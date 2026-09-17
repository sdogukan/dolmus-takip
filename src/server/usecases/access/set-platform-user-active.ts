/**
 * setPlatformUserActive(platformUserId, active) — T1.4 ADIM 2/2, S1.4.
 *
 * Görev tanımı — "platform_users.active=0 ... → ekip oturumu reddedilir."
 * `./set-vehicle-active.ts` üstündeki notla aynı iki katman gerekçesi:
 * `resolveSession`'ın canlı `platformUser.active` kontrolü + BU kullanım
 * durumunun `active=false` iken yazdığı KALICI `revokeSessionsForPlatform
 * UserSync`. `active=true` (yeniden aktifleştirme) hiçbir revoke ÇAĞIRMAZ —
 * S1.4 AC3'ün "yeniden aktifleştirmek önceden iptal edilmiş oturumu
 * DİRİLTMEZ" garantisi bu asimetriye dayanır.
 */
import { eq } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { AppDatabase } from "../../data/db";
import { platformUsers } from "../../data/schema";
import { revokeSessionsForPlatformUserSync } from "../session/revoke-session";
import { runAccessChangeTransaction } from "./run-access-change-transaction";

export function setPlatformUserActive(
  db: AppDatabase,
  platformUserId: string,
  active: boolean,
  clock: Clock = systemClock,
): void {
  runAccessChangeTransaction(
    db,
    () => {
      db.update(platformUsers)
        .set({ active })
        .where(eq(platformUsers.id, platformUserId))
        .run();
    },
    active ? undefined : () => revokeSessionsForPlatformUserSync(db, platformUserId, clock),
  );
}
