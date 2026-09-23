import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppDb } from "../../server/data/app-db";
import { readPageSession } from "../../server/auth/page-session";
import { readVehiclePlateForDisplay } from "../../server/auth/vehicle-plate";
import { WORK_ENTRY_MESSAGES } from "../../lib/messages";
import { VehiclePageHeader } from "../_components/vehicle-page-header";

/**
 * /sahip — mal sahibi ana ekranı (DESIGN.md §1/§2.5). T1.2 ADIM 2/2, S1.2;
 * T1.3 ADIM 2/2, S1.3, görev tanımı (c) — platform oturumu artık /giris
 * yerine /yonetim'e yönlendirilir.
 *
 * Görev tanımı (2, birebir): "oturum yoksa /giris'e yönlendirir
 * (redirect); rol uyuşmuyorsa rolüne uygun sayfaya yönlendirir." K2 —
 * "Sahip oturumu yalnız giriş yapılan aracı kapsar" — bu sayfa şimdilik
 * yalnız `context.vehicleId`'nin plakasını gösterir; çok araçlı bir
 * seçici EKLENMEDİ (K2 kesin kararı).
 *
 * MILESTONES M1 — "çalışan rapor/günlük kayıt varmış gibi boş yer tutucu
 * ekran sunulmaz": sahte özet/form YOK, yalnız dürüst kısa metin.
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
    // Ekip (platform) oturumu — DESIGN §1 "geçerli oturum varsa ilgili
    // ana ekrana yönlenir" (T1.3 ADIM 2/2, görev tanımı c).
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[35rem] flex-col gap-8 px-4 py-6">
      <VehiclePageHeader plate={plate ?? "—"} csrfToken={context.csrfToken} />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">
          Özet
        </h1>
        <p className="text-base text-[var(--color-text-secondary)]">
          Sahip girişi başarılı. Özet ve raporlar bir sonraki aşamada
          açılacak.
        </p>
      </div>
      <nav aria-label="Sahip bağlantıları" className="flex flex-col gap-3">
        <Link
          href="/sahip/kayit/yeni"
          className="inline-flex min-h-[var(--control-min-height)] items-center rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)]"
        >
          {WORK_ENTRY_MESSAGES.enterLink}
        </Link>
        <Link
          href="/sahip/soforler"
          className="inline-flex min-h-[var(--control-min-height)] items-center rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)]"
        >
          Şoförlerim
        </Link>
      </nav>
    </main>
  );
}
