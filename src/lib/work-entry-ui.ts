/**
 * Günlük kayıt formunun (`../app/_components/work-entry-form.tsx`) SAF
 * yardımcıları — T3.4 öncesi. `GET /api/v1/drivers` iki biçimde döner: şoför
 * oturumu `{ personId, fullName }` satırları, sahip/ekip (`driver.manage`)
 * yönetim görünümü. Yönetim görünümü pasif atamaları ve pasif kişileri de
 * içerir; seçilebilir liste burada AÇIKÇA süzülür. İstemci listesi yetki
 * VERMEZ: asıl doğrulama sunucudadır.
 */
import { COMMON_SCREEN_MESSAGES, getErrorMessage, WORK_ENTRY_MESSAGES as TEXT } from "./messages";
import { centsToApiString, parseTlAmount } from "./money";
import type { WorkKind } from "./work-calculation";

export interface SelectableDriver {
  personId: string;
  fullName: string;
}

/** Seçilebilir şoförler; yanıt beklenen biçimde değilse `null`. */
export function selectableFromDriversResponse(body: unknown): SelectableDriver[] | null {
  const list = (body as { drivers?: unknown } | null)?.drivers;
  if (!Array.isArray(list)) return null;
  const drivers: SelectableDriver[] = [];
  for (const item of list as Array<Record<string, unknown> | null>) {
    if (typeof item?.personId !== "string" || typeof item.fullName !== "string") return null;
    if ("assignment" in item) {
      // Yönetim görünümü satırı: yalnız AKTİF atama + AKTİF kişi seçilebilir.
      const assignment = item.assignment as { active?: unknown } | null;
      if (typeof item.personActive !== "boolean") return null;
      if (assignment !== null && typeof assignment?.active !== "boolean") return null;
      if (item.personActive !== true || assignment?.active !== true) continue;
    }
    drivers.push({ personId: item.personId, fullName: item.fullName });
  }
  return drivers;
}

/** Sahip/ekip ekranındaki iki seçenek; boş = henüz seçilmedi. */
export type WorkTypeChoice = WorkKind | "";

/**
 * Kaydetme akışı (T3.4 istemcisi) — SAF yardımcılar. Taslak `useStoredDraft`
 * ile saklanır; gönderilecek gövde İLK gönderimden ÖNCE `frozenBody` olarak
 * taslağa dondurulur. Belirsiz sonuçta tekrar deneme aynı `requestId` ile bu
 * dondurulmuş metni BAYTI BAYTINA yeniden yollar; gövde asla o anki form
 * durumundan yeniden kurulmaz (sunucu farklı içeriği 409 ile reddeder).
 */

export function workEntryDraftName(vehicleId: string): string {
  return `kayit-${vehicleId}`;
}

export interface WorkEntryDraft {
  requestId: string;
  workType: WorkTypeChoice;
  date: string;
  personId: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  grossText: string;
  fuelText: string;
  expenseOpen: boolean;
  otherText: string;
  otherNote: string;
  /** Sonucu belirsiz — sunucuya ulaşıp ulaşmadığı bilinmiyor; form kilitli. */
  pending: boolean;
  /** İlk gönderimde dondurulan gövde (JSON metni); yalnız `pending` iken dolu. */
  frozenBody: string | null;
}

/** Boş taslak; `today` sunucudan gelen bugün (hydration'da kaymaz). */
export function emptyWorkEntryDraft(today: string, newId: () => string): WorkEntryDraft {
  return {
    requestId: newId(),
    workType: "",
    date: today,
    personId: "",
    startTime: "",
    endTime: "",
    endsNextDay: false,
    grossText: "",
    fuelText: "",
    expenseOpen: false,
    otherText: "",
    otherNote: "",
    pending: false,
    frozenBody: null,
  };
}

/** Kullanıcının girdiği ama henüz gönderilmemiş bir şey var mı. */
export function isWorkEntryDraftDirty(draft: WorkEntryDraft, today: string): boolean {
  return (
    draft.pending ||
    draft.date !== today ||
    draft.personId !== "" ||
    draft.startTime !== "" ||
    draft.endTime !== "" ||
    draft.endsNextDay ||
    draft.grossText !== "" ||
    draft.fuelText !== "" ||
    draft.otherText !== "" ||
    draft.otherNote !== "" ||
    draft.workType !== ""
  );
}

export interface WorkEntryRequestBody {
  requestId: string;
  workType: WorkKind;
  workerPersonId?: string;
  date: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  grossCents: string;
  fuelCents: string;
  otherExpenseCents?: string;
  otherExpenseNote?: string;
}

/**
 * Taslaktan istek gövdesini kurar. Kuruşlar ondalık tam sayı metnidir;
 * `workerPersonId` yalnız şoför türünde gider; kişi/işletme/rol/pay alanları
 * gövdeye ASLA konmaz. Kullanılmayan masraf bölümü (tutar+açıklama boş)
 * alanları hiç göndermez. Geçersiz tutar veya tür seçilmemişse `null`.
 */
export function buildWorkEntryBody(
  draft: WorkEntryDraft,
  mode: "driver" | "owner" | "staff",
): WorkEntryRequestBody | null {
  const workType: WorkTypeChoice = mode === "driver" ? "driver" : draft.workType;
  if (workType === "") return null;
  const gross = parseTlAmount(draft.grossText);
  const fuel = parseTlAmount(draft.fuelText);
  if (!gross.ok || !fuel.ok) return null;
  const note = draft.otherNote.trim();
  const otherUsed = draft.expenseOpen && (draft.otherText.trim() !== "" || note !== "");
  const other = otherUsed ? parseTlAmount(draft.otherText) : null;
  if (other && !other.ok) return null;
  return {
    requestId: draft.requestId,
    workType,
    ...(workType === "driver" ? { workerPersonId: draft.personId } : {}),
    date: draft.date,
    startTime: draft.startTime,
    endTime: draft.endTime,
    endsNextDay: draft.endsNextDay,
    grossCents: centsToApiString(gross.cents),
    fuelCents: centsToApiString(fuel.cents),
    ...(other?.ok ? { otherExpenseCents: centsToApiString(other.cents) } : {}),
    ...(other?.ok && note !== "" ? { otherExpenseNote: note } : {}),
  };
}

/** Sunucunun döndürdüğü kayıt (201); yalnız ekranın gösterdiği alanlar. */
export interface SavedWorkEntry {
  id: string;
  status: "pending" | "not_required";
  workKind: WorkKind;
  workDate: string;
  durationMinutes: number;
  remainderCents: string;
  shareCents: string;
  personName: string;
}

export type WorkEntrySendOutcome =
  | { kind: "created"; entry: SavedWorkEntry }
  | { kind: "ambiguous" }
  | { kind: "error"; status: number; code?: string; fields: Record<string, string> };

/**
 * Yanıtı sınıflandırır. `response === null` ağ hatasıdır; `body === undefined`
 * gövde okunamadı demektir. Belirsiz = ağ hatası, okunamayan gövde, 5xx veya
 * beklenen biçimde olmayan 201 (kayıt yazılmış olabilir); geri kalan her şey
 * KESİN sonuçtur.
 */
export function classifyWorkEntryResponse(
  response: { status: number; body: unknown } | null,
): WorkEntrySendOutcome {
  if (response === null || response.body === undefined || response.status >= 500) {
    return { kind: "ambiguous" };
  }
  const body = response.body as Record<string, unknown> | null;
  if (response.status === 201) {
    const entry = savedEntryFromBody(body);
    return entry ? { kind: "created", entry } : { kind: "ambiguous" };
  }
  const error = (body as { error?: { code?: unknown; fields?: unknown } } | null)?.error;
  const fields: Record<string, string> = {};
  if (error?.fields && typeof error.fields === "object") {
    for (const [key, value] of Object.entries(error.fields)) {
      if (typeof value === "string") fields[key] = value;
    }
  }
  return {
    kind: "error",
    status: response.status,
    code: typeof error?.code === "string" ? error.code : undefined,
    fields,
  };
}

function savedEntryFromBody(body: Record<string, unknown> | null): SavedWorkEntry | null {
  const entry = (body as { workEntry?: Record<string, unknown> } | null)?.workEntry;
  const person = entry?.person as { fullName?: unknown } | undefined;
  if (
    !entry ||
    typeof entry.id !== "string" ||
    (entry.status !== "pending" && entry.status !== "not_required") ||
    (entry.workKind !== "owner" && entry.workKind !== "driver") ||
    typeof entry.workDate !== "string" ||
    typeof entry.durationMinutes !== "number" ||
    typeof entry.remainderCents !== "string" ||
    typeof entry.shareCents !== "string" ||
    typeof person?.fullName !== "string"
  ) {
    return null;
  }
  return {
    id: entry.id,
    status: entry.status,
    workKind: entry.workKind,
    workDate: entry.workDate,
    durationMinutes: entry.durationMinutes,
    remainderCents: entry.remainderCents,
    shareCents: entry.shareCents,
    personName: person.fullName,
  };
}

/** Kesin hata → form mesajı; sunucunun `error.message`'ı BASILMAZ. */
export function workEntryErrorMessage(status: number, code: string | undefined): string {
  if (status === 401) return COMMON_SCREEN_MESSAGES.sessionEnded;
  if (status === 409 && (code === undefined || code === "REQUEST_ID_REUSED")) {
    return TEXT.requestIdReused;
  }
  return (code ? getErrorMessage(code) : undefined) ?? TEXT.connectionFailed;
}
