import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readPageSession } from "../../../../server/auth/page-session";
import { computeScopeKey } from "../../../../server/auth/scope";
import { TeamPageHeader } from "../../../_components/team-page-header";
import { readPlatformUsernameForDisplay } from "../../../../server/auth/platform-username";
import { PLATFORM_ROLE_LABELS } from "../../../../lib/messages";
import { getAppDb } from "../../../../server/data/app-db";
import {
  getVehicleDetail,
  VehicleNotFoundError,
} from "../../../../server/usecases/admin-vehicles";
import { VehicleDetailForm } from "./vehicle-detail-form";

/**
 * /yonetim/araclar/[id] — araç detay/düzenleme/aktiflik. T2.2, S2.2.
 *
 * `../../isletmeler/[id]/page.tsx` (işletme detayı) İLE AYNI desen:
 * `getVehicleDetail` (`../../../../server/usecases/admin-vehicles/
 * queries.ts`) DOĞRUDAN çağrılır (ARCH §2 "kendi HTTP API'sine gereksiz
 * döngü yok"); mutasyonlar (`VehicleDetailForm` içindeki PATCH) İSE gerçek
 * `fetch("/api/v1/admin/vehicles/:id")` kullanır. Bu sayfa `resolveAdminScope`
 * ÇAĞIRMAZ — işletme detay sayfasıyla AYNI gerekçe: staff rolü (support/
 * admin) herhangi bir işletme/aracı görebilir (`resolveAdminScope`'un
 * kendisi de yalnız hedefin VAR OLUP OLMADIĞINI/businessId'sini DB'den
 * türetir, ek bir staff-başına kısıtlama YOKTUR — bkz. `../../../../
 * server/auth/scope.ts`); araç/oturum ayrımı aşağıdaki rol denetimiyle
 * zaten sağlanır.
 */
export const metadata: Metadata = {
  title: "Araç — Dolmuş Takip",
};

function targetPathForVehicleRole(role: string): string {
  return role === "owner" ? "/sahip" : "/sofor";
}

export default async function VehicleDetailPage({
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
    redirect(targetPathForVehicleRole(context.role));
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[var(--form-max-width)] flex-col gap-8 px-4 py-6">
      <TeamPageHeader
        username={username ?? "—"}
        roleLabel={roleLabel}
        csrfToken={context.csrfToken}
      />
      <VehicleDetailForm
        vehicleId={vehicleId}
        initialDetail={detail}
        csrfToken={context.csrfToken}
        scopeKey={computeScopeKey(context)}
      />
    </main>
  );
}
