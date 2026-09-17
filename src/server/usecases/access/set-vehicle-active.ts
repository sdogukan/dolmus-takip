/**
 * setVehicleActive(vehicleId, active) — T1.4 ADIM 2/2, S1.4.
 *
 * Görev tanımı — "vehicles.active=0 → o aracın tüm oturumları reddedilir,
 * tekrar active=1 yapınca eski oturum DİRİLMEZ (revoke kalıcı yazılmış
 * olmalı: pasifleştirme kullanım durumu revokeSessionsForVehicle çağırır;
 * ayrıca resolveSession aktiflik de kontrol eder)."
 *
 * İki BAĞIMSIZ katman birlikte bu garantiyi sağlar:
 * 1. `resolveSession` (bkz. `../session/resolve-session.ts`) HER çözümlemede
 *    `vehicles.active`'i CANLI okur — araç pasifken ayrıca bir revoke
 *    YAZILMASA bile istek anında reddedilir.
 * 2. BU kullanım durumu, `active=false` olduğunda AYRICA
 *    `revokeSessionsForVehicleSync` ile `sessions.revoked_at`'i KALICI
 *    yazar. Bu ikinci katman OLMADAN, araç yeniden `active=1` yapıldığında
 *    (1)'deki canlı kontrol artık ENGEL OLMAZ ve eski (hiç iptal
 *    edilmemiş) oturum SESSİZCE DİRİLİRDİ — görev tanımının açıkça
 *    yasakladığı davranış budur.
 *
 * `active=true` (yeniden aktifleştirme) çağrısı KASITLI olarak HİÇBİR
 * revoke ÇAĞIRMAZ — yalnız `vehicles.active`'i günceller; (1)'deki katman
 * zaten önceden iptal edilmiş oturumları `revoked_at` alanı üzerinden
 * reddetmeye devam eder.
 */
import { eq } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { AppDatabase } from "../../data/db";
import { vehicles } from "../../data/schema";
import { revokeSessionsForVehicleSync } from "../session/revoke-session";
import { runAccessChangeTransaction } from "./run-access-change-transaction";

export function setVehicleActive(
  db: AppDatabase,
  vehicleId: string,
  active: boolean,
  clock: Clock = systemClock,
): void {
  runAccessChangeTransaction(
    db,
    () => {
      db.update(vehicles).set({ active }).where(eq(vehicles.id, vehicleId)).run();
    },
    active ? undefined : () => revokeSessionsForVehicleSync(db, vehicleId, clock),
  );
}
