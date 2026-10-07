import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppDb } from "../../server/data/app-db";
import { readPageSession } from "../../server/auth/page-session";
import { computeScopeKey } from "../../server/auth/scope";
import { readVehiclePlateForDisplay } from "../../server/auth/vehicle-plate";
import { istanbulToday } from "../../lib/work-time";
import { VehiclePageShell } from "../_components/vehicle-page-shell";
import { WorkEntryForm } from "../_components/work-entry-form";

/**
 * /sofor — şoför ana ekranı. T1.2 ADIM 2/2, S1.2;
 * T1.3 ADIM 2/2, S1.3, görev tanımı (c) — platform oturumu artık /giris
 * yerine /yonetim'e yönlendirilir.
 *
 * Görev tanımı (2, birebir): "oturum yoksa /giris'e yönlendirir
 * (redirect); rol uyuşmuyorsa rolüne uygun sayfaya yönlendirir (şoför
 * şifresi /sahip'i AÇMAZ)." M1 — çalışan rapor/günlük kayıt varmış gibi
 * boş yer tutucu ekran sunulmaz. T3.1: günlük kayıt formu
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
    // Ekip (platform) oturumu — geçerli oturum varsa ilgili ana ekrana
    // yönlenir (T1.3 ADIM 2/2, görev tanımı c).
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
    <VehiclePageShell role={context.role} plate={plate ?? "—"} csrfToken={context.csrfToken}>
      <div className="flex flex-col gap-1">
        <h1 className="ds-title">Günlük kayıt</h1>
        <p className="text-base text-[var(--color-text-secondary)]">Çalıştığın günü, saatleri ve tutarları gir.</p>
      </div>
      <WorkEntryForm
        today={istanbulToday()}
        plate={plate ?? "—"}
        vehicleId={context.vehicleId}
        scopeKey={computeScopeKey(context)}
        csrfToken={context.csrfToken}
      />
    </VehiclePageShell>
  );
}
