import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PLATFORM_ROLE_LABELS, REPORT_MESSAGES, SUPPORT_MESSAGES } from "../../../../../lib/messages";
import { formatPlateForDisplay } from "../../../../../lib/plate";
import { readPageSession } from "../../../../../server/auth/page-session";
import { readPlatformUsernameForDisplay } from "../../../../../server/auth/platform-username";
import { computeScopeKey } from "../../../../../server/auth/scope";
import { getAppDb } from "../../../../../server/data/app-db";
import { getVehicleDetail, VehicleNotFoundError } from "../../../../../server/usecases/admin-vehicles";
import { VehiclePeriodReport } from "../../../../_components/vehicle-period-report";
import { SupportTargetHeader } from "../../../../_components/support-target-header";
import { TeamPageHeader } from "../../../../_components/team-page-header";
import { UnsavedChangesProvider } from "../../../../_components/unsaved-changes";

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
    <main className="mx-auto flex min-h-dvh w-full max-w-[35rem] flex-col gap-6 px-4 py-6">
      <TeamPageHeader
        username={username ?? "—"}
        roleLabel={roleLabel}
        csrfToken={context.csrfToken}
      />
      <UnsavedChangesProvider>
        <SupportTargetHeader
          vehicleId={vehicleId}
          scopeKey={computeScopeKey(context)}
          businessName={detail.business.name}
          plateDisplay={formatPlateForDisplay(detail.vehicle.plateNormalized)}
          ownerName={detail.owner.fullName}
          username={username ?? "—"}
          roleLabel={roleLabel}
        />
      </UnsavedChangesProvider>
      <Link
        href={`/yonetim/araclar/${vehicleId}/destek`}
        className="inline-flex min-h-[var(--control-min-height)] items-center self-start text-base font-medium text-[var(--color-primary)] underline"
      >
        ← {SUPPORT_MESSAGES.pageTitle}
      </Link>
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">{REPORT_MESSAGES.title}</h1>
      {inactive && (
        <p role="status" className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          {SUPPORT_MESSAGES.inactiveTarget}
        </p>
      )}
      <VehiclePeriodReport key={vehicleId} targetVehicleId={vehicleId} />
    </main>
  );
}
