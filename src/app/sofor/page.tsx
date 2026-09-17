import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppDb } from "../../server/data/app-db";
import { readPageSession } from "../../server/auth/page-session";
import { readVehiclePlateForDisplay } from "../../server/auth/vehicle-plate";
import { VehiclePageHeader } from "../_components/vehicle-page-header";

/**
 * /sofor — şoför ana ekranı (DESIGN.md §1/§2.2). T1.2 ADIM 2/2, S1.2.
 *
 * Görev tanımı (2, birebir): "oturum yoksa /giris'e yönlendirir
 * (redirect); rol uyuşmuyorsa rolüne uygun sayfaya yönlendirir (şoför
 * şifresi /sahip'i AÇMAZ)." MILESTONES M1 — "çalışan rapor/günlük kayıt
 * varmış gibi boş yer tutucu ekran sunulmaz": bu yüzden burada sahte bir
 * form/rapor YOK, yalnız dürüst kısa metin (aşağıdaki JSX).
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
    // Ekip (platform) oturumu — T1.3 henüz /yonetim'i AÇMADI. Var
    // olmayan bir rotaya yönlendirmek yerine güvenli varsayılana (giriş
    // ekranı) dönülür; bu, bu paketin open_issues'ında not edilmiştir.
    redirect("/giris");
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
  const plate = context.vehicleId
    ? await readVehiclePlateForDisplay(db, context.vehicleId)
    : undefined;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[35rem] flex-col gap-8 px-4 py-6">
      <VehiclePageHeader plate={plate ?? "—"} csrfToken={context.csrfToken} />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">
          Günlük kayıt
        </h1>
        <p className="text-base text-[var(--color-text-secondary)]">
          Şoför girişi başarılı. Günlük kayıt formu bir sonraki aşamada
          açılacak.
        </p>
      </div>
    </main>
  );
}
