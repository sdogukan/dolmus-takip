/**
 * Ekip kullanıcı adını okuma — T1.3 ADIM 1/2, S1.3.
 *
 * Görev tanımı — "GET /session platform oturumu için `username` döner."
 * `SessionContext` (bkz. `../usecases/session/types.ts`) `username`'i
 * KENDİSİ TAŞIMAZ (yalnız `platformUserId`); bu yüzden `../../app/api/v1/
 * session/route.ts` bu yardımcıyla tek bir ek SELECT yapar — `./vehicle-
 * plate.ts` `readVehiclePlateForDisplay`'in ekip oturumu KARŞILIĞI, AYNI
 * "tek kaynak" gerekçesiyle (iki farklı yerin aynı sorguyu bağımsız
 * kopyalar hâlinde taşıyıp birinin unutulması riskini önler).
 */
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../data/db";
import { platformUsers } from "../data/schema";

export async function readPlatformUsernameForDisplay(
  db: AppDatabase,
  platformUserId: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ username: platformUsers.username })
    .from(platformUsers)
    .where(eq(platformUsers.id, platformUserId))
    .limit(1);
  return rows[0]?.username;
}
