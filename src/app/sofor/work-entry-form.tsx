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
 */
import { useEffect, useRef, useState } from "react";
import { adminReadErrorMessage } from "../../lib/admin-search";
import { COMMON_SCREEN_MESSAGES, WORK_ENTRY_MESSAGES as TEXT } from "../../lib/messages";
import { evaluateWorkTime, formatDuration, formatWorkDate } from "../../lib/work-time";

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

export function WorkEntryForm({ today }: { today: string }) {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [date, setDate] = useState(today);
  const [personId, setPersonId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [endsNextDay, setEndsNextDay] = useState(false);
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
