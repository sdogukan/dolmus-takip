import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppDb } from "../../server/data/app-db";
import { readPageSession } from "../../server/auth/page-session";
import { readPlatformUsernameForDisplay } from "../../server/auth/platform-username";
import { PLATFORM_ROLE_LABELS } from "../../lib/messages";
import { TeamPageHeader } from "../_components/team-page-header";
import { listBusinesses } from "../../server/usecases/admin-businesses";

/**
 * /yonetim — ekip ana ekranı (DESIGN.md §1 "Ekip | İşletme / araç bulma
 * | /yonetim", §2.9 back office ilkesi). T1.3 ADIM 2/2 (S1.3) ilk sürümü
 * yalnız M1 dürüstlük metnini gösteriyordu; T2.1 (S2.1) bu ekranı DESIGN
 * §2.9'un "+ İşletme aç" düğmesi ve işletme listesiyle DOLDURUR — arama
 * kutusu ve araç ekleme (T2.2/T2.5'in kapsamı) BURADA henüz YOKTUR, bu
 * yüzden "M1 dürüstlük kuralı" ("henüz varmış gibi sunulmaz") aynı
 * gerekçeyle şimdi de geçerlidir: yalnız GERÇEKTEN var olan iş (işletme
 * açma + mevcut listeyi görme) sunulur.
 *
 * `listBusinesses` (`../../server/usecases/admin-businesses/queries.ts`)
 * DOĞRUDAN çağrılır — ARCH §2 "kendi HTTP API'sine gereksiz döngü yok"
 * ilkesi: bu sayfa zaten bir sunucu bileşenidir, kendi `GET /api/v1/
 * admin/businesses` ucuna ayrı bir `fetch` YAPMAZ.
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
  const businesses = listBusinesses(db);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[var(--form-max-width)] flex-col gap-8 px-4 py-6">
      <TeamPageHeader
        username={username ?? "—"}
        roleLabel={roleLabel}
        csrfToken={context.csrfToken}
      />
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">Yönetim</h1>
          <Link
            href="/yonetim/isletmeler/yeni"
            className="min-h-[var(--control-min-height)] flex items-center rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)]"
          >
            + İşletme aç
          </Link>
        </div>

        {businesses.length === 0 ? (
          <p className="text-base text-[var(--color-text-secondary)]">Henüz işletme yok.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {businesses.map((business) => (
              <li key={business.id}>
                <Link
                  href={`/yonetim/isletmeler/${business.id}`}
                  className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{business.name}</span>
                    <span className="text-[var(--color-text-secondary)]">
                      {business.owner ? `Sahip: ${business.owner.fullName}` : "Sahipsiz"} ·{" "}
                      {business.vehicleCount} araç
                    </span>
                  </span>
                  <span
                    className={
                      business.active
                        ? "rounded-full bg-[var(--color-success-surface)] px-2 py-0.5 text-[length:1rem] font-medium text-[var(--color-success)]"
                        : "rounded-full bg-[var(--color-warning-surface)] px-2 py-0.5 text-[length:1rem] font-medium text-[var(--color-warning)]"
                    }
                  >
                    {business.active ? "Aktif" : "Pasif"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
