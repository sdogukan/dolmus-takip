"use client";

/**
 * Sahip raporunun "Kişiler" bölümü: kişi kartları ve kişi ayrıntısı. Üst bileşen
 * (`./vehicle-period-report.tsx`) bunu YALNIZ araç raporu yüklendiğinde ve
 * (dönem, dönem ilk günü) anahtarıyla oluşturur; dönem değişince bileşen sökülür
 * ve hiçbir önceki durum kalmaz. Ayrıntı da kişi kimliğiyle anahtarlanır, her
 * istek kendi AbortController'ını taşır ve sökülünce kesilir — eski kişinin veya
 * dönemin yanıtı yeni başlığın altında görünmez. Yükleniyor / hata / oturum
 * bitti durumlarında kart veya tutar basılmaz; boş durum yalnız başarılı boş
 * yanıttan sonra çıkar. Sunucunun `error.message`'ı basılmaz; tarayıcı
 * depolamasına bir şey yazılmaz.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { COMMON_SCREEN_MESSAGES, REPORT_MESSAGES as REPORT_TEXT } from "../../lib/messages";
import type { ReportPeriodKind } from "../../lib/report-period";
import {
  buildPeoplePeriodReportUrl,
  buildPersonPeriodReportUrl,
  parsePeoplePeriodReport,
  parsePersonPeriodReport,
  peoplePeriodReportView,
  personDetailView,
  personEntryView,
  type PeoplePeriodReportView,
  type PersonDetailView,
  type PersonPeriodReportData,
  type PersonEntryView,
} from "../../lib/report-ui";
import { secondaryButtonClass } from "./work-entry-form";

const TEXT = REPORT_TEXT.people;

type FetchResult<T> = { kind: "ok"; value: T } | { kind: "unauthorized" } | { kind: "error" };

/** İstek + durum/gövde sınıflaması; kesilen istek `throw` eder (çağıran yok sayar). */
async function fetchParsed<T>(url: string, parse: (body: unknown) => T | null, signal: AbortSignal): Promise<FetchResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: "same-origin" });
  } catch (error) {
    if (signal.aborted) throw error;
    return { kind: "error" };
  }
  if (response.status === 401) return { kind: "unauthorized" };
  if (!response.ok) return { kind: "error" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return { kind: "error" };
  }
  const value = parse(body);
  return value === null ? { kind: "error" } : { kind: "ok", value };
}

const tabClass =
  "min-h-[var(--control-min-height)] rounded-[var(--radius-control)] border border-[var(--color-primary)] bg-[var(--color-primary)] px-4 text-base font-medium text-[var(--color-on-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]";

const cardClass =
  "flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] p-4 text-[var(--color-text)]";

function Problem({ unauthorized, onRetry }: { unauthorized: boolean; onRetry: () => void }) {
  if (unauthorized) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-base text-[var(--color-error)]">
          {COMMON_SCREEN_MESSAGES.sessionEnded}
        </p>
        <Link href="/giris" className={`${secondaryButtonClass} inline-flex items-center`}>
          {REPORT_TEXT.loginAgain}
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p role="alert" className="text-base text-[var(--color-error)]">
        {COMMON_SCREEN_MESSAGES.reportLoadFailed}
      </p>
      <button type="button" onClick={onRetry} className={secondaryButtonClass}>
        {REPORT_TEXT.retry}
      </button>
    </div>
  );
}

type DetailState =
  | { status: "loading" }
  | { status: "loaded"; view: PersonDetailView; entries: PersonEntryView[]; nextCursor: string | null }
  | { status: "error" }
  | { status: "unauthorized" };

interface PersonDetailProps {
  personId: string;
  fullName: string;
  period: ReportPeriodKind;
  date: string;
  onBack: () => void;
}

function PersonDetail({ personId, fullName, period, date, onBack }: PersonDetailProps) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const moreControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      let result: FetchResult<PersonPeriodReportData>;
      try {
        result = await fetchParsed(buildPersonPeriodReportUrl(personId, period, date), parsePersonPeriodReport, controller.signal);
      } catch {
        return; // kesildi: sonraki istek durumu belirler
      }
      if (controller.signal.aborted) return;
      if (result.kind === "ok") {
        const view = personDetailView(result.value);
        setState({ status: "loaded", view, entries: view.entries, nextCursor: view.nextCursor });
      } else {
        setState({ status: result.kind === "unauthorized" ? "unauthorized" : "error" });
      }
    })();
    return () => {
      controller.abort();
      moreControllerRef.current?.abort();
    };
  }, [personId, period, date, attempt]);

  function retry(): void {
    setState({ status: "loading" });
    setMoreFailed(false);
    setLoadingMore(false);
    setAttempt((value) => value + 1);
  }

  async function loadMore(cursor: string): Promise<void> {
    moreControllerRef.current?.abort();
    const controller = new AbortController();
    moreControllerRef.current = controller;
    setLoadingMore(true);
    setMoreFailed(false);
    let result;
    try {
      result = await fetchParsed(buildPersonPeriodReportUrl(personId, period, date, cursor), parsePersonPeriodReport, controller.signal);
    } catch {
      return;
    }
    if (controller.signal.aborted) return;
    setLoadingMore(false);
    if (result.kind === "ok") {
      const page = result.value;
      setState((prev) =>
        prev.status === "loaded"
          ? { ...prev, entries: [...prev.entries, ...page.entries.map(personEntryView)], nextCursor: page.nextCursor }
          : prev,
      );
    } else if (result.kind === "unauthorized") {
      setState({ status: "unauthorized" });
    } else {
      setMoreFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className={`${secondaryButtonClass} self-start`}>
        {TEXT.back}
      </button>
      <h3 className="break-words text-lg font-semibold text-[var(--color-text)]">{fullName}</h3>

      {state.status === "loading" && (
        <p role="status" className="text-base text-[var(--color-text-secondary)]">
          {TEXT.detailLoading}
        </p>
      )}
      {(state.status === "error" || state.status === "unauthorized") && (
        <Problem unauthorized={state.status === "unauthorized"} onRetry={retry} />
      )}

      {state.status === "loaded" && (
        <>
          <p className="text-base text-[var(--color-text-secondary)]">{state.view.summary}</p>
          <dl aria-label={TEXT.detailSummaryLabel} className="m-0 flex flex-col gap-2">
            {state.view.totals.map((row) => (
              <div key={row.label} className="flex flex-wrap justify-between gap-x-3 text-base">
                <dt className="text-[var(--color-text-secondary)]">{row.label}</dt>
                <dd className="m-0 tabular-nums text-[var(--color-text)]">{row.value}</dd>
              </div>
            ))}
          </dl>
          <h4 className="text-base font-semibold text-[var(--color-text)]">{TEXT.entriesHeading}</h4>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {state.entries.map((entry) => (
              <li key={entry.id} className={cardClass}>
                <span className="text-lg font-semibold">{entry.dateText}</span>
                <span className="text-base">
                  {entry.timeText} · {entry.durationText}
                </span>
                <span className="text-base tabular-nums">{entry.amounts}</span>
                <span className="text-base tabular-nums">
                  {TEXT.totals.remainder}: {entry.remainder}
                </span>
                <span className="text-base text-[var(--color-text-secondary)]">{entry.statusText}</span>
                <Link href={entry.href} className={`${secondaryButtonClass} inline-flex items-center`}>
                  {TEXT.openEntry}
                </Link>
              </li>
            ))}
          </ul>
          {moreFailed && (
            <p role="alert" className="text-base text-[var(--color-error)]">
              {COMMON_SCREEN_MESSAGES.reportLoadFailed}
            </p>
          )}
          {state.nextCursor !== null && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore(state.nextCursor as string)}
              className={secondaryButtonClass}
            >
              {loadingMore ? TEXT.loadingMore : moreFailed ? REPORT_TEXT.retry : TEXT.loadMore}
            </button>
          )}
        </>
      )}
    </div>
  );
}

type PeopleState =
  | { status: "loading" }
  | { status: "loaded"; view: PeoplePeriodReportView }
  | { status: "error" }
  | { status: "unauthorized" };

export function PeoplePeriodReport({ period, date }: { period: ReportPeriodKind; date: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PeopleState>({ status: "loading" });
  const [selected, setSelected] = useState<{ personId: string; fullName: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      let result;
      try {
        result = await fetchParsed(buildPeoplePeriodReportUrl(period, date), parsePeoplePeriodReport, controller.signal);
      } catch {
        return; // kesildi: sonraki istek durumu belirler
      }
      if (controller.signal.aborted) return;
      setState(
        result.kind === "ok"
          ? { status: "loaded", view: peoplePeriodReportView(result.value) }
          : { status: result.kind === "unauthorized" ? "unauthorized" : "error" },
      );
    })();
    return () => controller.abort();
  }, [period, date, attempt]);

  function retry(): void {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  return (
    <section className="flex flex-col gap-4">
      <div role="tablist" aria-label={TEXT.sectionTabsLabel} className="grid grid-cols-1 gap-2">
        <button type="button" role="tab" aria-selected="true" className={tabClass}>
          {TEXT.tab}
        </button>
      </div>
      <div role="tabpanel" className="flex flex-col gap-4">
        {selected ? (
          <PersonDetail
            key={selected.personId}
            personId={selected.personId}
            fullName={selected.fullName}
            period={period}
            date={date}
            onBack={() => setSelected(null)}
          />
        ) : (
          <>
            {state.status === "loading" && (
              <p role="status" className="text-base text-[var(--color-text-secondary)]">
                {TEXT.loading}
              </p>
            )}
            {(state.status === "error" || state.status === "unauthorized") && (
              <Problem unauthorized={state.status === "unauthorized"} onRetry={retry} />
            )}
            {state.status === "loaded" && state.view.isEmpty && (
              <p role="status" className="text-base text-[var(--color-text-secondary)]">
                {TEXT.empty}
              </p>
            )}
            {state.status === "loaded" && !state.view.isEmpty && (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {state.view.cards.map((card) => (
                  <li key={card.personId} className={cardClass}>
                    <p id={`person-${card.personId}`} className="m-0 flex flex-wrap gap-x-2 text-lg font-semibold">
                      <span className="break-words">{card.fullName}</span>
                      {card.ownerLabel !== null && (
                        <span className="text-[var(--color-text-secondary)]">{card.ownerLabel}</span>
                      )}
                    </p>
                    <p className="m-0 text-base">{card.summary}</p>
                    <p className="m-0 text-base tabular-nums">{card.amounts}</p>
                    <button
                      type="button"
                      aria-describedby={`person-${card.personId}`}
                      onClick={() => setSelected({ personId: card.personId, fullName: card.fullName })}
                      className={secondaryButtonClass}
                    >
                      {TEXT.openDetail}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
