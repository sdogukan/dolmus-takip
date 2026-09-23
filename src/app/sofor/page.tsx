import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppDb } from "../../server/data/app-db";
import { readPageSession } from "../../server/auth/page-session";
import { computeScopeKey } from "../../server/auth/scope";
import { readVehiclePlateForDisplay } from "../../server/auth/vehicle-plate";
import { WORK_ENTRY_MESSAGES } from "../../lib/messages";
import { istanbulToday } from "../../lib/work-time";
import { VehiclePageHeader } from "../_components/vehicle-page-header";
import { WorkEntryForm } from "../_components/work-entry-form";

/**
 * /sofor — şoför ana ekranı (DESIGN.md §1/§2.2). T1.2 ADIM 2/2, S1.2;
 * T1.3 ADIM 2/2, S1.3, görev tanımı (c) — platform oturumu artık /giris
 * yerine /yonetim'e yönlendirilir.
 *
 * Görev tanımı (2, birebir): "oturum yoksa /giris'e yönlendirir
 * (redirect); rol uyuşmuyorsa rolüne uygun sayfaya yönlendirir (şoför
 * şifresi /sahip'i AÇMAZ)." MILESTONES M1 — "çalışan rapor/günlük kayıt
 * varmış gibi boş yer tutucu ekran sunulmaz". T3.1: günlük kayıt formu
 * (`../_components/work-entry-form.tsx`) burada açılır; kaydı yazar (T3.4).
 */
export const metadata: Metadata = {
  title: "Şoför — Dolmuş Takip",
};

export default async function SoforPage() {
  const session = await readPageSession();
  if (!session.ok) {
    redirect("/giris");
  }
  const { context } = session;

  if (context.kind !== "vehicle") {
    // Ekip (platform) oturumu — DESIGN §1 "geçerli oturum varsa ilgili
    // ana ekrana yönlenir" (T1.3 ADIM 2/2, görev tanımı c).
    redirect("/yonetim");
  }
  if (context.role === "owner") {
    redirect("/sahip");
  }
  if (context.role !== "driver") {
    // Savunma amaçlı — `kind === "vehicle"` için `role` HER ZAMAN
    // "owner" | "driver"dır (bkz. `../../server/usecases/session/types.ts`);
    // bu dal normal akışta hiç tetiklenmez.
    redirect("/giris");
  }

  const db = getAppDb();
  if (!context.vehicleId) {
    redirect("/giris");
  }
  const plate = await readVehiclePlateForDisplay(db, context.vehicleId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[35rem] flex-col gap-8 px-4 py-6">
      <VehiclePageHeader plate={plate ?? "—"} csrfToken={context.csrfToken} />
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">Günlük kayıt</h1>
      <WorkEntryForm
        today={istanbulToday()}
        vehicleId={context.vehicleId}
        scopeKey={computeScopeKey(context)}
        csrfToken={context.csrfToken}
      />
      <Link
        href="/sofor/kayitlar"
        className="inline-flex min-h-[var(--control-min-height)] items-center rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)]"
      >
        {WORK_ENTRY_MESSAGES.listLink}
      </Link>
    </main>
  );
}
