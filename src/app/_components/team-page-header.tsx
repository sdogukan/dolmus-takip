/**
 * `/yonetim` ortak üst başlığı (server component) — T1.3 ADIM 2/2, S1.3,
 * görev tanımı (b): "üst başlıkta kişisel ekip kimliği (username) + rol
 * etiketi ('Yönetici' / 'Destek') + Çıkış (mevcut LogoutButton, çıkış
 * sonrası /yonetim/giris)."
 *
 * DESIGN.md §2.9 "Back office" başlığının ilkesi — "Yönetim · Doğukan
 * Çıkış" — GERÇEK ekip kimliğinin (uydurma "yönetici" etiketi/rolü
 * VARSAYILAN gösterim DEĞİL) her zaman görünür olmasıdır; bu bileşen aynı
 * ilkeyi ("{kullanıcı adı} · {rol etiketi}" + Çıkış) uygular. (Görev
 * tanımı DESIGN §2.8'e atıf yapıyor; o bölüm "Şoförlerim" ekranıdır —
 * gerçek ekip-kimliği-başlığı ilkesi §2.9'dadır; bu, dokümanla ÇELİŞEN bir
 * davranış DEĞİL, görev tanımının bölüm numarası yanlış atfıdır — bkz. bu
 * paketin open_issues'ı.)
 *
 * `../sofor|sahip/page.tsx`'in `./vehicle-page-header.tsx`'inin ekip
 * karşılığıdır — plaka yerine kişisel kimlik + rol gösterir, `LogoutButton`
 * AYNI bileşendir (kod tekrarı yok), yalnız `redirectTo="/yonetim/giris"`
 * geçirir.
 */
import { LogoutButton } from "./logout-button";

export function TeamPageHeader({
  username,
  roleLabel,
  csrfToken,
}: {
  username: string;
  roleLabel: string;
  csrfToken: string;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--color-divider)] pb-4">
      <span className="text-lg font-medium text-[var(--color-text)]">
        {username} · {roleLabel}
      </span>
      <LogoutButton csrfToken={csrfToken} redirectTo="/yonetim/giris" />
    </header>
  );
}
