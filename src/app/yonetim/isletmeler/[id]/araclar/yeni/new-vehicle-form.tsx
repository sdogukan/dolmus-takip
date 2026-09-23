"use client";

/**
 * Yeni araç oluşturma formu (istemci bileşeni) — T2.2, S2.2.
 *
 * `../new-business-form.tsx`'in (bkz. o dosyanın üst notu — dosya üstü
 * "ARCHITECTURE §3.4" açıklaması BİREBİR burada da geçerlidir: aynı
 * `requestId`nin korunması, belirsiz sonuçta dondurma, kesin sonuçtan
 * sonraki değişiklikte yeni `requestId`) AYNI deseni izler — TEK fark, bu
 * formun İKİ GİZLİ alanı (mal sahibi/şoför şifresi) taşımasıdır.
 *
 * ## Şifreler taslakta ASLA saklanmaz (risk notu)
 *
 * `useStoredDraft` yalnız GİZLİ OLMAYAN alanları (`plate`/`brandModel`/
 * `year`/`routeStop`/`note`/`requestId`/`pending`) taşır — `ownerPassword`/
 * `driverPassword` YALNIZ bu bileşenin React `useState`'inde tutulur, hiçbir
 * zaman `localStorage`'a (`useStoredDraft` → `../../../../../../lib/
 * client-state.ts`), URL'e veya konsola yazılmaz. Sayfa yenilenip taslak
 * "ambiguous" (sonucu belirsiz) durumda geri yüklendiğinde şifre alanları
 * BOŞ başlar — `createVehicle`'ın (`../../../../../../server/usecases/
 * admin-vehicles/create-vehicle.ts`) tekrar gönderim yolu, bilinen bir
 * makbuzla karşılaşınca gönderilen şifreleri saklanan özetlere karşı
 * DOĞRULAR (eşleşmezse 409 REQUEST_ID_REUSED); bu yüzden "Tekrar kontrol
 * et" ekip üyesinin HER İKİ şifreyi yeniden girmesini GEREKTİRİR — aksi
 * halde aynı `requestId` boş/yanlış şifreyle gönderilip 409'a düşer.
 */
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ClientStateScope } from "../../../../../../lib/client-state";
import { useStoredDraft } from "../../../../../../lib/use-stored-draft";
import { getErrorMessage } from "../../../../../../lib/messages";

interface Draft {
  requestId: string;
  plate: string;
  brandModel: string;
  year: string;
  routeStop: string;
  note: string;
  pending: boolean;
}

function randomRequestId(): string {
  return crypto.randomUUID();
}

function emptyDraft(): Draft {
  return {
    requestId: randomRequestId(),
    plate: "",
    brandModel: "",
    year: "",
    routeStop: "",
    note: "",
    pending: false,
  };
}

interface FieldErrors {
  plate?: string;
  brandModel?: string;
  year?: string;
  routeStop?: string;
  note?: string;
  ownerPassword?: string;
  driverPassword?: string;
}

interface CreateSuccessBody {
  vehicle?: { id?: unknown };
}

interface CreateErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
}

export function NewVehicleForm({
  businessId,
  businessName,
  ownerFullName,
  csrfToken,
  scopeKey,
}: {
  businessId: string;
  businessName: string;
  ownerFullName: string;
  csrfToken: string;
  scopeKey: string;
}) {
  const router = useRouter();
  const scope: ClientStateScope = { scopeKey };
  const draftName = `arac-yeni-${businessId}`;

  const [draft, persist] = useStoredDraft<Draft>(scope, draftName, emptyDraft);
  // Gizli alanlar — dosya üstü notu: taslakta ASLA saklanmaz.
  const [ownerPassword, setOwnerPassword] = useState("");
  const [driverPassword, setDriverPassword] = useState("");
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);
  const [showDriverPassword, setShowDriverPassword] = useState(false);

  const [isFetching, setIsFetching] = useState(false);
  const phase: "idle" | "submitting" | "ambiguous" = isFetching
    ? "submitting"
    : draft.pending
      ? "ambiguous"
      : "idle";
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const plateInputRef = useRef<HTMLInputElement>(null);
  const brandModelInputRef = useRef<HTMLInputElement>(null);
  const yearInputRef = useRef<HTMLInputElement>(null);
  const routeStopInputRef = useRef<HTMLInputElement>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const ownerPasswordInputRef = useRef<HTMLInputElement>(null);
  const driverPasswordInputRef = useRef<HTMLInputElement>(null);

  function focusFirstInvalid(errors: FieldErrors): void {
    if (errors.plate) return plateInputRef.current?.focus();
    if (errors.brandModel) return brandModelInputRef.current?.focus();
    if (errors.year) return yearInputRef.current?.focus();
    if (errors.routeStop) return routeStopInputRef.current?.focus();
    if (errors.note) return noteInputRef.current?.focus();
    if (errors.ownerPassword) return ownerPasswordInputRef.current?.focus();
    if (errors.driverPassword) return driverPasswordInputRef.current?.focus();
  }

  async function sendCreateRequest(
    body: Draft,
    ownerPw: string,
    driverPw: string,
  ): Promise<void> {
    setFormError(null);
    let response: Response;
    try {
      response = await fetch("/api/v1/admin/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({
          requestId: body.requestId,
          businessRef: businessId,
          plate: body.plate,
          brandModel: body.brandModel.trim() || undefined,
          year: body.year.trim() ? Number(body.year) : undefined,
          routeStop: body.routeStop.trim() || undefined,
          note: body.note.trim() || undefined,
          ownerPassword: ownerPw,
          driverPassword: driverPw,
        }),
      });
    } catch {
      // Gönderim SIRASINDA koptu — sunucuya ULAŞIP ULAŞMADIĞI bilinmiyor.
      persist({ ...body, pending: true });
      return;
    }

    let responseBody: (CreateSuccessBody & CreateErrorBody) | undefined;
    try {
      responseBody = (await response.json()) as CreateSuccessBody & CreateErrorBody;
    } catch {
      persist({ ...body, pending: true });
      return;
    }

    if (response.ok) {
      const vehicleId = responseBody?.vehicle?.id;
      persist(emptyDraft());
      // Kaydedilmiş şifreler ekranda BİR DAHA gösterilmez — temizlenir.
      setOwnerPassword("");
      setDriverPassword("");
      if (typeof vehicleId === "string") {
        router.push(`/yonetim/araclar/${vehicleId}`);
      } else {
        router.push(`/yonetim/isletmeler/${businessId}`);
      }
      return;
    }

    persist({ ...body, pending: false });

    if (response.status === 422) {
      const fields = responseBody?.error?.fields ?? {};
      const nextErrors: FieldErrors = {
        plate: fields.plate,
        brandModel: fields.brandModel,
        year: fields.year,
        routeStop: fields.routeStop,
        note: fields.note,
        ownerPassword: fields.ownerPassword,
        driverPassword: fields.driverPassword,
      };
      setFieldErrors(nextErrors);
      if (Object.values(nextErrors).some(Boolean)) {
        focusFirstInvalid(nextErrors);
        return;
      }
    }

    if (response.status >= 500) {
      setFormError("Bağlantı kurulamadı. Tekrar dene.");
      return;
    }

    const code = responseBody?.error?.code;
    setFormError((code ? getErrorMessage(code) : undefined) ?? "Bağlantı kurulamadı. Tekrar dene.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase !== "idle") {
      return;
    }
    if (!navigator.onLine) {
      setFormError("Bağlantı yok. Henüz kaydedilmedi.");
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setIsFetching(true);
    const sent = { ...draft, pending: true };
    persist(sent);
    await sendCreateRequest(sent, ownerPassword, driverPassword);
    setIsFetching(false);
  }

  async function handleRetryCheck(): Promise<void> {
    setIsFetching(true);
    await sendCreateRequest(draft, ownerPassword, driverPassword);
    setIsFetching(false);
  }

  function handleFieldChange(field: keyof Omit<Draft, "requestId" | "pending">, value: string): void {
    const hadKnownError = Object.values(fieldErrors).some(Boolean);
    const next: Draft = {
      ...draft,
      [field]: value,
      requestId: hadKnownError ? randomRequestId() : draft.requestId,
      pending: false,
    };
    if (hadKnownError) {
      setFieldErrors({});
    }
    persist(next);
  }

  function handlePasswordChange(role: "owner" | "driver", value: string): void {
    const hadKnownError = Object.values(fieldErrors).some(Boolean);
    if (hadKnownError) {
      setFieldErrors({});
      persist({ ...draft, requestId: randomRequestId(), pending: false });
    }
    if (role === "owner") {
      setOwnerPassword(value);
    } else {
      setDriverPassword(value);
    }
  }

  const disabled = phase !== "idle";
  const canRetry = phase === "ambiguous" && ownerPassword.trim() !== "" && driverPassword.trim() !== "";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">Araç ekle</h1>
        <p className="mt-1 text-base text-[var(--color-text-secondary)]">
          {businessName} · Sahip: {ownerFullName}
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate aria-busy={phase === "submitting"} className="flex flex-col gap-6">
        {formError && (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base break-words text-[var(--color-error)]"
          >
            {formError}
          </p>
        )}

        {phase === "ambiguous" && (
          <div
            role="status"
            className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]"
          >
            <p>Kaydın sonucu kontrol ediliyor. Devam etmek için sahip ve şoför şifresini tekrar gir.</p>
          </div>
        )}

        <div>
          <label htmlFor="vehicle-plate" className="block text-lg font-medium text-[var(--color-text)]">
            Plaka
          </label>
          <input
            ref={plateInputRef}
            id="vehicle-plate"
            name="plate"
            type="text"
            value={draft.plate}
            disabled={disabled}
            onChange={(event) => handleFieldChange("plate", event.target.value)}
            aria-invalid={fieldErrors.plate ? true : undefined}
            aria-describedby={fieldErrors.plate ? "vehicle-plate-error" : undefined}
            className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
          />
          {fieldErrors.plate && (
            <p id="vehicle-plate-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
              {fieldErrors.plate}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="vehicle-brand-model" className="block text-lg font-medium text-[var(--color-text)]">
            Marka / model
          </label>
          <input
            ref={brandModelInputRef}
            id="vehicle-brand-model"
            name="brandModel"
            type="text"
            value={draft.brandModel}
            disabled={disabled}
            onChange={(event) => handleFieldChange("brandModel", event.target.value)}
            aria-invalid={fieldErrors.brandModel ? true : undefined}
            aria-describedby={fieldErrors.brandModel ? "vehicle-brand-model-error" : undefined}
            className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
          />
          {fieldErrors.brandModel && (
            <p id="vehicle-brand-model-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
              {fieldErrors.brandModel}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="vehicle-year" className="block text-lg font-medium text-[var(--color-text)]">
            Yıl
          </label>
          <input
            ref={yearInputRef}
            id="vehicle-year"
            name="year"
            type="number"
            inputMode="numeric"
            value={draft.year}
            disabled={disabled}
            onChange={(event) => handleFieldChange("year", event.target.value)}
            aria-invalid={fieldErrors.year ? true : undefined}
            aria-describedby={fieldErrors.year ? "vehicle-year-error" : undefined}
            className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
          />
          {fieldErrors.year && (
            <p id="vehicle-year-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
              {fieldErrors.year}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="vehicle-route-stop" className="block text-lg font-medium text-[var(--color-text)]">
            Hat / durak notu
          </label>
          <input
            ref={routeStopInputRef}
            id="vehicle-route-stop"
            name="routeStop"
            type="text"
            value={draft.routeStop}
            disabled={disabled}
            onChange={(event) => handleFieldChange("routeStop", event.target.value)}
            aria-invalid={fieldErrors.routeStop ? true : undefined}
            aria-describedby={fieldErrors.routeStop ? "vehicle-route-stop-error" : undefined}
            className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
          />
          {fieldErrors.routeStop && (
            <p id="vehicle-route-stop-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
              {fieldErrors.routeStop}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="vehicle-note" className="block text-lg font-medium text-[var(--color-text)]">
            Not
          </label>
          <textarea
            ref={noteInputRef}
            id="vehicle-note"
            name="note"
            rows={3}
            value={draft.note}
            disabled={disabled}
            onChange={(event) => handleFieldChange("note", event.target.value)}
            aria-invalid={fieldErrors.note ? true : undefined}
            aria-describedby={fieldErrors.note ? "vehicle-note-error" : undefined}
            className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 py-2 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
          />
          {fieldErrors.note && (
            <p id="vehicle-note-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
              {fieldErrors.note}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="vehicle-owner-password" className="block text-lg font-medium text-[var(--color-text)]">
            Sahip şifresi
          </label>
          <div className="mt-1 flex items-stretch gap-2">
            <input
              ref={ownerPasswordInputRef}
              id="vehicle-owner-password"
              name="ownerPassword"
              type={showOwnerPassword ? "text" : "password"}
              autoComplete="new-password"
              value={ownerPassword}
              disabled={phase === "submitting"}
              onChange={(event) => handlePasswordChange("owner", event.target.value)}
              aria-invalid={fieldErrors.ownerPassword ? true : undefined}
              aria-describedby={fieldErrors.ownerPassword ? "vehicle-owner-password-error" : undefined}
              className="min-h-[var(--control-min-height)] w-full flex-1 rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
            />
            <button
              type="button"
              onClick={() => setShowOwnerPassword((prev) => !prev)}
              aria-pressed={showOwnerPassword}
              className="min-h-[var(--control-min-height)] min-w-[3rem] shrink-0 rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-3 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              {showOwnerPassword ? "Gizle" : "Göster"}
            </button>
          </div>
          {fieldErrors.ownerPassword && (
            <p id="vehicle-owner-password-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
              {fieldErrors.ownerPassword}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="vehicle-driver-password" className="block text-lg font-medium text-[var(--color-text)]">
            Şoför şifresi
          </label>
          <div className="mt-1 flex items-stretch gap-2">
            <input
              ref={driverPasswordInputRef}
              id="vehicle-driver-password"
              name="driverPassword"
              type={showDriverPassword ? "text" : "password"}
              autoComplete="new-password"
              value={driverPassword}
              disabled={phase === "submitting"}
              onChange={(event) => handlePasswordChange("driver", event.target.value)}
              aria-invalid={fieldErrors.driverPassword ? true : undefined}
              aria-describedby={fieldErrors.driverPassword ? "vehicle-driver-password-error" : undefined}
              className="min-h-[var(--control-min-height)] w-full flex-1 rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
            />
            <button
              type="button"
              onClick={() => setShowDriverPassword((prev) => !prev)}
              aria-pressed={showDriverPassword}
              className="min-h-[var(--control-min-height)] min-w-[3rem] shrink-0 rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-3 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              {showDriverPassword ? "Gizle" : "Göster"}
            </button>
          </div>
          {fieldErrors.driverPassword && (
            <p id="vehicle-driver-password-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
              {fieldErrors.driverPassword}
            </p>
          )}
        </div>

        <p aria-live="polite" className="sr-only">
          {phase === "submitting" ? "Kaydediliyor…" : ""}
        </p>

        {phase === "ambiguous" ? (
          <button
            type="button"
            onClick={handleRetryCheck}
            disabled={!canRetry}
            className="min-h-[var(--primary-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] text-lg font-semibold text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
          >
            Tekrar kontrol et
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled}
            aria-busy={phase === "submitting"}
            className="min-h-[var(--primary-min-height)] w-full rounded-[var(--radius-control)] bg-[var(--color-primary)] text-lg font-semibold text-[var(--color-on-primary)] transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
          >
            {phase === "submitting" ? "Kaydediliyor…" : "Aracı kaydet"}
          </button>
        )}
      </form>
    </div>
  );
}
