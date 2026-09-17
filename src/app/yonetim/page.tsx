import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppDb } from "../../server/data/app-db";
import { readPageSession } from "../../server/auth/page-session";
import { readPlatformUsernameForDisplay } from "../../server/auth/platform-username";
import { PLATFORM_ROLE_LABELS } from "../../lib/messages";
import { TeamPageHeader } from "../_components/team-page-header";

/**
 * /yonetim — ekip ana ekranı (DESIGN.md §1 "Ekip | İşletme / araç bulma
 * | /yonetim", §2.9 back office ilkesi). T1.3 ADIM 2/2, S1.3, görev
 * tanımı (b).
 *
 * Görev tanımı (b, birebir): "platform oturumu yoksa /yonetim/giris'e;
 * araç oturumuyla gelen rolüne uygun sayfaya (/sofor | /sahip)
 * yönlendirilir; üst başlıkta kişisel ekip kimliği (username) + rol
 * etiketi ('Yönetici' / 'Destek') + Çıkış ... içerik M1 dürüstlük kuralı:
 * 'Ekip girişi başarılı. İşletme ve araç yönetimi bir sonraki aşamada
 * açılacak.' — sahte arama/liste/form YOK."
 *
 * DESIGN §1'in tam tasarımı bu sayfada "Plaka veya işletme ara" arama
 * kutusu ve işletme/araç listesini (§2.9) öngörür — ama bu, S2.1/S2.2'nin
 * (E2 destesi) kapsamıdır; T1.3/S1.3'ün kendi doğrulaması yalnız "kişisel
 * ekip girişi ve ilk yönetici kurulumu"dur (bkz. TASKS.md T1.3 sonuç
 * cümlesi). MILESTONES M1 — "çalışan rapor/günlük kayıt varmış gibi boş
 * yer tutucu ekran sunulmaz" (`../sofor/page.tsx`/`../sahip/page.tsx`
 * AYNI ilkeyi zaten uygular) — bu yüzden burada sahte bir arama/liste/form
 * YOK, yalnız dürüst kısa metin.
 */
export const metadata: Metadata = {
  title: "Yönetim — Dolmuş Takip",
};

function targetPathForVehicleRole(role: string): string {
  return role === "owner" ? "/sahip" : "/sofor";
}

export default async function YonetimPage() {
  const session = await readPageSession();
  if (!session.ok) {
    redirect("/yonetim/giris");
  }
  const { context } = session;

  if (context.kind === "vehicle") {
    // Araç oturumuyla /yonetim'e gelindi — görev tanımı (b, birebir):
    // "araç oturumuyla gelen rolüne uygun sayfaya (/sofor | /sahip)
    // yönlendirilir." `role` `kind === "vehicle"` için HER ZAMAN
    // "owner"|"driver"dır (bkz. `../../server/usecases/session/types.ts`).
    redirect(targetPathForVehicleRole(context.role));
  }

  if (context.kind !== "platform" || context.platformUserId === undefined) {
    // Savunma amaçlı — `SessionContext.kind` yalnız "vehicle"|"platform"
    // olabilir (bkz. yukarıdaki tip); "platform" iken `platformUserId`
    // HER ZAMAN doludur (bkz. `../../server/usecases/session/
    // create-platform-session.ts`). Bu dal normal akışta hiç tetiklenmez.
    redirect("/yonetim/giris");
  }

  const db = getAppDb();
  const username = await readPlatformUsernameForDisplay(db, context.platformUserId);
  const roleLabel =
    context.role === "admin" || context.role === "support"
      ? PLATFORM_ROLE_LABELS[context.role]
      : context.role;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[35rem] flex-col gap-8 px-4 py-6">
      <TeamPageHeader
        username={username ?? "—"}
        roleLabel={roleLabel}
        csrfToken={context.csrfToken}
      />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">Yönetim</h1>
        <p className="text-base text-[var(--color-text-secondary)]">
          Ekip girişi başarılı. İşletme ve araç yönetimi bir sonraki aşamada
          açılacak.
        </p>
      </div>
    </main>
  );
}
