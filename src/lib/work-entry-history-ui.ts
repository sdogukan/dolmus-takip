/**
 * Kayıt geçmişi ekranının (`../app/_components/work-entry-history.tsx`) SAF
 * yardımcıları — DB/ağ/React YOK. Tipler `readWorkEntryHistoryForScope`
 * çıktısının (`../server/usecases/work-entries/history.ts`) istemci-güvenli
 * aynasıdır; sunucu modülü buraya taşınmaz. Kuruşlar ondalık tam sayı METNİDİR:
 * BigInt ile biçimlenir, hiçbir yerde toplanmaz.
 */
import { formatTlAmount, parseApiCents } from "./money";
import { PLATFORM_ROLE_LABELS, WORK_ENTRY_MESSAGES } from "./messages";
import { formatPlateForDisplay } from "./plate";
import {
  type WorkEntryHistoryChange,
  type WorkEntryHistoryChangeField,
  type WorkEntryHistoryValues,
} from "./work-entry-history";
import { formatWorkDate, istanbulWallClock } from "./work-time";

const TEXT = WORK_ENTRY_MESSAGES;

export type HistoryActor =
  | { kind: "vehicle_credential"; access: "owner" | "driver"; plateNormalized: string | null }
  | {
      kind: "platform_user";
      username: string;
      fullName: string | null;
      role: "support" | "admin";
      onBehalfOf: { kind: "owner" | "driver"; fullName: string } | null;
    };

export interface HistoryRevision {
  version: number;
  action: "create" | "update" | "confirm" | "correct_and_confirm";
  createdAt: string;
  actor: HistoryActor;
  values: WorkEntryHistoryValues;
  changes: WorkEntryHistoryChange[];
}

export interface HistoryConfirmation {
  entryVersion: number;
  receivedCents: string;
  confirmedAt: string;
  actor: HistoryActor;
  current: boolean;
}

export interface HistoryView {
  entry: { id: string; version: number; status: "pending" | "confirmed" | "not_required"; workKind: "owner" | "driver" };
  revisions: HistoryRevision[];
  confirmations: HistoryConfirmation[];
}

export interface HistoryChangeLine {
  label: string;
  before: string;
  after: string;
}

export type HistoryRow =
  | {
      kind: "created" | "updated";
      version: number;
      when: string;
      actor: string;
      onBehalf: string | null;
      changes: HistoryChangeLine[];
    }
  | {
      kind: "confirmation";
      version: number;
      when: string;
      actor: string;
      onBehalf: string | null;
      received: string;
      current: boolean;
    };

const ACCESS_LABELS = { owner: "Sahip oturumu", driver: "Şoför oturumu" } as const;
const DASH = "—";

export function formatHistoryCents(text: string | null): string {
  if (text === null) return DASH;
  const cents = parseApiCents(text);
  return cents === null ? DASH : formatTlAmount(cents);
}

/** "14 Eylül 2026 · 08:00" (İstanbul duvar saati). */
export function formatHistoryTime(isoUtc: string): string {
  const { date, time } = istanbulWallClock(isoUtc);
  return TEXT.confirmedAtValue(formatWorkDate(date), time);
}

/** Ekip: "<kullanıcı adı> · <rol>"; araç credential'ı: erişim rolü + plaka (kişi adı türetilmez). */
export function formatHistoryActor(actor: HistoryActor): string {
  if (actor.kind === "platform_user") {
    return `${actor.username || DASH} · ${PLATFORM_ROLE_LABELS[actor.role]}`;
  }
  const access = ACCESS_LABELS[actor.access];
  return actor.plateNormalized ? `${access} · ${formatPlateForDisplay(actor.plateNormalized)}` : access;
}

/** Yalnız ekip satırlarında: "Sahip adına <ad>" / "Şoför adına <ad>". */
export function formatHistoryOnBehalf(actor: HistoryActor): string | null {
  if (actor.kind !== "platform_user" || !actor.onBehalfOf) return null;
  return actor.onBehalfOf.kind === "owner"
    ? TEXT.historyOnBehalfOfOwner(actor.onBehalfOf.fullName)
    : TEXT.historyOnBehalfOfDriver(actor.onBehalfOf.fullName);
}

/** Bir değişen alanın ekran metni: gün, saat ve tutarlar biçimlenir; boş → "—". */
export function formatHistoryFieldValue(field: WorkEntryHistoryChangeField, value: string | null): string {
  if (value === null || value === "") return DASH;
  switch (field) {
    case "workDate":
      return formatWorkDate(value) || DASH;
    case "startsAt":
    case "endsAt":
      return formatHistoryTime(value);
    case "grossCents":
    case "fuelCents":
    case "otherExpenseCents":
    case "shareCents":
    case "remainderCents":
    case "receivedCents":
      return formatHistoryCents(value);
    default:
      return value;
  }
}

/** Alınan tutar değişimi onay satırında gösterilir; değişiklik satırlarında TEKRAR edilmez. */
function changeLines(changes: WorkEntryHistoryChange[]): HistoryChangeLine[] {
  return changes
    .filter((change) => change.field !== "receivedCents")
    .map((change) => ({
      label: TEXT.historyFieldLabels[change.field],
      before: formatHistoryFieldValue(change.field, change.before),
      after: formatHistoryFieldValue(change.field, change.after),
    }));
}

/**
 * Kronolojik satırlar (sürüm artan; aynı sürümde önce değişiklik, sonra onay).
 * Her onay ayrı satırdır ve hiçbir tutar toplanmaz. Salt onay revizyonu
 * (`confirm`) ve değişen alanı olmayan `correct_and_confirm` revizyonu kendi
 * onay satırıyla zaten görünür; ayrıca satır üretmez.
 */
export function buildHistoryRows(view: HistoryView): HistoryRow[] {
  const ordered: { version: number; order: number; row: HistoryRow }[] = [];
  for (const revision of view.revisions) {
    const changes = changeLines(revision.changes);
    if (revision.action === "confirm") continue;
    if (revision.action === "correct_and_confirm" && changes.length === 0) continue;
    ordered.push({
      version: revision.version,
      order: 0,
      row: {
        kind: revision.action === "create" ? "created" : "updated",
        version: revision.version,
        when: formatHistoryTime(revision.createdAt),
        actor: formatHistoryActor(revision.actor),
        onBehalf: formatHistoryOnBehalf(revision.actor),
        changes: revision.action === "create" ? [] : changes,
      },
    });
  }
  for (const confirmation of view.confirmations) {
    ordered.push({
      version: confirmation.entryVersion,
      order: 1,
      row: {
        kind: "confirmation",
        version: confirmation.entryVersion,
        when: formatHistoryTime(confirmation.confirmedAt),
        actor: formatHistoryActor(confirmation.actor),
        onBehalf: formatHistoryOnBehalf(confirmation.actor),
        received: formatHistoryCents(confirmation.receivedCents),
        current: confirmation.current,
      },
    });
  }
  return ordered.sort((a, b) => a.version - b.version || a.order - b.order).map((item) => item.row);
}

/** Güncel özet: son revizyonun değerleri + yalnız GÜNCEL sürümün onayı. */
export interface HistoryCurrentSummary {
  version: number;
  status: HistoryView["entry"]["status"];
  workKind: HistoryView["entry"]["workKind"];
  values: WorkEntryHistoryValues;
  received: string | null;
}

export function currentHistorySummary(view: HistoryView): HistoryCurrentSummary | null {
  const latest = view.revisions[view.revisions.length - 1];
  if (!latest) return null;
  const confirmation = view.confirmations.find((c) => c.current);
  return {
    version: view.entry.version,
    status: view.entry.status,
    workKind: view.entry.workKind,
    values: latest.values,
    received: confirmation ? formatHistoryCents(confirmation.receivedCents) : null,
  };
}
