/**
 * bumpCredentialVersion(credentialId) — T1.4 ADIM 2/2, S1.4.
 *
 * Görev tanımı — "parola sıfırlama simülasyonu = vehicle_credentials.
 * credential_version artışı → yalnız o rolün oturumları reddedilir, diğer
 * rolün oturumu çalışmaya devam eder" ve "bumpCredentialVersion(credentialId)
 * ... ilgili revoke ile aynı BEGIN IMMEDIATE transaction'ında."
 *
 * Gerçek parola sıfırlama akışı (yeni hash üretimi, admin_audit) S2.3'te
 * gelecektir; bu kullanım durumu yalnız S1.4 AC4'ün gerektirdiği
 * "credential_version artışı + oturum iptali ATOMİK" çekirdeğidir — S2.3
 * gerçek parola alanını EKLEYECEK, bu transaction'ı YENİDEN YAZMAYACAKTIR
 * (bkz. `../../data/db.ts` `AppDatabase` notu — M2 admin_audit yazması aynı
 * transaction'a eklenecek).
 *
 * `vehicle_credentials` tablosunda `id` her (araç, rol) çiftine ÖZGÜDÜR
 * ("Araç/rol UNIQUE"). Bu yüzden yalnız BU credential_id'ye bağlı
 * oturumlar (`revokeSessionsForCredentialSync`) iptal edilir; aynı araçtaki
 * DİĞER rolün credential'ı ve oturumları dokunulmadan kalır (S1.4 AC4).
 *
 * `credential_version` MUTLAK bir değere değil, SQL `+ 1` ile ARTIRILIR:
 * eşzamanlı iki çağrı (ör. iki farklı admin sekmesi) birbirinin yazdığı
 * artışı EZMEZ (her ikisi de kendi +1'ini üstüne ekler).
 */
import { eq, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { AppDatabase } from "../../data/db";
import { vehicleCredentials } from "../../data/schema";
import { revokeSessionsForCredentialSync } from "../session/revoke-session";
import { runAccessChangeTransaction } from "./run-access-change-transaction";

export function bumpCredentialVersion(
  db: AppDatabase,
  credentialId: string,
  clock: Clock = systemClock,
): void {
  runAccessChangeTransaction(
    db,
    () => {
      db.update(vehicleCredentials)
        .set({
          credentialVersion: sql`${vehicleCredentials.credentialVersion} + 1`,
        })
        .where(eq(vehicleCredentials.id, credentialId))
        .run();
    },
    () => revokeSessionsForCredentialSync(db, credentialId, clock),
  );
}
