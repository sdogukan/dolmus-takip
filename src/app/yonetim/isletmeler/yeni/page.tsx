import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readPageSession } from "../../../../server/auth/page-session";
import { computeScopeKey } from "../../../../server/auth/scope";
import { TeamPageHeader } from "../../../_components/team-page-header";
import { readPlatformUsernameForDisplay } from "../../../../server/auth/platform-username";
import { PLATFORM_ROLE_LABELS } from "../../../../lib/messages";
import { getAppDb } from "../../../../server/data/app-db";
import { NewBusinessForm } from "./new-business-form";

/**
 * /yonetim/isletmeler/yeni — işletme + mal sahibi oluşturma. T2.1, S2.1.
 *
 * İşletme / sahip açma: işletme adı, tanımlı sahip veya yeni sahip
 * ad-soyadı; kaydetmeden önce ilişki görünür. Kişisel araç giriş hesabı
 * oluşturma adımı yoktur. İlk sürümde "tanımlı sahip" seçimi YOKTUR (yalnız
 * POST ile yeni işletme YENİ bir sahiple birlikte kurulur — bkz.
 * `../../../../server/usecases/admin-businesses/create-business.ts` üst
 * notu: "sahipsiz işletme" bir PATCH ARA durumudur, POST'un çıktısı değil).
 *
 * `../page.tsx` (/yonetim) İLE AYNI oturum deseni: platform oturumu yoksa
 * girişe, araç oturumu kendi alanına yönlendirilir (görev tanımı — "Sayfalar
 * readPageSession ile ekip oturumu ister, araç oturumunu kendi alanına ve
 * oturumsuzu /yonetim/giris'e yönlendirir").
 */
export const metadata: Metadata = {
  title: "Yeni işletme — Dolmuş Takip",
};

function targetPathForVehicleRole(role: string): string {
  return role === "owner" ? "/sahip" : "/sofor";
}

export default async function NewBusinessPage() {
  const session = await readPageSession();
  if (!session.ok) {
    redirect("/yonetim/giris");
  }
  const { context } = session;

  if (context.kind === "vehicle") {
    redirect(targetPathForVehicleRole(context.role));
  }
  if (context.kind !== "platform" || context.platformUserId === undefined) {
    // Savunma amaçlı — bkz. `../../page.tsx` AYNI daldaki üst notu.
    redirect("/yonetim/giris");
  }

  const db = getAppDb();
  const username = await readPlatformUsernameForDisplay(db, context.platformUserId);
  const roleLabel =
    context.role === "admin" || context.role === "support"
      ? PLATFORM_ROLE_LABELS[context.role]
      : context.role;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[var(--form-max-width)] flex-col gap-8 px-4 py-6">
      <TeamPageHeader
        username={username ?? "—"}
        roleLabel={roleLabel}
        csrfToken={context.csrfToken}
      />
      <NewBusinessForm csrfToken={context.csrfToken} scopeKey={computeScopeKey(context)} />
    </main>
  );
}
