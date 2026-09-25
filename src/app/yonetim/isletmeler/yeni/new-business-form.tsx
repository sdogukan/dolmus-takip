"use client";

/**
 * Yeni işletme + mal sahibi oluşturma formu (istemci bileşeni) — T2.1, S2.1.
 *
 * Tekrar gönderim/eşzamanlı düzenleme kuralları BİREBİR burada uygulanır:
 * - "Her mutasyon istemciden rastgele request_id alır. Aynı form yeniden
 *   gönderilirken bu anahtar korunur." → `requestId` bir kez üretilir,
 *   içerik DEĞİŞMEDİĞİ sürece AYNI kalır (draft ile birlikte `src/lib/
 *   client-state.ts` üzerinden saklanır).
 * - "Oluşturmanın sonucu belirsizse gönderilen içerik/anahtar dondurulur;
 *   önce aynı istek tekrar gönderilerek sonuç çözümlenir." → `phase ===
 *   "ambiguous"` iken alanlar KİLİTLENİR, yalnız "Tekrar kontrol et" AYNI
 *   `requestId`+gövdeyle tekrar `fetch` eder (sunucu idempotency katmanı —
 *   `createBusinessWithOwner`'ın `resolveReceipt` replay dalı — bunu GÜVENLİ
 *   kılar: ikinci gönderim yeni işletme ÜRETMEZ).
 * - "Sonucu bilinen işlemden (başarı veya kesin red) sonra içerik
 *   değiştirilirse yeni anahtar üretilir." → yalnız KESİN bir sonuçtan
 *   (422 alan hatası) SONRA kullanıcı bir alanı değiştirirse `requestId`
 *   YENİLENİR (`regenerateRequestIdOnNextChange`); ambiguous/submitting
 *   sırasında zaten alanlar salt-okunur olduğundan bu dal tetiklenmez.
 *
 * İki bağlantı durumu — "Gönderim sonrası bağlantı koptu" ("Kaydın sonucu
 * kontrol ediliyor.") ile "Gönderilmediği bilinen bağlantı hatası"
 * ("Bağlantı yok. Henüz kaydedilmedi.") — AYRIMI `navigator.onLine` ile
 * yapılır: tarayıcı GERÇEKTEN çevrimdışıysa istek hiç ATILMAZ (kesin
 * "gönderilmedi" — form DÜZENLENEBİLİR kalır, aynı requestId korunur);
 * çevrimiçiyken `fetch` reddederse (bağlantı gönderim SIRASINDA koptu,
 * sunucuya ULAŞIP ULAŞMADIĞI BİLİNMEZ) belirsiz sayılır ve yukarıdaki
 * dondurma kuralı uygulanır.
 */
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ClientStateScope } from "../../../../lib/client-state";
import { useStoredDraft } from "../../../../lib/use-stored-draft";
import { getErrorMessage } from "../../../../lib/messages";

const DRAFT_NAME = "isletme-yeni";

interface Draft {
  requestId: string;
  name: string;
  ownerFullName: string;
  /** `true` — son bilinen durum: istek gönderildi ama sonucu HENÜZ
   * çözülmedi (bkz. dosya üstü notu). Sayfa kapanıp yeniden açılsa bile
   * bu bayrak korunur; mount'ta "ambiguous" ekranı GERİ KURULUR. */
  pending: boolean;
}

function randomRequestId(): string {
  return crypto.randomUUID();
}

function emptyDraft(): Draft {
  return { requestId: randomRequestId(), name: "", ownerFullName: "", pending: false };
}

interface FieldErrors {
  name?: string;
  ownerFullName?: string;
}

interface CreateSuccessBody {
  business?: { id?: unknown };
}

interface CreateErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
}

export function NewBusinessForm({
  csrfToken,
  scopeKey,
}: {
  csrfToken: string;
  scopeKey: string;
}) {
  const router = useRouter();
  const scope: ClientStateScope = { scopeKey };

  // `useStoredDraft` — `../../../../lib/use-stored-draft.ts` üst notu:
  // `useSyncExternalStore` ile hydration-güvenli localStorage okuma/yazma
  // (bir `useEffect` içinde `setState` ÇAĞRILMAZ).
  const [draft, persist] = useStoredDraft<Draft>(scope, DRAFT_NAME, emptyDraft);
  // "submitting" YALNIZ bu bileşenin O AN sürdürdüğü isteği yansıtır (asla
  // kalıcı taslağa YAZILMAZ); "ambiguous" ise `draft.pending`den TÜRETİLİR
  // — ayrı bir "phase" durumu tutup mount'ta senkronlamak GEREKMEZ, sayfa
  // yeniden açıldığında `draft.pending === true` İSE ekran doğrudan
  // "ambiguous" ile başlar.
  const [isFetching, setIsFetching] = useState(false);
  const phase: "idle" | "submitting" | "ambiguous" = isFetching
    ? "submitting"
    : draft.pending
      ? "ambiguous"
      : "idle";
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const nameInputRef = useRef<HTMLInputElement>(null);
  const ownerInputRef = useRef<HTMLInputElement>(null);

  async function sendCreateRequest(body: Draft): Promise<void> {
    setFormError(null);
    let response: Response;
    try {
      response = await fetch("/api/v1/admin/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({
          requestId: body.requestId,
          name: body.name,
          owner: { fullName: body.ownerFullName },
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
      const businessId = responseBody?.business?.id;
      persist(emptyDraft());
      if (typeof businessId === "string") {
        router.push(`/yonetim/isletmeler/${businessId}`);
      } else {
        router.push("/yonetim");
      }
      return;
    }

    persist({ ...body, pending: false });

    if (response.status === 422) {
      const fields = responseBody?.error?.fields ?? {};
      const nameError = fields.name;
      const ownerError = fields["owner.fullName"];
      setFieldErrors({ name: nameError, ownerFullName: ownerError });
      if (nameError || ownerError) {
        (nameError ? nameInputRef : ownerInputRef).current?.focus();
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
      // Kesin "gönderilmedi" — form düzenlenebilir kalır, aynı requestId
      // korunur ("Gönderilmediği bilinen bağlantı hatası" durumu).
      setFormError("Bağlantı yok. Henüz kaydedilmedi.");
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setIsFetching(true);
    persist({ ...draft, pending: true });
    await sendCreateRequest(draft);
    setIsFetching(false);
  }

  async function handleRetryCheck(): Promise<void> {
    setIsFetching(true);
    await sendCreateRequest(draft);
    setIsFetching(false);
  }

  function handleFieldChange(field: "name" | "ownerFullName", value: string): void {
    // "Sonucu bilinen işlemden sonra içerik değişirse yeni requestId
    // üretilir" — burada tetiklenen tek kesin sonuç 422'dir (`phase` zaten
    // "idle"e döner); ambiguous/submitting sırasında alanlar salt-okunur
    // olduğundan bu dal yalnız o durumda çalışır.
    const hadKnownError = fieldErrors.name !== undefined || fieldErrors.ownerFullName !== undefined;
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

  const disabled = phase !== "idle";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">İşletme aç</h1>
        <p className="mt-1 text-base text-[var(--color-text-secondary)]">
          İşletme adı ve mal sahibinin ad soyadını gir. Kişisel araç giriş hesabı bu adımda
          oluşturulmaz.
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
            <p>Kaydın sonucu kontrol ediliyor.</p>
            <button
              type="button"
              onClick={handleRetryCheck}
              className="min-h-[var(--control-min-height)] rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              Tekrar kontrol et
            </button>
          </div>
        )}

        <div>
          <label htmlFor="business-name" className="block text-lg font-medium text-[var(--color-text)]">
            İşletme adı
          </label>
          <input
            ref={nameInputRef}
            id="business-name"
            name="name"
            type="text"
            value={draft.name}
            disabled={disabled}
            onChange={(event) => handleFieldChange("name", event.target.value)}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? "business-name-error" : undefined}
            className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
          />
          {fieldErrors.name && (
            <p id="business-name-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
              {fieldErrors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="owner-full-name" className="block text-lg font-medium text-[var(--color-text)]">
            Sahibin ad soyadı
          </label>
          <input
            ref={ownerInputRef}
            id="owner-full-name"
            name="ownerFullName"
            type="text"
            value={draft.ownerFullName}
            disabled={disabled}
            onChange={(event) => handleFieldChange("ownerFullName", event.target.value)}
            aria-invalid={fieldErrors.ownerFullName ? true : undefined}
            aria-describedby={fieldErrors.ownerFullName ? "owner-full-name-error" : undefined}
            className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
          />
          {fieldErrors.ownerFullName && (
            <p id="owner-full-name-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
              {fieldErrors.ownerFullName}
            </p>
          )}
        </div>

        {(draft.name.trim() || draft.ownerFullName.trim()) && (
          <p className="rounded-[var(--radius-control)] bg-[var(--color-page)] px-3 py-2 text-base text-[var(--color-text-secondary)]">
            {draft.name.trim() || "(işletme adı)"} işletmesinin sahibi:{" "}
            {draft.ownerFullName.trim() || "(sahip adı)"}
          </p>
        )}

        <p aria-live="polite" className="sr-only">
          {phase === "submitting" ? "Kaydediliyor…" : ""}
        </p>

        <button
          type="submit"
          disabled={disabled}
          aria-busy={phase === "submitting"}
          className="min-h-[var(--primary-min-height)] w-full rounded-[var(--radius-control)] bg-[var(--color-primary)] text-lg font-semibold text-[var(--color-on-primary)] transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
        >
          {phase === "submitting" ? "Kaydediliyor…" : "İşletmeyi kaydet"}
        </button>
      </form>
    </div>
  );
}
