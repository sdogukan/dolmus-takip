/**
 * runAccessChangeTransaction(db, update, revoke?) — T1.4 düzeltme turu 3,
 * S1.4.
 *
 * Denetim bulgusu (düşük önem, `mimari` merceği): `bump-credential-
 * version.ts`, `bump-platform-user-version.ts`, `set-vehicle-active.ts`,
 * `set-business-active.ts` ve `set-platform-user-active.ts` BİREBİR aynı
 * iskeleti beş ayrı dosyada tekrarlıyordu: `withImmediateTransaction`
 * içinde önce bir tablo güncellemesi, ardından (bazılarında koşullu) bir
 * oturum iptali. Bu dosyaların kendi üst notlarının öngördüğü gibi, M2
 * admin ekranı bu yazmaları aynı transaction'da bir `admin_audit`
 * satırıyla birleştirecektir; ortak bir yardımcı OLMADAN bu ekleme beş
 * dosyaya AYRI AYRI yapılırdı ve biri güncellenirken diğerinin unutulması
 * riski doğardı. Bu yardımcı yalnız "TEK transaction sınırı" iskeletini
 * paylaştırır — her kullanım durumu kendi güncelleme ve (varsa) revoke
 * mantığını KENDİSİ sağlar; davranışta hiçbir değişiklik yoktur.
 */
// Açık ".ts" uzantısı KASITLIDIR — bkz. `./bump-platform-user-version.ts`
// üst notu (T1.3, `scripts/platform-admin.ts` bu zinciri bundler'sız Node
// ESM ile İÇE AKTARIR).
import { type AppDatabase, withImmediateTransaction } from "../../data/db.ts";

export function runAccessChangeTransaction(
  db: AppDatabase,
  update: () => void,
  revoke?: () => void,
): void {
  withImmediateTransaction(db.$client, () => {
    update();
    revoke?.();
  });
}
