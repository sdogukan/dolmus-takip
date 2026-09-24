/**
 * Kayıt geçmişi — iki revizyon değeri arasındaki değişen alanları bulan SAF
 * fonksiyon. İstemci-güvenli: sunucu modülü içe aktarmaz. Kuruş alanları
 * ondalık tam sayı METNİDİR; toplama/çevirme yapılmaz.
 */

export interface WorkEntryHistoryValues {
  person: { id: string; fullName: string };
  workDate: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  grossCents: string;
  fuelCents: string;
  otherExpenseCents: string;
  otherExpenseNote: string | null;
  shareCents: string;
  remainderCents: string;
  status: string;
  /** Yalnız onay revizyonlarında bulunur; eski create/update anlık görüntülerinde yoktur. */
  receivedCents?: string;
}

export const WORK_ENTRY_HISTORY_CHANGE_FIELDS = [
  "person",
  "workDate",
  "startsAt",
  "endsAt",
  "grossCents",
  "fuelCents",
  "otherExpenseCents",
  "otherExpenseNote",
  "shareCents",
  "remainderCents",
  "receivedCents",
] as const;

export type WorkEntryHistoryChangeField = (typeof WORK_ENTRY_HISTORY_CHANGE_FIELDS)[number];

export interface WorkEntryHistoryChange {
  field: WorkEntryHistoryChangeField;
  before: string | null;
  after: string | null;
}

/** Kişi için karşılaştırma kimlikle, gösterim ad-soyadladır. */
function comparable(values: WorkEntryHistoryValues, field: WorkEntryHistoryChangeField): string | null {
  if (field === "person") return values.person.id;
  return values[field] ?? null;
}

function shown(values: WorkEntryHistoryValues, field: WorkEntryHistoryChangeField): string | null {
  if (field === "person") return values.person.fullName;
  return values[field] ?? null;
}

/** `before` → `after` arasında yalnız DEĞİŞEN alanlar, sabit alan sırasıyla. */
export function diffWorkEntryRevision(
  before: WorkEntryHistoryValues,
  after: WorkEntryHistoryValues,
): WorkEntryHistoryChange[] {
  const changes: WorkEntryHistoryChange[] = [];
  for (const field of WORK_ENTRY_HISTORY_CHANGE_FIELDS) {
    if (comparable(before, field) === comparable(after, field)) continue;
    changes.push({ field, before: shown(before, field), after: shown(after, field) });
  }
  return changes;
}
