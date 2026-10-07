import type { ReactNode } from "react";
import { ADMIN_NAVIGATION_MESSAGES } from "../../lib/messages";
import { AdminNavigation } from "./admin-navigation";
import { TeamPageHeader } from "./team-page-header";
import { UnsavedChangesProvider } from "./unsaved-changes";

/** Session identity and role are supplied by each page's existing server gate. */
export function TeamPageShell({
  username,
  roleLabel,
  csrfToken,
  isAdmin,
  wide = false,
  children,
}: {
  username: string;
  roleLabel: string;
  csrfToken: string;
  isAdmin: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <UnsavedChangesProvider>
      <div className="ds-admin-shell">
        <a href="#admin-content" className="ds-admin-skip">{ADMIN_NAVIGATION_MESSAGES.skip}</a>
        <TeamPageHeader username={username} roleLabel={roleLabel} csrfToken={csrfToken} />
        <AdminNavigation isAdmin={isAdmin} />
        <main id="admin-content" tabIndex={-1} className={`ds-admin-content${wide ? " ds-admin-content-wide" : ""}`}>
          {children}
        </main>
      </div>
    </UnsavedChangesProvider>
  );
}
