import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { WORK_ENTRY_MESSAGES } from "../../../../../lib/messages";
import { readPageSession } from "../../../../../server/auth/page-session";
import { scopeFromVehicleSession } from "../../../../../server/auth/scope";
import { readVehiclePlateForDisplay } from "../../../../../server/auth/vehicle-plate";
import { getAppDb } from "../../../../../server/data/app-db";
import { readWorkEntryHistoryForScope } from "../../../../../server/usecases/work-entries";
import { VehiclePageShell } from "../../../../_components/vehicle-page-shell";
import { WorkEntryHistory } from "../../../../_components/work-entry-history";

/**
 * /sahip/kayitlar/[id]/gecmis — sahip için salt okunur kayıt geçmişi. `../page.tsx`
 * İLE AYNI oturum/rol denetimi (şoför → /sofor, ekip → /yonetim) ve HİÇBİR okumadan
 * ÖNCE yapılır; kayıt oturumun kapsamıyla okunur, kapsam dışı/bilinmeyen kimlik 404.
 */
export const metadata: Metadata = {
  title: "Kayıt geçmişi — Dolmuş Takip",
};

export default async function SahipEntryHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: entryId } = await params;

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
  const view = readWorkEntryHistoryForScope(db, scopeFromVehicleSession(context), entryId);
  if (!view) {
    notFound();
  }
  const plate = (await readVehiclePlateForDisplay(db, context.vehicleId)) ?? "—";

  return (
    <VehiclePageShell role={context.role} plate={plate} csrfToken={context.csrfToken} backLink={{ href: `/sahip/kayitlar/${entryId}`, label: "Kayda dön" }}>
      <h1 className="ds-title">{WORK_ENTRY_MESSAGES.historyTitle}</h1>
      <WorkEntryHistory view={view} />
    </VehiclePageShell>
  );
}
