import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readPageSession } from "../../../server/auth/page-session";
import { computeScopeKey, scopeFromVehicleSession } from "../../../server/auth/scope";
import { readVehiclePlateForDisplay } from "../../../server/auth/vehicle-plate";
import { getAppDb } from "../../../server/data/app-db";
import { listVehicleDriversForManagement } from "../../../server/usecases/drivers";
import { DriversManager } from "../../_components/drivers-manager";
import { VehiclePageHeader } from "../../_components/vehicle-page-header";

/**
 * /sahip/soforler — Şoförlerim (DESIGN "Şoförlerim"). T2.5. `../page.tsx` İLE
 * AYNI oturum/rol yönlendirmesi: oturum yoksa /giris, ekip oturumu /yonetim,
 * şoför oturumu /sofor. Liste sunucuda oturumun kendi kapsamıyla okunur
 * (`scopeFromVehicleSession`); mutasyonlar `/api/v1/drivers` uçlarına gider.
 * Sahip arayüzünde küresel kişi aktifliği kontrolü YOKTUR.
 */
export const metadata: Metadata = {
  title: "Şoförlerim — Dolmuş Takip",
};

export default async function SahipSoforlerPage() {
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
  const initialView = listVehicleDriversForManagement(db, scopeFromVehicleSession(context));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[35rem] flex-col gap-6 px-4 py-6">
      <VehiclePageHeader plate={plate} csrfToken={context.csrfToken} />
      <Link href="/sahip" className="text-base font-medium text-[var(--color-primary)] underline">
        ← Özet
      </Link>
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">Şoförlerim</h1>
      <DriversManager
        mode="owner"
        vehicleId={context.vehicleId}
        plateDisplay={plate}
        csrfToken={context.csrfToken}
        scopeKey={computeScopeKey(context)}
        initialView={initialView}
      />
    </main>
  );
}
