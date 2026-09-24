"use client";

/**
 * Sahip özeti (/sahip): dönem seçimi, etiketli araç toplamları, "Teslim alınan
 * (onaylı)" bloğu ve "Henüz doğrulanmayan kayıtlar" listesi. Toplamlar ve liste
 * İKİ AYRI istektir; liste, yüklenen özetin sunucudan gelen (dönem, dönem ilk günü)
 * anahtarıyla oluşturulur, böylece ikisi aynı aralığı anlatır — ama tek anlık
 * görüntü garantisi verilmez. Her istek kendi AbortController'ını taşır; dönem
 * değişimi ikisini de keser ve eski seçimin yanıtı yeni aralığın altına yazılmaz.
 * Liste hatası/boşluğu yüklü toplamları silmez. Bileşen her bağlanışta ve geri-ileri
 * önbelleğinden dönüşte (`pageshow` persisted) sunucudan yeniden okur; hiçbir şey
 * modül düzeyinde veya tarayıcı depolamasında tutulmaz. Sunucunun `error.message`'ı
 * basılmaz.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { COMMON_SCREEN_MESSAGES, REPORT_MESSAGES as REPORT_TEXT } from "../../lib/messages";
import { REPORT_PERIOD_KINDS, type ReportPeriodKind } from "../../lib/report-period";
import {
  buildDailyEntriesUrl,
  buildOwnerSummaryUrl,
  dailyEntryCardView,
  ownerSummaryView,
  parseDailyEntriesPage,
  parseOwnerSummary,
  type DailyEntryCardView,
  type OwnerSummaryView,
} from "../../lib/report-ui";
import { cardClass, fetchParsed, Problem } from "./people-period-report";
import { controlClass, labelClass, secondaryButtonClass } from "./work-entry-form";

const TEXT = REPORT_TEXT.summary;
const MORE_TEXT = REPORT_TEXT.people;

type SummaryState =
  | { status: "loading" }
  | { status: "loaded"; view: OwnerSummaryView }
  | { status: "error" }
  | { status: "unauthorized" };

type PendingState =
  | { status: "loading" }
  | { status: "loaded"; cards: DailyEntryCardView[]; nextCursor: string | null }
  | { status: "error" }
  | { status: "unauthorized" };

interface SummaryQuery {
  period: ReportPeriodKind;
  /** `undefined` → sunucu bugünü kullanır. */
  date: string | undefined;
}

function PendingEntries({ period, date }: { period: ReportPeriodKind; date: string }) {
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<PendingState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const moreControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      let result;
      try {
        result = await fetchParsed(buildDailyEntriesUrl(period, date, { status: "pending" }), parseDailyEntriesPage, controller.signal);
      } catch {
        return; // kesildi: sonraki istek durumu belirler
      }
      if (controller.signal.aborted) return;
      if (result.kind === "ok") {
        setList({ status: "loaded", cards: result.value.entries.map(dailyEntryCardView), nextCursor: result.value.nextCursor });
      } else {
        setList({ status: result.kind === "unauthorized" ? "unauthorized" : "error" });
      }
    })();
    return () => {
      controller.abort();
      moreControllerRef.current?.abort();
    };
  }, [period, date, attempt]);

  function retry(): void {
    setList({ status: "loading" });
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
      result = await fetchParsed(buildDailyEntriesUrl(period, date, { status: "pending" }, cursor), parseDailyEntriesPage, controller.signal);
    } catch {
      return;
    }
    if (controller.signal.aborted) return;
    setLoadingMore(false);
    if (result.kind === "ok") {
      const page = result.value;
      setList((prev) =>
        prev.status === "loaded"
          ? { status: "loaded", cards: [...prev.cards, ...page.entries.map(dailyEntryCardView)], nextCursor: page.nextCursor }
          : prev,
      );
    } else if (result.kind === "unauthorized") {
      setList({ status: "unauthorized" });
    } else {
      setMoreFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {list.status === "loading" && (
        <p role="status" className="text-base text-[var(--color-text-secondary)]">
          {COMMON_SCREEN_MESSAGES.loading}
        </p>
      )}
      {(list.status === "error" || list.status === "unauthorized") && (
        <Problem unauthorized={list.status === "unauthorized"} onRetry={retry} />
      )}
      {list.status === "loaded" && list.cards.length === 0 && (
        <p role="status" className="text-base text-[var(--color-text-secondary)]">
          {TEXT.pendingEmpty}
        </p>
      )}
      {list.status === "loaded" && list.cards.length > 0 && (
        <>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {list.cards.map((card) => (
              <li key={card.id} className={cardClass}>
                <span className="break-words text-lg font-semibold">{card.personName}</span>
                <span className="text-base">
                  {card.dateText} · {card.timeText}
                </span>
                <span className="text-base tabular-nums">
                  {card.expectedLabel}: {card.expectedText}
                </span>
                <span className="text-base text-[var(--color-text-secondary)]">{card.statusText}</span>
                <Link href={card.href} className={`${secondaryButtonClass} inline-flex items-center`}>
                  {MORE_TEXT.openEntry}
                </Link>
              </li>
            ))}
          </ul>
          {moreFailed && (
            <p role="alert" className="text-base text-[var(--color-error)]">
              {COMMON_SCREEN_MESSAGES.reportLoadFailed}
            </p>
          )}
          {list.nextCursor !== null && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore(list.nextCursor as string)}
              className={secondaryButtonClass}
            >
              {loadingMore ? MORE_TEXT.loadingMore : moreFailed ? REPORT_TEXT.retry : MORE_TEXT.loadMore}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function OwnerSummary() {
  const [query, setQuery] = useState<SummaryQuery>({ period: "month", date: undefined });
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SummaryState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      let result;
      try {
        result = await fetchParsed(buildOwnerSummaryUrl(query.period, query.date), parseOwnerSummary, controller.signal);
      } catch {
        return; // kesildi: sonraki istek durumu belirler
      }
      if (controller.signal.aborted) return;
      setState(
        result.kind === "ok"
          ? { status: "loaded", view: ownerSummaryView(result.value) }
          : { status: result.kind === "unauthorized" ? "unauthorized" : "error" },
      );
    })();
    return () => controller.abort();
  }, [query, attempt]);

  // Geri-ileri önbelleğinden dönüş: sayfa bileşen durumuyla geri gelir; tutarlar yeniden okunur.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent): void {
      if (!event.persisted) return;
      setState({ status: "loading" });
      setAttempt((value) => value + 1);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  function go(next: SummaryQuery): void {
    setState({ status: "loading" });
    setQuery(next);
  }

  function retry(): void {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  const view = state.status === "loaded" ? state.view : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <label htmlFor="summary-period" className={labelClass}>
          {TEXT.periodLabel}
        </label>
        <select
          id="summary-period"
          value={query.period}
          onChange={(event) => go({ period: event.target.value as ReportPeriodKind, date: query.date })}
          className={controlClass}
        >
          {REPORT_PERIOD_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {REPORT_TEXT.periodTabs[kind]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!view}
          aria-label={REPORT_TEXT.previousLabel}
          onClick={() => view && go({ period: query.period, date: view.previousDate })}
          className={`${secondaryButtonClass} w-full self-auto`}
        >
          {REPORT_TEXT.previous}
        </button>
        <button
          type="button"
          disabled={!view}
          aria-label={REPORT_TEXT.nextLabel}
          onClick={() => view && go({ period: query.period, date: view.nextDate })}
          className={`${secondaryButtonClass} w-full self-auto`}
        >
          {REPORT_TEXT.next}
        </button>
      </div>

      {state.status === "loading" && (
        <p role="status" className="text-base text-[var(--color-text-secondary)]">
          {COMMON_SCREEN_MESSAGES.loading}
        </p>
      )}
      {(state.status === "error" || state.status === "unauthorized") && (
        <Problem unauthorized={state.status === "unauthorized"} onRetry={retry} />
      )}

      {view && (
        <section aria-label={view.rangeText} className="flex flex-col gap-6">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">{view.rangeText}</h2>
          {view.isEmpty ? (
            <p role="status" className="text-base text-[var(--color-text-secondary)]">
              {COMMON_SCREEN_MESSAGES.trulyEmptyPeriod}
            </p>
          ) : (
            <>
              <dl className="m-0 flex flex-col gap-2">
                {view.totals.map((row) => (
                  <div key={row.label} className="flex flex-wrap justify-between gap-x-3 text-lg text-[var(--color-text)]">
                    <dt>{row.label}</dt>
                    <dd className="m-0 font-semibold tabular-nums">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <div>
                <p className="flex flex-wrap justify-between gap-x-3 text-lg font-semibold text-[var(--color-text)]">
                  <span>{REPORT_TEXT.receivedLabel}</span>
                  <span className="tabular-nums">{view.received}</span>
                </p>
                <p className="text-base text-[var(--color-text-secondary)]">{TEXT.receivedHelp}</p>
              </div>
              <div className="flex flex-col gap-3">
                <h3 className="text-lg font-semibold text-[var(--color-text)]">{TEXT.pendingTitle(view.rangeText)}</h3>
                <PendingEntries key={`${query.period}|${view.startDate}`} period={query.period} date={view.startDate} />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
