/**
 * setPlatformUserRole(platformUserId, role) — T1.4 ADIM 2/2, S1.4.
 *
 * Görev tanımı — "platform_role değişimi → sonraki istekte güncel rol
 * (SessionContext.role her çözümlemede DB'den okunur, oturuma gömülmez)."
 * S1.4 AC5: "Ekip yetkisi değiştirildiğinde sonraki istekte güncel yetki
 * uygulanır; eski oturum eski yönetici hakkını kullanamaz."
 *
 * `resolveSession` (bkz. `../session/resolve-session.ts`) `role`'ü HER
 * çağrıda `platform_users.platform_role`'den TAZE okur ve `SessionContext`
 * İÇİNE gömmez (DB'de `sessions` tablosunda rol sütunu YOK — §3.2). Bu
 * yüzden, `bumpCredentialVersion`/`setVehicleActive`'in aksine, rol
 * değişikliği HİÇBİR revoke/sürüm artışı GEREKTİRMEZ: var olan oturum
 * (aynı token) bir sonraki istekte zaten GÜNCEL rolü görür — "eski oturum
 * eski hakkı kullanamaz" burada "oturumun KENDİSİ iptal olur" değil,
 * "oturum ARTIK GÜNCEL rolle çalışır" anlamındadır (STORIES metniyle
 * birebir uyumlu: "sonraki istekte güncel yetki uygulanır", oturumun
 * iptalinden SÖZ EDİLMEZ).
 *
 * Yine de `withImmediateTransaction` içine alınır: M2 admin ekranı bu
 * yazmayı aynı transaction'da bir `admin_audit` satırıyla birleştirecektir
 * (görev tanımı — "M2 ekranları bunları kullanacak"); tek başına bir
 * UPDATE için SQLite zaten örtük atomiktir, bu sarmalama yalnız gelecekteki
 * genişlemeyle YAPISAL TUTARLILIK sağlar.
 */
import { eq } from "drizzle-orm";
import { type AppDatabase, withImmediateTransaction } from "../../data/db";
import { platformUsers } from "../../data/schema";
import type { SessionRole } from "../session/types";

/** `platform_users.platform_role` CHECK kısıtının izin verdiği iki değer
 * (§3.2 CHECK: "IN ('admin', 'support')"); `SessionRole` birleşik tipinden
 * daraltılır — ayrı bir literal kümesi TEKRAR TANIMLANMAZ. */
export type PlatformRole = Extract<SessionRole, "admin" | "support">;

export function setPlatformUserRole(
  db: AppDatabase,
  platformUserId: string,
  role: PlatformRole,
): void {
  withImmediateTransaction(db.$client, () => {
    db.update(platformUsers)
      .set({ platformRole: role })
      .where(eq(platformUsers.id, platformUserId))
      .run();
  });
}
