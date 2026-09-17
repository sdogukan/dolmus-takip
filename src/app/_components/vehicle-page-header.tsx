/**
 * `/sofor` ve `/sahip` ortak üst başlığı (server component) — T1.2 ADIM
 * 2/2, S1.2, görev tanımı (2): "DESIGN §2.2/§2.5 üst başlığı: plaka
 * (görüntü biçimi) ve 'Çıkış' düğmesi." DESIGN.md §2.2/§2.5 wireframe'i:
 * "35 ABC 123          Çıkış".
 */
import { LogoutButton } from "./logout-button";

export function VehiclePageHeader({
  plate,
  csrfToken,
}: {
  plate: string;
  csrfToken: string;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--color-divider)] pb-4">
      <span className="text-lg font-medium text-[var(--color-text)]">{plate}</span>
      <LogoutButton csrfToken={csrfToken} />
    </header>
  );
}
