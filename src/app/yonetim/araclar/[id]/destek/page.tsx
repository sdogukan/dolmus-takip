import type { Metadata } from "next";
import { BarChart3, CarFront, ClipboardList, History, NotebookPen, UsersRound } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { ADMIN_NAVIGATION_MESSAGES as NAV, PLATFORM_ROLE_LABELS, SUPPORT_MESSAGES } from "../../../../../lib/messages";
import { formatPlateForDisplay } from "../../../../../lib/plate";
import { readPageSession } from "../../../../../server/auth/page-session";
import { readPlatformUsernameForDisplay } from "../../../../../server/auth/platform-username";
import { computeScopeKey } from "../../../../../server/auth/scope";
import { getAppDb } from "../../../../../server/data/app-db";
import { getVehicleDetail, VehicleNotFoundError } from "../../../../../server/usecases/admin-vehicles";
import { SupportTargetHeader } from "../../../../_components/support-target-header";
import { TeamPageShell } from "../../../../_components/team-page-shell";
import { AdminActionLink } from "../../../../_components/admin-navigation";

/**
 * /yonetim/araclar/[id]/destek — destek alanı. `../page.tsx`
 * İLE AYNI oturum/rol denetimi (araç oturumu → /sahip|/sofor, oturum yok →
 * /yonetim/giris, bilinmeyen araç → 404). Hedef (işletme, araç, sahip)
 * URL'deki araç kimliğinden SUNUCUDA türetilir; sorgu parametresinden işletme
 * kimliği alınmaz.
 *
 * Yalnız GERÇEKTEN var olan işler bağlanır (M1 dürüstlük kuralı): çalışma
 * kaydı formu, özet ve raporlar vardır ve bağlanır; teslim onayı bu sürümde
 * yoktur, bağlantı/düğme olarak SUNULMAZ.
 */
export const metadata: Metadata = {
  title: "Destek — Dolmuş Takip",
};

const linkClass = "ds-btn ds-btn-secondary justify-start";

export default async function VehicleSupportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: vehicleId } = await params;

  const session = await readPageSession();
  if (!session.ok) {
    redirect("/yonetim/giris");
  }
  const { context } = session;

  if (context.kind === "vehicle") {
    redirect(context.role === "owner" ? "/sahip" : "/sofor");
  }
  if (context.kind !== "platform" || context.platformUserId === undefined) {
    redirect("/yonetim/giris");
  }

  const db = getAppDb();
  let detail;
  try {
    detail = getVehicleDetail(db, vehicleId);
  } catch (error) {
    if (error instanceof VehicleNotFoundError) {
      notFound();
    }
    throw error;
  }

  const username = await readPlatformUsernameForDisplay(db, context.platformUserId);
  const roleLabel =
    context.role === "admin" || context.role === "support"
      ? PLATFORM_ROLE_LABELS[context.role]
      : context.role;
  const inactive = !detail.vehicle.active || !detail.business.active;

  return (
    <TeamPageShell
      username={username ?? "—"}
      roleLabel={roleLabel}
      csrfToken={context.csrfToken}
      isAdmin={context.role === "admin"}
      backLink={{ href: `/yonetim/araclar/${vehicleId}`, label: NAV.backToVehicle }}
    >
      <SupportTargetHeader
        vehicleId={vehicleId}
        scopeKey={computeScopeKey(context)}
        businessName={detail.business.name}
        plateDisplay={formatPlateForDisplay(detail.vehicle.plateNormalized)}
        ownerName={detail.owner.fullName}
        username={username ?? "—"}
        roleLabel={roleLabel}
      />

      <div className="flex flex-col gap-2">
        <h1 className="ds-title">{SUPPORT_MESSAGES.pageTitle}</h1>
        <p className="ds-hint">Bu araç için yapacağın işlemi seç.</p>
      </div>
      {inactive && (
        <p role="status" className="ds-notice ds-notice-warning">
          {SUPPORT_MESSAGES.inactiveTarget}
        </p>
      )}
      <nav aria-label={SUPPORT_MESSAGES.pageTitle} className="flex flex-col gap-6">
        <section aria-labelledby="support-work-title" className="ds-panel flex flex-col gap-3">
          <h2 id="support-work-title" className="ds-section-title">Günlük çalışma</h2>
          <p className="ds-hint">Mal sahibinin veya şoförün çalışma kaydını gir.</p>
          <AdminActionLink href={`/yonetim/araclar/${vehicleId}/kayit/yeni`} className="ds-btn ds-btn-primary ds-btn-lg">
            <NotebookPen aria-hidden="true" className="shrink-0" size={22} strokeWidth={1.75} />
            {SUPPORT_MESSAGES.linkWorkEntry}
          </AdminActionLink>
        </section>
        <section aria-labelledby="support-reports-title" className="ds-panel flex flex-col gap-3">
          <h2 id="support-reports-title" className="ds-section-title">Özet ve raporlar</h2>
          <p className="ds-hint">Hasılatı, giderleri ve teslim durumlarını incele.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminActionLink href={`/yonetim/araclar/${vehicleId}/ozet`} className={linkClass}>
              <ClipboardList aria-hidden="true" className="shrink-0" size={22} strokeWidth={1.75} />
              {SUPPORT_MESSAGES.linkSummary}
            </AdminActionLink>
            <AdminActionLink href={`/yonetim/araclar/${vehicleId}/raporlar`} className={linkClass}>
              <BarChart3 aria-hidden="true" className="shrink-0" size={22} strokeWidth={1.75} />
              {SUPPORT_MESSAGES.linkReports}
            </AdminActionLink>
          </div>
        </section>
        <section aria-labelledby="support-management-title" className="ds-panel flex flex-col gap-3">
          <h2 id="support-management-title" className="ds-section-title">Araç yönetimi</h2>
          <AdminActionLink href={`/yonetim/araclar/${vehicleId}/soforler`} className={linkClass}>
            <UsersRound aria-hidden="true" className="shrink-0" size={22} strokeWidth={1.75} />
            {SUPPORT_MESSAGES.linkDrivers}
          </AdminActionLink>
          <AdminActionLink href={`/yonetim/araclar/${vehicleId}`} className={linkClass}>
            <CarFront aria-hidden="true" className="shrink-0" size={22} strokeWidth={1.75} />
            {SUPPORT_MESSAGES.linkVehicle}
          </AdminActionLink>
          <AdminActionLink href={`/yonetim/islem-gecmisi?vehicleId=${vehicleId}`} className={linkClass}>
            <History aria-hidden="true" className="shrink-0" size={22} strokeWidth={1.75} />
            {SUPPORT_MESSAGES.linkAudit}
          </AdminActionLink>
        </section>
      </nav>
    </TeamPageShell>
  );
}
