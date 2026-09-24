"use client";

/**
 * Sahip araç dönem raporu: hafta/ay/yıl sekmeleri, önceki/sonraki dönem,
 * "Hesaplanan kalan" ile "Teslim alınan (onaylı)" ve açılır hesap dökümü, altında
 * "Kişiler" / "Gün gün" bölüm sekmeleri (özet dönemin tamamıdır, bölümlerin
 * süzgeçlerinden etkilenmez).
 * Aralık metni ve gezinme çapaları sunucunun döndürdüğü dönemden gelir
 * (`../../lib/report-ui.ts`); hiçbir şey tarayıcı depolamasına yazılmaz.
 * Her istek öncekini keser (AbortController) ve eski yanıt yeni dönemi EZEMEZ.
 * Yükleniyor / boş / hata / oturum bitti durumları AYRIDIR ve hiçbirinde
 * önceki dönemin tutarı yeni başlığın altında kalmaz. Sunucunun `error.message`'ı
 * basılmaz.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { COMMON_SCREEN_MESSAGES, REPORT_MESSAGES as TEXT } from "../../lib/messages";
import { REPORT_PERIOD_KINDS, type ReportPeriodKind } from "../../lib/report-period";
import {
  buildVehiclePeriodReportUrl,
  parseVehiclePeriodReport,
  vehiclePeriodReportView,
  type VehiclePeriodReportView,
} from "../../lib/report-ui";
import { DailyEntriesReport } from "./daily-entries-report";
import { PeoplePeriodReport, reportLoginHref } from "./people-period-report";
import { secondaryButtonClass } from "./work-entry-form";

type ReportState =
  | { status: "loading" }
  | { status: "loaded"; view: VehiclePeriodReportView }
  | { status: "error" }
  | { status: "unauthorized" };

type ReportSection = "people" | "daily";

interface ReportQuery {
  period: ReportPeriodKind;
  /** `undefined` → sunucu bugünü kullanır. */
  date: string | undefined;
}

type FetchResult = { kind: "ok"; view: VehiclePeriodReportView } | { kind: "unauthorized" } | { kind: "error" };

async function fetchReport(query: ReportQuery, signal: AbortSignal, targetVehicleId?: string): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetch(buildVehiclePeriodReportUrl(query.period, query.date), {
      signal,
      credentials: "same-origin",
      headers: targetVehicleId ? { "X-Target-Vehicle": targetVehicleId } : undefined,
    });
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
  const report = parseVehiclePeriodReport(body);
  return report ? { kind: "ok", view: vehiclePeriodReportView(report) } : { kind: "error" };
}

const tabClass = (active: boolean): string =>
  `min-h-[var(--control-min-height)] rounded-[var(--radius-control)] border px-2 text-base font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
    active
      ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-on-primary)]"
      : "border-[var(--color-input-border)] text-[var(--color-text)]"
  }`;

const SECTIONS: { key: ReportSection; label: string }[] = [
  { key: "people", label: TEXT.people.tab },
  { key: "daily", label: TEXT.daily.tab },
];

/** `targetVehicleId` verilirse destek (ekip) modu: istekler `X-Target-Vehicle` taşır, bağlantılar yönetim sayfalarına gider. */
export function VehiclePeriodReport({ targetVehicleId }: { targetVehicleId?: string } = {}) {
  const [query, setQuery] = useState<ReportQuery>({ period: "month", date: undefined });
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ReportState>({ status: "loading" });
  const [section, setSection] = useState<ReportSection>("people");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      let result: FetchResult;
      try {
        result = await fetchReport(query, controller.signal, targetVehicleId);
      } catch {
        return; // kesildi: sonraki istek durumu belirler
      }
      if (controller.signal.aborted) return;
      setState(
        result.kind === "ok"
          ? { status: "loaded", view: result.view }
          : { status: result.kind === "unauthorized" ? "unauthorized" : "error" },
      );
    })();
    return () => controller.abort();
  }, [query, targetVehicleId, attempt]);

  // Geri-ileri önbelleğinden dönüş: sayfa bileşen durumuyla geri gelir; tutarlar temizlenip yeniden okunur.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent): void {
      if (!event.persisted) return;
      setState({ status: "loading" });
      setAttempt((value) => value + 1);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  function go(next: ReportQuery): void {
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
      <div role="group" aria-label={TEXT.periodTabsLabel} className="grid grid-cols-3 gap-2">
        {REPORT_PERIOD_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={query.period === kind}
            onClick={() => go({ period: kind, date: query.date })}
            className={tabClass(query.period === kind)}
          >
            {TEXT.periodTabs[kind]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!view}
          aria-label={TEXT.previousLabel}
          onClick={() => view && go({ period: query.period, date: view.previousDate })}
          className={`${secondaryButtonClass} w-full self-auto`}
        >
          {TEXT.previous}
        </button>
        <button
          type="button"
          disabled={!view}
          aria-label={TEXT.nextLabel}
          onClick={() => view && go({ period: query.period, date: view.nextDate })}
          className={`${secondaryButtonClass} w-full self-auto`}
        >
          {TEXT.next}
        </button>
      </div>

      {state.status === "loading" && (
        <p role="status" className="text-base text-[var(--color-text-secondary)]">
          {TEXT.loading}
        </p>
      )}

      {state.status === "unauthorized" && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-base text-[var(--color-error)]">
            {COMMON_SCREEN_MESSAGES.sessionEnded}
          </p>
          <Link href={reportLoginHref(targetVehicleId)} className={`${secondaryButtonClass} inline-flex items-center`}>
            {TEXT.loginAgain}
          </Link>
        </div>
      )}

      {state.status === "error" && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-base text-[var(--color-error)]">
            {COMMON_SCREEN_MESSAGES.reportLoadFailed}
          </p>
          <button type="button" onClick={retry} className={secondaryButtonClass}>
            {TEXT.retry}
          </button>
        </div>
      )}

      {view && (
        <section aria-label={view.rangeText} className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">{view.rangeText}</h2>
          {view.isEmpty ? (
            <p role="status" className="text-base text-[var(--color-text-secondary)]">
              {COMMON_SCREEN_MESSAGES.trulyEmptyPeriod}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <div>
                  <p className="flex flex-wrap justify-between gap-x-3 text-lg font-semibold text-[var(--color-text)]">
                    <span>{TEXT.remainderLabel}</span>
                    <span className="tabular-nums">{view.remainder}</span>
                  </p>
                  <p className="text-base text-[var(--color-text-secondary)]">{TEXT.remainderHelp}</p>
                </div>
                <div>
                  <p className="flex flex-wrap justify-between gap-x-3 text-lg font-semibold text-[var(--color-text)]">
                    <span>{TEXT.receivedLabel}</span>
                    <span className="tabular-nums">{view.received}</span>
                  </p>
                  <p className="text-base text-[var(--color-text-secondary)]">{TEXT.receivedHelp}</p>
                </div>
                <p className="text-base text-[var(--color-text-secondary)]">{TEXT.summaryScope}</p>
              </div>
              <details className="rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)]">
                <summary className="flex min-h-[var(--control-min-height)] cursor-pointer items-center px-4 text-base font-medium text-[var(--color-text)]">
                  {TEXT.breakdownSummary}
                </summary>
                <dl className="flex flex-col gap-2 px-4 pb-4">
                  {view.breakdown.map((row) => (
                    <div key={row.label} className="flex flex-wrap justify-between gap-x-3 text-base">
                      <dt className="text-[var(--color-text-secondary)]">{row.label}</dt>
                      <dd className="tabular-nums text-[var(--color-text)]">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              <div role="tablist" aria-label={TEXT.people.sectionTabsLabel} className="grid grid-cols-2 gap-2">
                {SECTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={section === key}
                    onClick={() => setSection(key)}
                    className={tabClass(section === key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div role="tabpanel" aria-label={SECTIONS.find(({ key }) => key === section)!.label} className="flex flex-col gap-4">
                {section === "people" ? (
                  <PeoplePeriodReport
                    key={`${query.period}|${view.startDate}`}
                    period={query.period}
                    date={view.startDate}
                    targetVehicleId={targetVehicleId}
                  />
                ) : (
                  <DailyEntriesReport
                    key={`${query.period}|${view.startDate}`}
                    period={query.period}
                    date={view.startDate}
                    targetVehicleId={targetVehicleId}
                  />
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
