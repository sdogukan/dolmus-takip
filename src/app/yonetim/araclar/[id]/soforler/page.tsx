import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PLATFORM_ROLE_LABELS } from "../../../../../lib/messages";
import { formatPlateForDisplay } from "../../../../../lib/plate";
import { readPageSession } from "../../../../../server/auth/page-session";
import { readPlatformUsernameForDisplay } from "../../../../../server/auth/platform-username";
import { computeScopeKey, resolveAdminScope } from "../../../../../server/auth/scope";
import { getAppDb } from "../../../../../server/data/app-db";
import { getVehicleDetail, VehicleNotFoundError } from "../../../../../server/usecases/admin-vehicles";
import {
  listAffectedVehiclesForPeople,
  listVehicleDriversForManagement,
} from "../../../../../server/usecases/drivers";
import { DriversManager } from "../../../../_components/drivers-manager";
import { SupportTargetHeader } from "../../../../_components/support-target-header";
import { TeamPageHeader } from "../../../../_components/team-page-header";
import { UnsavedChangesProvider } from "../../../../_components/unsaved-changes";

/**
 * /yonetim/araclar/[id]/soforler — ekip için Şoförlerim (T2.5). `../page.tsx`
 * İLE AYNI oturum/rol denetimi; hedef araç ve işletme URL'deki araç kimliğinden
 * sunucuda türetilir (`resolveAdminScope`). Şifre sıfırlama bağlantısı araç
 * detayındaki bölüme (`#sifre-sifirlama`) gider. KVKK "Adı anonimleştir"
 * yalnız yönetici oturumunda açılır (`canAnonymize`, sunucudaki rol).
 */
export const metadata: Metadata = {
  title: "Şoförler — Dolmuş Takip",
};

export default async function VehicleDriversPage({
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
  const resolved = await resolveAdminScope(context, { vehicleId }, db);
  if (!resolved.ok) {
    notFound();
  }

  const initialView = listVehicleDriversForManagement(db, resolved.scope);
  const affectedVehicles = listAffectedVehiclesForPeople(
    db,
    resolved.scope,
    initialView.drivers.map((driver) => driver.personId),
  );

  const username = await readPlatformUsernameForDisplay(db, context.platformUserId);
  const roleLabel =
    context.role === "admin" || context.role === "support"
      ? PLATFORM_ROLE_LABELS[context.role]
      : context.role;
  const plate = formatPlateForDisplay(detail.vehicle.plateNormalized);
  const scopeKey = computeScopeKey(context);

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
          scopeKey={scopeKey}
          businessName={detail.business.name}
          plateDisplay={plate}
          ownerName={detail.owner.fullName}
          username={username ?? "—"}
          roleLabel={roleLabel}
        />
        <Link
          href={`/yonetim/araclar/${vehicleId}`}
          className="text-base font-medium text-[var(--color-primary)] underline"
        >
          ← Araç
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">Şoförler</h1>
          <p className="text-base text-[var(--color-text-secondary)]">
            {plate} · {detail.business.name} · Sahip: {detail.owner.fullName}
          </p>
        </div>
        <DriversManager
          mode="staff"
          vehicleId={vehicleId}
          plateDisplay={plate}
          csrfToken={context.csrfToken}
          scopeKey={scopeKey}
          initialView={initialView}
          affectedVehicles={affectedVehicles}
          passwordResetHref={`/yonetim/araclar/${vehicleId}#sifre-sifirlama`}
          canAnonymize={context.role === "admin"}
          businessId={resolved.scope.businessId}
        />
      </UnsavedChangesProvider>
    </main>
  );
}
