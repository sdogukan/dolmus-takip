import { WORK_ENTRY_MESSAGES } from "../../lib/messages";
import {
  buildHistoryRows,
  currentHistorySummary,
  formatHistoryCents,
  type HistoryRow,
  type HistoryView,
} from "../../lib/work-entry-history-ui";
import { formatWorkTimeRange } from "../../lib/work-entry-ui";
import { formatDuration, formatWorkDate } from "../../lib/work-time";

const TEXT = WORK_ENTRY_MESSAGES;

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-4 text-lg tabular-nums">
      <span>{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </p>
  );
}

function statusText(status: HistoryView["entry"]["status"]): string {
  if (status === "pending") return TEXT.statusPending;
  if (status === "confirmed") return TEXT.statusConfirmed;
  return TEXT.statusNotRequired;
}

function Row({ row }: { row: HistoryRow }) {
  const title =
    row.kind === "created" ? TEXT.historyCreated : row.kind === "updated" ? TEXT.historyUpdated : TEXT.historyConfirmation;
  return (
    <li className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] p-4">
      <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-[var(--color-text)]">
        <span>{title}</span>
        {row.kind === "confirmation" && row.current && (
          <span className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-2 text-base font-medium text-[var(--color-text)]">
            {TEXT.historyCurrent}
          </span>
        )}
      </p>
      <p className="text-base text-[var(--color-text-secondary)]">
        {TEXT.versionLabel(row.version)} · {row.when}
      </p>
      <p className="text-base text-[var(--color-text-secondary)]">{row.actor}</p>
      {row.onBehalf && <p className="text-base text-[var(--color-text-secondary)]">{row.onBehalf}</p>}
      {row.kind === "confirmation" && row.supportTrace && (
        <p className="text-base text-[var(--color-text-secondary)]">{row.supportTrace}</p>
      )}
      {row.kind === "confirmation" && (
        <p className="text-lg font-semibold tabular-nums text-[var(--color-text)]">{TEXT.historyReceived(row.received)}</p>
      )}
      {row.kind === "updated" && (
        <ul className="flex flex-col gap-1">
          {row.changes.map((change) => (
            <li key={change.label} className="text-base tabular-nums text-[var(--color-text)]">
              {TEXT.historyChange(change.label, change.before, change.after)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Salt okunur kayıt geçmişi: güncel özet + kronolojik satırlar. Düzenleme/silme
 * kontrolü ve geçmiş toplamı YOKTUR; metinler React kaçışıyla düz metin basılır.
 */
export function WorkEntryHistory({ view }: { view: HistoryView }) {
  const summary = currentHistorySummary(view);
  const rows = buildHistoryRows(view);
  return (
    <div className="flex flex-col gap-6">
      {summary && (
        <section
          id="history-current"
          aria-label={TEXT.currentValuesTitle}
          className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] p-4"
        >
          <h2 className="text-xl font-semibold text-[var(--color-text)]">{TEXT.currentValuesTitle}</h2>
          <SummaryRow label={TEXT.detailPerson} value={summary.values.person.fullName || "—"} />
          <SummaryRow label={TEXT.detailDate} value={formatWorkDate(summary.values.workDate)} />
          <SummaryRow
            label={TEXT.detailTime}
            value={formatWorkTimeRange(summary.values.startsAt, summary.values.endsAt)}
          />
          <SummaryRow label={TEXT.detailDuration} value={formatDuration(summary.values.durationMinutes)} />
          <SummaryRow label={TEXT.detailGross} value={formatHistoryCents(summary.values.grossCents)} />
          <SummaryRow label={TEXT.detailFuel} value={formatHistoryCents(summary.values.fuelCents)} />
          {(summary.values.otherExpenseCents !== "0" || summary.values.otherExpenseNote !== null) && (
            <SummaryRow
              label={
                summary.values.otherExpenseNote
                  ? `${TEXT.detailOther} (${summary.values.otherExpenseNote})`
                  : TEXT.detailOther
              }
              value={formatHistoryCents(summary.values.otherExpenseCents)}
            />
          )}
          {summary.workKind === "driver" && (
            <SummaryRow label={TEXT.detailShare} value={formatHistoryCents(summary.values.shareCents)} />
          )}
          <SummaryRow
            label={summary.workKind === "owner" ? TEXT.detailOwnerRemainder : TEXT.detailRemainder}
            value={formatHistoryCents(summary.values.remainderCents)}
          />
          {summary.received !== null && <SummaryRow label={TEXT.confirmedReceivedLabel} value={summary.received} />}
          <p className="text-lg font-medium text-[var(--color-text)]">{statusText(summary.status)}</p>
          <p className="text-base text-[var(--color-text-secondary)]">{TEXT.versionLabel(summary.version)}</p>
        </section>
      )}
      <section aria-label={TEXT.historyListTitle} className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-[var(--color-text)]">{TEXT.historyListTitle}</h2>
        <ol id="history-list" className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <Row key={`${row.kind}-${row.version}-${index}`} row={row} />
          ))}
        </ol>
      </section>
    </div>
  );
}
