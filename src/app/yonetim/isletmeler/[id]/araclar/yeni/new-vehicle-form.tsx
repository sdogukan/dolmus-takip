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
import Link from "next/link";
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

/** Alan-dışı (409/403/429/5xx/ağ) bir hatayı ekran metnine çevirir — sunucunun
 * `error.message`'ı BASILMAZ (sözleşme). `code` yalnız `REQUEST_ID_REUSED`
 * için (aşağıdaki bağlantıyı göstermek üzere) SAKLANIR. */
interface FormBanner {
  message: string;
  code?: string;
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
  // C4 düzeltmesi — bu oturumda GÖNDERİLMİŞ şifre çifti (yalnız bellekte,
  // dosya üstü notu — persist()/draft'a asla yazılmaz). `handleSubmit`te
  // KURULUR, başarıda ve HER kesin (ambiguous olmayan) yanıtta TEMİZLENİR.
  // Kilit ve "Tekrar kontrol et" bu çiftin VARLIĞINA bakar — girdi
  // DEĞERİNE değil (bkz. aşağıdaki `ownerPasswordLocked` notu).
  const [submittedPasswords, setSubmittedPasswords] = useState<{
    owner: string;
    driver: string;
  } | null>(null);

  const [isFetching, setIsFetching] = useState(false);
  const phase: "idle" | "submitting" | "ambiguous" = isFetching
    ? "submitting"
    : draft.pending
      ? "ambiguous"
      : "idle";
  const [formError, setFormError] = useState<FormBanner | null>(null);
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
      setSubmittedPasswords(null);
      if (typeof vehicleId === "string") {
        router.push(`/yonetim/araclar/${vehicleId}`);
      } else {
        router.push(`/yonetim/isletmeler/${businessId}`);
      }
      return;
    }

    persist({ ...body, pending: false });
    // Buradan sonraki her dal KESİN bir sonuçtur (pending: false yazıldı) —
    // bellekteki gönderilmiş çift artık geçersiz: bir sonraki deneme ya yeni
    // bir `handleSubmit` ya da (sayfa yenilenmeden) hâlâ dolu input
    // state'inden okur.
    setSubmittedPasswords(null);

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
      setFormError({ message: "Bağlantı kurulamadı. Tekrar dene." });
      return;
    }

    const code = responseBody?.error?.code;
    // 409 REQUEST_ID_REUSED burada — `../../../../../../server/usecases/
    // admin-vehicles/create-vehicle.ts` risk notu — İKİ ayrı durumu
    // kapsayabilir: aynı requestId FARKLI içerikle (gerçek çakışma) veya
    // AYNI içerikle ama tekrar denemede FARKLI parolalarla (bkz. dosya üstü
    // notu). Her iki durumda da araç muhtemelen ZATEN oluşturulmuştur —
    // `../../../../../../lib/messages.ts`'in genel ("sayfayı yenile") PATCH
    // metni burada YANILTICIDIR (bu form yenilenince BOŞ bir taslağa döner,
    // sürüm çakışması yoktur); işletme sayfasına bağlantı veren bu form-özgü
    // metin KULLANILIR, genel `ERROR_CODE_MESSAGES.REQUEST_ID_REUSED` metni
    // DEĞİL.
    const message =
      code === "REQUEST_ID_REUSED"
        ? "Bu araç zaten oluşturulmuş olabilir. İşletme sayfasından kontrol et."
        : (code ? getErrorMessage(code) : undefined) ?? "Bağlantı kurulamadı. Tekrar dene.";
    setFormError({ message, code });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase !== "idle") {
      return;
    }
    if (!navigator.onLine) {
      setFormError({ message: "Bağlantı yok. Henüz kaydedilmedi." });
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setIsFetching(true);
    // C4 düzeltmesi — az önce gönderilen çift, sonucu bilinene kadar
    // bellekte SAKLANIR (dosya üstü notu); kilit ve retry bunu okur.
    setSubmittedPasswords({ owner: ownerPassword, driver: driverPassword });
    const sent = { ...draft, pending: true };
    persist(sent);
    await sendCreateRequest(sent, ownerPassword, driverPassword);
    setIsFetching(false);
  }

  async function handleRetryCheck(): Promise<void> {
    setIsFetching(true);
    // Bellekteki çift VARSA (sayfa yenilenmedi) AYNEN o gönderilir; YOKSA
    // (sayfa yenilendi, dosya üstü notu) ekip üyesinin az önce yeniden
    // yazdığı şifreler gönderilir.
    const { owner: ownerPw, driver: driverPw } = submittedPasswords ?? {
      owner: ownerPassword,
      driver: driverPassword,
    };
    await sendCreateRequest(draft, ownerPw, driverPw);
    setIsFetching(false);
  }

  // C3 kök neden düzeltmesi: rotasyon yalnız `fieldErrors`e (422 alan
  // hatası) BAĞLI değildir — 409 REQUEST_ID_REUSED/403/429/5xx gibi alan
  // dışı kesin (belirsiz OLMAYAN) sonuçlar `formError` banner'ında görünür;
  // bu banner GÖZ ARDI edilirse aynı `requestId` 24 saatlik taslakta KALIR
  // ve o işletme için SONRAKİ HER gönderim de 409'a düşer (review bulgusu).
  function hadKnownResult(): boolean {
    return Object.values(fieldErrors).some(Boolean) || formError !== null;
  }

  function handleFieldChange(field: keyof Omit<Draft, "requestId" | "pending">, value: string): void {
    const hadKnownError = hadKnownResult();
    const next: Draft = {
      ...draft,
      [field]: value,
      requestId: hadKnownError ? randomRequestId() : draft.requestId,
      pending: false,
    };
    if (hadKnownError) {
      setFieldErrors({});
      setFormError(null);
    }
    persist(next);
  }

  function handlePasswordChange(role: "owner" | "driver", value: string): void {
    const hadKnownError = hadKnownResult();
    if (hadKnownError) {
      setFieldErrors({});
      setFormError(null);
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
  // C2 (istemci yarısı) — belirsiz sonuçta gönderilen şifreler bu bileşenin
  // `useState`'inde (yukarıda) HAYATTA kalır (dosya üstü notu); "Tekrar
  // kontrol et" AYNI şifrelerle AYNI requestId'yi göndermelidir (ARCH §3.4).
  // Alanlar hâlâ DOLU iken (sayfa yenilenmediyse) düzenlenebilir bırakmak,
  // ekip üyesinin YANLIŞLIKLA farklı bir şifre yazıp göndermesine — ve
  // `verifyReplayPasswords`'ün bunu 409 REQUEST_ID_REUSED'e düşürmesine —
  // yol açar; sayfa yenilenip alan BOŞ döndüğünde (dosya üstü notu) İSE
  // yeniden girilebilir KALMALIDIR.
  //
  // C4 KÖK NEDEN düzeltmesi (review) — kilit ESKİDEN girdinin ANLIK
  // DEĞERİNE bakıyordu (`ownerPassword !== ""`): sayfa yenilenip alan BOŞ
  // döndüğünde ekip üyesinin yazdığı İLK karakter değeri boş-olmayan yapıp
  // alanı ANINDA kilitliyordu — geri kalan karakterler hiç yazılamıyor,
  // "Tekrar kontrol et" 1 karakterlik şifreyle aracı oluşturuyordu. Kilit
  // artık bellekteki GÖNDERİLMİŞ çiftin VARLIĞINA bakar: sayfa
  // yenilenmediyse (çift bellekte) kilitli, yenilendiyse (çift yok) girdi
  // uzunluğundan bağımsız DÜZENLENEBİLİR.
  const hasSubmittedPasswords = submittedPasswords !== null;
  const ownerPasswordLocked = phase === "submitting" || (phase === "ambiguous" && hasSubmittedPasswords);
  const driverPasswordLocked = phase === "submitting" || (phase === "ambiguous" && hasSubmittedPasswords);

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
            {formError.message}
            {formError.code === "REQUEST_ID_REUSED" && (
              <>
                {" "}
                <Link href={`/yonetim/isletmeler/${businessId}`} className="underline">
                  İşletmeye dön
                </Link>
              </>
            )}
          </p>
        )}

        {phase === "ambiguous" && (
          <div
            role="status"
            className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]"
          >
            {/* I7 — yeniden girme isteği YALNIZ şifreler bellekte YOKKEN (sayfa
                yenilendiğinde) gösterilir; bellekteki çift varken (aşağıdaki
                alanlar zaten dolu ve kilitli) tekrar girmesi gerekmez. */}
            <p>
              Kaydın sonucu kontrol ediliyor.
              {!hasSubmittedPasswords && " Devam etmek için sahip ve şoför şifresini tekrar gir."}
            </p>
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
              disabled={ownerPasswordLocked}
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
              disabled={driverPasswordLocked}
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
