/**
 * setBusinessActive(businessId, active) — T1.4 ADIM 2/2, S1.4.
 *
 * `./set-vehicle-active.ts` üstündeki notla BİREBİR AYNI iki katman
 * gerekçesi — yalnız hedef `businesses.active` ve kapsamı O İŞLETMENİN
 * TÜM araç credential'larına bağlı oturumlardır (`revokeSessionsForBusiness
 * Sync`, `resolveSession`'ın `business.active` canlı kontrolüyle birlikte).
 * Görev tanımı — "businesses.active=0 aynı şekilde [vehicles.active=0 ile
 * aynı garanti]."
 *
 * platform_users işletmeye bağlı DEĞİLDİR; bu yüzden
 * işletme pasifliği ekip (platform) oturumlarını ETKİLEMEZ (bkz.
 * `revokeSessionsForBusinessSync` — yalnız `vehicle_credentials.business_id`
 * üzerinden credential id toplar).
 */
import { eq } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { AppDatabase } from "../../data/db";
import { businesses } from "../../data/schema";
import { revokeSessionsForBusinessSync } from "../session/revoke-session";
import { runAccessChangeTransaction } from "./run-access-change-transaction";

export function setBusinessActive(
  db: AppDatabase,
  businessId: string,
  active: boolean,
  clock: Clock = systemClock,
): void {
  runAccessChangeTransaction(
    db,
    () => {
      db.update(businesses)
        .set({ active })
        .where(eq(businesses.id, businessId))
        .run();
    },
    active ? undefined : () => revokeSessionsForBusinessSync(db, businessId, clock),
  );
}
