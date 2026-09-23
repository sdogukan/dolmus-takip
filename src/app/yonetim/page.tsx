import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppDb } from "../../server/data/app-db";
import { readPageSession } from "../../server/auth/page-session";
import { readPlatformUsernameForDisplay } from "../../server/auth/platform-username";
import { PLATFORM_ROLE_LABELS } from "../../lib/messages";
import { TeamPageHeader } from "../_components/team-page-header";
import { parseActiveFilter } from "../../lib/admin-search";
import { AdminSearch } from "./admin-search";

/**
 * /yonetim — ekip ana ekranı (DESIGN.md §1 "Ekip | İşletme / araç bulma
 * | /yonetim", §2.9 back office ilkesi): "+ İşletme aç", işlem geçmişi
 * bağlantısı ve `AdminSearch` (URL'deki `q`/`active` ile başlar; liste
 * istemcide `GET /api/v1/admin/businesses|vehicles` ile okunur).
 */
export const metadata: Metadata = {
  title: "Yönetim — Dolmuş Takip",
};

function targetPathForVehicleRole(role: string): string {
  return role === "owner" ? "/sahip" : "/sofor";
}

export default async function YonetimPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; active?: string | string[] }>;
}) {
  const params = await searchParams;
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
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const rawActive = Array.isArray(params.active) ? params.active[0] : params.active;

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

        <Link
          href="/yonetim/islem-gecmisi"
          className="self-start text-base font-medium text-[var(--color-primary)] underline"
        >
          İşlem geçmişi
        </Link>
        <AdminSearch
          initialQuery={(rawQuery ?? "").trim().slice(0, 100)}
          initialActive={parseActiveFilter(rawActive)}
        />
      </div>
    </main>
  );
}
