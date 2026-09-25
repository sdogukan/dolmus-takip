import type { Metadata } from "next";
import Link from "next/link";
import { TEAM_USER_MESSAGES as TEXT } from "../../../lib/messages";
import { teamRoleLabel } from "../../../lib/team-users-ui";
import { listPlatformUsers } from "../../../server/usecases/admin-users";
import { TeamPageHeader } from "../../_components/team-page-header";
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
  "flex min-h-[var(--control-min-height)] items-center rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]";

export default async function TeamListPage() {
  const page = await readTeamPageContext();
  const header = <TeamPageHeader username={page.username} roleLabel={page.roleLabel} csrfToken={page.csrfToken} />;

  if (!page.isAdmin) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[var(--form-max-width)] flex-col gap-6 px-4 py-6">
        {header}
        <Link href="/yonetim" className="text-base font-medium text-[var(--color-primary)] underline">
          {TEXT.backToAdmin}
        </Link>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">{TEXT.listTitle}</h1>
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
          {TEXT.unauthorized}
        </p>
      </main>
    );
  }

  const users = listPlatformUsers(page.db);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[var(--form-max-width)] flex-col gap-6 px-4 py-6">
      {header}
      <Link href="/yonetim" className="text-base font-medium text-[var(--color-primary)] underline">
        {TEXT.backToAdmin}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">{TEXT.listTitle}</h1>
        <Link
          href="/yonetim/ekip/yeni"
          className="flex min-h-[var(--control-min-height)] items-center rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)]"
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
              className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-text)]"
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
    </main>
  );
}
