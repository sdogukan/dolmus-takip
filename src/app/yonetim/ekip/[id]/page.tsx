import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TEAM_USER_MESSAGES as TEXT } from "../../../../lib/messages";
import { AdminUserNotFoundError, getPlatformUserDetail } from "../../../../server/usecases/admin-users";
import { TeamPageHeader } from "../../../_components/team-page-header";
import { UnsavedChangesProvider } from "../../../_components/unsaved-changes";
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
  const header = <TeamPageHeader username={page.username} roleLabel={page.roleLabel} csrfToken={page.csrfToken} />;

  if (!page.isAdmin) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[var(--form-max-width)] flex-col gap-6 px-4 py-6">
        {header}
        <Link href="/yonetim" className="text-base font-medium text-[var(--color-primary)] underline">
          {TEXT.backToAdmin}
        </Link>
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
          {TEXT.unauthorized}
        </p>
      </main>
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
    <main className="mx-auto flex min-h-dvh w-full max-w-[var(--form-max-width)] flex-col gap-8 px-4 py-6">
      {header}
      <Link href="/yonetim/ekip" className="text-base font-medium text-[var(--color-primary)] underline">
        {TEXT.backToList}
      </Link>
      <UnsavedChangesProvider>
        <TeamUserDetailForm
          initialUser={user}
          isSelf={page.platformUserId === user.id}
          csrfToken={page.csrfToken}
          scopeKey={page.scopeKey}
        />
      </UnsavedChangesProvider>
    </main>
  );
}
