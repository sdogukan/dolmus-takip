import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ADMIN_NAVIGATION_MESSAGES as NAV, TEAM_USER_MESSAGES as TEXT } from "../../../../lib/messages";
import { AdminUserNotFoundError, getPlatformUserDetail } from "../../../../server/usecases/admin-users";
import { TeamPageShell } from "../../../_components/team-page-shell";
import { readTeamPageContext } from "../team-page-context";
import { TeamUserDetailForm } from "./team-user-detail-form";

/**
 * /yonetim/ekip/[id] — ekip hesabı düzenleme, aktiflik ve şifre sıfırlama.
 * Yetki sunucuda taze oturum rolüyle kararlaştırılır; yönetici olmayan hesap
 * için hedef hesap HİÇ okunmaz.
 */
export const metadata: Metadata = {
  title: "Ekip hesabı — Dolmuş Takip",
};

export default async function TeamUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await readTeamPageContext();
  const shellProps = {
    username: page.username,
    roleLabel: page.roleLabel,
    csrfToken: page.csrfToken,
    isAdmin: page.isAdmin,
    backLink: page.isAdmin
      ? { href: "/yonetim/ekip", label: NAV.backToTeam }
      : { href: "/yonetim", label: NAV.backToBusinesses },
  };

  if (!page.isAdmin) {
    return (
      <TeamPageShell {...shellProps}>
        <p role="alert" className="ds-notice ds-notice-error">
          {TEXT.unauthorized}
        </p>
      </TeamPageShell>
    );
  }

  let user;
  try {
    user = getPlatformUserDetail(page.db, id);
  } catch (error) {
    if (error instanceof AdminUserNotFoundError) {
      notFound();
    }
    throw error;
  }

  return (
    <TeamPageShell {...shellProps}>
      <TeamUserDetailForm
        initialUser={user}
        isSelf={page.platformUserId === user.id}
        csrfToken={page.csrfToken}
        scopeKey={page.scopeKey}
      />
    </TeamPageShell>
  );
}
