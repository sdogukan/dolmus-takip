import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppDb } from "../../../server/data/app-db";
import { readPageSession } from "../../../server/auth/page-session";
import { readVehiclePlateForDisplay } from "../../../server/auth/vehicle-plate";
import { REPORT_MESSAGES } from "../../../lib/messages";
import { VehiclePageHeader } from "../../_components/vehicle-page-header";
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
    <main className="mx-auto flex min-h-dvh w-full max-w-[35rem] flex-col gap-6 px-4 py-6">
      <VehiclePageHeader plate={plate ?? "—"} csrfToken={context.csrfToken} />
      <Link
        href="/sahip"
        className="inline-flex min-h-[var(--control-min-height)] items-center self-start text-base font-medium text-[var(--color-text)]"
      >
        ← Özet
      </Link>
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">{REPORT_MESSAGES.title}</h1>
      <VehiclePeriodReport />
    </main>
  );
}
