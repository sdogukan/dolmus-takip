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
// T1.3, S1.3 — açık ".ts" uzantısı KASITLIDIR (bkz. `../../data/db.ts` üst
// notu ve `../../data/package.json`/`../../../../scripts/package.json` —
// AYNI desen): `scripts/platform-admin.ts` bu modülü (dolaylı olarak,
// `bumpPlatformUserVersion` üzerinden) DOĞRUDAN Node'un yerel ESM
// çözümleyicisiyle (bundler'sız) İÇE AKTARIR; Node uzantısız göreli
// import'u ÇÖZEMEZ. `allowImportingTsExtensions` (tsconfig) ve Next.js/
// Vitest'in bundler tabanlı çözümleyicileri açık ".ts" uzantısını da
// SORUNSUZ kabul eder — bu yüzden davranış hiçbir tüketicide DEĞİŞMEZ.
import { systemClock, type Clock } from "../../auth/session.ts";
import type { AppDatabase } from "../../data/db.ts";
import { platformUsers } from "../../data/schema.ts";
import { revokeSessionsForPlatformUserSync } from "../session/revoke-session.ts";
import { runAccessChangeTransaction } from "./run-access-change-transaction.ts";

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
