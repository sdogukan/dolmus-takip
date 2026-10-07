import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  ADMIN_NAVIGATION_MESSAGES as NAV,
  PLATFORM_ROLE_LABELS,
  SUPPORT_MESSAGES,
  WORK_ENTRY_MESSAGES,
} from "../../../../../../lib/messages";
import { formatPlateForDisplay } from "../../../../../../lib/plate";
import { istanbulToday } from "../../../../../../lib/work-time";
import { readPageSession } from "../../../../../../server/auth/page-session";
import { readPlatformUsernameForDisplay } from "../../../../../../server/auth/platform-username";
import { computeScopeKey } from "../../../../../../server/auth/scope";
import { getAppDb } from "../../../../../../server/data/app-db";
import { getVehicleDetail, VehicleNotFoundError } from "../../../../../../server/usecases/admin-vehicles";
import { SupportTargetHeader } from "../../../../../_components/support-target-header";
import { TeamPageShell } from "../../../../../_components/team-page-shell";
import { WorkEntryForm } from "../../../../../_components/work-entry-form";

/**
 * /yonetim/araclar/[id]/kayit/yeni — destek alanında çalışma kaydı. `../../destek/
 * page.tsx` İLE AYNI oturum/rol denetimi ve hedef türetme: hedef YALNIZ URL'deki
 * araç kimliğinden SUNUCUDA çözülür (bilinmeyen araç → 404); sahip adı sunucudan
 * gelir. Pasif araç/işletmede okuma serbest, yazma yoktur: form kilitlenir.
 * Form kaydı yazar (T3.4).
 */
export const metadata: Metadata = {
  title: "Çalışma kaydı — Dolmuş Takip",
};

export default async function VehicleWorkEntryPage({
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
      <h1 className="ds-title">{WORK_ENTRY_MESSAGES.pageTitle}</h1>
      {inactive && (
        <p role="status" className="ds-notice ds-notice-warning">
          {SUPPORT_MESSAGES.inactiveTarget}
        </p>
      )}
      <WorkEntryForm
        today={istanbulToday()}
        plate={formatPlateForDisplay(detail.vehicle.plateNormalized)}
        mode="staff"
        ownerName={detail.owner.fullName}
        targetVehicleId={vehicleId}
        disabled={inactive}
        vehicleId={vehicleId}
        scopeKey={computeScopeKey(context)}
        csrfToken={context.csrfToken}
      />
    </TeamPageShell>
  );
}
