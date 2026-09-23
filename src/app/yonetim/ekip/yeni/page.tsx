import type { Metadata } from "next";
import Link from "next/link";
import { TEAM_USER_MESSAGES as TEXT } from "../../../../lib/messages";
import { TeamPageHeader } from "../../../_components/team-page-header";
import { readTeamPageContext } from "../team-page-context";
import { NewTeamUserForm } from "./new-team-user-form";

/** /yonetim/ekip/yeni — ekip hesabı açma (yalnız yönetici; yetki sunucuda). */
export const metadata: Metadata = {
  title: "Ekip hesabı aç — Dolmuş Takip",
};

export default async function NewTeamUserPage() {
  const page = await readTeamPageContext();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[var(--form-max-width)] flex-col gap-8 px-4 py-6">
      <TeamPageHeader username={page.username} roleLabel={page.roleLabel} csrfToken={page.csrfToken} />
      <Link href="/yonetim/ekip" className="text-base font-medium text-[var(--color-primary)] underline">
        {TEXT.backToList}
      </Link>
      {page.isAdmin ? (
        <NewTeamUserForm csrfToken={page.csrfToken} scopeKey={page.scopeKey} />
      ) : (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
          {TEXT.unauthorized}
        </p>
      )}
    </main>
  );
}
