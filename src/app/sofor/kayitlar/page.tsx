import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WORK_ENTRY_MESSAGES } from "../../../lib/messages";
import { readPageSession } from "../../../server/auth/page-session";
import { readVehiclePlateForDisplay } from "../../../server/auth/vehicle-plate";
import { getAppDb } from "../../../server/data/app-db";
import { DriverEntriesList } from "../../_components/driver-entries-list";
import { VehiclePageHeader } from "../../_components/vehicle-page-header";

/**
 * /sofor/kayitlar — şoförün kayıt listesi (K1). `../page.tsx` İLE AYNI
 * yönlendirme. Liste istemcide, seçilen kişinin GÖRÜNÜR kayıtlarıyla dolar.
 */
export const metadata: Metadata = {
  title: "Kayıtlarım — Dolmuş Takip",
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
    <main className="mx-auto flex min-h-dvh w-full max-w-[35rem] flex-col gap-6 px-4 py-6">
      <VehiclePageHeader plate={plate} csrfToken={context.csrfToken} />
      <Link href="/sofor" className="text-base font-medium text-[var(--color-primary)] underline">
        {WORK_ENTRY_MESSAGES.backToDriver}
      </Link>
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">{WORK_ENTRY_MESSAGES.listTitle}</h1>
      <DriverEntriesList />
    </main>
  );
}
