"use client";

/**
 * İşletme detay/düzenleme/aktiflik formu (istemci bileşeni) — T2.1, S2.1.
 *
 * Üç bağımsız mini-form (ad düzeltme, sahip ataması/adı düzeltme, aktiflik)
 * DESIGN §3 "Düğmeler — her formda tek baskın işlem" ilkesi gereği AYRI
 * tutulur; her biri kendi `requestId`sini (`../../../../lib/client-state.ts`
 * üzerinden, TEK bir taslak nesnesinin alt alanı olarak) taşır — ARCHITECTURE
 * §3.4'ün "aynı form yeniden gönderilirken bu anahtar korunur" / "belirsiz
 * sonuçta içerik/anahtar dondurulur" kuralı HER ÜÇÜ için AYNI şekilde
 * uygulanır (bkz. `../yeni/new-business-form.tsx`'in AYNI desenin daha
 * basit tek-form hâli için üst notu — burada üç form olduğundan mantık
 * `patchBusiness` ortak yardımcısında TOPLANIR, tekrar YAZILMAZ).
 *
 * Her BAŞARILI PATCH sunucunun döndürdüğü TAZE `BusinessDetail`'i (yeni
 * `businesses.version`/`people.version` dahil) yerel `detail` durumuna
 * yazar — "Her PATCH businesses.version'ı en az bir kez artırır" (DECISIONS
 * T2.1 notu) bu yüzden BİR mini-formun başarısı DİĞERLERİNİN sonraki
 * gönderiminin sürüm jetonunu da GÜNCEL tutmalıdır; ayrı ayrı senkron
 * mantığı YAZILMAZ, tek `setDetail(fresh)` üçünü de besler.
 *
 * KVKK "Adı anonimleştir" (yalnız `canAnonymize` — sunucu sayfasının yönetici
 * rolü) sahip bölümündedir; ayrı `POST .../people/:personId/anonymize` ucuna
 * gider. Belirsiz sonuçta kişi kimliği, sürüm ve `requestId` taslakta
 * dondurulur; "Tekrar kontrol et" AYNI gövdeyi gönderir. Anonimleştirilmiş
 * sahibin adı düzenlenemez.
 */
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { ClientStateScope } from "../../../../lib/client-state";
import { useStoredDraft } from "../../../../lib/use-stored-draft";
import { getErrorMessage, PERSON_ANONYMIZE_MESSAGES } from "../../../../lib/messages";
import { ConfirmDialog } from "../../../_components/confirm-dialog";

interface BusinessDetail {
  business: { id: string; name: string; active: boolean; version: number; createdAt: string };
  owner: {
    personId: string;
    fullName: string;
    active: boolean;
    version: number;
    anonymized: boolean;
  } | null;
  eligiblePeople: { id: string; fullName: string; active: boolean }[];
  vehicles: { id: string; plateNormalized: string; active: boolean }[];
}

interface PatchErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
}

type PatchOutcome =
  | { kind: "ambiguous" }
  | { kind: "success"; detail: BusinessDetail }
  | { kind: "error"; status: number; code?: string; message?: string; fields?: Record<string, string> };

async function patchBusiness(
  businessId: string,
  csrfToken: string,
  body: Record<string, unknown>,
): Promise<PatchOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/admin/businesses/${businessId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: "ambiguous" };
  }

  let parsed: (BusinessDetail & PatchErrorBody) | undefined;
  try {
    parsed = (await response.json()) as BusinessDetail & PatchErrorBody;
  } catch {
    return { kind: "ambiguous" };
  }

  if (response.ok) {
    return { kind: "success", detail: parsed as BusinessDetail };
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

type AnonymizeOutcome =
  | { kind: "ambiguous" }
  | { kind: "success"; person: { fullName: string; version: number } }
  | { kind: "error"; status: number; code?: string };

/** Ağ hatası ve 5xx belirsizdir: sunucunun adı değiştirip değiştirmediği
 * bilinmez. */
async function postAnonymize(
  businessId: string,
  csrfToken: string,
  body: NonNullable<DetailDraft["ownerAnonymize"]>,
): Promise<AnonymizeOutcome> {
  let response: Response;
  try {
    response = await fetch(
      `/api/v1/admin/businesses/${encodeURIComponent(businessId)}/people/${encodeURIComponent(body.personId)}/anonymize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ requestId: body.requestId, version: body.ownerVersion }),
      },
    );
  } catch {
    return { kind: "ambiguous" };
  }
  if (response.status >= 500) return { kind: "ambiguous" };
  let parsed: ({ person?: { fullName: string; version: number } } & PatchErrorBody) | undefined;
  try {
    parsed = (await response.json()) as { person?: { fullName: string; version: number } } & PatchErrorBody;
  } catch {
    return response.ok ? { kind: "ambiguous" } : { kind: "error", status: response.status };
  }
  if (response.ok && parsed?.person) return { kind: "success", person: parsed.person };
  if (response.ok) return { kind: "ambiguous" };
  return { kind: "error", status: response.status, code: parsed?.error?.code };
}

/** 409/404 sonrası görünümü sunucudan tazelemek için. */
async function fetchBusinessDetail(businessId: string): Promise<BusinessDetail | null> {
  try {
    const response = await fetch(`/api/v1/admin/businesses/${encodeURIComponent(businessId)}`);
    if (!response.ok) return null;
    return (await response.json()) as BusinessDetail;
  } catch {
    return null;
  }
}

/** Alan-dışı (409/403/429/5xx/ağ) bir hatayı ekran metnine çevirir —
 * sunucunun `error.message`'ı BASILMAZ (sözleşme), yalnız kod → mesaj. */
function bannerFor(outcome: Extract<PatchOutcome, { kind: "error" }>): Banner {
  const message =
    outcome.status >= 500
      ? "Bağlantı kurulamadı. Tekrar dene."
      : (outcome.code ? getErrorMessage(outcome.code) : undefined) ?? "Bağlantı kurulamadı. Tekrar dene.";
  return { message, code: outcome.code };
}

interface Banner {
  message: string;
  code?: string;
}

/** VERSION_CONFLICT (409, "iki sekmeden eski sürümle kaydetme") için
 * "Güncel halini aç" bağlantısını da gösteren ortak hata bandı — risk notu:
 * "detay sayfası version'ı sayfa yüklenirken alır; 409 sonrası kullanıcıya
 * güncel hali açma yolu verilir, taslak sessizce üzerine yazılmaz." Tam
 * sayfa yenilemesi (`window.location.reload()`) TAZE `version`'ı sunucudan
 * getirir; taslak (girilen değer) `run()`'ın hiçbir dalının onu SİLMEMESİ
 * sayesinde alan içinde KALIR. */
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

// ---------------------------------------------------------------------------
// Taslak deposu — TEK client-state anahtarı, üç mini-formun alt alanları.
// ---------------------------------------------------------------------------

/**
 * `version`/`ownerVersion` YALNIZ sonucu belirsiz (pending) bir istek için
 * taslakta DONDURULUR: ARCHITECTURE §3.4 — "Tekrar kontrol et" aynı
 * requestId'yi AYNI değer ve sürümle göndermelidir (istek özetine `version`
 * de girer; sayfa yenilenip taze sürüm gelirse sunucu 409 REQUEST_ID_REUSED
 * döner). İstek çözülünce (başarı/kesin red/içerik değişimi) alanlar
 * temizlenir; taslak sekmeler arası ortak olduğundan çözülmüş bir işlemin
 * sürümü başka sekmedeki formu ezmez.
 */
interface DetailDraft {
  name: { requestId: string; value: string; pending: boolean; version?: number };
  ownerRename: {
    requestId: string;
    value: string;
    pending: boolean;
    version?: number;
    ownerVersion?: number;
  };
  ownerAssign: {
    requestId: string;
    mode: "existing" | "new";
    existingPersonRef: string;
    newFullName: string;
    pending: boolean;
    version?: number;
  };
  active: { requestId: string; target: boolean; pending: boolean; version?: number } | null;
  /** Sahip adının anonimleştirilmesi — onay penceresi açıldığında kişi ve
   * sürümle birlikte oluşur. Bu alan eklenmeden önce yazılmış taslaklarda
   * yoktur (`undefined` = işlem yok). */
  ownerAnonymize?: { requestId: string; personId: string; ownerVersion: number; pending: boolean } | null;
}

function emptyDraft(detail: BusinessDetail): DetailDraft {
  return {
    name: { requestId: randomRequestId(), value: detail.business.name, pending: false },
    ownerRename: {
      requestId: randomRequestId(),
      value: detail.owner?.fullName ?? "",
      pending: false,
    },
    ownerAssign: {
      requestId: randomRequestId(),
      mode: "new",
      existingPersonRef: detail.eligiblePeople[0]?.id ?? "",
      newFullName: "",
      pending: false,
    },
    active: null,
    ownerAnonymize: null,
  };
}

export function BusinessDetailForm({
  businessId,
  initialDetail,
  csrfToken,
  scopeKey,
  canAnonymize,
}: {
  businessId: string;
  initialDetail: BusinessDetail;
  csrfToken: string;
  scopeKey: string;
  /** Sunucu sayfasının oturum rolünden hesapladığı (yalnız yönetici) izin;
   * asıl yetki denetimi sunucudadır. */
  canAnonymize: boolean;
}) {
  const draftName = `isletme-${businessId}`;
  const scope: ClientStateScope = { scopeKey };
  const [detail, setDetail] = useState<BusinessDetail>(initialDetail);
  // `useStoredDraft` — `../../../../lib/use-stored-draft.ts` üst notu:
  // `useSyncExternalStore` ile hydration-güvenli localStorage okuma/yazma
  // (bir `useEffect` içinde `setState` ÇAĞRILMAZ).
  const [draft, persistDraft] = useStoredDraft<DetailDraft>(scope, draftName, () =>
    emptyDraft(initialDetail),
  );

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{detail.business.name}</h1>
          <span
            className={
              detail.business.active
                ? "rounded-full bg-[var(--color-success-surface)] px-2 py-0.5 text-base font-medium text-[var(--color-success)]"
                : "rounded-full bg-[var(--color-warning-surface)] px-2 py-0.5 text-base font-medium text-[var(--color-warning)]"
            }
          >
            {detail.business.active ? "Aktif" : "Pasif"}
          </span>
        </div>
        <p className="text-base text-[var(--color-text-secondary)]">
          Mal sahibi: {detail.owner ? detail.owner.fullName : "Sahipsiz"}
        </p>
      </div>

      <NameSection
        businessId={businessId}
        csrfToken={csrfToken}
        detail={detail}
        draft={draft.name}
        onDraftChange={(name) => persistDraft((prev) => ({ ...prev, name }))}
        onSaved={setDetail}
      />

      {detail.owner ? (
        <OwnerRenameSection
          businessId={businessId}
          csrfToken={csrfToken}
          detail={detail}
          draft={draft.ownerRename}
          onDraftChange={(ownerRename) => persistDraft((prev) => ({ ...prev, ownerRename }))}
          onSaved={setDetail}
          canAnonymize={canAnonymize}
          anonymizeDraft={draft.ownerAnonymize ?? null}
          onAnonymizeDraftChange={(ownerAnonymize) => persistDraft((prev) => ({ ...prev, ownerAnonymize }))}
        />
      ) : (
        <OwnerAssignSection
          businessId={businessId}
          csrfToken={csrfToken}
          detail={detail}
          draft={draft.ownerAssign}
          onDraftChange={(ownerAssign) => persistDraft((prev) => ({ ...prev, ownerAssign }))}
          onSaved={setDetail}
        />
      )}

      <VehiclesSection businessId={businessId} detail={detail} />

      <ActiveSection
        businessId={businessId}
        csrfToken={csrfToken}
        detail={detail}
        draft={draft.active}
        onDraftChange={(active) => persistDraft((prev) => ({ ...prev, active }))}
        onSaved={setDetail}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ad düzeltme.
// ---------------------------------------------------------------------------

function NameSection({
  businessId,
  csrfToken,
  detail,
  draft,
  onDraftChange,
  onSaved,
}: {
  businessId: string;
  csrfToken: string;
  detail: BusinessDetail;
  draft: DetailDraft["name"];
  onDraftChange: (next: DetailDraft["name"]) => void;
  onSaved: (detail: BusinessDetail) => void;
}) {
  // "submitting" bu bileşenin O AN sürdürdüğü isteği yansıtır (kalıcı
  // taslağa YAZILMAZ); "ambiguous" `draft.pending`den TÜRETİLİR — ayrı bir
  // "phase" durumu tutup mount'ta senkronlamak GEREKMEZ (bkz. `../yeni/
  // new-business-form.tsx`'in AYNI desenin üst notu).
  const [isFetching, setIsFetching] = useState(false);
  const phase: "idle" | "submitting" | "ambiguous" = isFetching
    ? "submitting"
    : draft.pending
      ? "ambiguous"
      : "idle";
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [banner, setBanner] = useState<Banner | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function run(body: DetailDraft["name"]): Promise<void> {
    setBanner(null);
    const outcome = await patchBusiness(businessId, csrfToken, {
      requestId: body.requestId,
      version: body.version ?? detail.business.version,
      name: body.value,
    });
    if (outcome.kind === "ambiguous") {
      onDraftChange({ ...body, pending: true });
      return;
    }
    if (outcome.kind === "success") {
      onDraftChange({ requestId: randomRequestId(), value: body.value, pending: false });
      onSaved(outcome.detail);
      return;
    }
    onDraftChange({ ...body, pending: false, version: undefined });
    if (outcome.status === 422 && outcome.fields?.name) {
      setFieldError(outcome.fields.name);
      inputRef.current?.focus();
      return;
    }
    setBanner(bannerFor(outcome));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase !== "idle") return;
    setFieldError(undefined);
    setIsFetching(true);
    const sent = { ...draft, pending: true, version: detail.business.version };
    onDraftChange(sent);
    await run(sent);
    setIsFetching(false);
  }

  function handleChange(value: string): void {
    const requestId = fieldError || banner ? randomRequestId() : draft.requestId;
    if (fieldError) setFieldError(undefined);
    if (banner) setBanner(null);
    onDraftChange({ requestId, value, pending: false });
  }

  const disabled = phase !== "idle";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-[var(--color-text)]">İşletme adı</h2>
      {banner && <ErrorBanner banner={banner} />}
      {phase === "ambiguous" && (
        <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          <p>Kaydın sonucu kontrol ediliyor.</p>
          <button
            type="button"
            onClick={async () => {
              setIsFetching(true);
              await run(draft);
              setIsFetching(false);
            }}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)]"
          >
            Tekrar kontrol et
          </button>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="business-name-edit" className="block text-lg font-medium text-[var(--color-text)]">
            Ad
          </label>
          <input
            ref={inputRef}
            id="business-name-edit"
            type="text"
            value={draft.value}
            disabled={disabled}
            onChange={(event) => handleChange(event.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "business-name-edit-error" : undefined}
            className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] disabled:opacity-70"
          />
          {fieldError && (
            <p id="business-name-edit-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
              {fieldError}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={disabled || draft.value.trim() === detail.business.name}
          className="min-h-[var(--control-min-height)] shrink-0 rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] disabled:opacity-70"
        >
          {phase === "submitting" ? "Kaydediliyor…" : "Adı kaydet"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sahip adı düzeltme (owner varsa).
// ---------------------------------------------------------------------------

function OwnerRenameSection({
  businessId,
  csrfToken,
  detail,
  draft,
  onDraftChange,
  onSaved,
  canAnonymize,
  anonymizeDraft,
  onAnonymizeDraftChange,
}: {
  businessId: string;
  csrfToken: string;
  detail: BusinessDetail;
  draft: DetailDraft["ownerRename"];
  onDraftChange: (next: DetailDraft["ownerRename"]) => void;
  onSaved: (detail: BusinessDetail) => void;
  canAnonymize: boolean;
  anonymizeDraft: NonNullable<DetailDraft["ownerAnonymize"]> | null;
  onAnonymizeDraftChange: (next: DetailDraft["ownerAnonymize"]) => void;
}) {
  const owner = detail.owner!;
  const [isFetching, setIsFetching] = useState(false);
  const phase: "idle" | "submitting" | "ambiguous" = isFetching
    ? "submitting"
    : draft.pending
      ? "ambiguous"
      : "idle";
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [banner, setBanner] = useState<Banner | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [anonymizeFetching, setAnonymizeFetching] = useState(false);
  const [anonymizeDialogOpen, setAnonymizeDialogOpen] = useState(false);
  const [anonymizedNotice, setAnonymizedNotice] = useState(false);
  const anonymizePhase: "idle" | "submitting" | "ambiguous" = anonymizeFetching
    ? "submitting"
    : anonymizeDraft?.pending
      ? "ambiguous"
      : "idle";
  // Ad düzeltmesi ile anonimleştirme birbirini kilitler: biri çözülmeden
  // diğeri eski sürüme karşı gönderilemez.
  const disabled = phase !== "idle" || anonymizePhase !== "idle";

  async function runAnonymize(body: NonNullable<DetailDraft["ownerAnonymize"]>): Promise<void> {
    setBanner(null);
    setAnonymizedNotice(false);
    const outcome = await postAnonymize(businessId, csrfToken, body);
    if (outcome.kind === "ambiguous") {
      onAnonymizeDraftChange({ ...body, pending: true });
      return;
    }
    if (outcome.kind === "success") {
      onAnonymizeDraftChange(null);
      // Eski ad taslakta da kalmasın.
      onDraftChange({ requestId: randomRequestId(), value: outcome.person.fullName, pending: false });
      onSaved({
        ...detail,
        owner: { ...owner, fullName: outcome.person.fullName, version: outcome.person.version, anonymized: true },
      });
      setAnonymizedNotice(true);
      return;
    }
    onAnonymizeDraftChange(null);
    setBanner(bannerFor(outcome));
    if (outcome.status === 409 || outcome.status === 404) {
      // Görünüm sunucudan tazelenir; yeni sürümle sessizce yeniden GÖNDERİLMEZ.
      const fresh = await fetchBusinessDetail(businessId);
      if (fresh) onSaved(fresh);
    }
  }

  async function confirmAnonymize(): Promise<void> {
    setAnonymizeDialogOpen(false);
    if (!anonymizeDraft) return;
    const sent = { ...anonymizeDraft, pending: true };
    onAnonymizeDraftChange(sent);
    setAnonymizeFetching(true);
    await runAnonymize(sent);
    setAnonymizeFetching(false);
  }

  if (owner.anonymized) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-[var(--color-text)]">Mal sahibi</h2>
        {anonymizedNotice && (
          <p role="status" className="rounded-[var(--radius-control)] bg-[var(--color-success-surface)] px-3 py-2 text-base text-[var(--color-success)]">
            {PERSON_ANONYMIZE_MESSAGES.done}
          </p>
        )}
        <p className="text-lg font-medium text-[var(--color-text)]">{owner.fullName}</p>
        <p className="text-base text-[var(--color-text-secondary)]">{PERSON_ANONYMIZE_MESSAGES.anonymizedNote}</p>
      </div>
    );
  }

  async function run(body: DetailDraft["ownerRename"]): Promise<void> {
    setBanner(null);
    const outcome = await patchBusiness(businessId, csrfToken, {
      requestId: body.requestId,
      version: body.version ?? detail.business.version,
      ownerRename: { fullName: body.value, ownerVersion: body.ownerVersion ?? owner.version },
    });
    if (outcome.kind === "ambiguous") {
      onDraftChange({ ...body, pending: true });
      return;
    }
    if (outcome.kind === "success") {
      onDraftChange({
        requestId: randomRequestId(),
        value: outcome.detail.owner?.fullName ?? body.value,
        pending: false,
      });
      onSaved(outcome.detail);
      return;
    }
    onDraftChange({ ...body, pending: false, version: undefined, ownerVersion: undefined });
    if (outcome.status === 422 && outcome.fields?.["ownerRename.fullName"]) {
      setFieldError(outcome.fields["ownerRename.fullName"]);
      inputRef.current?.focus();
      return;
    }
    setBanner(bannerFor(outcome));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (disabled) return;
    setFieldError(undefined);
    setIsFetching(true);
    const sent = {
      ...draft,
      pending: true,
      version: detail.business.version,
      ownerVersion: owner.version,
    };
    onDraftChange(sent);
    await run(sent);
    setIsFetching(false);
  }

  function handleChange(value: string): void {
    const requestId = fieldError || banner ? randomRequestId() : draft.requestId;
    if (fieldError) setFieldError(undefined);
    if (banner) setBanner(null);
    onDraftChange({ requestId, value, pending: false });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-[var(--color-text)]">Mal sahibi</h2>
      {banner && <ErrorBanner banner={banner} />}
      {phase === "ambiguous" && (
        <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          <p>Kaydın sonucu kontrol ediliyor.</p>
          <button
            type="button"
            onClick={async () => {
              setIsFetching(true);
              await run(draft);
              setIsFetching(false);
            }}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)]"
          >
            Tekrar kontrol et
          </button>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="owner-name-edit" className="block text-lg font-medium text-[var(--color-text)]">
            Ad soyad
          </label>
          <input
            ref={inputRef}
            id="owner-name-edit"
            type="text"
            value={draft.value}
            disabled={disabled}
            onChange={(event) => handleChange(event.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "owner-name-edit-error" : undefined}
            className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] disabled:opacity-70"
          />
          {fieldError && (
            <p id="owner-name-edit-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
              {fieldError}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={disabled || draft.value.trim() === owner.fullName}
          className="min-h-[var(--control-min-height)] shrink-0 rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] disabled:opacity-70"
        >
          {phase === "submitting" ? "Kaydediliyor…" : "Adı kaydet"}
        </button>
      </div>
      {canAnonymize && (
        <>
          {anonymizePhase === "ambiguous" && anonymizeDraft && (
            <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
              <p>Kaydın sonucu kontrol ediliyor.</p>
              <button
                type="button"
                onClick={async () => {
                  setAnonymizeFetching(true);
                  await runAnonymize(anonymizeDraft);
                  setAnonymizeFetching(false);
                }}
                className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)]"
              >
                Tekrar kontrol et
              </button>
            </div>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onAnonymizeDraftChange({
                requestId: randomRequestId(),
                personId: owner.personId,
                ownerVersion: owner.version,
                pending: false,
              });
              setAnonymizeDialogOpen(true);
            }}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] disabled:opacity-70"
          >
            {PERSON_ANONYMIZE_MESSAGES.action}
          </button>
          <ConfirmDialog
            open={anonymizeDialogOpen}
            title={PERSON_ANONYMIZE_MESSAGES.dialogTitle}
            description={
              <div className="flex flex-col gap-2">
                <p>{PERSON_ANONYMIZE_MESSAGES.dialogDescription(owner.fullName)}</p>
                <p>{PERSON_ANONYMIZE_MESSAGES.dialogKeepsRecords}</p>
              </div>
            }
            confirmLabel={PERSON_ANONYMIZE_MESSAGES.confirm}
            isSubmitting={anonymizePhase === "submitting"}
            onConfirm={confirmAnonymize}
            onCancel={() => {
              setAnonymizeDialogOpen(false);
              onAnonymizeDraftChange(null);
            }}
          />
        </>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sahip atama (owner yoksa) — mevcut kişi seçimi veya yeni sahip.
// ---------------------------------------------------------------------------

function OwnerAssignSection({
  businessId,
  csrfToken,
  detail,
  draft,
  onDraftChange,
  onSaved,
}: {
  businessId: string;
  csrfToken: string;
  detail: BusinessDetail;
  draft: DetailDraft["ownerAssign"];
  onDraftChange: (next: DetailDraft["ownerAssign"]) => void;
  onSaved: (detail: BusinessDetail) => void;
}) {
  const [isFetching, setIsFetching] = useState(false);
  const phase: "idle" | "submitting" | "ambiguous" = isFetching
    ? "submitting"
    : draft.pending
      ? "ambiguous"
      : "idle";
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [banner, setBanner] = useState<Banner | null>(null);

  async function run(body: DetailDraft["ownerAssign"]): Promise<void> {
    setBanner(null);
    const ownerAssignment =
      body.mode === "existing"
        ? { existingPersonRef: body.existingPersonRef }
        : { newFullName: body.newFullName };
    const outcome = await patchBusiness(businessId, csrfToken, {
      requestId: body.requestId,
      version: body.version ?? detail.business.version,
      ownerAssignment,
    });
    if (outcome.kind === "ambiguous") {
      onDraftChange({ ...body, pending: true });
      return;
    }
    if (outcome.kind === "success") {
      onDraftChange({
        requestId: randomRequestId(),
        mode: "new",
        existingPersonRef: "",
        newFullName: "",
        pending: false,
      });
      onSaved(outcome.detail);
      return;
    }
    onDraftChange({ ...body, pending: false, version: undefined });
    if (outcome.status === 422) {
      const fields = outcome.fields ?? {};
      const message =
        fields["ownerAssignment.newFullName"] ??
        fields["ownerAssignment.existingPersonRef"] ??
        fields.ownerAssignment;
      if (message) {
        setFieldError(message);
        return;
      }
    }
    setBanner(bannerFor(outcome));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase !== "idle") return;
    setFieldError(undefined);
    setIsFetching(true);
    const sent = { ...draft, pending: true, version: detail.business.version };
    onDraftChange(sent);
    await run(sent);
    setIsFetching(false);
  }

  function handleFieldChange(next: Partial<DetailDraft["ownerAssign"]>): void {
    const requestId = fieldError || banner ? randomRequestId() : draft.requestId;
    if (fieldError) setFieldError(undefined);
    if (banner) setBanner(null);
    onDraftChange({ ...draft, ...next, requestId, pending: false, version: undefined });
  }

  const disabled = phase !== "idle";
  const canSubmit =
    draft.mode === "existing" ? draft.existingPersonRef.trim().length > 0 : draft.newFullName.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-[var(--color-text)]">Mal sahibi</h2>
      <p className="text-base text-[var(--color-text-secondary)]">
        Bu işletmenin henüz sahibi yok. Aynı işletmede tanımlı aktif bir kişiyi seç veya yeni sahip
        ad soyadı gir.
      </p>
      {banner && <ErrorBanner banner={banner} />}
      {fieldError && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
          {fieldError}
        </p>
      )}
      {phase === "ambiguous" && (
        <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          <p>Kaydın sonucu kontrol ediliyor.</p>
          <button
            type="button"
            onClick={async () => {
              setIsFetching(true);
              await run(draft);
              setIsFetching(false);
            }}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)]"
          >
            Tekrar kontrol et
          </button>
        </div>
      )}

      {detail.eligiblePeople.length > 0 && (
        <label className="flex items-start gap-2 text-base text-[var(--color-text)]">
          <input
            type="radio"
            name="owner-assign-mode"
            checked={draft.mode === "existing"}
            disabled={disabled}
            onChange={() => handleFieldChange({ mode: "existing" })}
            className="mt-1"
          />
          <span className="flex flex-1 flex-col gap-1">
            Mevcut kişi
            <select
              value={draft.existingPersonRef}
              disabled={disabled || draft.mode !== "existing"}
              onChange={(event) => handleFieldChange({ mode: "existing", existingPersonRef: event.target.value })}
              className="min-h-[var(--control-min-height)] rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] disabled:opacity-70"
            >
              {detail.eligiblePeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName} · {person.active ? "Aktif" : "Pasif"} · {person.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </span>
        </label>
      )}

      <label className="flex items-start gap-2 text-base text-[var(--color-text)]">
        <input
          type="radio"
          name="owner-assign-mode"
          checked={draft.mode === "new"}
          disabled={disabled}
          onChange={() => handleFieldChange({ mode: "new" })}
          className="mt-1"
        />
        <span className="flex flex-1 flex-col gap-1">
          Yeni sahip
          <input
            type="text"
            placeholder="Ad soyad"
            value={draft.newFullName}
            disabled={disabled || draft.mode !== "new"}
            onChange={(event) => handleFieldChange({ mode: "new", newFullName: event.target.value })}
            className="min-h-[var(--control-min-height)] rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] disabled:opacity-70"
          />
        </span>
      </label>

      <button
        type="submit"
        disabled={disabled || !canSubmit}
        className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] disabled:opacity-70"
      >
        {phase === "submitting" ? "Kaydediliyor…" : "Sahibi kaydet"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Araçlar — pasifleştirme onayının "etkilenen plakalar"ı da buradan gelir.
// "+ Araç ekle" yalnız aktif VE sahipli işletmede gösterilir (sunucu zaten
// pasif/sahipsiz işletme için POST /admin/vehicles'ı 422 ile reddeder — bu,
// yalnız erken geri bildirim, tek geçerli denetim DEĞİLDİR).
// ---------------------------------------------------------------------------

function VehiclesSection({ businessId, detail }: { businessId: string; detail: BusinessDetail }) {
  const canAddVehicle = detail.business.active && detail.owner !== null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-[var(--color-text)]">
          Araçlar ({detail.vehicles.length})
        </h2>
        {canAddVehicle && (
          <Link
            href={`/yonetim/isletmeler/${businessId}/araclar/yeni`}
            className="min-h-[var(--control-min-height)] flex items-center rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)]"
          >
            + Araç ekle
          </Link>
        )}
      </div>
      {detail.vehicles.length === 0 ? (
        <p className="text-base text-[var(--color-text-secondary)]">Bu işletmede araç yok.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {detail.vehicles.map((vehicle) => (
            <li key={vehicle.id}>
              <Link
                href={`/yonetim/araclar/${vehicle.id}`}
                className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] px-2 py-1 text-base text-[var(--color-text)] hover:bg-[var(--color-page)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <span>{vehicle.plateNormalized}</span>
                <span className="text-[var(--color-text-secondary)]">
                  {vehicle.active ? "Aktif" : "Pasif"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aktiflik — pasifleştirme onaylı (etkilenen araçlar + erişim sonucu),
// yeniden aktifleştirme açıklamalı.
// ---------------------------------------------------------------------------

function ActiveSection({
  businessId,
  csrfToken,
  detail,
  draft,
  onDraftChange,
  onSaved,
}: {
  businessId: string;
  csrfToken: string;
  detail: BusinessDetail;
  draft: DetailDraft["active"];
  onDraftChange: (next: DetailDraft["active"]) => void;
  onSaved: (detail: BusinessDetail) => void;
}) {
  const [isFetching, setIsFetching] = useState(false);
  const phase: "idle" | "submitting" | "ambiguous" = isFetching
    ? "submitting"
    : draft?.pending
      ? "ambiguous"
      : "idle";
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function run(body: NonNullable<DetailDraft["active"]>): Promise<void> {
    setBanner(null);
    const outcome = await patchBusiness(businessId, csrfToken, {
      requestId: body.requestId,
      version: body.version ?? detail.business.version,
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
    onDraftChange({ ...body, pending: false, version: undefined });
    setBanner(bannerFor(outcome));
  }

  async function startAction(target: boolean): Promise<void> {
    const body: NonNullable<DetailDraft["active"]> = {
      requestId: randomRequestId(),
      target,
      pending: false,
    };
    if (target) {
      // Yeniden aktifleştirme sonuçlu bir "kesme" işlemi DEĞİLDİR — onay
      // penceresi gerekmez (DESIGN §3 "Pencere" yalnız "sonuçlu işlemler"
      // ister).
      const sent = { ...body, pending: true, version: detail.business.version };
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
    if (!draft) return;
    const sent = { ...draft, pending: true, version: detail.business.version };
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
      {phase === "ambiguous" && draft && (
        <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          <p>Kaydın sonucu kontrol ediliyor.</p>
          <button
            type="button"
            onClick={async () => {
              setIsFetching(true);
              await run(draft);
              setIsFetching(false);
            }}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)]"
          >
            Tekrar kontrol et
          </button>
        </div>
      )}

      {detail.business.active ? (
        <>
          <p className="text-base text-[var(--color-text-secondary)]">
            İşletmeyi pasifleştirmek bu işletmedeki tüm araçların oturum erişimini keser. Geçmiş
            kayıtlar silinmez.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => startAction(false)}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] bg-[var(--color-error)] px-4 text-base font-semibold text-white disabled:opacity-70"
          >
            {phase === "submitting" && draft?.target === false ? "Pasifleştiriliyor…" : "İşletmeyi pasifleştir"}
          </button>
        </>
      ) : (
        <>
          <p className="text-base text-[var(--color-text-secondary)]">
            İşletme tekrar aktif olur. Daha önce pasifleşen araç oturumları kendiliğinden geri
            gelmez; gerekiyorsa ayrıca açılmalıdır.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => startAction(true)}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] disabled:opacity-70"
          >
            {phase === "submitting" && draft?.target === true ? "Aktifleştiriliyor…" : "İşletmeyi yeniden aktifleştir"}
          </button>
        </>
      )}

      <ConfirmDialog
        open={dialogOpen}
        title="İşletmeyi pasifleştir"
        description={
          <div className="flex flex-col gap-2">
            <p>
              <strong>{detail.business.name}</strong> pasifleşince bu işletmedeki
              {" "}
              {detail.vehicles.length} araç oturum açamaz hale gelir:
            </p>
            {detail.vehicles.length > 0 && (
              <ul className="list-disc pl-5">
                {detail.vehicles.map((vehicle) => (
                  <li key={vehicle.id}>{vehicle.plateNormalized}</li>
                ))}
              </ul>
            )}
            <p>Geçmiş kayıtlar silinmez; işletme sonradan yeniden aktifleştirilebilir.</p>
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
