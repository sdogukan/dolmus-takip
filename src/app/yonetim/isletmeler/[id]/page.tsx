import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readPageSession } from "../../../../server/auth/page-session";
import { computeScopeKey } from "../../../../server/auth/scope";
import { TeamPageHeader } from "../../../_components/team-page-header";
import { readPlatformUsernameForDisplay } from "../../../../server/auth/platform-username";
import { PLATFORM_ROLE_LABELS } from "../../../../lib/messages";
import { getAppDb } from "../../../../server/data/app-db";
import {
  getBusinessDetail,
  BusinessNotFoundError,
} from "../../../../server/usecases/admin-businesses";
import { BusinessDetailForm } from "./business-detail-form";

/**
 * /yonetim/isletmeler/[id] — işletme detay/düzenleme/aktiflik. T2.1, S2.1.
 *
 * DESIGN.md §2.9 tablosu satırları: "İşletme / sahip açma" (ad ve sahip adı
 * düzeltme, sahipsiz işletmede mevcut kişi seçimi veya yeni sahip), "Araç /
 * işletme aktifliği" (etkilenen hedef ve erişim sonucu açıkça gösterilir;
 * pasife alma geçmişi silmez).
 *
 * `getBusinessDetail` (`../../../../server/usecases/admin-businesses/
 * queries.ts`) DOĞRUDAN çağrılır — ARCH §2 "kendi HTTP API'sine gereksiz
 * döngü yok" ilkesi `../page.tsx`'in (/yonetim) liste render'ıyla AYNI
 * desen; sayfa render'ı zaten sunucu tarafındadır, kendi API'sine ayrı bir
 * `fetch` YAPMAZ. Mutasyonlar (`BusinessDetailForm` içindeki PATCH) İSE
 * gerçek `fetch("/api/v1/admin/businesses/:id")` kullanır — CSRF/idempotency
 * katmanı YALNIZ route handler üzerinden çalışır, usecase'i BURADAN
 * DOĞRUDAN çağırmak bu katmanı ATLARDI.
 */
export const metadata: Metadata = {
  title: "İşletme — Dolmuş Takip",
};

function targetPathForVehicleRole(role: string): string {
  return role === "owner" ? "/sahip" : "/sofor";
}

export default async function BusinessDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: businessId } = await params;

  const session = await readPageSession();
  if (!session.ok) {
    redirect("/yonetim/giris");
  }
  const { context } = session;

  if (context.kind === "vehicle") {
    redirect(targetPathForVehicleRole(context.role));
  }
  if (context.kind !== "platform" || context.platformUserId === undefined) {
    redirect("/yonetim/giris");
  }

  const db = getAppDb();
  let detail;
  try {
    detail = getBusinessDetail(db, businessId);
  } catch (error) {
    if (error instanceof BusinessNotFoundError) {
      notFound();
    }
    throw error;
  }

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
      <BusinessDetailForm
        businessId={businessId}
        initialDetail={detail}
        csrfToken={context.csrfToken}
        scopeKey={computeScopeKey(context)}
        canAnonymize={context.role === "admin"}
      />
    </main>
  );
}
