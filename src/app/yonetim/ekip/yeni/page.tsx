import type { Metadata } from "next";
import Link from "next/link";
import { TEAM_USER_MESSAGES as TEXT } from "../../../../lib/messages";
import { TeamPageShell } from "../../../_components/team-page-shell";
import { readTeamPageContext } from "../team-page-context";
import { NewTeamUserForm } from "./new-team-user-form";

/** /yonetim/ekip/yeni — ekip hesabı açma (yalnız yönetici; yetki sunucuda). */
export const metadata: Metadata = {
  title: "Ekip hesabı aç — Dolmuş Takip",
};

export default async function NewTeamUserPage() {
  const page = await readTeamPageContext();

  return (
    <TeamPageShell
      username={page.username} roleLabel={page.roleLabel} csrfToken={page.csrfToken}
      isAdmin={page.isAdmin}
    >
      <Link href="/yonetim/ekip" className="ds-link ds-link-block">
        {TEXT.backToList}
      </Link>
      {page.isAdmin ? (
        <NewTeamUserForm csrfToken={page.csrfToken} scopeKey={page.scopeKey} />
      ) : (
        <p role="alert" className="ds-notice ds-notice-error">
          {TEXT.unauthorized}
        </p>
      )}
    </TeamPageShell>
  );
}
