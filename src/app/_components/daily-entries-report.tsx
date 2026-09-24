"use client";

/**
 * Sahip raporunun "Gün gün" bölümü: dönemin kayıtları kart olarak, kişi ve teslim
 * durumu süzgeçleriyle. Üst bileşen (`./vehicle-period-report.tsx`) bunu YALNIZ
 * araç raporu yüklendiğinde ve (dönem, dönem ilk günü) anahtarıyla oluşturur;
 * süzgeçler bu bileşenin içindedir, bu yüzden üstteki araç özeti süzgeçle
 * değişmez ve yeniden okunmaz. Her liste isteği (ilk sayfa, süzgeç değişimi,
 * "Daha fazla göster") kendi AbortController'ını taşır; süzgeç/dönem değişimi
 * bekleyen sonraki sayfa isteğini de keser, eski süzgecin sayfası yeni listeye
 * eklenmez. Sonraki sayfa hatasında yüklü kartlar kalır ve aynı imleçle
 * "Tekrar dene" sunulur. Boş durum yalnız başarılı boş yanıttan sonra çıkar.
 * Sunucunun `error.message`'ı basılmaz; tarayıcı depolamasına bir şey yazılmaz.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { COMMON_SCREEN_MESSAGES, REPORT_MESSAGES as REPORT_TEXT } from "../../lib/messages";
import type { ReportPeriodKind } from "../../lib/report-period";
import {
  buildDailyEntriesUrl,
  buildPeoplePeriodReportUrl,
  dailyEntryCardView,
  parseDailyEntriesPage,
  parsePeoplePeriodReport,
  type DailyEntriesFilters,
  type DailyEntriesStatusFilter,
  type DailyEntryCardView,
} from "../../lib/report-ui";
import { deliveryStatusLabel, type WorkEntryDetail } from "../../lib/work-entry-ui";
import { cardClass, fetchParsed, Problem } from "./people-period-report";
import { controlClass, labelClass, secondaryButtonClass } from "./work-entry-form";

const TEXT = REPORT_TEXT.daily;
const MORE_TEXT = REPORT_TEXT.people;

const STATUS_OPTIONS: DailyEntriesStatusFilter[] = ["pending", "confirmed", "not_required"];

type ListState =
  | { status: "loading" }
  | { status: "loaded"; cards: DailyEntryCardView[]; nextCursor: string | null }
  | { status: "error" }
  | { status: "unauthorized" };

interface PersonOption {
  personId: string;
  fullName: string;
}

interface DailyEntriesReportProps {
  period: ReportPeriodKind;
  date: string;
  /** Destek (ekip) modu: istekler `X-Target-Vehicle` taşır, kayıt bağlantıları yönetim sayfalarına gider. */
  targetVehicleId?: string;
}

export function DailyEntriesReport({ period, date, targetVehicleId }: DailyEntriesReportProps) {
  const [personId, setPersonId] = useState("");
  const [status, setStatus] = useState<DailyEntriesStatusFilter | "">("");
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const moreControllerRef = useRef<AbortController | null>(null);

  const filters: DailyEntriesFilters = { personId: personId || undefined, status: status || undefined };

  // Süzgeç seçenekleri: AYNI dönemin kişi raporundaki kimlikler (istemci kimlik üretmez).
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await fetchParsed(
          buildPeoplePeriodReportUrl(period, date),
          parsePeoplePeriodReport,
          controller.signal,
          targetVehicleId,
        );
        if (controller.signal.aborted || result.kind !== "ok") return;
        setPeople(result.value.people.map((person) => ({ personId: person.personId, fullName: person.fullName })));
      } catch {
        // kesildi
      }
    })();
    return () => controller.abort();
  }, [period, date, targetVehicleId]);

  // İlk sayfa: dönem/süzgeç/yeniden deneme değişince önceki istek ve bekleyen sonraki sayfa kesilir.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      let result;
      try {
        result = await fetchParsed(
          buildDailyEntriesUrl(period, date, { personId: personId || undefined, status: status || undefined }),
          parseDailyEntriesPage,
          controller.signal,
          targetVehicleId,
        );
      } catch {
        return; // kesildi: sonraki istek durumu belirler
      }
      if (controller.signal.aborted) return;
      if (result.kind === "ok") {
        setList({
          status: "loaded",
          cards: result.value.entries.map((entry) => dailyEntryCardView(entry, targetVehicleId)),
          nextCursor: result.value.nextCursor,
        });
      } else {
        setList({ status: result.kind === "unauthorized" ? "unauthorized" : "error" });
      }
    })();
    return () => {
      controller.abort();
      moreControllerRef.current?.abort();
    };
  }, [period, date, personId, status, targetVehicleId, attempt]);

  function changeFilter(apply: () => void): void {
    apply();
    setList({ status: "loading" });
    setMoreFailed(false);
    setLoadingMore(false);
  }

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
      result = await fetchParsed(
        buildDailyEntriesUrl(period, date, filters, cursor),
        parseDailyEntriesPage,
        controller.signal,
        targetVehicleId,
      );
    } catch {
      return;
    }
    if (controller.signal.aborted) return;
    setLoadingMore(false);
    if (result.kind === "ok") {
      const page: { entries: WorkEntryDetail[]; nextCursor: string | null } = result.value;
      setList((prev) =>
        prev.status === "loaded"
          ? { status: "loaded", cards: [...prev.cards, ...page.entries.map((entry) => dailyEntryCardView(entry, targetVehicleId))], nextCursor: page.nextCursor }
          : prev,
      );
    } else if (result.kind === "unauthorized") {
      setList({ status: "unauthorized" });
    } else {
      setMoreFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend className="mb-2 p-0 text-base font-semibold text-[var(--color-text)]">{TEXT.filterLegend}</legend>
        <div>
          <label htmlFor="daily-person" className={labelClass}>
            {TEXT.personLabel}
          </label>
          <select
            id="daily-person"
            value={personId}
            onChange={(event) => changeFilter(() => setPersonId(event.target.value))}
            className={controlClass}
          >
            <option value="">{TEXT.allPeople}</option>
            {people.map((person) => (
              <option key={person.personId} value={person.personId}>
                {person.fullName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="daily-status" className={labelClass}>
            {TEXT.statusLabel}
          </label>
          <select
            id="daily-status"
            value={status}
            onChange={(event) => changeFilter(() => setStatus(event.target.value as DailyEntriesStatusFilter | ""))}
            className={controlClass}
          >
            <option value="">{TEXT.allStatuses}</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {deliveryStatusLabel(option)}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      {list.status === "loading" && (
        <p role="status" className="text-base text-[var(--color-text-secondary)]">
          {TEXT.loading}
        </p>
      )}
      {(list.status === "error" || list.status === "unauthorized") && (
        <Problem unauthorized={list.status === "unauthorized"} onRetry={retry} targetVehicleId={targetVehicleId} />
      )}
      {list.status === "loaded" && list.cards.length === 0 && (
        <p role="status" className="text-base text-[var(--color-text-secondary)]">
          {TEXT.empty}
        </p>
      )}

      {list.status === "loaded" && list.cards.length > 0 && (
        <>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {list.cards.map((card) => (
              <li key={card.id} className={cardClass}>
                <span className="text-lg font-semibold">{card.dateText}</span>
                <span className="break-words text-base">{card.personName}</span>
                <span className="text-base">{card.timeText}</span>
                <span className="text-base tabular-nums">
                  {TEXT.gross}: {card.grossText}
                </span>
                <span className="text-base tabular-nums">
                  {card.expectedLabel}: {card.expectedText}
                </span>
                {card.receivedText !== null && (
                  <span className="text-base tabular-nums">
                    {TEXT.received}: {card.receivedText}
                  </span>
                )}
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
