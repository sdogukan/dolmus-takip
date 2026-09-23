"use client";

/**
 * İşlem geçmişi listesi (salt okunur) — `GET /api/v1/admin/audit`. Düzenleme/
 * silme denetimi YOKTUR. Durumlar ayrıdır: loading / results / empty / error;
 * "Daha fazla göster" `nextCursor` sayfasını mevcut listeye EKLER. Önce/sonra
 * değerleri `../../../lib/audit-ui.ts` ile metne çevrilir ve yalnız React
 * kaçışıyla basılır (HTML enjeksiyonu yok); parola benzeri anahtarlar
 * gösterilmez.
 */
import { useEffect, useRef, useState } from "react";
import { adminReadErrorMessage } from "../../../lib/admin-search";
import {
  auditActionLabel,
  buildAuditUrl,
  buildBeforeAfterRows,
  formatAuditActor,
  formatAuditTime,
  type AuditEntry,
} from "../../../lib/audit-ui";
import { AUDIT_MESSAGES as TEXT } from "../../../lib/messages";
import { formatPlateForDisplay } from "../../../lib/plate";

const PAGE_SIZE = 20;

type HistoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "results";
      entries: AuditEntry[];
      nextCursor: string | null;
      loadingMore: boolean;
      moreError: string | null;
    };

type FetchResult =
  | { ok: true; entries: AuditEntry[]; nextCursor: string | null }
  | { ok: false; message: string };

async function fetchPage(url: string, signal: AbortSignal): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
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
  return {
    ok: true,
    entries: (body?.entries ?? []) as AuditEntry[],
    nextCursor: typeof body?.nextCursor === "string" ? body.nextCursor : null,
  };
}

/** Bir sayfa sonucunu durumla birleştirir: imleçli sayfa listeye EKLENİR,
 * hata mevcut listeyi korur; ilk sayfa hatası tam hata durumudur. */
function applyResult(previous: HistoryState, cursor: string | null, result: FetchResult): HistoryState {
  if (!result.ok) {
    return cursor !== null && previous.status === "results"
      ? { ...previous, loadingMore: false, moreError: result.message }
      : { status: "error", message: result.message };
  }
  return {
    status: "results",
    entries:
      cursor !== null && previous.status === "results"
        ? [...previous.entries, ...result.entries]
        : result.entries,
    nextCursor: result.nextCursor,
    loadingMore: false,
    moreError: null,
  };
}

const secondaryButtonClass =
  "min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70";

function AuditRow({ entry }: { entry: AuditEntry }) {
  const { rows, noPreviousValue } = buildBeforeAfterRows(entry.action, entry.before, entry.after);
  const target = [
    entry.business?.name,
    entry.vehicle ? formatPlateForDisplay(entry.vehicle.plateNormalized) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-text)]">
      <p className="text-[var(--color-text-secondary)]">
        <time dateTime={entry.occurredAt}>{formatAuditTime(entry.occurredAt)}</time>
        {target ? ` · ${target}` : ""}
      </p>
      <p className="font-medium">{auditActionLabel(entry.action)}</p>
      <p>
        {TEXT.actorPrefix}: {formatAuditActor(entry.actor)}
      </p>
      {entry.targetUser && <p>{TEXT.targetUser(entry.targetUser.username)}</p>}
      {entry.onBehalfOf && (
        <p className="text-[var(--color-text-secondary)]">{TEXT.onBehalfOf(entry.onBehalfOf.fullName)}</p>
      )}
      {noPreviousValue && <p className="text-[var(--color-text-secondary)]">{TEXT.noPreviousValue}</p>}
      {rows.length > 0 && (
        <dl className="mt-1 flex flex-col gap-1">
          {rows.map((row) => (
            <div key={row.key} className="flex flex-col">
              <dt className="text-[var(--color-text-secondary)]">{row.label}</dt>
              <dd>
                {row.before !== null && (
                  <>
                    {TEXT.before}: {row.before}{" "}
                  </>
                )}
                {TEXT.after}: {row.after}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

export function AuditHistory({ vehicleId, businessId }: { vehicleId?: string; businessId?: string }) {
  const [state, setState] = useState<HistoryState>({ status: "loading" });
  const sequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  async function load(cursor: string | null): Promise<void> {
    const sequence = ++sequenceRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let result: FetchResult;
    try {
      result = await fetchPage(
        buildAuditUrl({ vehicleId, businessId, cursor, limit: PAGE_SIZE }),
        controller.signal,
      );
    } catch {
      return; // kesildi — daha yeni bir istek sahiplendi
    }
    if (sequence !== sequenceRef.current) return; // eski yanıt
    setState((previous) => applyResult(previous, cursor, result));
  }

  useEffect(() => {
    // İlk yükleme (durum zaten "loading"): sonuç bir geri çağrıda işlenir.
    const controller = new AbortController();
    let cancelled = false;
    fetchPage(buildAuditUrl({ vehicleId, businessId, cursor: null, limit: PAGE_SIZE }), controller.signal).then(
      (result) => {
        if (!cancelled) setState((previous) => applyResult(previous, null, result));
      },
      () => undefined, // kesildi
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [vehicleId, businessId]);

  function handleRetry(): void {
    setState({ status: "loading" });
    void load(null);
  }

  function handleLoadMore(): void {
    if (state.status !== "results" || state.nextCursor === null || state.loadingMore) return;
    const cursor = state.nextCursor;
    setState({ ...state, loadingMore: true, moreError: null });
    void load(cursor);
  }

  const announcement =
    state.status === "loading"
      ? TEXT.loading
      : state.status === "error"
        ? state.message
        : state.entries.length === 0
          ? TEXT.empty
          : TEXT.resultCount(state.entries.length, state.nextCursor !== null);

  return (
    <div className="flex flex-col gap-4">
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
          <button type="button" onClick={handleRetry} className={secondaryButtonClass}>
            {TEXT.retry}
          </button>
        </div>
      )}

      {state.status === "results" && state.entries.length === 0 && (
        <p className="text-base text-[var(--color-text-secondary)]">{TEXT.empty}</p>
      )}

      {state.status === "results" && state.entries.length > 0 && (
        <ul className="flex flex-col gap-3">
          {state.entries.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      {state.status === "results" && state.moreError && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
          {state.moreError}
        </p>
      )}
      {state.status === "results" && state.nextCursor !== null && (
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
