import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readPageSession } from "../../../../../../server/auth/page-session";
import { computeScopeKey } from "../../../../../../server/auth/scope";
import { TeamPageHeader } from "../../../../../_components/team-page-header";
import { readPlatformUsernameForDisplay } from "../../../../../../server/auth/platform-username";
import { PLATFORM_ROLE_LABELS } from "../../../../../../lib/messages";
import { getAppDb } from "../../../../../../server/data/app-db";
import {
  getBusinessDetail,
  BusinessNotFoundError,
} from "../../../../../../server/usecases/admin-businesses";
import { NewVehicleForm } from "./new-vehicle-form";

/**
 * /yonetim/isletmeler/[id]/araclar/yeni — araç oluşturma. T2.2, S2.2.
 *
 * Araç açma / düzenleme: bağlı işletme/sahip, plaka, marka/model/yıl,
 * hat/durak notu, aktiflik. İlk oluşturma sırasında mal sahibi şifresi ve
 * ortak şoför şifresi ayrı etiketli alanlardır; aynı olamazlar.
 *
 * `getBusinessDetail` (`../../../../../../server/usecases/admin-businesses/
 * queries.ts`) DOĞRUDAN çağrılır — `../../page.tsx` (işletme detayı) İLE
 * AYNI desen (kendi HTTP API'sine gereksiz döngü yok). Bağlı
 * işletme/sahip başlığı bu okumadan gelir; POST'un kendisi (`NewVehicleForm`
 * içinde) gerçek `fetch("/api/v1/admin/vehicles")` kullanır (CSRF/idempotency
 * katmanı yalnız route handler üzerinden çalışır).
 *
 * Pasif veya sahipsiz işletmede form HİÇ RENDER EDİLMEZ (yalnız erken geri
 * bildirim — sunucu `createVehicle` zaten `businessRef` için aynı iki
 * durumu 422 ile reddeder, bkz. `../../../../../../server/usecases/
 * admin-vehicles/create-vehicle.ts`); bu ekran KENDİSİ ek bir yetki kararı
 * VERMEZ.
 */
export const metadata: Metadata = {
  title: "Araç ekle — Dolmuş Takip",
};

function targetPathForVehicleRole(role: string): string {
  return role === "owner" ? "/sahip" : "/sofor";
}

export default async function NewVehiclePage({
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
  let business;
  try {
    business = getBusinessDetail(db, businessId);
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

  const canCreateVehicle = business.business.active && business.owner !== null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[var(--form-max-width)] flex-col gap-8 px-4 py-6">
      <TeamPageHeader
        username={username ?? "—"}
        roleLabel={roleLabel}
        csrfToken={context.csrfToken}
      />
      {canCreateVehicle ? (
        <NewVehicleForm
          businessId={businessId}
          businessName={business.business.name}
          ownerFullName={business.owner!.fullName}
          csrfToken={context.csrfToken}
          scopeKey={computeScopeKey(context)}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">Araç ekle</h1>
          <p className="text-base text-[var(--color-text-secondary)]">
            {business.business.active
              ? "Bu işletmenin sahibi yok; önce sahip ata."
              : "İşletme pasif; araç eklemeden önce yeniden aktifleştir."}
          </p>
          <Link
            href={`/yonetim/isletmeler/${businessId}`}
            className="min-h-[var(--control-min-height)] inline-flex w-fit items-center rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            İşletmeye dön
          </Link>
        </div>
      )}
    </main>
  );
}
