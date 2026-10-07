import type { Metadata } from "next";
import Link from "next/link";
import { TEAM_USER_MESSAGES as TEXT } from "../../../lib/messages";
import { teamRoleLabel } from "../../../lib/team-users-ui";
import { listPlatformUsers } from "../../../server/usecases/admin-users";
import { TeamPageShell } from "../../_components/team-page-shell";
import { readTeamPageContext } from "./team-page-context";

/**
 * /yonetim/ekip — ekip hesapları listesi. Yalnız yönetici: yetki kararı
 * sunucuda, taze oturum rolüyle verilir; destek rolü yalnız yetkisiz
 * metnini görür ve liste HİÇ okunmaz.
 */
export const metadata: Metadata = {
  title: "Ekip hesapları — Dolmuş Takip",
};

const linkButtonClass =
  "ds-btn ds-btn-secondary flex items-center";

export default async function TeamListPage() {
  const page = await readTeamPageContext();
  const shellProps = {
    username: page.username,
    roleLabel: page.roleLabel,
    csrfToken: page.csrfToken,
    isAdmin: page.isAdmin,
  };

  if (!page.isAdmin) {
    return (
      <TeamPageShell {...shellProps} wide>
        <h1 className="ds-title">{TEXT.listTitle}</h1>
        <p role="alert" className="ds-notice ds-notice-error">
          {TEXT.unauthorized}
        </p>
      </TeamPageShell>
    );
  }

  const users = listPlatformUsers(page.db);

  return (
    <TeamPageShell {...shellProps} wide>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="ds-title">{TEXT.listTitle}</h1>
        <Link
          href="/yonetim/ekip/yeni"
          className="ds-btn ds-btn-primary flex items-center"
        >
          {TEXT.openAccount}
        </Link>
      </div>

      {users.length === 0 ? (
        <p className="text-base text-[var(--color-text-secondary)]">{TEXT.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {users.map((user) => (
            <li
              key={user.id}
              className="ds-card flex flex-col gap-2 px-4 py-3 text-base"
            >
              <p className="break-words text-lg font-medium">{user.username}</p>
              <p className="break-words text-[var(--color-text-secondary)]">
                {user.fullName ?? TEXT.noFullName} · {teamRoleLabel(user.platformRole)} ·{" "}
                <span className={user.active ? "text-[var(--color-success)]" : "text-[var(--color-warning)]"}>
                  {user.active ? TEXT.activeBadge : TEXT.inactiveBadge}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/yonetim/ekip/${user.id}`} className={linkButtonClass}>
                  {TEXT.edit}
                </Link>
                <Link href={`/yonetim/ekip/${user.id}#sifre-sifirlama`} className={linkButtonClass}>
                  {TEXT.resetPassword}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </TeamPageShell>
  );
}
