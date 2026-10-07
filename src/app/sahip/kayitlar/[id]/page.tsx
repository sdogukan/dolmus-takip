import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { WORK_ENTRY_MESSAGES } from "../../../../lib/messages";
import { istanbulToday } from "../../../../lib/work-time";
import { readPageSession } from "../../../../server/auth/page-session";
import { computeScopeKey, scopeFromVehicleSession } from "../../../../server/auth/scope";
import { readVehiclePlateForDisplay } from "../../../../server/auth/vehicle-plate";
import { getAppDb } from "../../../../server/data/app-db";
import { readWorkEntryForScope } from "../../../../server/usecases/work-entries";
import { VehiclePageShell } from "../../../_components/vehicle-page-shell";
import { VehicleActionLink } from "../../../_components/vehicle-navigation";
import { WorkEntryEditForm } from "../../../_components/work-entry-edit-form";

/**
 * /sahip/kayitlar/[id] — sahip kayıt detayı ve düzenleme. `../../kayit/yeni/
 * page.tsx` İLE AYNI yönlendirme. Kayıt, oturumun kendi kapsamıyla (işletme +
 * araç) okunur; başka araç/işletme kaydı ve bilinmeyen kimlik AYNI 404'ü alır.
 */
export const metadata: Metadata = {
  title: "Kayıt detayı — Dolmuş Takip",
};

export default async function SahipEntryPage({ params }: { params: Promise<{ id: string }> }) {
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
  const entry = readWorkEntryForScope(db, scopeFromVehicleSession(context), entryId);
  if (!entry) {
    notFound();
  }
  const plate = (await readVehiclePlateForDisplay(db, context.vehicleId)) ?? "—";

  return (
    <VehiclePageShell role={context.role} plate={plate} csrfToken={context.csrfToken} backLink={{ href: "/sahip", label: "Özete dön" }}>
      <h1 className="ds-title">{WORK_ENTRY_MESSAGES.detailTitle}</h1>
      <WorkEntryEditForm
        entry={entry}
        today={istanbulToday()}
        mode="owner"
        vehicleId={context.vehicleId}
        scopeKey={computeScopeKey(context)}
        csrfToken={context.csrfToken}
        plate={plate}
      />
      <VehicleActionLink
        href={`/sahip/kayitlar/${entryId}/gecmis`}
        className="ds-btn ds-btn-secondary self-start"
      >
        {WORK_ENTRY_MESSAGES.historyLink}
      </VehicleActionLink>
    </VehiclePageShell>
  );
}
