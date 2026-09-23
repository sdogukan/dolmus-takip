import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PLATFORM_ROLE_LABELS, SUPPORT_MESSAGES } from "../../../../../lib/messages";
import { formatPlateForDisplay } from "../../../../../lib/plate";
import { readPageSession } from "../../../../../server/auth/page-session";
import { readPlatformUsernameForDisplay } from "../../../../../server/auth/platform-username";
import { computeScopeKey } from "../../../../../server/auth/scope";
import { getAppDb } from "../../../../../server/data/app-db";
import { getVehicleDetail, VehicleNotFoundError } from "../../../../../server/usecases/admin-vehicles";
import { SupportTargetHeader } from "../../../../_components/support-target-header";
import { TeamPageHeader } from "../../../../_components/team-page-header";
import { UnsavedChangesProvider } from "../../../../_components/unsaved-changes";

/**
 * /yonetim/araclar/[id]/destek — destek alanı (DESIGN §2.9). `../page.tsx`
 * İLE AYNI oturum/rol denetimi (araç oturumu → /sahip|/sofor, oturum yok →
 * /yonetim/giris, bilinmeyen araç → 404). Hedef (işletme, araç, sahip)
 * URL'deki araç kimliğinden SUNUCUDA türetilir; sorgu parametresinden işletme
 * kimliği alınmaz.
 *
 * Yalnız GERÇEKTEN var olan işler bağlanır (M1 dürüstlük kuralı): çalışma
 * kaydı formu vardır ve bağlanır; teslim onayı ve raporlar bu sürümde
 * yoktur, bağlantı/düğme olarak SUNULMAZ.
 */
export const metadata: Metadata = {
  title: "Destek — Dolmuş Takip",
};

const linkClass =
  "flex min-h-[var(--control-min-height)] items-center rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]";

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
    <main className="mx-auto flex min-h-dvh w-full max-w-[var(--form-max-width)] flex-col gap-6 px-4 py-6">
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
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">{SUPPORT_MESSAGES.pageTitle}</h1>
      {inactive && (
        <p role="status" className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          {SUPPORT_MESSAGES.inactiveTarget}
        </p>
      )}
      <nav aria-label={SUPPORT_MESSAGES.pageTitle} className="flex flex-col gap-3">
        <Link href={`/yonetim/araclar/${vehicleId}/kayit/yeni`} className={linkClass}>
          {SUPPORT_MESSAGES.linkWorkEntry}
        </Link>
        <Link href={`/yonetim/araclar/${vehicleId}/soforler`} className={linkClass}>
          {SUPPORT_MESSAGES.linkDrivers}
        </Link>
        <Link href={`/yonetim/araclar/${vehicleId}`} className={linkClass}>
          {SUPPORT_MESSAGES.linkVehicle}
        </Link>
        <Link href={`/yonetim/islem-gecmisi?vehicleId=${vehicleId}`} className={linkClass}>
          {SUPPORT_MESSAGES.linkAudit}
        </Link>
      </nav>
    </main>
  );
}
