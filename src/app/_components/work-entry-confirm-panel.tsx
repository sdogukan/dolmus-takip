"use client";

/**
 * Sahibin teslim onayı (T4.2 istemcisi): "Aldığım tutar (TL)" alanı ve
 * "Parayı aldım, tutar doğru". Ekip (destek) aynı paneli `onBehalf` ile kullanır:
 * "Sahip adına alınan tutar" / "Sahip adına teslimi onayla"; istekler URL'deki
 * hedef araçla `X-Target-Vehicle` taşır, onaylı durumda "Sahip adına platform
 * desteği · <kullanıcı>" izi görünür. Kayıt durumu (`entry`) düzenleme formuyla
 * PAYLAŞILIR: onay başarısında kayıt `onEntry` ile güncellenir, düzenleme
 * formu yeni sürüme ve salt okunur duruma kendiliğinden geçer.
 *
 * Alan beklenen tutarla ÖN DOLU görünür ama bu onay DEĞİLDİR: durum düğmeye
 * basılana dek "Henüz doğrulanmadı" kalır ve hiçbir istek kendiliğinden
 * gitmez. Kullanıcı yazana kadar ön dolum sunucudaki kaydı izler; yazınca
 * kullanıcının değeri korunur.
 *
 * Gönderim: gövde (`requestId`, `version`, açık `receivedCents`) fetch'ten
 * ÖNCE taslağa dondurulur. Belirsiz sonuçta (ağ, 5xx, okunamayan/bozuk 200)
 * düğme kilitlenir; "Sonucu şimdi kontrol et" aynı `requestId` + dondurulmuş
 * gövdeyi BAYTI BAYTINA yeniden yollar (yenilemeden sonra da). Başarı yalnız
 * onaylı durum + onay bilgisi taşıyan 200'den gösterilir; tutar ve zaman
 * sunucunun onayından okunur. Sunucunun `error.message`'ı BASILMAZ.
 */
import { useRef, useState } from "react";
import { WORK_ENTRY_MESSAGES as TEXT } from "../../lib/messages";
import { formatTlAmount, parseApiCents } from "../../lib/money";
import {
  buildWorkEntryConfirmBody,
  classifyWorkEntryConfirmResponse,
  confirmErrorNeedsReread,
  emptyConfirmDraft,
  frozenReceivedText,
  hasEarlierAttempt,
  receivedDifference,
  receivedPrefill,
  releaseConfirmDraft,
  shouldReleaseAfterConfirmError,
  workEntryErrorMessage,
  type WorkEntryConfirmDraft,
  type WorkEntryConfirmOutcome,
  type WorkEntryDetail,
} from "../../lib/work-entry-ui";
import { formatWorkDate, istanbulWallClock } from "../../lib/work-time";
import { useUnsavedChanges } from "./unsaved-changes";
import {
  amountInputProps,
  controlClass,
  errorTextClass,
  labelClass,
  primaryButtonClass,
  randomRequestId,
  secondaryButtonClass,
} from "./work-entry-form";

/** Dondurulmuş gövdeyi olduğu gibi yollar; sonuç `classifyWorkEntryConfirmResponse`ta sınıflanır. */
async function postConfirm(
  entryId: string,
  frozenBody: string,
  csrfToken: string,
  targetVehicleId: string | undefined,
): Promise<WorkEntryConfirmOutcome> {
  const headers: Record<string, string> = { "X-CSRF-Token": csrfToken, "Content-Type": "application/json" };
  if (targetVehicleId) headers["X-Target-Vehicle"] = targetVehicleId;
  let response: Response;
  try {
    response = await fetch(`/api/v1/work-entries/${encodeURIComponent(entryId)}/confirm`, {
      method: "POST",
      headers,
      body: frozenBody,
    });
  } catch {
    return classifyWorkEntryConfirmResponse(null);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return classifyWorkEntryConfirmResponse({ status: response.status, body });
}

function formatCents(text: string): string {
  const cents = parseApiCents(text);
  return cents === null ? "—" : formatTlAmount(cents);
}

export function WorkEntryConfirmPanel({
  entry,
  draft,
  persistDraft,
  blocked,
  csrfToken,
  targetVehicleId,
  onBehalf,
  onEntry,
  onReread,
}: {
  entry: WorkEntryDetail;
  draft: WorkEntryConfirmDraft;
  persistDraft: (next: WorkEntryConfirmDraft | ((prev: WorkEntryConfirmDraft) => WorkEntryConfirmDraft)) => void;
  /** Düzenleme taslağı bekliyor ya da bayat: bekleyen PATCH sürümü değiştirebilir, onay yollanmaz. */
  blocked: boolean;
  csrfToken: string;
  /** Ekip modunda hedef araç (URL'den); her istekte `X-Target-Vehicle` olarak gider. */
  targetVehicleId?: string;
  /** Ekip: sahip adına onay; "Aldığım tutar" / "Parayı aldım" iddiası yapılmaz. */
  onBehalf?: boolean;
  /** Sunucunun onayladığı kayıt; düzenleme formunun kayıt durumunu günceller. */
  onEntry: (entry: WorkEntryDetail) => void;
  /** Güncel kaydı yeniden okur (sürüm çakışması / başka yerde onaylanmış); başarısızsa gösterilecek mesajı döner. */
  onReread: () => Promise<string | null>;
}) {
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  // Yazılmış ama gönderilmemiş tutar (ya da sonucu belirsiz gönderim) sayfa/hedef değişiminde uyarı ister.
  const dirty = entry.status === "pending" && (draft.pending || (draft.touched && draft.receivedText.trim() !== ""));
  useUnsavedChanges("work-entry-confirm", dirty);

  if (entry.status === "confirmed") {
    if (!entry.confirmation) return null;
    const at = istanbulWallClock(entry.confirmation.confirmedAt);
    return (
      <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] p-4">
        <p className="flex justify-between gap-4 text-lg tabular-nums">
          <span>{TEXT.confirmedReceivedLabel}</span>
          <span className="text-right font-semibold">{formatCents(entry.confirmation.receivedCents)}</span>
        </p>
        <p className="flex justify-between gap-4 text-base text-[var(--color-text-secondary)] tabular-nums">
          <span>{TEXT.confirmedAtLabel}</span>
          <span className="text-right">{TEXT.confirmedAtValue(formatWorkDate(at.date), at.time)}</span>
        </p>
        {entry.confirmation.actor?.kind === "platform_user" && entry.confirmation.actor.username && (
          <p className="text-base text-[var(--color-text-secondary)]">
            {TEXT.supportTrace(entry.confirmation.actor.username)}
          </p>
        )}
      </section>
    );
  }
  if (entry.status !== "pending" || entry.workKind !== "driver") return null;

  // Bekleyen denemede alan gönderilen tutarı gösterir; kullanıcı yazmadıysa kesin hata sonrası ön dolum kaydı izlemeye döner.
  const value =
    (draft.pending ? frozenReceivedText(draft.frozenBody) : null) ??
    (draft.touched ? draft.receivedText : receivedPrefill(entry));
  const parsed = buildWorkEntryConfirmBody({ requestId: draft.requestId, version: entry.version, receivedText: value });
  const fieldError = submitted && !parsed.ok ? parsed.message : undefined;
  const difference = receivedDifference(entry.remainderCents, value);
  const unresolved = draft.pending && !sending;
  const locked = draft.pending || sending;

  async function send(frozenBody: string, earlierAttempt: boolean): Promise<void> {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSending(true);
    setMessage(null);
    const outcome = await postConfirm(entry.id, frozenBody, csrfToken, targetVehicleId);
    inFlightRef.current = false;
    setSending(false);
    if (outcome.kind === "ambiguous") return; // taslak `pending` kalır: alan kilitli, tekrar dene.
    if (outcome.kind === "confirmed") {
      persistDraft(() => emptyConfirmDraft(randomRequestId));
      onEntry(outcome.entry);
      return;
    }
    setMessage(outcome.fields.receivedCents ?? workEntryErrorMessage(outcome.status, outcome.code));
    // Daha önce ulaşmış olabilecek denemede yazılmadığı kanıtlanmadıysa taslak bekleyen kalır.
    if (!shouldReleaseAfterConfirmError(outcome, earlierAttempt)) return;
    persistDraft((prev) => releaseConfirmDraft(prev, randomRequestId));
    if (confirmErrorNeedsReread(outcome)) {
      const failure = await onReread();
      if (failure) setMessage(failure);
    }
  }

  async function handleConfirm(): Promise<void> {
    if (inFlightRef.current || locked || blocked) return;
    setSubmitted(true);
    setMessage(null);
    if (!parsed.ok) return;
    const frozenBody = JSON.stringify(parsed.body);
    // Gövde fetch'ten ÖNCE dondurulur; `attemptSent` de fetch'ten ÖNCE yazılır.
    persistDraft((prev) => ({
      ...prev,
      requestId: parsed.body.requestId,
      pending: true,
      frozenBody,
      attemptSent: true,
    }));
    await send(frozenBody, false);
  }

  async function handleRetry(): Promise<void> {
    if (inFlightRef.current || draft.frozenBody === null) return;
    await send(draft.frozenBody, hasEarlierAttempt(draft));
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <label htmlFor="received-amount" className={labelClass}>
          {onBehalf ? TEXT.receivedLabelOnBehalf : TEXT.receivedLabel}
        </label>
        <input
          id="received-amount"
          {...amountInputProps}
          value={value}
          disabled={locked || blocked}
          onChange={(event) => {
            persistDraft((prev) => ({ ...prev, touched: true, receivedText: event.target.value }));
            setMessage(null);
          }}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? "received-amount-error" : undefined}
          className={`${controlClass} tabular-nums`}
        />
        {fieldError && (
          <p id="received-amount-error" role="alert" className={errorTextClass}>
            {fieldError}
          </p>
        )}
        {difference && (
          <p role="status" className="mt-2 text-base text-[var(--color-text-secondary)]">
            {difference.kind === "shortfall"
              ? TEXT.receivedShortfall(formatTlAmount(difference.cents))
              : TEXT.receivedExcess(formatTlAmount(difference.cents))}
          </p>
        )}
      </div>

      {entry.remainderCents.startsWith("-") && (
        <p className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          {TEXT.remainderNegative}
        </p>
      )}

      {message && entry.status === "pending" && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
          {message}
        </p>
      )}
      {unresolved && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
            {TEXT.checking}
          </p>
          <button type="button" onClick={() => void handleRetry()} className={secondaryButtonClass}>
            {TEXT.confirmRetry}
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={locked || blocked}
        onClick={() => void handleConfirm()}
        className={primaryButtonClass}
      >
        {sending ? TEXT.confirmSending : onBehalf ? TEXT.confirmButtonOnBehalf : TEXT.confirmButton}
      </button>
    </section>
  );
}
