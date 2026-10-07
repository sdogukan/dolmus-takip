import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WORK_ENTRY_MESSAGES } from "../../../lib/messages";
import { readPageSession } from "../../../server/auth/page-session";
import { readVehiclePlateForDisplay } from "../../../server/auth/vehicle-plate";
import { getAppDb } from "../../../server/data/app-db";
import { DriverEntriesList } from "../../_components/driver-entries-list";
import { VehiclePageShell } from "../../_components/vehicle-page-shell";

/**
 * /sofor/kayitlar — şoförün kayıt listesi (K1). `../page.tsx` İLE AYNI
 * yönlendirme. Liste istemcide, seçilen kişinin GÖRÜNÜR kayıtlarıyla dolar.
 */
export const metadata: Metadata = {
  title: "Araçtaki kayıtlar — Dolmuş Takip",
};

export default async function SoforEntriesPage() {
  const session = await readPageSession();
  if (!session.ok) {
    redirect("/giris");
  }
  const { context } = session;

  if (context.kind !== "vehicle") {
    redirect("/yonetim");
  }
  if (context.role === "owner") {
    redirect("/sahip");
  }
  if (context.role !== "driver" || !context.vehicleId) {
    redirect("/giris");
  }

  const plate = (await readVehiclePlateForDisplay(getAppDb(), context.vehicleId)) ?? "—";

  return (
    <VehiclePageShell role={context.role} plate={plate} csrfToken={context.csrfToken} backLink={{ href: "/sofor", label: "Günlük kayda dön" }}>
      <div className="flex flex-col gap-1">
        <h1 className="ds-title">{WORK_ENTRY_MESSAGES.listTitle}</h1>
        <p className="text-base text-[var(--color-text-secondary)]">Bu araçta çalışan şoförlerin kayıtlarını ve teslim durumunu gör.</p>
      </div>
      <DriverEntriesList />
    </VehiclePageShell>
  );
}
