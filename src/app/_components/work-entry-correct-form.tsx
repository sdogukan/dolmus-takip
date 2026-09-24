"use client";

/**
 * Sahibin onaylı şoför kaydını tek işlemde düzeltip yeniden onaylaması (T4.3
 * istemcisi; ekip aynı formu `onBehalf` + `X-Target-Vehicle` ile kullanır): "Kaydı düzenle" → "Onaylanmış kaydı düzelt" formu. Alanlar
 * SUNUCUNUN güncel değerleriyle başlar; "Aldığım tutar (TL)" güncel onayın
 * tutarıyla ön doludur ve hasılat/gider değişince yeni beklenen teslime KAYMAZ —
 * fark yalnız bilgi olarak gösterilir. "Yeni beklenen teslim" canlı hesaplanır
 * ama sunucunun kaydı değildir; kayıtlı değerler yalnız yanıttan gelir.
 *
 * Taslak (`…-duzelt`) düzenleme ve onay taslaklarından AYRIDIR, dayandığı
 * sürümü taşır. Sürümü kayıttan farklı VE yarım kalmış taslak (başka sekme/cihaz
 * düzeltti) BAYATTIR: alanlar kilitlenir, güncel kayıt okunur, kullanıcı
 * "Güncel değerleri yükle" ya da "Benim değerlerimle devam et"i seçer. Temiz
 * taslak bayatlamaz; form açılırken güncel kayıttan yeniden kurulur.
 *
 * Gönderim: gövde fetch'ten ÖNCE taslağa DONDURULUR; belirsiz sonuçta (ağ, 5xx,
 * okunamayan/bozuk 200) alanlar kilitlenir ve aynı `requestId` + dondurulmuş
 * gövde BAYTI BAYTINA yeniden yollanır. 409 VERSION_CONFLICT kanonik metni
 * gösterir ve kaydı yeniden okur. "Vazgeç" hiç istek atmaz. Sunucunun
 * `error.message`'ı BASILMAZ.
 */
import { useEffect, useRef, useState } from "react";
import type { ClientStateScope } from "../../lib/client-state";
import { isDraftStale } from "../../lib/draft-version";
import {
  COMMON_SCREEN_MESSAGES,
  DRIVER_FIELD_MESSAGES,
  WORK_ENTRY_MESSAGES as TEXT,
} from "../../lib/messages";
import { formatTlAmount, parseTlAmount } from "../../lib/money";
import { useStoredDraft } from "../../lib/use-stored-draft";
import {
  buildWorkEntryCorrectBody,
  classifyWorkEntryCorrectResponse,
  correctDraftFromEntry,
  correctErrorNeedsReread,
  editPersonOptions,
  hasEarlierAttempt,
  isCorrectDraftDirty,
  rebaseCorrectDraft,
  receivedDifference,
  releaseCorrectDraft,
  shouldReleaseAfterCorrectError,
  workEntryCorrectDraftName,
  workEntryErrorMessage,
  type SelectableDriver,
  type WorkEntryCorrectDraft,
  type WorkEntryCorrectOutcome,
  type WorkEntryDetail,
} from "../../lib/work-entry-ui";
import { evaluateWorkTime, formatDuration } from "../../lib/work-time";
import { ConfirmDialog } from "./confirm-dialog";
import { useUnsavedChanges } from "./unsaved-changes";
import {
  amountInputProps,
  computeSummary,
  controlClass,
  errorTextClass,
  fetchDrivers,
  labelClass,
  OTHER_NOTE_MAX_LENGTH,
  primaryButtonClass,
  randomRequestId,
  secondaryButtonClass,
  type FetchResult,
} from "./work-entry-form";

type ListState =
  | { status: "loading" }
  | { status: "loaded"; drivers: SelectableDriver[] }
  | { status: "error"; message: string; retryable: boolean };

/** Dondurulmuş gövdeyi olduğu gibi yollar; sonuç `classifyWorkEntryCorrectResponse`ta sınıflanır. */
async function postCorrect(
  entryId: string,
  frozenBody: string,
  csrfToken: string,
  targetVehicleId: string | undefined,
): Promise<WorkEntryCorrectOutcome> {
  const headers: Record<string, string> = { "X-CSRF-Token": csrfToken, "Content-Type": "application/json" };
  if (targetVehicleId) headers["X-Target-Vehicle"] = targetVehicleId;
  let response: Response;
  try {
    response = await fetch(`/api/v1/work-entries/${encodeURIComponent(entryId)}/correct-and-confirm`, {
      method: "POST",
      headers,
      body: frozenBody,
    });
  } catch {
    return classifyWorkEntryCorrectResponse(null);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return classifyWorkEntryCorrectResponse({ status: response.status, body });
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className={errorTextClass}>
          {error}
        </p>
      )}
    </div>
  );
}

export function WorkEntryCorrectForm({
  entry,
  vehicleId,
  scopeKey,
  csrfToken,
  targetVehicleId,
  onBehalf = false,
  disabled = false,
  onEntry,
  onReread,
}: {
  /** Onaylı şoför kaydı (onayı dolu). */
  entry: WorkEntryDetail;
  vehicleId: string;
  scopeKey: string;
  csrfToken: string;
  /** Ekip modunda hedef araç (URL'den); her istekte `X-Target-Vehicle` olarak gider. */
  targetVehicleId?: string;
  /** Ekip: sahip adına düzeltme; "Aldığım tutar" iddiası yapılmaz. */
  onBehalf?: boolean;
  /** Pasif hedef: form açılamaz, gönderilemez. */
  disabled?: boolean;
  /** Sunucunun düzeltip onayladığı kayıt; sayfanın kayıt durumunu günceller. */
  onEntry: (entry: WorkEntryDetail) => void;
  /** Güncel kaydı yeniden okur ve benimser; başarısızsa gösterilecek mesajı döner. */
  onReread: () => Promise<string | null>;
}) {
  const scope: ClientStateScope = { scopeKey };
  const [draft, persistDraft] = useStoredDraft<WorkEntryCorrectDraft>(
    scope,
    workEntryCorrectDraftName(vehicleId, entry.id),
    () => correctDraftFromEntry(entry, randomRequestId),
  );
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [corrected, setCorrected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [personError, setPersonError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const inFlightRef = useRef(false);
  const refreshedKeyRef = useRef("");
  const listControllerRef = useRef<AbortController | null>(null);

  const dirty = isCorrectDraftDirty(draft, entry);
  const visible = open || dirty;
  const stale = dirty && isDraftStale({ baseVersion: draft.baseVersion, currentVersion: entry.version, pending: draft.pending });
  useUnsavedChanges("work-entry-correct", dirty);

  function update(patch: Partial<WorkEntryCorrectDraft>): void {
    // Temiz ama eski sürüme bağlı taslak, düzenlemeden önce güncel kayda taşınır (yoksa yazar yazmaz bayat sayılırdı).
    persistDraft((prev) => {
      const base =
        !prev.pending && prev.baseVersion !== entry.version && !isCorrectDraftDirty(prev, entry)
          ? correctDraftFromEntry(entry, () => prev.requestId)
          : prev;
      return { ...base, ...patch };
    });
  }

  function touch(): void {
    setMessage(null);
    setCorrected(false);
    setServerFields({});
  }

  function applyList(result: FetchResult): void {
    setList(
      result.ok
        ? { status: "loaded", drivers: result.drivers }
        : { status: "error", message: result.message, retryable: result.retryable },
    );
  }

  async function loadList(): Promise<void> {
    listControllerRef.current?.abort();
    const controller = new AbortController();
    listControllerRef.current = controller;
    setList({ status: "loading" });
    try {
      const result = await fetchDrivers(controller.signal, targetVehicleId);
      if (!controller.signal.aborted) applyList(result);
    } catch {
      // Kesildi: yeni istek durumu yönetir.
    }
  }

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    listControllerRef.current = controller;
    void fetchDrivers(controller.signal, targetVehicleId).then(
      (result) => {
        if (!controller.signal.aborted) applyList(result);
      },
      () => undefined,
    );
    return () => controller.abort();
    // Yalnız form görünür olunca; applyList set fonksiyonlarını kullanır.
  }, [visible]);

  // Başka sekme/cihaz düzeltince taslağın sürümü kayıttan ayrılır: güncel kaydı BİR KEZ okuruz.
  const staleKey = stale ? `${draft.baseVersion}:${entry.version}` : "";
  useEffect(() => {
    if (staleKey === "" || refreshedKeyRef.current === staleKey) return;
    refreshedKeyRef.current = staleKey;
    void onReread().then((failure) => {
      if (failure) setMessage(failure);
    });
    // Tetikleyici yalnız `staleKey`; onReread her render'da yeniden kurulur.
  }, [staleKey]);

  const timeInput = { date: draft.date, startTime: draft.startTime, endTime: draft.endTime, endsNextDay: draft.endsNextDay };
  const evaluation = evaluateWorkTime(timeInput);
  const fieldErrors = evaluation.ok ? {} : evaluation.errors;
  const relationVisible = draft.startTime !== "" && draft.endTime !== "";
  const dateError = (submitted ? fieldErrors.date : undefined) ?? serverFields.date;
  const startError = (submitted ? fieldErrors.startTime : undefined) ?? serverFields.startTime;
  const endError =
    (fieldErrors.endTime && (submitted || relationVisible) ? fieldErrors.endTime : undefined) ?? serverFields.endTime;

  const grossResult = parseTlAmount(draft.grossText);
  const fuelResult = parseTlAmount(draft.fuelText);
  const receivedResult = parseTlAmount(draft.receivedText);
  const otherUsed = draft.expenseOpen && (draft.otherText.trim() !== "" || draft.otherNote.trim() !== "");
  const otherResult = otherUsed ? parseTlAmount(draft.otherText) : null;
  const summary = computeSummary(entry.workKind, grossResult, fuelResult, otherResult);
  const grossError = (submitted && !grossResult.ok ? grossResult.message : undefined) ?? serverFields.grossCents;
  const fuelError =
    (submitted && !fuelResult.ok
      ? fuelResult.message
      : submitted && summary.status === "invalid" && summary.tooLarge
        ? TEXT.amountsTooLarge
        : undefined) ?? serverFields.fuelCents;
  const otherError =
    (submitted && otherResult && !otherResult.ok ? otherResult.message : undefined) ??
    serverFields.otherExpenseCents ??
    serverFields.otherExpenseNote;
  const receivedError =
    (submitted && !receivedResult.ok ? receivedResult.message : undefined) ?? serverFields.receivedCents;
  const difference = summary.status === "ready" ? receivedDifference(String(summary.remainderCents), draft.receivedText) : null;

  const locked = draft.pending || sending || stale || disabled;
  const drivers = list.status === "loaded" ? list.drivers : [];
  const personOptions =
    list.status === "loaded"
      ? editPersonOptions(drivers, entry.person)
      : [{ personId: entry.person.id, label: entry.person.fullName }];

  function openForm(): void {
    // Yarım değişikliği/bekleyen gönderimi olmayan taslak güncel sunucu değerlerinden yeniden kurulur.
    persistDraft((prev) =>
      prev.pending || isCorrectDraftDirty(prev, entry) ? prev : correctDraftFromEntry(entry, randomRequestId),
    );
    setCorrected(false);
    setMessage(null);
    setOpen(true);
  }

  /** Vazgeç: istek atmaz, sunucudaki kayda dokunmaz; yerel taslağı temizleyip formu kapatır. */
  function closeForm(): void {
    persistDraft(() => correctDraftFromEntry(entry, randomRequestId));
    setOpen(false);
    setSubmitted(false);
    setMessage(null);
    setPersonError(null);
    setServerFields({});
    setConfirmingDiscard(false);
  }

  function requestCancel(): void {
    if (dirty) {
      setConfirmingDiscard(true);
      return;
    }
    closeForm();
  }

  function requestRemoveExpense(): void {
    if (draft.otherText.trim() !== "" || draft.otherNote.trim() !== "") {
      setConfirmingRemove(true);
      return;
    }
    update({ expenseOpen: false });
    touch();
  }

  function confirmRemoveExpense(): void {
    setConfirmingRemove(false);
    update({ expenseOpen: false, otherText: "", otherNote: "" });
    touch();
  }

  /** Dondurulmuş gövdeyi yollar ve sonucu işler; çağıran gövdeyi ÖNCEDEN taslağa dondurmuştur. */
  async function send(frozenBody: string, earlierAttempt: boolean): Promise<void> {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSending(true);
    setMessage(null);
    const outcome = await postCorrect(entry.id, frozenBody, csrfToken, targetVehicleId);
    inFlightRef.current = false;
    setSending(false);
    if (outcome.kind === "ambiguous") return; // taslak `pending` kalır: form kilitli, tekrar dene.
    if (outcome.kind === "corrected") {
      onEntry(outcome.entry);
      persistDraft(() => correctDraftFromEntry(outcome.entry, randomRequestId));
      setOpen(false);
      setSubmitted(false);
      setPersonError(null);
      setServerFields({});
      setCorrected(true);
      return;
    }
    setMessage(outcome.fields.change ?? workEntryErrorMessage(outcome.status, outcome.code));
    // Daha önce ulaşmış olabilecek denemede yazılmadığı kanıtlanmadıysa taslak bekleyen kalır.
    if (!shouldReleaseAfterCorrectError(outcome, earlierAttempt)) return;
    persistDraft((prev) => releaseCorrectDraft(prev, randomRequestId));
    if (correctErrorNeedsReread(outcome)) {
      // Kullanıcının değerleri taslakta kalır; güncel kayıt yanında görünür.
      const failure = await onReread();
      if (failure) setMessage(failure);
      return;
    }
    if (outcome.status === 422) {
      setServerFields(outcome.fields);
      if (outcome.fields.workerPersonId) {
        setPersonError(outcome.fields.workerPersonId);
        void loadList();
      }
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlightRef.current || stale || disabled) return;
    if (draft.pending && draft.frozenBody !== null) {
      // Belirsiz sonuç: dondurulmuş gövde aynen, aynı requestId ile.
      await send(draft.frozenBody, hasEarlierAttempt(draft));
      return;
    }
    setSubmitted(true);
    setMessage(null);
    setServerFields({});
    setCorrected(false);

    let hasError = !evaluation.ok;
    if (draft.personId === "") {
      setPersonError(TEXT.managedPersonRequired);
      hasError = true;
    }
    if (!grossResult.ok || !fuelResult.ok || !receivedResult.ok || (otherResult && !otherResult.ok)) hasError = true;
    if (summary.status === "invalid") hasError = true;
    if (hasError) return;
    if (!dirty) {
      setMessage(DRIVER_FIELD_MESSAGES.noChange);
      return;
    }

    setPersonError(null);
    const body = buildWorkEntryCorrectBody(draft);
    if (!body) {
      setMessage(TEXT.connectionFailed);
      return;
    }
    const frozenBody = JSON.stringify(body);
    // Gövde fetch'ten ÖNCE dondurulur; `attemptSent` de fetch'ten ÖNCE yazılır.
    persistDraft((prev) => ({ ...prev, pending: true, frozenBody, requestId: body.requestId, attemptSent: true }));
    await send(frozenBody, false);
  }

  if (!visible) {
    return (
      <div className="flex flex-col gap-3">
        {corrected && (
          <p role="status" className="text-2xl font-semibold text-[var(--color-success)]">
            {COMMON_SCREEN_MESSAGES.correctedAndConfirmed}
          </p>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={openForm}
          className="inline-flex min-h-[var(--control-min-height)] items-center self-start rounded-[var(--radius-control)] px-1 text-base font-medium text-[var(--color-primary)] underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          {TEXT.editTitle}
        </button>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-[var(--color-text)]">{TEXT.correctTitle}</h2>

      {stale && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-3 text-base text-[var(--color-error)]"
        >
          <p>{COMMON_SCREEN_MESSAGES.concurrentEditConflict}</p>
          <p className="font-medium">{TEXT.yourDraftTitle}</p>
          <button
            type="button"
            onClick={() => {
              persistDraft(() => correctDraftFromEntry(entry, randomRequestId));
              touch();
            }}
            className={secondaryButtonClass}
          >
            {TEXT.useCurrent}
          </button>
          <button
            type="button"
            onClick={() => {
              persistDraft((prev) => rebaseCorrectDraft(prev, entry.version, randomRequestId));
              touch();
            }}
            className={secondaryButtonClass}
          >
            {TEXT.keepMine}
          </button>
        </div>
      )}

      <fieldset disabled={locked} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
        <Field id="correct-date" label={TEXT.dateLabel} error={dateError}>
          <input
            id="correct-date"
            type="date"
            value={draft.date}
            onChange={(event) => {
              update({ date: event.target.value });
              touch();
            }}
            aria-invalid={dateError ? true : undefined}
            aria-describedby={dateError ? "correct-date-error" : undefined}
            className={controlClass}
          />
        </Field>

        <Field id="correct-person" label={TEXT.personLabel} error={personError ?? undefined}>
          <select
            id="correct-person"
            value={draft.personId}
            disabled={list.status === "loading"}
            onChange={(event) => {
              update({ personId: event.target.value });
              setPersonError(null);
              touch();
            }}
            aria-invalid={personError ? true : undefined}
            aria-describedby={personError ? "correct-person-error" : list.status === "error" ? "correct-person-list-error" : undefined}
            className={controlClass}
          >
            {personOptions.map((option) => (
              <option key={option.personId} value={option.personId}>
                {option.label}
              </option>
            ))}
          </select>
          {list.status === "error" && (
            <div className="mt-2 flex flex-col gap-2">
              <p id="correct-person-list-error" role="alert" className="text-base text-[var(--color-error)]">
                {list.message}
              </p>
              {list.retryable && (
                <button type="button" disabled={sending} onClick={() => void loadList()} className={secondaryButtonClass}>
                  {TEXT.retry}
                </button>
              )}
            </div>
          )}
        </Field>

        <Field id="correct-start" label={TEXT.startLabel} error={startError}>
          <input
            id="correct-start"
            type="time"
            value={draft.startTime}
            onChange={(event) => {
              update({ startTime: event.target.value });
              touch();
            }}
            aria-invalid={startError ? true : undefined}
            aria-describedby={startError ? "correct-start-error" : undefined}
            className={controlClass}
          />
        </Field>

        <div>
          <Field id="correct-end" label={TEXT.endLabel} error={endError}>
            <input
              id="correct-end"
              type="time"
              value={draft.endTime}
              onChange={(event) => {
                update({ endTime: event.target.value });
                touch();
              }}
              aria-invalid={endError ? true : undefined}
              aria-describedby={endError ? "correct-end-error" : undefined}
              className={controlClass}
            />
          </Field>
          <label
            htmlFor="correct-next-day"
            className="mt-2 flex min-h-[var(--control-min-height)] items-center gap-3 text-base text-[var(--color-text)]"
          >
            <input
              id="correct-next-day"
              type="checkbox"
              checked={draft.endsNextDay}
              onChange={(event) => {
                update({ endsNextDay: event.target.checked });
                touch();
              }}
              className="size-6"
            />
            {TEXT.nextDayLabel}
          </label>
          {evaluation.ok && (
            <p role="status" className="mt-2 text-lg font-medium text-[var(--color-text)]">
              {TEXT.duration(formatDuration(evaluation.durationMinutes))}
            </p>
          )}
        </div>

        <Field id="correct-gross" label={TEXT.grossLabel} error={grossError}>
          <input
            id="correct-gross"
            {...amountInputProps}
            value={draft.grossText}
            onChange={(event) => {
              update({ grossText: event.target.value });
              touch();
            }}
            aria-invalid={grossError ? true : undefined}
            aria-describedby={grossError ? "correct-gross-error" : undefined}
            className={`${controlClass} tabular-nums`}
          />
        </Field>

        <Field id="correct-fuel" label={TEXT.fuelLabel} error={fuelError}>
          <input
            id="correct-fuel"
            {...amountInputProps}
            value={draft.fuelText}
            onChange={(event) => {
              update({ fuelText: event.target.value });
              touch();
            }}
            aria-invalid={fuelError ? true : undefined}
            aria-describedby={fuelError ? "correct-fuel-error" : undefined}
            className={`${controlClass} tabular-nums`}
          />
        </Field>

        {draft.expenseOpen ? (
          <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--color-divider)] p-4">
            <Field id="correct-other" label={TEXT.otherExpenseLabel} error={otherError}>
              <input
                id="correct-other"
                {...amountInputProps}
                value={draft.otherText}
                onChange={(event) => {
                  update({ otherText: event.target.value });
                  touch();
                }}
                aria-invalid={otherError ? true : undefined}
                aria-describedby={otherError ? "correct-other-error" : undefined}
                className={`${controlClass} tabular-nums`}
              />
            </Field>
            <Field id="correct-other-note" label={TEXT.otherExpenseNoteLabel}>
              <input
                id="correct-other-note"
                type="text"
                maxLength={OTHER_NOTE_MAX_LENGTH}
                autoComplete="off"
                value={draft.otherNote}
                onChange={(event) => {
                  update({ otherNote: event.target.value });
                  touch();
                }}
                className={controlClass}
              />
            </Field>
            <button type="button" onClick={requestRemoveExpense} className={secondaryButtonClass}>
              {TEXT.removeExpense}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              update({ expenseOpen: true });
              touch();
            }}
            className={secondaryButtonClass}
          >
            {TEXT.addExpense}
          </button>
        )}

        <div
          id="correct-summary"
          role="status"
          aria-live="polite"
          aria-label={TEXT.summaryTitle}
          className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] p-4 text-lg tabular-nums"
        >
          <p className="flex justify-between gap-4">
            <span>{TEXT.onBehalfShareLabel}</span>
            <span className="font-semibold">{summary.status === "ready" ? formatTlAmount(summary.shareCents) : "—"}</span>
          </p>
          <p className="flex justify-between gap-4">
            <span>{TEXT.newExpectedLabel}</span>
            <span className="font-semibold">{summary.status === "ready" ? formatTlAmount(summary.remainderCents) : "—"}</span>
          </p>
          {summary.status === "ready" && summary.remainderCents < 0 && (
            <p className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
              {TEXT.remainderNegative}
            </p>
          )}
        </div>

        <Field id="correct-received" label={onBehalf ? TEXT.receivedLabelOnBehalf : TEXT.receivedLabel} error={receivedError}>
          <input
            id="correct-received"
            {...amountInputProps}
            value={draft.receivedText}
            onChange={(event) => {
              update({ receivedText: event.target.value });
              touch();
            }}
            aria-invalid={receivedError ? true : undefined}
            aria-describedby={receivedError ? "correct-received-error" : undefined}
            className={`${controlClass} tabular-nums`}
          />
          {difference && (
            <p role="status" className="mt-2 text-base text-[var(--color-text-secondary)]">
              {difference.kind === "shortfall"
                ? TEXT.receivedShortfall(formatTlAmount(difference.cents))
                : TEXT.receivedExcess(formatTlAmount(difference.cents))}
            </p>
          )}
        </Field>
      </fieldset>

      <ConfirmDialog
        open={confirmingRemove}
        title={TEXT.removeExpenseTitle}
        description={TEXT.removeExpenseDescription}
        confirmLabel={TEXT.removeExpenseConfirm}
        cancelLabel={TEXT.removeExpenseCancel}
        onConfirm={confirmRemoveExpense}
        onCancel={() => setConfirmingRemove(false)}
      />
      <ConfirmDialog
        open={confirmingDiscard}
        title={TEXT.correctDiscardTitle}
        description={TEXT.correctDiscardDescription}
        confirmLabel={TEXT.correctDiscardConfirm}
        cancelLabel={TEXT.correctDiscardBack}
        onConfirm={closeForm}
        onCancel={() => setConfirmingDiscard(false)}
      />

      {message && !stale && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
          {message}
        </p>
      )}
      {draft.pending && !sending && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          {TEXT.correctUnknownResult}
        </p>
      )}

      {!stale && (
        <button type="submit" disabled={sending || disabled} className={primaryButtonClass}>
          {sending ? TEXT.correctSending : draft.pending ? TEXT.confirmRetry : TEXT.correctSubmit}
        </button>
      )}
      {!draft.pending && !sending && (
        <button type="button" onClick={requestCancel} className={secondaryButtonClass}>
          {TEXT.correctCancel}
        </button>
      )}
    </form>
  );
}
