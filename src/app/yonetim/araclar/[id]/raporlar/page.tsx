import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ADMIN_NAVIGATION_MESSAGES as NAV, PLATFORM_ROLE_LABELS, REPORT_MESSAGES, SUPPORT_MESSAGES } from "../../../../../lib/messages";
import { formatPlateForDisplay } from "../../../../../lib/plate";
import { readPageSession } from "../../../../../server/auth/page-session";
import { readPlatformUsernameForDisplay } from "../../../../../server/auth/platform-username";
import { computeScopeKey } from "../../../../../server/auth/scope";
import { getAppDb } from "../../../../../server/data/app-db";
import { getVehicleDetail, VehicleNotFoundError } from "../../../../../server/usecases/admin-vehicles";
import { VehiclePeriodReport } from "../../../../_components/vehicle-period-report";
import { SupportTargetHeader } from "../../../../_components/support-target-header";
import { TeamPageShell } from "../../../../_components/team-page-shell";

/**
 * /yonetim/araclar/[id]/raporlar — destek alanında araç dönem raporu (sahip raporunun ekip modu). `../destek/page.tsx`
 * İLE AYNI oturum/rol denetimi ve hedef türetme (araç oturumu → /sahip|/sofor,
 * oturum yok → /yonetim/giris, bilinmeyen araç → 404); hedef YALNIZ URL'deki
 * araç kimliğinden SUNUCUDA çözülür. Rapor bileşenleri sahip ekranlarıyla
 * AYNIDIR; destek modunda her istek `X-Target-Vehicle` taşır ve kayıt
 * bağlantıları yönetim sayfalarına gider. Bileşen araç kimliğiyle anahtarlanır:
 * başka araca geçişte önceki aracın tutarı kalmaz. Pasif araç/işletmede okuma
 * serbesttir; yalnız pasif bilgi notu gösterilir.
 */
export const metadata: Metadata = {
  title: "Raporlar — Dolmuş Takip",
};

export default async function VehicleSupportReportsPage({
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
      backLink={{ href: `/yonetim/araclar/${vehicleId}/destek`, label: NAV.backToSupport }}
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

      <h1 className="ds-title">{REPORT_MESSAGES.title}</h1>
      {inactive && (
        <p role="status" className="ds-notice ds-notice-warning">
          {SUPPORT_MESSAGES.inactiveTarget}
        </p>
      )}
      <VehiclePeriodReport key={vehicleId} targetVehicleId={vehicleId} />
    </TeamPageShell>
  );
}
