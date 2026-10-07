import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WORK_ENTRY_MESSAGES } from "../../../../lib/messages";
import { istanbulToday } from "../../../../lib/work-time";
import { readPageSession } from "../../../../server/auth/page-session";
import { computeScopeKey, scopeFromVehicleSession } from "../../../../server/auth/scope";
import { readVehiclePlateForDisplay } from "../../../../server/auth/vehicle-plate";
import { getAppDb } from "../../../../server/data/app-db";
import { readVehicleOwnerPerson } from "../../../../server/usecases/work-entries";
import { VehiclePageHeader } from "../../../_components/vehicle-page-header";
import { WorkEntryForm } from "../../../_components/work-entry-form";

/**
 * /sahip/kayit/yeni — sahip çalışma kaydı.
 * `../../page.tsx` İLE AYNI yönlendirme: oturum yok → /giris, ekip → /yonetim,
 * şoför → /sofor. Sahibin adı sunucuda oturumun kendi kapsamıyla okunur. Form
 * kaydı yazar (T3.4).
 */
export const metadata: Metadata = {
  title: "Çalışma kaydı — Dolmuş Takip",
};

export default async function SahipWorkEntryPage() {
  const session = await readPageSession();
  if (!session.ok) {
    redirect("/giris");
  }
  const { context } = session;

  if (context.kind !== "vehicle") {
    redirect("/yonetim");
  }
  if (context.role === "driver") {
    redirect("/sofor");
  }
  if (context.role !== "owner" || !context.vehicleId) {
    redirect("/giris");
  }

  const db = getAppDb();
  const plate = (await readVehiclePlateForDisplay(db, context.vehicleId)) ?? "—";
  const owner = readVehicleOwnerPerson(db, scopeFromVehicleSession(context));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[35rem] flex-col gap-6 px-4 sm:px-6 py-6">
      <VehiclePageHeader role={context.role} plate={plate} csrfToken={context.csrfToken} />
      <Link href="/sahip" className="ds-link ds-link-block">
        ← Özet
      </Link>
      <h1 className="ds-title">{WORK_ENTRY_MESSAGES.pageTitle}</h1>
      <WorkEntryForm
        today={istanbulToday()}
        plate={plate}
        mode="owner"
        ownerName={owner?.fullName}
        vehicleId={context.vehicleId}
        scopeKey={computeScopeKey(context)}
        csrfToken={context.csrfToken}
      />
    </main>
  );
}
