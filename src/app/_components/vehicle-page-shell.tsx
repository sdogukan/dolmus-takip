import type { ReactNode } from "react";
import { AdminBackLink } from "./admin-navigation";
import { UnsavedChangesProvider } from "./unsaved-changes";
import { VehicleNavigation } from "./vehicle-navigation";
import { VehiclePageHeader } from "./vehicle-page-header";

/** Each route keeps its existing server-side session, role and vehicle checks. */
export function VehiclePageShell({
  role,
  plate,
  ownerName,
  csrfToken,
  backLink,
  children,
}: {
  role: "owner" | "driver";
  plate: string;
  ownerName?: string;
  csrfToken: string;
  backLink?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <UnsavedChangesProvider>
      <div className="ds-admin-shell ds-vehicle-shell">
        <a href="#vehicle-content" className="ds-admin-skip">İçeriğe geç</a>
        <VehiclePageHeader role={role} plate={plate} ownerName={ownerName} csrfToken={csrfToken} />
        <VehicleNavigation role={role} />
        <main id="vehicle-content" tabIndex={-1} className="ds-admin-content ds-vehicle-content">
          {backLink && <AdminBackLink {...backLink} />}
          {children}
        </main>
      </div>
    </UnsavedChangesProvider>
  );
}
