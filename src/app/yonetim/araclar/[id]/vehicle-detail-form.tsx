"use client";

/**
 * Araç detay/düzenleme/aktiflik formu (istemci bileşeni) — T2.2, S2.2.
 *
 * `../../isletmeler/[id]/business-detail-form.tsx` İLE AYNI iki desen:
 * ARCHITECTURE §3.4 tekrar gönderim/eşzamanlı düzenleme kuralları (her
 * mini-form kendi `requestId`sini taşır, belirsiz sonuçta alanlar
 * dondurulur, `version` bir sonraki PATCH'e taşınır) ve her BAŞARILI
 * PATCH'in sunucunun döndürdüğü TAZE `VehicleDetail`'i yerel `detail`
 * durumuna yazması. Plaka bu ekranda DÜZENLENEMEZ (T2.2 sözleşmesi) —
 * yalnız salt okunur gösterilir; şifre YOKTUR/gösterilmez (sıfırlama T2.3).
 */
import { useRef, useState, type FormEvent } from "react";
import type { ClientStateScope } from "../../../../lib/client-state";
import { useStoredDraft } from "../../../../lib/use-stored-draft";
import { getErrorMessage } from "../../../../lib/messages";
import { formatPlateForDisplay } from "../../../../lib/plate";
import { isDraftStale } from "../../../../lib/draft-version";
import { ConfirmDialog } from "../../../_components/confirm-dialog";
import { PasswordResetSection } from "./password-reset-section";

export interface VehicleDetail {
  vehicle: {
    id: string;
    plateNormalized: string;
    brandModel: string | null;
    year: number | null;
    routeStop: string | null;
    note: string | null;
    active: boolean;
    version: number;
  };
  business: { id: string; name: string; active: boolean };
  owner: { personId: string; fullName: string };
}

interface PatchErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
}

type PatchOutcome =
  | { kind: "ambiguous" }
  | { kind: "success"; detail: VehicleDetail }
  | { kind: "error"; status: number; code?: string; message?: string; fields?: Record<string, string> };

async function patchVehicle(
  vehicleId: string,
  csrfToken: string,
  body: Record<string, unknown>,
): Promise<PatchOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/admin/vehicles/${vehicleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: "ambiguous" };
  }

  let parsed: (VehicleDetail & PatchErrorBody) | undefined;
  try {
    parsed = (await response.json()) as VehicleDetail & PatchErrorBody;
  } catch {
    return { kind: "ambiguous" };
  }

  if (response.ok) {
    return { kind: "success", detail: parsed as VehicleDetail };
  }
  return {
    kind: "error",
    status: response.status,
    code: parsed?.error?.code,
    message: parsed?.error?.message,
    fields: parsed?.error?.fields,
  };
}

function randomRequestId(): string {
  return crypto.randomUUID();
}

interface Banner {
  message: string;
  code?: string;
}

/** Alan-dışı (409/403/429/5xx/ağ) bir hatayı ekran metnine çevirir —
 * `../../isletmeler/[id]/business-detail-form.tsx` `bannerFor` İLE AYNI
 * kural (sunucunun `error.message`'ı BASILMAZ). */
function bannerFor(outcome: Extract<PatchOutcome, { kind: "error" }>): Banner {
  const message =
    outcome.status >= 500
      ? "Bağlantı kurulamadı. Tekrar dene."
      : (outcome.code ? getErrorMessage(outcome.code) : undefined) ?? "Bağlantı kurulamadı. Tekrar dene.";
  return { message, code: outcome.code };
}

function ErrorBanner({ banner }: { banner: Banner }) {
  return (
    <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
      {banner.message}
      {banner.code === "VERSION_CONFLICT" && (
        <>
          {" "}
          <button type="button" onClick={() => window.location.reload()} className="underline">
            Güncel halini aç
          </button>
        </>
      )}
    </p>
  );
}

/**
 * `baseVersion` — bu taslağın alan değerlerinin (veya `active.target`ın)
 * DAYANDIĞI `vehicles.version`; PATCH HER ZAMAN bunu gönderir, o anki
 * `detail.vehicle.version`'ı DEĞİL (review bulgusu C1). `isDraftStale`
 * (`../../../../lib/draft-version.ts`) bunu `detail.vehicle.version`'la
 * karşılaştırarak taslağın hâlâ geçerli mi yoksa arada başka bir sekme/
 * ekip üyesinin kaydettiği daha yeni bir sürüme mi bayatladığını saptar.
 */
interface DetailDraft {
  info: {
    requestId: string;
    brandModel: string;
    year: string;
    routeStop: string;
    note: string;
    pending: boolean;
    baseVersion: number;
  };
  active: { requestId: string; target: boolean; pending: boolean; baseVersion: number } | null;
}

function emptyDraft(detail: VehicleDetail): DetailDraft {
  return {
    info: {
      requestId: randomRequestId(),
      brandModel: detail.vehicle.brandModel ?? "",
      year: detail.vehicle.year !== null ? String(detail.vehicle.year) : "",
      routeStop: detail.vehicle.routeStop ?? "",
      note: detail.vehicle.note ?? "",
      pending: false,
      baseVersion: detail.vehicle.version,
    },
    active: null,
  };
}

export function VehicleDetailForm({
  vehicleId,
  initialDetail,
  csrfToken,
  scopeKey,
}: {
  vehicleId: string;
  initialDetail: VehicleDetail;
  csrfToken: string;
  scopeKey: string;
}) {
  const draftName = `arac-${vehicleId}`;
  const scope: ClientStateScope = { scopeKey };
  const [detail, setDetail] = useState<VehicleDetail>(initialDetail);
  const [draft, persistDraft] = useStoredDraft<DetailDraft>(scope, draftName, () =>
    emptyDraft(initialDetail),
  );

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">
            {formatPlateForDisplay(detail.vehicle.plateNormalized)}
          </h1>
          <span
            className={
              detail.vehicle.active
                ? "rounded-full bg-[var(--color-success-surface)] px-2 py-0.5 text-base font-medium text-[var(--color-success)]"
                : "rounded-full bg-[var(--color-warning-surface)] px-2 py-0.5 text-base font-medium text-[var(--color-warning)]"
            }
          >
            {detail.vehicle.active ? "Aktif" : "Pasif"}
          </span>
        </div>
        <p className="text-base text-[var(--color-text-secondary)]">
          {detail.business.name} · Sahip: {detail.owner.fullName}
        </p>
      </div>

      <InfoSection
        vehicleId={vehicleId}
        csrfToken={csrfToken}
        detail={detail}
        draft={draft.info}
        onDraftChange={(info) => persistDraft((prev) => ({ ...prev, info }))}
        onSaved={setDetail}
      />

      <ActiveSection
        vehicleId={vehicleId}
        csrfToken={csrfToken}
        detail={detail}
        draft={draft.active}
        onDraftChange={(active) => persistDraft((prev) => ({ ...prev, active }))}
        onSaved={setDetail}
      />

      <PasswordResetSection
        vehicleId={vehicleId}
        csrfToken={csrfToken}
        scopeKey={scopeKey}
        detail={detail}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marka/model, yıl, hat/durak notu, not — tek PATCH.
// ---------------------------------------------------------------------------

function InfoSection({
  vehicleId,
  csrfToken,
  detail,
  draft,
  onDraftChange,
  onSaved,
}: {
  vehicleId: string;
  csrfToken: string;
  detail: VehicleDetail;
  draft: DetailDraft["info"];
  onDraftChange: (next: DetailDraft["info"]) => void;
  onSaved: (detail: VehicleDetail) => void;
}) {
  const [isFetching, setIsFetching] = useState(false);
  const phase: "idle" | "submitting" | "ambiguous" = isFetching
    ? "submitting"
    : draft.pending
      ? "ambiguous"
      : "idle";
  const [fieldErrors, setFieldErrors] = useState<{
    brandModel?: string;
    year?: string;
    routeStop?: string;
    note?: string;
  }>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const brandModelRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const routeStopRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Bayat taslak (başka bir sekme/ekip üyesi arada kaydetmiş) İÇERİKLE
  // GÜVENİLMEZ — `!draft.pending` koruması sayesinde sonucu belirsiz
  // (ambiguous) bir taslak asla atılmaz (dondurulmuş gövde/sürüm "Tekrar
  // kontrol et" için gerekir). Yeniden render'da localStorage'a HİÇBİR ŞEY
  // YAZILMAZ — `effective` yalnız bu render için TAZE sunucu değerlerini
  // KULLANIR; taslak, kullanıcı bir alanı değiştirdiğinde veya gönderdiğinde
  // (ilk aşağıdaki iki fonksiyon) GERÇEKTEN üzerine yazılır.
  const stale = isDraftStale({
    baseVersion: draft.baseVersion,
    currentVersion: detail.vehicle.version,
    pending: draft.pending,
  });
  const effective = stale ? emptyDraft(detail).info : draft;

  async function run(body: DetailDraft["info"]): Promise<void> {
    setBanner(null);
    const outcome = await patchVehicle(vehicleId, csrfToken, {
      requestId: body.requestId,
      version: body.baseVersion,
      brandModel: body.brandModel.trim() || null,
      year: body.year.trim() ? Number(body.year) : null,
      routeStop: body.routeStop.trim() || null,
      note: body.note.trim() || null,
    });
    if (outcome.kind === "ambiguous") {
      onDraftChange({ ...body, pending: true });
      return;
    }
    if (outcome.kind === "success") {
      onDraftChange({ ...emptyDraft(outcome.detail).info });
      onSaved(outcome.detail);
      return;
    }
    onDraftChange({ ...body, pending: false });
    if (outcome.status === 422 && outcome.fields) {
      const nextErrors = {
        brandModel: outcome.fields.brandModel,
        year: outcome.fields.year,
        routeStop: outcome.fields.routeStop,
        note: outcome.fields.note,
      };
      if (Object.values(nextErrors).some(Boolean)) {
        setFieldErrors(nextErrors);
        if (nextErrors.brandModel) brandModelRef.current?.focus();
        else if (nextErrors.year) yearRef.current?.focus();
        else if (nextErrors.routeStop) routeStopRef.current?.focus();
        else if (nextErrors.note) noteRef.current?.focus();
        return;
      }
    }
    setBanner(bannerFor(outcome));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase !== "idle") return;
    setFieldErrors({});
    setIsFetching(true);
    const sent = { ...effective, pending: true };
    onDraftChange(sent);
    await run(sent);
    setIsFetching(false);
  }

  function handleChange(field: "brandModel" | "year" | "routeStop" | "note", value: string): void {
    const hadKnownError = Object.values(fieldErrors).some(Boolean) || banner !== null;
    if (hadKnownError) {
      setFieldErrors({});
      setBanner(null);
    }
    onDraftChange({
      ...effective,
      [field]: value,
      requestId: hadKnownError ? randomRequestId() : effective.requestId,
      pending: false,
    });
  }

  const disabled = phase !== "idle";
  const hasChange =
    effective.brandModel.trim() !== (detail.vehicle.brandModel ?? "") ||
    effective.year.trim() !== (detail.vehicle.year !== null ? String(detail.vehicle.year) : "") ||
    effective.routeStop.trim() !== (detail.vehicle.routeStop ?? "") ||
    effective.note.trim() !== (detail.vehicle.note ?? "");

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-[var(--color-text)]">Araç bilgisi</h2>
      {banner && <ErrorBanner banner={banner} />}
      {phase === "ambiguous" && (
        <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          <p>Kaydın sonucu kontrol ediliyor.</p>
          <button
            type="button"
            onClick={async () => {
              setIsFetching(true);
              await run(effective);
              setIsFetching(false);
            }}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)]"
          >
            Tekrar kontrol et
          </button>
        </div>
      )}

      <div>
        <label htmlFor="vehicle-brand-model-edit" className="block text-lg font-medium text-[var(--color-text)]">
          Marka / model
        </label>
        <input
          ref={brandModelRef}
          id="vehicle-brand-model-edit"
          type="text"
          value={effective.brandModel}
          disabled={disabled}
          onChange={(event) => handleChange("brandModel", event.target.value)}
          aria-invalid={fieldErrors.brandModel ? true : undefined}
          aria-describedby={fieldErrors.brandModel ? "vehicle-brand-model-edit-error" : undefined}
          className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] disabled:opacity-70"
        />
        {fieldErrors.brandModel && (
          <p id="vehicle-brand-model-edit-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
            {fieldErrors.brandModel}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="vehicle-year-edit" className="block text-lg font-medium text-[var(--color-text)]">
          Yıl
        </label>
        <input
          ref={yearRef}
          id="vehicle-year-edit"
          type="number"
          inputMode="numeric"
          value={effective.year}
          disabled={disabled}
          onChange={(event) => handleChange("year", event.target.value)}
          aria-invalid={fieldErrors.year ? true : undefined}
          aria-describedby={fieldErrors.year ? "vehicle-year-edit-error" : undefined}
          className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] disabled:opacity-70"
        />
        {fieldErrors.year && (
          <p id="vehicle-year-edit-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
            {fieldErrors.year}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="vehicle-route-stop-edit" className="block text-lg font-medium text-[var(--color-text)]">
          Hat / durak notu
        </label>
        <input
          ref={routeStopRef}
          id="vehicle-route-stop-edit"
          type="text"
          value={effective.routeStop}
          disabled={disabled}
          onChange={(event) => handleChange("routeStop", event.target.value)}
          aria-invalid={fieldErrors.routeStop ? true : undefined}
          aria-describedby={fieldErrors.routeStop ? "vehicle-route-stop-edit-error" : undefined}
          className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] disabled:opacity-70"
        />
        {fieldErrors.routeStop && (
          <p id="vehicle-route-stop-edit-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
            {fieldErrors.routeStop}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="vehicle-note-edit" className="block text-lg font-medium text-[var(--color-text)]">
          Not
        </label>
        <textarea
          ref={noteRef}
          id="vehicle-note-edit"
          rows={3}
          value={effective.note}
          disabled={disabled}
          onChange={(event) => handleChange("note", event.target.value)}
          aria-invalid={fieldErrors.note ? true : undefined}
          aria-describedby={fieldErrors.note ? "vehicle-note-edit-error" : undefined}
          className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 py-2 text-[length:var(--font-size-body)] text-[var(--color-text)] disabled:opacity-70"
        />
        {fieldErrors.note && (
          <p id="vehicle-note-edit-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
            {fieldErrors.note}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={disabled || !hasChange}
        className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] disabled:opacity-70"
      >
        {phase === "submitting" ? "Kaydediliyor…" : "Bilgiyi kaydet"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Aktiflik — pasifleştirme onaylı (ConfirmDialog), yeniden aktifleştirme
// açıklamalı. `../../isletmeler/[id]/business-detail-form.tsx`
// `ActiveSection` İLE AYNI desen.
// ---------------------------------------------------------------------------

function ActiveSection({
  vehicleId,
  csrfToken,
  detail,
  draft,
  onDraftChange,
  onSaved,
}: {
  vehicleId: string;
  csrfToken: string;
  detail: VehicleDetail;
  draft: DetailDraft["active"];
  onDraftChange: (next: DetailDraft["active"]) => void;
  onSaved: (detail: VehicleDetail) => void;
}) {
  const [isFetching, setIsFetching] = useState(false);
  // Aynı bayatlık kuralı Info bölümüyle PAYLAŞILIR (risk notu — "aktiflik
  // taslağının bayat bir hedef taşıyıp taşımadığı" denetimi): `target`
  // (aktif/pasif) her `startAction` tıklamasında TAZE hesaplandığından
  // normalde bayat İÇERİK taşımaz, ama sonucu belirsiz (pending) bir
  // deneme dondurduğu `baseVersion`, dialog açıkken (henüz pending
  // OLMADAN) arada başka bir mini-formun sürümü artırmasıyla bayatlayabilir
  // — bu durumda dialog KENDİLİĞİNDEN kapanır (aşağıdaki `open` denetimi).
  const stale =
    draft !== null &&
    isDraftStale({
      baseVersion: draft.baseVersion,
      currentVersion: detail.vehicle.version,
      pending: draft.pending,
    });
  const effective = stale ? null : draft;
  const phase: "idle" | "submitting" | "ambiguous" = isFetching
    ? "submitting"
    : effective?.pending
      ? "ambiguous"
      : "idle";
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function run(body: NonNullable<DetailDraft["active"]>): Promise<void> {
    setBanner(null);
    const outcome = await patchVehicle(vehicleId, csrfToken, {
      requestId: body.requestId,
      version: body.baseVersion,
      active: body.target,
    });
    if (outcome.kind === "ambiguous") {
      onDraftChange({ ...body, pending: true });
      return;
    }
    if (outcome.kind === "success") {
      onDraftChange(null);
      onSaved(outcome.detail);
      return;
    }
    onDraftChange({ ...body, pending: false });
    setBanner(bannerFor(outcome));
  }

  async function startAction(target: boolean): Promise<void> {
    const body: NonNullable<DetailDraft["active"]> = {
      requestId: randomRequestId(),
      target,
      pending: false,
      baseVersion: detail.vehicle.version,
    };
    if (target) {
      const sent = { ...body, pending: true };
      onDraftChange(sent);
      setIsFetching(true);
      await run(sent);
      setIsFetching(false);
    } else {
      onDraftChange(body);
      setDialogOpen(true);
    }
  }

  async function confirmDeactivate(): Promise<void> {
    setDialogOpen(false);
    if (!effective) return;
    const sent = { ...effective, pending: true };
    onDraftChange(sent);
    setIsFetching(true);
    await run(sent);
    setIsFetching(false);
  }

  const disabled = phase !== "idle";

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--color-divider)] pt-6">
      <h2 className="text-xl font-semibold text-[var(--color-text)]">Aktiflik</h2>
      {banner && <ErrorBanner banner={banner} />}
      {phase === "ambiguous" && effective && (
        <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          <p>Kaydın sonucu kontrol ediliyor.</p>
          <button
            type="button"
            onClick={async () => {
              setIsFetching(true);
              await run(effective);
              setIsFetching(false);
            }}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)]"
          >
            Tekrar kontrol et
          </button>
        </div>
      )}

      {detail.vehicle.active ? (
        <>
          <p className="text-base text-[var(--color-text-secondary)]">
            Aracı pasifleştirmek sahip ve şoför oturum erişimini keser. Geçmiş kayıtlar silinmez.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => startAction(false)}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] bg-[var(--color-error)] px-4 text-base font-semibold text-white disabled:opacity-70"
          >
            {phase === "submitting" && effective?.target === false ? "Pasifleştiriliyor…" : "Aracı pasifleştir"}
          </button>
        </>
      ) : (
        <>
          <p className="text-base text-[var(--color-text-secondary)]">
            Araç tekrar aktif olur. Sahip ve şoför oturumları kendiliğinden geri gelmez; gerekiyorsa
            tekrar giriş yapılmalıdır.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => startAction(true)}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] disabled:opacity-70"
          >
            {phase === "submitting" && effective?.target === true ? "Aktifleştiriliyor…" : "Aracı yeniden aktifleştir"}
          </button>
        </>
      )}

      <ConfirmDialog
        open={dialogOpen && effective !== null}
        title="Aracı pasifleştir"
        description={
          <div className="flex flex-col gap-2">
            <p>
              <strong>{formatPlateForDisplay(detail.vehicle.plateNormalized)}</strong> pasifleşince
              sahip ve şoför oturum açamaz hale gelir.
            </p>
            <p>Geçmiş kayıtlar silinmez; araç sonradan yeniden aktifleştirilebilir.</p>
          </div>
        }
        confirmLabel="Pasifleştir"
        danger
        isSubmitting={phase === "submitting"}
        onConfirm={confirmDeactivate}
        onCancel={() => {
          setDialogOpen(false);
          onDraftChange(null);
        }}
      />
    </div>
  );
}
