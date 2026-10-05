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
    <header className="ds-header">
      <span className="ds-header-who">
        <span className="ds-plate">{plate}</span>
        {ownerName !== undefined && (
          <>
            {" "}
            <span>· {ownerName}</span>
          </>
        )}
      </span>
      <LogoutButton csrfToken={csrfToken} />
    </header>
  );
}
