"use client";

/**
 * Araç şifre sıfırlama bölümü (istemci bileşeni) — T2.3, S2.3.
 *
 * `./vehicle-detail-form.tsx`'in InfoSection/ActiveSection'ı İLE AYNI
 * mini-form deseni (kendi requestId'si, belirsiz sonuçta alanları
 * dondurma, `../../isletmeler/[id]/business-detail-form.tsx` `bannerFor`
 * kuralı) ama GİZLİ bir alan (newPassword) taşıdığından asıl kilit/tekrar-
 * gönderim kalıbını `../isletmeler/[id]/araclar/yeni/new-vehicle-form.tsx`
 * `submittedPasswords`'ten alır (bkz. o dosyanın üst notu) — TEK fark,
 * burada TEK gizli alan ve bir erişim seçimi (owner/driver) olmasıdır.
 *
 * Sıfırlama `vehicles.version`'ı DEĞİŞTİRMEZ (`../../../../server/
 * usecases/admin-vehicles/reset-vehicle-password.ts` üst notu) — bu
 * yüzden kendi taslağı Info/Active bölümlerinin `baseVersion`/
 * `isDraftStale` mekanizmasına HİÇ dokunmaz, tamamen ayrı bir
 * `useStoredDraft` anahtarı kullanır.
 *
 * ## Yeni şifre taslakta ASLA saklanmaz (risk notu)
 *
 * `useStoredDraft` yalnız GİZLİ OLMAYAN alanları (`requestId`/`access`/
 * `pending`) taşır — `newPassword` YALNIZ bu bileşenin React `useState`'inde
 * tutulur, hiçbir zaman `localStorage`'a, URL'e veya konsola yazılmaz.
 * Sayfa yenilenip taslak "ambiguous" durumda geri yüklendiğinde şifre alanı
 * BOŞ başlar; sunucunun tekrar gönderim doğrulaması (`resetVehiclePassword`
 * → `verifyReplayNewPassword`) bilinen bir makbuzla karşılaşınca gönderilen
 * şifreyi saklanan (sıfırlama SONRASI) özete karşı DOĞRULAR — bu yüzden
 * "Tekrar kontrol et" şifrenin YENİDEN girilmesini GEREKTİRİR. `access`
 * gizli olmadığından (plaka/marka gibi) normal taslak alanları gibi
 * PATCH/reload sırasında hep devre dışı (disabled) bırakılır — yalnız
 * şifre alanı, bellekteki gönderilmiş çiftin VARLIĞINA göre ayrıca kilitli.
 */
import { useRef, useState, type FormEvent } from "react";
import type { ClientStateScope } from "../../../../lib/client-state";
import { useStoredDraft } from "../../../../lib/use-stored-draft";
import { getErrorMessage } from "../../../../lib/messages";
import { formatPlateForDisplay } from "../../../../lib/plate";
import type { VehicleDetail } from "./vehicle-detail-form";

export type VehicleAccessRole = "owner" | "driver";

/** S2.3 AC1 — ekranda BİREBİR bu iki etiket görünmelidir. */
const ACCESS_LABELS: Record<VehicleAccessRole, string> = {
  owner: "Mal sahibi şifresi",
  driver: "Şoför şifresi",
};

interface ResetDraft {
  requestId: string;
  access: VehicleAccessRole | null;
  pending: boolean;
}

function randomRequestId(): string {
  return crypto.randomUUID();
}

function emptyDraft(): ResetDraft {
  return { requestId: randomRequestId(), access: null, pending: false };
}

interface FieldErrors {
  access?: string;
  newPassword?: string;
}

interface ResetSuccessBody {
  access?: VehicleAccessRole;
  vehicle?: { plateNormalized?: unknown };
}

interface ResetErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
}

interface Banner {
  message: string;
  code?: string;
}

/** Alan-dışı (409/403/429/5xx/ağ) bir hatayı ekran metnine çevirir —
 * `./vehicle-detail-form.tsx` `bannerFor` İLE AYNI kural (sunucunun
 * `error.message`'ı BASILMAZ, kod → Türkçe metin `../../../../lib/
 * messages.ts`'ten). */
function bannerFor(status: number, code: string | undefined): Banner {
  const message =
    status >= 500
      ? "Bağlantı kurulamadı. Tekrar dene."
      : (code ? getErrorMessage(code) : undefined) ?? "Bağlantı kurulamadı. Tekrar dene.";
  return { message, code };
}

export function PasswordResetSection({
  vehicleId,
  csrfToken,
  scopeKey,
  detail,
}: {
  vehicleId: string;
  csrfToken: string;
  scopeKey: string;
  detail: VehicleDetail;
}) {
  const scope: ClientStateScope = { scopeKey };
  const draftName = `arac-sifre-${vehicleId}`;
  const [draft, persist] = useStoredDraft<ResetDraft>(scope, draftName, emptyDraft);

  // Gizli alan — dosya üstü notu: taslakta ASLA saklanmaz.
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Bu oturumda GÖNDERİLMİŞ (erişim, şifre) çifti — yalnız bellekte, taslağa
  // ASLA yazılmaz. `../isletmeler/[id]/araclar/yeni/new-vehicle-form.tsx`
  // `submittedPasswords`'ün AYNISI: kilit ve "Tekrar kontrol et" bu çiftin
  // VARLIĞINA bakar, girdi DEĞERİNE değil.
  const [submitted, setSubmitted] = useState<{ access: VehicleAccessRole; password: string } | null>(
    null,
  );

  const [isFetching, setIsFetching] = useState(false);
  const phase: "idle" | "submitting" | "ambiguous" = isFetching
    ? "submitting"
    : draft.pending
      ? "ambiguous"
      : "idle";
  const [banner, setBanner] = useState<Banner | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Risk notu — pasif araç/işletme: bölüm sıfırlamayı sunmaz, sunucuya hiç
  // gönderilmez (sunucu yine de 403 TARGET_INACTIVE_FOR_WRITE ile korur).
  const inactive = !detail.vehicle.active || !detail.business.active;

  function hadKnownResult(): boolean {
    return Object.values(fieldErrors).some(Boolean) || banner !== null;
  }

  function handleAccessChange(next: VehicleAccessRole): void {
    const hadKnownError = hadKnownResult();
    if (hadKnownError) {
      setFieldErrors({});
      setBanner(null);
    }
    setSuccessMessage(null);
    persist({
      requestId: hadKnownError ? randomRequestId() : draft.requestId,
      access: next,
      pending: false,
    });
  }

  function handlePasswordChange(value: string): void {
    const hadKnownError = hadKnownResult();
    if (hadKnownError) {
      setFieldErrors({});
      setBanner(null);
      persist({ ...draft, requestId: randomRequestId(), pending: false });
    }
    setSuccessMessage(null);
    setNewPassword(value);
  }

  async function sendResetRequest(
    body: ResetDraft,
    access: VehicleAccessRole,
    password: string,
  ): Promise<void> {
    setBanner(null);
    let response: Response;
    try {
      response = await fetch(`/api/v1/admin/vehicles/${vehicleId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ requestId: body.requestId, access, newPassword: password }),
      });
    } catch {
      // Gönderim SIRASINDA koptu — sunucuya ULAŞIP ULAŞMADIĞI bilinmiyor.
      persist({ ...body, access, pending: true });
      return;
    }

    let responseBody: (ResetSuccessBody & ResetErrorBody) | undefined;
    try {
      responseBody = (await response.json()) as ResetSuccessBody & ResetErrorBody;
    } catch {
      persist({ ...body, access, pending: true });
      return;
    }

    if (response.ok) {
      const plateNormalized = responseBody?.vehicle?.plateNormalized;
      const plate = typeof plateNormalized === "string" ? formatPlateForDisplay(plateNormalized) : "";
      const roleLabel = ACCESS_LABELS[responseBody?.access ?? access];
      persist(emptyDraft());
      // Sıfırlanan şifre ekranda BİR DAHA gösterilmez — temizlenir.
      setNewPassword("");
      setShowPassword(false);
      setSubmitted(null);
      setFieldErrors({});
      // DESIGN §2.9 / TECH-STACK "Şifre teslimi" — plaka + değişen erişim
      // adı, kapatılan oturumlar ve elden teslim uyarısı TEK cümlede.
      setSuccessMessage(
        `${plate} · ${roleLabel} değiştirildi. Bu erişimin açık oturumları kapatıldı. Yeni şifreyi müşteriye WhatsApp üzerinden kendin ilet; uygulama otomatik mesaj göndermez.`,
      );
      return;
    }

    persist({ ...body, access, pending: false });
    // Buradan sonraki her dal KESİN bir sonuçtur (pending: false yazıldı) —
    // bellekteki gönderilmiş çift artık geçersiz.
    setSubmitted(null);

    if (response.status === 422) {
      const fields = responseBody?.error?.fields ?? {};
      const nextErrors: FieldErrors = { access: fields.access, newPassword: fields.newPassword };
      if (Object.values(nextErrors).some(Boolean)) {
        setFieldErrors(nextErrors);
        if (nextErrors.newPassword) passwordInputRef.current?.focus();
        return;
      }
    }

    setBanner(bannerFor(response.status, responseBody?.error?.code));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase !== "idle" || inactive || !draft.access) return;
    setFieldErrors({});
    setBanner(null);
    setIsFetching(true);
    setSubmitted({ access: draft.access, password: newPassword });
    const sent = { ...draft, pending: true };
    persist(sent);
    await sendResetRequest(sent, draft.access, newPassword);
    setIsFetching(false);
  }

  async function handleRetryCheck(): Promise<void> {
    if (!draft.access) return;
    setIsFetching(true);
    // Bellekteki çift VARSA (sayfa yenilenmedi) AYNEN o gönderilir; YOKSA
    // (sayfa yenilendi) ekip üyesinin az önce yeniden yazdığı şifre
    // gönderilir — gönderilecek çift, göndermeden ÖNCE bellekte kaydedilir
    // (`new-vehicle-form.tsx` C5 düzeltmesiyle AYNI gerekçe: bu retry'ın
    // yanıtı da kaybolursa bir SONRAKİ retry hâlâ doğru çifti bilir).
    const pair = submitted ?? { access: draft.access, password: newPassword };
    setSubmitted(pair);
    await sendResetRequest(draft, pair.access, pair.password);
    setIsFetching(false);
  }

  const disabled = phase !== "idle";
  const hasSubmittedPair = submitted !== null;
  const passwordLocked = phase === "submitting" || (phase === "ambiguous" && hasSubmittedPair);
  const canRetry = phase === "ambiguous" && newPassword.trim() !== "";
  const canSubmit = phase === "idle" && draft.access !== null && !inactive;

  return (
    <div id="sifre-sifirlama" className="flex flex-col gap-3 border-t border-[var(--color-divider)] pt-6">
      <h2 className="text-xl font-semibold text-[var(--color-text)]">Şifre sıfırlama</h2>
      <p className="text-base text-[var(--color-text-secondary)]">
        {detail.business.name} · {formatPlateForDisplay(detail.vehicle.plateNormalized)}
      </p>

      {inactive ? (
        <p className="text-base text-[var(--color-text-secondary)]">
          Araç veya işletme pasif; şifre sıfırlanamaz.
        </p>
      ) : (
        <form
          onSubmit={handleSubmit}
          noValidate
          aria-busy={phase === "submitting"}
          className="flex flex-col gap-4"
        >
          {successMessage && (
            <p
              role="status"
              className="rounded-[var(--radius-control)] bg-[var(--color-success-surface)] px-3 py-2 text-base break-words text-[var(--color-success)]"
            >
              {successMessage}
            </p>
          )}

          {banner && (
            <p
              role="alert"
              className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base break-words text-[var(--color-error)]"
            >
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
          )}

          {phase === "ambiguous" && (
            <div
              role="status"
              className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]"
            >
              <p>
                Kaydın sonucu kontrol ediliyor.
                {!hasSubmittedPair && " Devam etmek için yeni şifreyi tekrar gir."}
              </p>
            </div>
          )}

          <div role="radiogroup" aria-label="Sıfırlanacak erişim" className="flex flex-col gap-2">
            {(Object.keys(ACCESS_LABELS) as VehicleAccessRole[]).map((role) => (
              <label
                key={role}
                className={`flex min-h-[var(--control-min-height)] items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-3 text-lg font-medium text-[var(--color-text)] ${disabled ? "opacity-70" : ""}`}
              >
                <input
                  type="radio"
                  name="reset-access"
                  value={role}
                  checked={draft.access === role}
                  disabled={disabled}
                  onChange={() => handleAccessChange(role)}
                  className="h-5 w-5"
                />
                {ACCESS_LABELS[role]}
              </label>
            ))}
          </div>
          {fieldErrors.access && (
            <p role="alert" className="text-base text-[var(--color-error)]">
              {fieldErrors.access}
            </p>
          )}

          <p className="text-base text-[var(--color-text-secondary)]">
            Yalnız seçtiğin erişimin açık oturumları kapatılır; diğer erişim etkilenmez.
          </p>

          <div>
            <label htmlFor="vehicle-reset-password" className="block text-lg font-medium text-[var(--color-text)]">
              Yeni şifre
            </label>
            <div className="mt-1 flex items-stretch gap-2">
              <input
                ref={passwordInputRef}
                id="vehicle-reset-password"
                name="newPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={newPassword}
                disabled={passwordLocked}
                onChange={(event) => handlePasswordChange(event.target.value)}
                aria-invalid={fieldErrors.newPassword ? true : undefined}
                aria-describedby={fieldErrors.newPassword ? "vehicle-reset-password-error" : undefined}
                className="min-h-[var(--control-min-height)] w-full flex-1 rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-pressed={showPassword}
                className="min-h-[var(--control-min-height)] min-w-[3rem] shrink-0 rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-3 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                {showPassword ? "Gizle" : "Göster"}
              </button>
            </div>
            {fieldErrors.newPassword && (
              <p id="vehicle-reset-password-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
                {fieldErrors.newPassword}
              </p>
            )}
          </div>

          <p aria-live="polite" className="sr-only">
            {phase === "submitting" ? "Sıfırlanıyor…" : ""}
          </p>

          {phase === "ambiguous" ? (
            <button
              type="button"
              onClick={handleRetryCheck}
              disabled={!canRetry}
              className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
            >
              Tekrar kontrol et
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSubmit}
              aria-busy={phase === "submitting"}
              className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
            >
              {phase === "submitting" ? "Sıfırlanıyor…" : "Şifreyi sıfırla"}
            </button>
          )}
        </form>
      )}
    </div>
  );
}
