import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WORK_ENTRY_MESSAGES } from "../../../../lib/messages";
import { istanbulToday } from "../../../../lib/work-time";
import { readPageSession } from "../../../../server/auth/page-session";
import { computeScopeKey, scopeFromVehicleSession } from "../../../../server/auth/scope";
import { readVehiclePlateForDisplay } from "../../../../server/auth/vehicle-plate";
import { getAppDb } from "../../../../server/data/app-db";
import { readWorkEntryForScope } from "../../../../server/usecases/work-entries";
import { VehiclePageHeader } from "../../../_components/vehicle-page-header";
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
    <main className="mx-auto flex min-h-dvh w-full max-w-[35rem] flex-col gap-6 px-4 py-6">
      <VehiclePageHeader plate={plate} csrfToken={context.csrfToken} />
      <Link href="/sahip" className="text-base font-medium text-[var(--color-primary)] underline">
        {WORK_ENTRY_MESSAGES.backToOwner}
      </Link>
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">{WORK_ENTRY_MESSAGES.detailTitle}</h1>
      <WorkEntryEditForm
        entry={entry}
        today={istanbulToday()}
        mode="owner"
        vehicleId={context.vehicleId}
        scopeKey={computeScopeKey(context)}
        csrfToken={context.csrfToken}
        plate={plate}
      />
      <Link
        href={`/sahip/kayitlar/${entryId}/gecmis`}
        className="text-base font-medium text-[var(--color-primary)] underline"
      >
        {WORK_ENTRY_MESSAGES.historyLink}
      </Link>
    </main>
  );
}
