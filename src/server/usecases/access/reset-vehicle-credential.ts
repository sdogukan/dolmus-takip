/**
 * resetVehicleCredentialSync(credentialId, newPasswordHash, expectedVersion)
 * — T2.3.
 *
 * `bump-credential-version.ts`in koşulsuz `+ 1` çekirdeğinden FARKLI olarak
 * bu çekirdek KOŞULLUDUR: `WHERE id = ? AND credential_version = ?` — çağıran
 * (`../admin-vehicles/reset-vehicle-password.ts`) Argon2 hashlemeden HEMEN
 * ÖNCE (transaction DIŞINDA) okuduğu `credential_version`i buraya
 * `expectedVersion` olarak verir; bu UPDATE'in aynı anda başka bir isteğin
 * ÖNCE COMMIT ettiği bir sürüm DEĞİŞİKLİĞİYLE çakışıp çakışmadığını
 * (TOCTOU) `changes !== 1` ile ATOMİK olarak sınar — çağıran `updated: false`
 * dönüşünü 409 VERSION_CONFLICT'e çevirir.
 *
 * Satır GERÇEKTEN güncellenmişse (yalnız o zaman) `revokeSessionsForCredentialSync`
 * ile SADECE bu credential'ın oturumları iptal edilir — `bump-credential-
 * version.ts`in kendi üst notundaki AYNI gerekçeyle (vehicle_credentials.id
 * her (araç, rol) çiftine özgüdür), aynı araçtaki DİĞER rolün oturumları
 * dokunulmadan kalır.
 */
import { and, eq, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { AppDatabase } from "../../data/db";
import { vehicleCredentials } from "../../data/schema";
import { revokeSessionsForCredentialSync } from "../session/revoke-session";

export type ResetVehicleCredentialResult =
  | { updated: true; newVersion: number }
  | { updated: false };

export function resetVehicleCredentialSync(
  db: AppDatabase,
  credentialId: string,
  newPasswordHash: string,
  expectedVersion: number,
  clock: Clock = systemClock,
): ResetVehicleCredentialResult {
  const updateResult = db
    .update(vehicleCredentials)
    .set({
      passwordHash: newPasswordHash,
      credentialVersion: sql`${vehicleCredentials.credentialVersion} + 1`,
    })
    .where(
      and(
        eq(vehicleCredentials.id, credentialId),
        eq(vehicleCredentials.credentialVersion, expectedVersion),
      ),
    )
    .run();

  if (updateResult.changes !== 1) {
    return { updated: false };
  }

  revokeSessionsForCredentialSync(db, credentialId, clock);
  return { updated: true, newVersion: expectedVersion + 1 };
}
