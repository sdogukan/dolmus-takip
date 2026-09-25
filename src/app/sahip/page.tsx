import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppDb } from "../../server/data/app-db";
import { readPageSession } from "../../server/auth/page-session";
import { readVehicleOwnerNameForDisplay, readVehiclePlateForDisplay } from "../../server/auth/vehicle-plate";
import { REPORT_MESSAGES, WORK_ENTRY_MESSAGES } from "../../lib/messages";
import { OwnerSummary } from "../_components/owner-summary";
import { VehiclePageHeader } from "../_components/vehicle-page-header";

/**
 * /sahip — mal sahibi özeti. Yönlendirmeler:
 * oturum yok → /giris, ekip → /yonetim, şoför → /sofor. K2 — "Sahip oturumu
 * yalnız giriş yapılan aracı kapsar": araç seçici YOK.
 */
export const metadata: Metadata = {
  title: "Sahip — Dolmuş Takip",
};

export default async function SahipPage() {
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
  if (context.role === "driver") {
    // Şoför şifresi /sahip'i AÇMAZ (görev tanımı, birebir) — kendi
    // rolüne uygun sayfaya geri yönlendirilir.
    redirect("/sofor");
  }
  if (context.role !== "owner") {
    // Savunma amaçlı — `kind === "vehicle"` için `role` HER ZAMAN
    // "owner" | "driver"dır.
    redirect("/giris");
  }

  const db = getAppDb();
  const plate = context.vehicleId
    ? await readVehiclePlateForDisplay(db, context.vehicleId)
    : undefined;

  const ownerName = context.vehicleId
    ? await readVehicleOwnerNameForDisplay(db, context.vehicleId)
    : undefined;

  const tabClass =
    "inline-flex min-h-[var(--control-min-height)] items-center justify-center rounded-[var(--radius-control)] border px-2 text-base font-medium";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[35rem] flex-col gap-6 px-4 py-6">
      <VehiclePageHeader plate={plate ?? "—"} ownerName={ownerName} csrfToken={context.csrfToken} />
      <h1 className="sr-only">{REPORT_MESSAGES.summary.title}</h1>
      <nav aria-label={REPORT_MESSAGES.summary.tabsLabel} className="grid grid-cols-3 gap-2">
        <span
          aria-current="page"
          className={`${tabClass} border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-on-primary)]`}
        >
          {REPORT_MESSAGES.summary.title}
        </span>
        <Link href="/sahip/raporlar" className={`${tabClass} border-[var(--color-input-border)] text-[var(--color-text)]`}>
          {REPORT_MESSAGES.link}
        </Link>
        <Link href="/sahip/soforler" className={`${tabClass} border-[var(--color-input-border)] text-[var(--color-text)]`}>
          {REPORT_MESSAGES.summary.driversTab}
        </Link>
      </nav>
      <Link
        href="/sahip/kayit/yeni"
        className="inline-flex min-h-14 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-lg font-semibold text-[var(--color-on-primary)]"
      >
        {WORK_ENTRY_MESSAGES.enterLink}
      </Link>
      <OwnerSummary />
    </main>
  );
}
