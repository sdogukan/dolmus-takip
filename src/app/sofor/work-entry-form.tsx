"use client";

/**
 * Şoförün günlük kayıt formu (T3.1). Bu paket KAYIT YAZMAZ: gönderim yalnız
 * alanları doğrular ve seçilen kişiyi `GET /api/v1/drivers`ten TAZE okuyup
 * hâlâ seçilebilir mi diye kontrol eder; "Kaydedildi" hiçbir yerde denmez.
 *
 * Liste durumları AYRIDIR: loading / loaded / empty / error. Ağ hatası,
 * 401/403 veya 5xx "boş liste" metnini ASLA göstermez; yalnız `200` +
 * `drivers: []` boş durumdur. Üst üste binen istekler: her istek bir sıra
 * numarası taşır ve öncekini keser; eski yanıt yeni listeyi EZEMEZ.
 * İstemcideki liste yetki VERMEZ (kişi kimliği yalnız seçim değeridir, hiçbir
 * istekte yetki olarak gönderilmez) ve tarayıcı depolamasına yazılmaz.
 * "Bugün" sunucuda BİR KEZ hesaplanıp prop gelir (hydration'da kaymaz).
 *
 * T3.2: hasılat/mazot zorunlu (açık 0 geçerli), tek "diğer masraf" + açıklama
 * isteğe bağlı. Şoför payı ve teslim edilecek tutar tarayıcıda CANLI ve
 * YALNIZ GÖSTERİM olarak hesaplanır (düzenlenebilir kontrol değil, hiçbir
 * isteğe gönderilmez, depolamaya yazılmaz); eksik/geçersiz girdide "—" görünür.
 */
import { useEffect, useRef, useState } from "react";
import { adminReadErrorMessage } from "../../lib/admin-search";
import { COMMON_SCREEN_MESSAGES, WORK_ENTRY_MESSAGES as TEXT } from "../../lib/messages";
import { formatTlAmount, parseTlAmount, type ParseTlResult } from "../../lib/money";
import { AmountOutOfRangeError, calculateWorkEntryAmounts } from "../../lib/work-calculation";
import { evaluateWorkTime, formatDuration, formatWorkDate } from "../../lib/work-time";
import { ConfirmDialog } from "../_components/confirm-dialog";

interface SelectableDriver {
  personId: string;
  fullName: string;
}

type ListState =
  | { status: "loading" }
  | { status: "loaded"; drivers: SelectableDriver[] }
  | { status: "error"; message: string; retryable: boolean };

type FetchResult =
  | { ok: true; drivers: SelectableDriver[] }
  | { ok: false; message: string; retryable: boolean };

function parseDrivers(body: unknown): SelectableDriver[] | null {
  const list = (body as { drivers?: unknown } | null)?.drivers;
  if (!Array.isArray(list)) return null;
  const drivers: SelectableDriver[] = [];
  for (const item of list as Array<Partial<SelectableDriver> | null>) {
    if (typeof item?.personId !== "string" || typeof item.fullName !== "string") return null;
    drivers.push({ personId: item.personId, fullName: item.fullName });
  }
  return drivers;
}

async function fetchDrivers(signal: AbortSignal): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetch("/api/v1/drivers", { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, message: adminReadErrorMessage(null), retryable: true };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return {
      ok: false,
      message: adminReadErrorMessage(response.ok ? null : response.status),
      retryable: response.status !== 401,
    };
  }
  if (!response.ok) {
    const code = (body as { error?: { code?: string } } | null)?.error?.code;
    return {
      ok: false,
      message: adminReadErrorMessage(response.status, code),
      retryable: response.status !== 401,
    };
  }
  const drivers = parseDrivers(body);
  if (!drivers) return { ok: false, message: adminReadErrorMessage(null), retryable: true };
  return { ok: true, drivers };
}

const labelClass = "block text-lg font-medium text-[var(--color-text)]";
const controlClass =
  "mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]";
const errorTextClass = "mt-1 text-base text-[var(--color-error)]";
const secondaryButtonClass =
  "min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70";
const primaryButtonClass =
  "min-h-14 w-full rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-lg font-semibold text-[var(--color-on-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:opacity-70";

const OTHER_NOTE_MAX_LENGTH = 200;
const amountInputProps = { type: "text", inputMode: "decimal", autoComplete: "off" } as const;

type SummaryState =
  | { status: "invalid"; tooLarge: boolean }
  | { status: "ready"; shareCents: number; remainderCents: number };

function computeSummary(
  gross: ParseTlResult,
  fuel: ParseTlResult,
  other: ParseTlResult | null,
): SummaryState {
  // `other === null` = kullanılmayan bölüm (0); geçersizse özet "—" olur.
  if (!gross.ok || !fuel.ok || (other !== null && !other.ok)) {
    return { status: "invalid", tooLarge: false };
  }
  try {
    const amounts = calculateWorkEntryAmounts(
      "driver",
      gross.cents,
      fuel.cents,
      other?.ok ? other.cents : 0n,
    );
    return {
      status: "ready",
      shareCents: amounts.shareCents,
      remainderCents: amounts.remainderCents,
    };
  } catch (error) {
    if (error instanceof AmountOutOfRangeError) return { status: "invalid", tooLarge: true };
    throw error;
  }
}

export function WorkEntryForm({ today }: { today: string }) {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [date, setDate] = useState(today);
  const [personId, setPersonId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [endsNextDay, setEndsNextDay] = useState(false);
  const [grossText, setGrossText] = useState("");
  const [fuelText, setFuelText] = useState("");
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [otherNote, setOtherNote] = useState("");
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [checkedNote, setCheckedNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const sequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  /** Yeni istek başlatır; öncekini keser. `null` = kesildi/eski yanıt. */
  async function request(): Promise<FetchResult | null> {
    const sequence = ++sequenceRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let result: FetchResult;
    try {
      result = await fetchDrivers(controller.signal);
    } catch {
      return null;
    }
    return sequence === sequenceRef.current ? result : null;
  }

  function applyList(result: FetchResult): void {
    if (result.ok) {
      setPersonId((current) =>
        result.drivers.some((driver) => driver.personId === current) ? current : "",
      );
    }
    setList(
      result.ok
        ? { status: "loaded", drivers: result.drivers }
        : { status: "error", message: result.message, retryable: result.retryable },
    );
  }

  async function loadList(): Promise<void> {
    setList({ status: "loading" });
    const result = await request();
    if (result) applyList(result);
  }

  useEffect(() => {
    // İlk yükleme: durum zaten "loading" (senkron setState yok).
    void request().then((result) => {
      if (result) applyList(result);
    });
    return () => {
      sequenceRef.current += 1;
      controllerRef.current?.abort();
    };
    // Yalnız mount'ta bir kez; request/applyList ref/set fonksiyonlarını kullanır.
  }, []);

  function touch(): void {
    setCheckedNote(null);
    setFormMessage(null);
  }

  const timeInput = { date, startTime, endTime, endsNextDay };
  const evaluation = evaluateWorkTime(timeInput);
  const fieldErrors = evaluation.ok ? {} : evaluation.errors;
  // Süre/sıra ilişkisi hataları saatler dolunca CANLI görünür; eksik alan
  // hataları gönderimden sonra.
  const relationVisible = startTime !== "" && endTime !== "";
  const dateError = submitted ? fieldErrors.date : undefined;
  const startError = submitted ? fieldErrors.startTime : undefined;
  const endError =
    fieldErrors.endTime && (submitted || relationVisible) ? fieldErrors.endTime : undefined;

  const grossResult = parseTlAmount(grossText);
  const fuelResult = parseTlAmount(fuelText);
  // Tutar boş + açıklama boş = kullanılmadı (0); açıklamalı boş tutar 0 SAYILMAZ.
  const otherUsed = expenseOpen && (otherText.trim() !== "" || otherNote.trim() !== "");
  const otherResult = otherUsed ? parseTlAmount(otherText) : null;
  const summary = computeSummary(grossResult, fuelResult, otherResult);
  const grossError = submitted && !grossResult.ok ? grossResult.message : undefined;
  const fuelError =
    submitted && !fuelResult.ok
      ? fuelResult.message
      : submitted && summary.status === "invalid" && summary.tooLarge
        ? TEXT.amountsTooLarge
        : undefined;
  const otherError = submitted && otherResult && !otherResult.ok ? otherResult.message : undefined;

  function requestRemoveExpense(): void {
    if (otherText.trim() !== "" || otherNote.trim() !== "") {
      setConfirmingRemove(true);
      return;
    }
    setExpenseOpen(false);
    touch();
  }

  function confirmRemoveExpense(): void {
    setConfirmingRemove(false);
    setExpenseOpen(false);
    setOtherText("");
    setOtherNote("");
    touch();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setSubmitted(true);
    setCheckedNote(null);
    setFormMessage(null);

    let hasError = !evaluation.ok;
    if (personId === "") {
      setPersonError(TEXT.personRequired);
      hasError = true;
    }
    if (!grossResult.ok || !fuelResult.ok || (otherResult && !otherResult.ok)) hasError = true;
    if (summary.status === "invalid") hasError = true;
    if (hasError || !evaluation.ok) return;

    // Kişi hâlâ seçilebilir mi — istemci listesine GÜVENİLMEZ, taze okunur.
    setSubmitting(true);
    const result = await request();
    setSubmitting(false);
    if (!result) return;
    if (!result.ok) {
      setFormMessage(
        result.retryable ? TEXT.connectionFailed : COMMON_SCREEN_MESSAGES.sessionEnded,
      );
      return;
    }
    applyList(result);
    const person = result.drivers.find((driver) => driver.personId === personId);
    if (!person) {
      setPersonId("");
      setPersonError(TEXT.personUnavailable);
      return;
    }
    setPersonError(null);
    setCheckedNote(
      `${person.fullName} · ${formatWorkDate(evaluation.workDate)} · ${formatDuration(
        evaluation.durationMinutes,
      )}. ${TEXT.notSavedYet}`,
    );
  }

  const drivers = list.status === "loaded" ? list.drivers : [];
  const personDescribedBy = personError
    ? "work-person-error"
    : list.status === "loaded" && drivers.length === 0
      ? "work-person-empty"
      : list.status === "error"
        ? "work-person-list-error"
        : undefined;

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
      <div>
        <label htmlFor="work-date" className={labelClass}>
          {TEXT.dateLabel}
        </label>
        <input
          id="work-date"
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            touch();
          }}
          aria-invalid={dateError ? true : undefined}
          aria-describedby={dateError ? "work-date-error" : "work-date-display"}
          className={controlClass}
        />
        <p id="work-date-display" className="mt-1 text-base text-[var(--color-text-secondary)]">
          {formatWorkDate(date)}
        </p>
        {dateError && (
          <p id="work-date-error" role="alert" className={errorTextClass}>
            {dateError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="work-person" className={labelClass}>
          {TEXT.personLabel}
        </label>
        <select
          id="work-person"
          value={personId}
          disabled={list.status !== "loaded" || drivers.length === 0}
          onChange={(event) => {
            setPersonId(event.target.value);
            setPersonError(null);
            touch();
          }}
          aria-invalid={personError ? true : undefined}
          aria-describedby={personDescribedBy}
          className={controlClass}
        >
          <option value="">
            {list.status === "loading" ? TEXT.personLoading : TEXT.personPlaceholder}
          </option>
          {drivers.map((driver) => (
            <option key={driver.personId} value={driver.personId}>
              {driver.fullName}
            </option>
          ))}
        </select>
        {list.status === "loaded" && drivers.length === 0 && (
          <p id="work-person-empty" role="status" className="mt-1 text-base text-[var(--color-text-secondary)]">
            {TEXT.personEmpty}
          </p>
        )}
        {list.status === "error" && (
          <div className="mt-2 flex flex-col gap-2">
            <p id="work-person-list-error" role="alert" className="text-base text-[var(--color-error)]">
              {list.message}
            </p>
            {list.retryable && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void loadList()}
                className={secondaryButtonClass}
              >
                {TEXT.retry}
              </button>
            )}
          </div>
        )}
        {personError && (
          <p id="work-person-error" role="alert" className={errorTextClass}>
            {personError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="work-start" className={labelClass}>
          {TEXT.startLabel}
        </label>
        <input
          id="work-start"
          type="time"
          value={startTime}
          onChange={(event) => {
            setStartTime(event.target.value);
            touch();
          }}
          aria-invalid={startError ? true : undefined}
          aria-describedby={startError ? "work-start-error" : undefined}
          className={controlClass}
        />
        {startError && (
          <p id="work-start-error" role="alert" className={errorTextClass}>
            {startError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="work-end" className={labelClass}>
          {TEXT.endLabel}
        </label>
        <input
          id="work-end"
          type="time"
          value={endTime}
          onChange={(event) => {
            setEndTime(event.target.value);
            touch();
          }}
          aria-invalid={endError ? true : undefined}
          aria-describedby={endError ? "work-end-error" : undefined}
          className={controlClass}
        />
        <label
          htmlFor="work-next-day"
          className="mt-2 flex min-h-[var(--control-min-height)] items-center gap-3 text-base text-[var(--color-text)]"
        >
          <input
            id="work-next-day"
            type="checkbox"
            checked={endsNextDay}
            onChange={(event) => {
              setEndsNextDay(event.target.checked);
              touch();
            }}
            className="size-6"
          />
          {TEXT.nextDayLabel}
        </label>
        {endError && (
          <p id="work-end-error" role="alert" className={errorTextClass}>
            {endError}
          </p>
        )}
        {evaluation.ok && (
          <div role="status" className="mt-2 flex flex-col gap-1 text-base text-[var(--color-text)]">
            {endsNextDay && (
              <p>{TEXT.endsOn(formatWorkDate(evaluation.endDate), endTime)}</p>
            )}
            <p className="text-lg font-medium">
              {TEXT.duration(formatDuration(evaluation.durationMinutes))}
            </p>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="work-gross" className={labelClass}>
          {TEXT.grossLabel}
        </label>
        <input
          id="work-gross"
          {...amountInputProps}
          value={grossText}
          onChange={(event) => {
            setGrossText(event.target.value);
            touch();
          }}
          aria-invalid={grossError ? true : undefined}
          aria-describedby={grossError ? "work-gross-error" : undefined}
          className={`${controlClass} tabular-nums`}
        />
        {grossError && (
          <p id="work-gross-error" role="alert" className={errorTextClass}>
            {grossError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="work-fuel" className={labelClass}>
          {TEXT.fuelLabel}
        </label>
        <input
          id="work-fuel"
          {...amountInputProps}
          value={fuelText}
          onChange={(event) => {
            setFuelText(event.target.value);
            touch();
          }}
          aria-invalid={fuelError ? true : undefined}
          aria-describedby={fuelError ? "work-fuel-error" : undefined}
          className={`${controlClass} tabular-nums`}
        />
        {fuelError && (
          <p id="work-fuel-error" role="alert" className={errorTextClass}>
            {fuelError}
          </p>
        )}
      </div>

      {expenseOpen ? (
        <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--color-divider)] p-4">
          <div>
            <label htmlFor="work-other" className={labelClass}>
              {TEXT.otherExpenseLabel}
            </label>
            <input
              id="work-other"
              {...amountInputProps}
              value={otherText}
              onChange={(event) => {
                setOtherText(event.target.value);
                touch();
              }}
              aria-invalid={otherError ? true : undefined}
              aria-describedby={otherError ? "work-other-error" : undefined}
              className={`${controlClass} tabular-nums`}
            />
            {otherError && (
              <p id="work-other-error" role="alert" className={errorTextClass}>
                {otherError}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="work-other-note" className={labelClass}>
              {TEXT.otherExpenseNoteLabel}
            </label>
            <input
              id="work-other-note"
              type="text"
              maxLength={OTHER_NOTE_MAX_LENGTH}
              autoComplete="off"
              value={otherNote}
              onChange={(event) => {
                setOtherNote(event.target.value);
                touch();
              }}
              className={controlClass}
            />
          </div>
          <button type="button" onClick={requestRemoveExpense} className={secondaryButtonClass}>
            {TEXT.removeExpense}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setExpenseOpen(true);
            touch();
          }}
          className={secondaryButtonClass}
        >
          {TEXT.addExpense}
        </button>
      )}

      <div
        id="work-summary"
        role="status"
        aria-live="polite"
        aria-label={TEXT.summaryTitle}
        className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] p-4 text-lg tabular-nums"
      >
        <p className="flex justify-between gap-4">
          <span>{TEXT.driverShareLabel}</span>
          <span className="font-semibold">
            {summary.status === "ready" ? formatTlAmount(summary.shareCents) : "—"}
          </span>
        </p>
        <p className="flex justify-between gap-4">
          <span>{TEXT.remainderLabel}</span>
          <span className="font-semibold">
            {summary.status === "ready" ? formatTlAmount(summary.remainderCents) : "—"}
          </span>
        </p>
        {summary.status === "ready" && summary.remainderCents < 0 && (
          <p className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
            {TEXT.remainderNegative}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmingRemove}
        title={TEXT.removeExpenseTitle}
        description={TEXT.removeExpenseDescription}
        confirmLabel={TEXT.removeExpenseConfirm}
        cancelLabel={TEXT.removeExpenseCancel}
        onConfirm={confirmRemoveExpense}
        onCancel={() => setConfirmingRemove(false)}
      />

      {formMessage && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
          {formMessage}
        </p>
      )}
      {checkedNote && (
        <p role="status" className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          {checkedNote}
        </p>
      )}

      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting ? TEXT.submitting : TEXT.submit}
      </button>
    </form>
  );
}
