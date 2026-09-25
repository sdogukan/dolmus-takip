import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AUDIT_MESSAGES, PLATFORM_ROLE_LABELS } from "../../../lib/messages";
import { formatPlateForDisplay } from "../../../lib/plate";
import { readPageSession } from "../../../server/auth/page-session";
import { readPlatformUsernameForDisplay } from "../../../server/auth/platform-username";
import { getAppDb } from "../../../server/data/app-db";
import { BusinessNotFoundError, getBusinessDetail } from "../../../server/usecases/admin-businesses";
import { getVehicleDetail, VehicleNotFoundError } from "../../../server/usecases/admin-vehicles";
import { TeamPageHeader } from "../../_components/team-page-header";
import { AuditHistory } from "./audit-history";

/**
 * /yonetim/islem-gecmisi — salt okunur işlem geçmişi. Ekip
 * oturumu dışında erişilemez (araç oturumu → /sahip|/sofor). Opsiyonel
 * `?vehicleId=` / `?businessId=` filtresi DOĞRUDAN API'ye gider (API doğrular);
 * başlıktaki filtre etiketi için hedef burada sunucuda okunur, bilinmeyen
 * hedef 404 verir.
 */
export const metadata: Metadata = {
  title: "İşlem geçmişi — Dolmuş Takip",
};

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first ? first : undefined;
}

export default async function AuditHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicleId?: string | string[]; businessId?: string | string[] }>;
}) {
  const params = await searchParams;
  const vehicleId = single(params.vehicleId);
  const businessId = single(params.businessId);

  const session = await readPageSession();
  if (!session.ok) {
    redirect("/yonetim/giris");
  }
  const { context } = session;

  if (context.kind === "vehicle") {
    redirect(context.role === "owner" ? "/sahip" : "/sofor");
  }
  if (context.kind !== "platform" || context.platformUserId === undefined) {
    redirect("/yonetim/giris");
  }

  const db = getAppDb();
  let filterLabel: string | null = null;
  try {
    if (vehicleId) {
      const detail = getVehicleDetail(db, vehicleId);
      filterLabel = `${formatPlateForDisplay(detail.vehicle.plateNormalized)} · ${detail.business.name}`;
    } else if (businessId) {
      filterLabel = getBusinessDetail(db, businessId).business.name;
    }
  } catch (error) {
    if (error instanceof VehicleNotFoundError || error instanceof BusinessNotFoundError) {
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
    <main className="mx-auto flex min-h-dvh w-full max-w-[var(--form-max-width)] flex-col gap-6 px-4 py-6">
      <TeamPageHeader
        username={username ?? "—"}
        roleLabel={roleLabel}
        csrfToken={context.csrfToken}
      />
      <Link href="/yonetim" className="text-base font-medium text-[var(--color-primary)] underline">
        ← Yönetim
      </Link>
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">{AUDIT_MESSAGES.title}</h1>
      {filterLabel && (
        <p className="flex flex-wrap items-center gap-3 text-base text-[var(--color-text-secondary)]">
          <span>
            {AUDIT_MESSAGES.filterPrefix}: {filterLabel}
          </span>
          <Link href="/yonetim/islem-gecmisi" className="font-medium text-[var(--color-primary)] underline">
            {AUDIT_MESSAGES.clearFilter}
          </Link>
        </p>
      )}
      <AuditHistory vehicleId={vehicleId} businessId={businessId} />
    </main>
  );
}
