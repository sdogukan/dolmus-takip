import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  PLATFORM_ROLE_LABELS,
  SUPPORT_MESSAGES,
  WORK_ENTRY_MESSAGES,
} from "../../../../../../lib/messages";
import { formatPlateForDisplay } from "../../../../../../lib/plate";
import { istanbulToday } from "../../../../../../lib/work-time";
import { readPageSession } from "../../../../../../server/auth/page-session";
import { readPlatformUsernameForDisplay } from "../../../../../../server/auth/platform-username";
import { computeScopeKey, type StaffScope } from "../../../../../../server/auth/scope";
import { getAppDb } from "../../../../../../server/data/app-db";
import { getVehicleDetail, VehicleNotFoundError } from "../../../../../../server/usecases/admin-vehicles";
import { readWorkEntryForScope } from "../../../../../../server/usecases/work-entries";
import { SupportTargetHeader } from "../../../../../_components/support-target-header";
import { TeamPageHeader } from "../../../../../_components/team-page-header";
import { UnsavedChangesProvider } from "../../../../../_components/unsaved-changes";
import { WorkEntryEditForm } from "../../../../../_components/work-entry-edit-form";

/**
 * /yonetim/araclar/[id]/kayitlar/[entryId] — destek alanında kayıt detayı ve
 * düzenleme. `../../kayit/yeni/page.tsx` İLE AYNI oturum/rol denetimi ve hedef
 * türetme: hedef YALNIZ URL'deki araç kimliğinden SUNUCUDA çözülür (bilinmeyen
 * araç → 404); kayıt o aracın kapsamıyla okunur, başka araç kaydı bilinmeyen
 * kimlikle AYNI 404'ü alır. Pasif araç/işletmede okuma serbest, yazma yoktur.
 */
export const metadata: Metadata = {
  title: "Kayıt detayı — Dolmuş Takip",
};

export default async function VehicleWorkEntryDetailPage({
  params,
}: {
  params: Promise<{ id: string; entryId: string }>;
}) {
  const { id: vehicleId, entryId } = await params;

  const session = await readPageSession();
  if (!session.ok) {
    redirect("/yonetim/giris");
  }
  const { context } = session;

  if (context.kind === "vehicle") {
    redirect(context.role === "owner" ? "/sahip" : "/sofor");
  }
  if (
    context.kind !== "platform" ||
    context.platformUserId === undefined ||
    (context.role !== "admin" && context.role !== "support")
  ) {
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

  const scope: StaffScope = {
    kind: "staff",
    actor: context.role,
    businessId: detail.business.id,
    vehicleId,
    platformUserId: context.platformUserId,
    onBehalfOf: true,
  };
  const entry = readWorkEntryForScope(db, scope, entryId);
  if (!entry) {
    notFound();
  }

  const username = await readPlatformUsernameForDisplay(db, context.platformUserId);
  const roleLabel = PLATFORM_ROLE_LABELS[context.role];
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
        <Link
          href={`/yonetim/araclar/${vehicleId}/destek`}
          className="text-base font-medium text-[var(--color-primary)] underline"
        >
          ← {SUPPORT_MESSAGES.pageTitle}
        </Link>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">{WORK_ENTRY_MESSAGES.detailTitle}</h1>
        {inactive && (
          <p role="status" className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
            {SUPPORT_MESSAGES.inactiveTarget}
          </p>
        )}
        <WorkEntryEditForm
          entry={entry}
          today={istanbulToday()}
          mode="staff"
          targetVehicleId={vehicleId}
          disabled={inactive}
          vehicleId={vehicleId}
          scopeKey={computeScopeKey(context)}
          csrfToken={context.csrfToken}
        />
      </UnsavedChangesProvider>
    </main>
  );
}
