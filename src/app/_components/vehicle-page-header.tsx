/**
 * `/sofor` ve `/sahip` ortak üst başlığı (server component) — T1.2 ADIM
 * 2/2, S1.2, görev tanımı (2): şoför ve sahip ekranlarının üst başlığı —
 * oturum rolüne uygun panel başlığı, plaka (görüntü biçimi) ve "Çıkış" düğmesi.
 */
import { PANEL_TITLES } from "../../lib/messages";
import { LogoutButton } from "./logout-button";

export function VehiclePageHeader({
  role,
  plate,
  ownerName,
  csrfToken,
}: {
  role: "owner" | "driver";
  plate: string;
  /** Yalnız sahip özetinde verilir: "plaka · ad". */
  ownerName?: string;
  csrfToken: string;
}) {
  return (
    <header className="ds-header">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="ds-card-title">{PANEL_TITLES[role]}</p>
        <span className="ds-header-who">
          <span className="ds-plate">{plate}</span>
          {ownerName !== undefined && (
            <>
              {" "}
              <span>· {ownerName}</span>
            </>
          )}
        </span>
      </div>
      <LogoutButton csrfToken={csrfToken} />
    </header>
  );
}
