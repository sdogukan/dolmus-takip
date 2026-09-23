"use client";

/**
 * /yonetim araması — arama metni ve durum filtresi adres çubuğuna (`?q=&active=`)
 * yansır (sayfa yenilenince/paylaşılınca korunur). Metin BOŞSA işletme listesi
 * (`GET /admin/businesses`), DOLUYSA araç kartları (`GET /admin/vehicles?q=`:
 * plaka biçiminden bağımsız, işletme veya sahip adı) listelenir.
 *
 * Durumlar AYRIDIR: loading / results / empty / error. Yükleme "sonuç yok"
 * metnini ASLA göstermez; hata yazılan metni korur ve "Tekrar dene" sunar.
 * Üst üste binen istekler: her istek bir sıra numarası taşır ve öncekini
 * `AbortController` ile keser; eski yanıt yeni sorgunun listesini EZEMEZ.
 * Yeni sorguda liste sıfırlanır; yalnız `nextCursor` sayfaları eklenir.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  adminReadErrorMessage,
  buildAdminListUrl,
  buildSearchPageHref,
  type ActiveFilter,
} from "../../lib/admin-search";
import { ADMIN_SEARCH_MESSAGES as TEXT } from "../../lib/messages";
import { formatPlateForDisplay } from "../../lib/plate";

interface BusinessItem {
  id: string;
  name: string;
  active: boolean;
  owner: { personId: string; fullName: string } | null;
  vehicleCount: number;
}

interface VehicleItem {
  id: string;
  plateNormalized: string;
  active: boolean;
  owner: { personId: string; fullName: string };
  business: { id: string; name: string; active: boolean };
}

type ListView =
  | { mode: "businesses"; items: BusinessItem[]; nextCursor: string | null }
  | { mode: "vehicles"; items: VehicleItem[]; nextCursor: string | null };

type SearchState =
  | { status: "loading" }
  | { status: "results"; view: ListView; loadingMore: boolean; moreError: string | null }
  | { status: "error"; message: string };

interface Query {
  q: string;
  active: ActiveFilter;
}

type FetchResult =
  | { ok: true; view: ListView }
  | { ok: false; message: string };

async function fetchList(query: Query, cursor: string | null, signal: AbortSignal): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetch(buildAdminListUrl({ ...query, cursor }), { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, message: adminReadErrorMessage(null) };
  }
  let body: Record<string, unknown> | undefined;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return { ok: false, message: adminReadErrorMessage(response.ok ? null : response.status) };
  }
  if (!response.ok) {
    const code = (body?.error as { code?: string } | undefined)?.code;
    return { ok: false, message: adminReadErrorMessage(response.status, code) };
  }
  const nextCursor = typeof body?.nextCursor === "string" ? body.nextCursor : null;
  if (query.q === "") {
    return {
      ok: true,
      view: { mode: "businesses", items: (body?.businesses ?? []) as BusinessItem[], nextCursor },
    };
  }
  return {
    ok: true,
    view: { mode: "vehicles", items: (body?.vehicles ?? []) as VehicleItem[], nextCursor },
  };
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        active
          ? "rounded-full bg-[var(--color-success-surface)] px-2 py-0.5 text-[length:1rem] font-medium text-[var(--color-success)]"
          : "rounded-full bg-[var(--color-warning-surface)] px-2 py-0.5 text-[length:1rem] font-medium text-[var(--color-warning)]"
      }
    >
      {active ? TEXT.activeBadge : TEXT.inactiveBadge}
    </span>
  );
}

const cardClass =
  "rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-text)]";
const actionLinkClass =
  "flex min-h-[var(--control-min-height)] items-center rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]";
const secondaryButtonClass =
  "min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70";

const DEBOUNCE_MS = 300;

export function AdminSearch({
  initialQuery,
  initialActive,
}: {
  initialQuery: string;
  initialActive: ActiveFilter;
}) {
  const [input, setInput] = useState(initialQuery);
  const [active, setActive] = useState<ActiveFilter>(initialActive);
  const [state, setState] = useState<SearchState>({ status: "loading" });
  // Son BAŞLATILAN sorgu (yeniden dene / daha fazla göster bunu kullanır).
  const queryRef = useRef<Query>({ q: initialQuery.trim(), active: initialActive });
  const sequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(query: Query, cursor: string | null): Promise<void> {
    const sequence = ++sequenceRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let result: FetchResult;
    try {
      result = await fetchList(query, cursor, controller.signal);
    } catch {
      return; // kesildi — daha yeni bir istek sahiplendi
    }
    if (sequence !== sequenceRef.current) return; // eski yanıt

    if (!result.ok) {
      setState((previous) =>
        cursor !== null && previous.status === "results"
          ? { ...previous, loadingMore: false, moreError: result.message }
          : { status: "error", message: result.message },
      );
      return;
    }
    setState((previous) => {
      if (cursor !== null && previous.status === "results" && previous.view.mode === result.view.mode) {
        const merged = [...previous.view.items, ...result.view.items] as ListView["items"];
        return {
          status: "results",
          view: { mode: result.view.mode, items: merged, nextCursor: result.view.nextCursor } as ListView,
          loadingMore: false,
          moreError: null,
        };
      }
      return { status: "results", view: result.view, loadingMore: false, moreError: null };
    });
  }

  useEffect(() => {
    // İlk yükleme: durum zaten "loading" (senkron setState yok).
    void load(queryRef.current, null);
    return () => {
      sequenceRef.current += 1;
      controllerRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // load yalnız ref/set fonksiyonları kullanır; mount'ta bir kez çalışır.
  }, []);

  function startSearch(query: Query): void {
    queryRef.current = query;
    window.history.replaceState(null, "", buildSearchPageHref(query.q, query.active));
    setState({ status: "loading" });
    void load(query, null);
  }

  function handleInputChange(value: string): void {
    setInput(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const q = value.trim();
      if (q !== queryRef.current.q) startSearch({ q, active: queryRef.current.active });
    }, DEBOUNCE_MS);
  }

  function handleActiveChange(next: ActiveFilter): void {
    setActive(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    startSearch({ q: input.trim(), active: next });
  }

  function handleLoadMore(): void {
    if (state.status !== "results" || state.view.nextCursor === null || state.loadingMore) return;
    const cursor = state.view.nextCursor;
    setState({ ...state, loadingMore: true, moreError: null });
    void load(queryRef.current, cursor);
  }

  const view = state.status === "results" ? state.view : null;
  const announcement =
    state.status === "loading"
      ? TEXT.loading
      : state.status === "error"
        ? state.message
        : view && view.items.length === 0
          ? view.mode === "businesses"
            ? TEXT.noBusinesses
            : TEXT.noResults
          : view
            ? TEXT.resultCount(view.items.length, view.nextCursor !== null)
            : "";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="yonetim-arama" className="block text-lg font-medium text-[var(--color-text)]">
          {TEXT.label}
        </label>
        <input
          id="yonetim-arama"
          type="search"
          autoComplete="off"
          maxLength={100}
          value={input}
          onChange={(event) => handleInputChange(event.target.value)}
          className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        />
      </div>
      <div>
        <label htmlFor="yonetim-durum" className="block text-lg font-medium text-[var(--color-text)]">
          {TEXT.activeLabel}
        </label>
        <select
          id="yonetim-durum"
          value={active}
          onChange={(event) => handleActiveChange(event.target.value as ActiveFilter)}
          className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)]"
        >
          <option value="all">{TEXT.activeAll}</option>
          <option value="active">{TEXT.activeOnly}</option>
          <option value="inactive">{TEXT.inactiveOnly}</option>
        </select>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {state.status === "loading" && (
        <p className="text-base text-[var(--color-text-secondary)]">{TEXT.loading}</p>
      )}

      {state.status === "error" && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
            {state.message}
          </p>
          <button type="button" onClick={() => startSearch(queryRef.current)} className={secondaryButtonClass}>
            {TEXT.retry}
          </button>
        </div>
      )}

      {state.status === "results" && state.view.items.length === 0 && (
        <p className="text-base text-[var(--color-text-secondary)]">
          {state.view.mode === "businesses" ? TEXT.noBusinesses : TEXT.noResults}
        </p>
      )}

      {state.status === "results" && state.view.mode === "businesses" && state.view.items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {state.view.items.map((business) => (
            <li key={business.id}>
              <Link
                href={`/yonetim/isletmeler/${business.id}`}
                className={`flex items-center justify-between gap-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${cardClass}`}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{business.name}</span>
                  <span className="text-[var(--color-text-secondary)]">
                    {business.owner ? `Sahip: ${business.owner.fullName}` : "Sahipsiz"} ·{" "}
                    {business.vehicleCount} araç
                  </span>
                </span>
                <ActiveBadge active={business.active} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {state.status === "results" && state.view.mode === "vehicles" && state.view.items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {state.view.items.map((vehicle) => {
            const plate = formatPlateForDisplay(vehicle.plateNormalized);
            return (
              <li key={vehicle.id} className={`flex flex-col gap-3 ${cardClass}`}>
                <div className="flex items-start justify-between gap-4">
                  <span className="flex flex-col">
                    <span className="font-medium">{vehicle.business.name}</span>
                    <span className="text-lg font-semibold">{plate}</span>
                    <span className="text-[var(--color-text-secondary)]">Sahip: {vehicle.owner.fullName}</span>
                    {!vehicle.business.active && (
                      <span className="text-[var(--color-warning)]">{TEXT.businessInactive}</span>
                    )}
                  </span>
                  <ActiveBadge active={vehicle.active} />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Link href={`/yonetim/araclar/${vehicle.id}/destek`} className={actionLinkClass}>
                    {TEXT.openSupport}
                    <span className="sr-only"> {plate}</span>
                  </Link>
                  <Link href={`/yonetim/araclar/${vehicle.id}`} className={actionLinkClass}>
                    {TEXT.openVehicle}
                    <span className="sr-only"> {plate}</span>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {state.status === "results" && state.moreError && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
          {state.moreError}
        </p>
      )}
      {state.status === "results" && state.view.nextCursor !== null && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={state.loadingMore}
          className={secondaryButtonClass}
        >
          {state.loadingMore ? TEXT.loadingMore : TEXT.loadMore}
        </button>
      )}
    </div>
  );
}
