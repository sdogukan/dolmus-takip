import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppDb } from "../../../server/data/app-db";
import { readPageSession } from "../../../server/auth/page-session";
import { readVehiclePlateForDisplay } from "../../../server/auth/vehicle-plate";
import { REPORT_MESSAGES } from "../../../lib/messages";
import { VehiclePageShell } from "../../_components/vehicle-page-shell";
import { VehiclePeriodReport } from "../../_components/vehicle-period-report";

/**
 * /sahip/raporlar — sahibin araç dönem raporu (S5.x). Yönlendirmeler /sahip
 * ile aynı: oturum yok → /giris, ekip → /yonetim, şoför → /sofor.
 */
export const metadata: Metadata = {
  title: "Raporlar — Dolmuş Takip",
};

export default async function SahipRaporlarPage() {
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
  if (context.role !== "owner") {
    redirect("/giris");
  }

  const db = getAppDb();
  const plate = context.vehicleId
    ? await readVehiclePlateForDisplay(db, context.vehicleId)
    : undefined;

  return (
    <VehiclePageShell role={context.role} plate={plate ?? "—"} csrfToken={context.csrfToken} backLink={{ href: "/sahip", label: "Özete dön" }}>
      <div className="flex flex-col gap-1">
        <h1 className="ds-title">{REPORT_MESSAGES.title}</h1>
        <p className="text-base text-[var(--color-text-secondary)]">Seçtiğin dönemin hesabını kişi kişi veya gün gün incele.</p>
      </div>
      <VehiclePeriodReport />
    </VehiclePageShell>
  );
}
