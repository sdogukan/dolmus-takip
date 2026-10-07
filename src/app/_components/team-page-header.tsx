/**
 * `/yonetim` ortak üst başlığı (server component) — T1.3 ADIM 2/2, S1.3,
 * görev tanımı (b): "üst başlıkta kişisel ekip kimliği (username) + rol
 * etiketi ('Yönetici' / 'Destek') + Çıkış (mevcut LogoutButton, çıkış
 * sonrası /yonetim/giris)."
 *
 * Back office başlığının ilkesi ("Yönetim · Doğukan  Çıkış") GERÇEK ekip
 * kimliğinin (uydurma "yönetici" etiketi/rolü VARSAYILAN gösterim DEĞİL)
 * her zaman görünür olmasıdır; bu bileşen aynı ilkeyi
 * ("{kullanıcı adı} · {rol etiketi}" + Çıkış) uygular.
 *
 * `../sofor|sahip/page.tsx`'in `./vehicle-page-header.tsx`'inin ekip
 * karşılığıdır — plaka yerine kişisel kimlik + rol gösterir, `LogoutButton`
 * AYNI bileşendir (kod tekrarı yok), yalnız `redirectTo="/yonetim/giris"`
 * geçirir.
 */
import { PANEL_TITLES } from "../../lib/messages";
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
    <header className="ds-header">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="ds-card-title">{PANEL_TITLES.management}</p>
        <span className="ds-header-who">
          <span className="[overflow-wrap:anywhere]">{username}</span>{" "}
          <span className="ds-header-role">· {roleLabel}</span>
        </span>
      </div>
      <LogoutButton csrfToken={csrfToken} redirectTo="/yonetim/giris" />
    </header>
  );
}
