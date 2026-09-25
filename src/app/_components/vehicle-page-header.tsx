/**
 * `/sofor` ve `/sahip` ortak üst başlığı (server component) — T1.2 ADIM
 * 2/2, S1.2, görev tanımı (2): şoför ve sahip ekranlarının üst başlığı —
 * plaka (görüntü biçimi) ve "Çıkış" düğmesi. Tel çerçeve:
 * "35 ABC 123          Çıkış".
 */
import { LogoutButton } from "./logout-button";

export function VehiclePageHeader({
  plate,
  ownerName,
  csrfToken,
}: {
  plate: string;
  /** Yalnız sahip özetinde verilir: "plaka · ad". */
  ownerName?: string;
  csrfToken: string;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--color-divider)] pb-4">
      <span className="text-lg font-medium text-[var(--color-text)]">{ownerName === undefined ? plate : `${plate} · ${ownerName}`}</span>
      <LogoutButton csrfToken={csrfToken} />
    </header>
  );
}
