/**
 * Günlük kayıt formunun (`../app/_components/work-entry-form.tsx`) SAF
 * yardımcıları — T3.4 öncesi. `GET /api/v1/drivers` iki biçimde döner: şoför
 * oturumu `{ personId, fullName }` satırları, sahip/ekip (`driver.manage`)
 * yönetim görünümü. Yönetim görünümü pasif atamaları ve pasif kişileri de
 * içerir; seçilebilir liste burada AÇIKÇA süzülür. İstemci listesi yetki
 * VERMEZ: asıl doğrulama sunucudadır.
 */
import { COMMON_SCREEN_MESSAGES, getErrorMessage, WORK_ENTRY_MESSAGES as TEXT } from "./messages";
import { centsToApiString, formatTlAmount, parseApiCents, parseSignedApiCents, parseTlAmount } from "./money";
import type { WorkKind } from "./work-calculation";
import { istanbulWallClock } from "./work-time";

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
  /**
   * Mevcut `requestId` ile bir istek sunucuya gitmiş OLABİLİR (ilk gönderim
   * dondurulurken yazılır; yenilemeden ve başka sekmeden sonra da okunur).
   */
  attemptSent: boolean;
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
    attemptSent: false,
  };
}

/**
 * Bu gönderim, aynı `requestId` ile yapılmış daha önceki bir denemenin
 * ardından mı? İşaretten önce yazılmış bekleyen taslaklar (alan yok) gönderilmiş
 * sayılır: güvenli yön "serbest bırakma"dır.
 */
export function hasEarlierAttempt(draft: Pick<WorkEntryDraft, "pending" | "attemptSent">): boolean {
  return draft.pending && draft.attemptSent !== false;
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
  status: "pending" | "confirmed" | "not_required";
  workKind: WorkKind;
  workDate: string;
  startsAt: string;
  endsAt: string;
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
    typeof entry.startsAt !== "string" ||
    typeof entry.endsAt !== "string" ||
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
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    durationMinutes: entry.durationMinutes,
    remainderCents: entry.remainderCents,
    shareCents: entry.shareCents,
    personName: person.fullName,
  };
}

/** "Yenile" ile okunan güncel kayıttan sonuç ekranı verisi. */
export function savedEntryFromDetail(entry: WorkEntryDetail): SavedWorkEntry {
  return {
    id: entry.id,
    status: entry.status,
    workKind: entry.workKind,
    workDate: entry.workDate,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    durationMinutes: entry.durationMinutes,
    remainderCents: entry.remainderCents,
    shareCents: entry.shareCents,
    personName: entry.person.fullName,
  };
}

/** "08:00–17:30"; bitiş başka bir takvim gününe düşüyorsa "(ertesi gün)" eklenir. */
export function formatWorkTimeRange(startsAt: string, endsAt: string): string {
  const start = istanbulWallClock(startsAt);
  const end = istanbulWallClock(endsAt);
  const range = `${start.time}–${end.time}`;
  return end.date === start.date ? range : `${range} ${TEXT.nextDaySuffix}`;
}

/**
 * Sonucu belirsiz gönderim şimdi kontrol edilebilir mi (düğme, sayfa açılışı,
 * çevrimiçi olayı)? Yalnız daha önce ulaşmış olabilecek, dondurulmuş gövdesi
 * olan bekleyen taslak, form kilitli değilken ve çevrimiçiyken; çevrimdışı
 * hiçbir şey yollanmaz (sonuç bilinmeyen kalır).
 */
export function canResolveUnknown(
  draft: Pick<WorkEntryDraft, "pending" | "frozenBody" | "attemptSent">,
  state: { online: boolean; disabled: boolean },
): boolean {
  return (
    state.online && !state.disabled && draft.frozenBody !== null && hasEarlierAttempt(draft)
  );
}

/**
 * Kayıt oluştu: taslak yalnız HÂLÂ bu `requestId`'ye aitse boşaltılır. Başka
 * sekme aynı isteği çoktan çözüp yeni bir kayda başlamışsa onun taslağı silinmez.
 */
export function draftAfterCreated(
  current: WorkEntryDraft,
  requestId: string,
  fresh: () => WorkEntryDraft,
): WorkEntryDraft {
  return current.requestId === requestId ? fresh() : current;
}

/** Kesin hata formu serbest bırakır: yalnız taslak hâlâ bu `requestId`'ye aitse yeni `requestId`. */
export function draftAfterRelease(
  current: WorkEntryDraft,
  requestId: string,
  newRequestId: string,
): WorkEntryDraft {
  if (current.requestId !== requestId) return current;
  return { ...current, pending: false, frozenBody: null, attemptSent: false, requestId: newRequestId };
}

/** Oturum bitince gidilecek sabit iç yol (dönüş adresi/parametre TAŞIMAZ). */
export function workEntryLoginHref(mode: "driver" | "owner" | "staff"): string {
  return mode === "staff" ? "/yonetim/giris" : "/giris";
}

/**
 * Kesin hata formu serbest bırakır mı (yeni `requestId`, dondurulmuş gövde
 * silinir)? İlk denemede her kesin hata bırakır. Daha önce ulaşmış olabilecek
 * bir denemeden sonra yalnız bu `requestId` altında hiçbir şey saklanmadığını
 * KANITLAYAN yanıtlar bırakır: 422 ve 409 REQUEST_ID_REUSED. 401/403/404 gibi
 * geri kalanı (makbuz aramasından önce de dönebilir) taslağı bekleyen tutar.
 */
export function shouldReleaseAfterError(
  outcome: { status: number; code?: string },
  earlierAttempt: boolean,
): boolean {
  if (!earlierAttempt) return true;
  return outcome.status === 422 || (outcome.status === 409 && outcome.code === "REQUEST_ID_REUSED");
}

/** Kesin hata → form mesajı; sunucunun `error.message`'ı BASILMAZ. */
export function workEntryErrorMessage(status: number, code: string | undefined): string {
  if (status === 401) return COMMON_SCREEN_MESSAGES.sessionEnded;
  if (status === 409 && (code === undefined || code === "REQUEST_ID_REUSED")) {
    return TEXT.requestIdReused;
  }
  return (code ? getErrorMessage(code) : undefined) ?? TEXT.connectionFailed;
}

/**
 * Kayıt düzenleme (T3.5 istemcisi) — SAF yardımcılar. Düzenleme taslağı kendi
 * anahtarıyla saklanır (`kayit-duzenle-<araç>-<kayıt>`; oluşturma taslağı
 * `kayit-<araç>`a DOKUNMAZ) ve dayandığı sürümü (`baseVersion`) taşır: PATCH her
 * zaman taslağın sürümünü yollar, o an okunan taze sürümü DEĞİL — bayat bir
 * taslak taze sürümle gönderilseydi iyimser kilit atlanırdı. Belirsiz sonuçta
 * `requestId` ve İLK gönderimde dondurulan gövde (aynı sürüm dahil) BAYTI
 * BAYTINA yeniden yollanır.
 */

/** Kaydın detay/düzenleme sayfası; staff modunda araç kimliği URL'de taşınır. */
export function workEntryDetailHref(
  mode: "driver" | "owner" | "staff",
  entryId: string,
  vehicleId: string,
): string {
  if (mode === "driver") return `/sofor/kayitlar/${entryId}`;
  if (mode === "owner") return `/sahip/kayitlar/${entryId}`;
  return `/yonetim/araclar/${vehicleId}/kayitlar/${entryId}`;
}

export function workEntryEditDraftPrefix(vehicleId: string): string {
  return `kayit-duzenle-${vehicleId}-`;
}

export function workEntryEditDraftName(vehicleId: string, entryId: string): string {
  return `${workEntryEditDraftPrefix(vehicleId)}${entryId}`;
}

/** Sunucunun döndürdüğü kayıt (GET/PATCH `workEntry`); kuruşlar ondalık tam sayı METNİDİR. */
export interface WorkEntryDetail {
  id: string;
  version: number;
  status: "pending" | "confirmed" | "not_required";
  workKind: WorkKind;
  workDate: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  grossCents: string;
  fuelCents: string;
  otherExpenseCents: string;
  shareCents: string;
  remainderCents: string;
  otherExpenseNote: string | null;
  person: { id: string; fullName: string };
  /** Kaydın GÜNCEL sürümüne ait teslim onayı; onaysız kayıtta `null`. */
  confirmation: WorkEntryConfirmation | null;
}

/** Onaylayan özeti; bilinmeyen/eksik biçim `null` (iz satırı gösterilmez, kayıt reddedilmez). */
export type WorkEntryConfirmationActor = { kind: "vehicle_credential" } | { kind: "platform_user"; username: string };

export interface WorkEntryConfirmation {
  receivedCents: string;
  confirmedAt: string;
  entryVersion: number;
  actor: WorkEntryConfirmationActor | null;
}

function parseConfirmationActor(value: unknown): WorkEntryConfirmationActor | null {
  const actor = value as Record<string, unknown> | null | undefined;
  if (typeof actor !== "object" || actor === null) return null;
  if (actor.kind === "vehicle_credential") return { kind: "vehicle_credential" };
  if (actor.kind === "platform_user" && typeof actor.username === "string" && actor.username !== "") {
    return { kind: "platform_user", username: actor.username };
  }
  return null;
}

const CENT_KEYS = ["grossCents", "fuelCents", "otherExpenseCents", "shareCents"] as const;

/** `null` = onaysız; biçimi bozuk değer `undefined` (kayıt bozuk sayılır). */
function parseConfirmation(value: unknown): WorkEntryConfirmation | null | undefined {
  if (value === null) return null;
  const confirmation = value as Record<string, unknown> | undefined;
  if (
    typeof confirmation !== "object" ||
    typeof confirmation.receivedCents !== "string" ||
    parseApiCents(confirmation.receivedCents) === null ||
    typeof confirmation.confirmedAt !== "string" ||
    typeof confirmation.entryVersion !== "number" ||
    !Number.isInteger(confirmation.entryVersion)
  ) {
    return undefined;
  }
  return {
    receivedCents: confirmation.receivedCents,
    confirmedAt: confirmation.confirmedAt,
    entryVersion: confirmation.entryVersion,
    actor: parseConfirmationActor(confirmation.actor),
  };
}

/** Bozuk biçim `null` döner (sessizce 0 gösterilmez). */
export function parseWorkEntryDetail(value: unknown): WorkEntryDetail | null {
  const entry = value as Record<string, unknown> | null;
  const person = entry?.person as { id?: unknown; fullName?: unknown } | undefined;
  if (
    !entry ||
    typeof entry.id !== "string" ||
    typeof entry.version !== "number" ||
    !Number.isInteger(entry.version) ||
    (entry.status !== "pending" && entry.status !== "confirmed" && entry.status !== "not_required") ||
    (entry.workKind !== "owner" && entry.workKind !== "driver") ||
    typeof entry.workDate !== "string" ||
    typeof entry.startsAt !== "string" ||
    typeof entry.endsAt !== "string" ||
    typeof entry.durationMinutes !== "number" ||
    (entry.otherExpenseNote !== null && typeof entry.otherExpenseNote !== "string") ||
    typeof person?.id !== "string" ||
    typeof person.fullName !== "string"
  ) {
    return null;
  }
  for (const key of CENT_KEYS) {
    const cents = entry[key];
    if (typeof cents !== "string" || parseApiCents(cents) === null) return null;
  }
  // Giderler hasılatı aşarsa kalan eksi olabilir (K5); yalnız bu alan işaretli okunur.
  if (typeof entry.remainderCents !== "string" || parseSignedApiCents(entry.remainderCents) === null) return null;
  const confirmation = parseConfirmation(entry.confirmation);
  if (confirmation === undefined) return null;
  return {
    id: entry.id,
    version: entry.version,
    status: entry.status,
    workKind: entry.workKind,
    workDate: entry.workDate,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    durationMinutes: entry.durationMinutes,
    grossCents: entry.grossCents as string,
    fuelCents: entry.fuelCents as string,
    otherExpenseCents: entry.otherExpenseCents as string,
    shareCents: entry.shareCents as string,
    remainderCents: entry.remainderCents as string,
    otherExpenseNote: entry.otherExpenseNote,
    person: { id: person.id, fullName: person.fullName },
    confirmation,
  };
}

export interface WorkEntryEditDraft {
  requestId: string;
  /** Alan değerlerinin dayandığı kayıt sürümü; PATCH bunu yollar. */
  baseVersion: number;
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
  pending: boolean;
  frozenBody: string | null;
  attemptSent: boolean;
}

/** "1.250,50" — `parseTlAmount`ın geri okuduğu, "TL" eki olmayan giriş metni. */
function centsToInputText(cents: string): string {
  return formatTlAmount(parseApiCents(cents) ?? 0n).replace(/ TL$/u, "");
}

/** Sunucudaki kayıttan TEMİZ taslak; alanlar kaydın değerleridir. */
export function editDraftFromEntry(entry: WorkEntryDetail, newId: () => string): WorkEntryEditDraft {
  const start = istanbulWallClock(entry.startsAt);
  const end = istanbulWallClock(entry.endsAt);
  const hasOther = entry.otherExpenseCents !== "0" || entry.otherExpenseNote !== null;
  return {
    requestId: newId(),
    baseVersion: entry.version,
    date: entry.workDate,
    personId: entry.person.id,
    startTime: start.time,
    endTime: end.time,
    endsNextDay: end.date !== start.date,
    grossText: centsToInputText(entry.grossCents),
    fuelText: centsToInputText(entry.fuelCents),
    expenseOpen: hasOther,
    otherText: hasOther ? centsToInputText(entry.otherExpenseCents) : "",
    otherNote: entry.otherExpenseNote ?? "",
    pending: false,
    frozenBody: null,
    attemptSent: false,
  };
}

/** Kullanıcının kayıttan farklı bir değeri (veya sonucu belirsiz bir gönderimi) var mı. */
export function isEditDraftDirty(draft: WorkEntryEditDraft, entry: WorkEntryDetail): boolean {
  if (draft.pending) return true;
  const base = editDraftFromEntry(entry, () => draft.requestId);
  return (
    draft.date !== base.date ||
    draft.personId !== base.personId ||
    draft.startTime !== base.startTime ||
    draft.endTime !== base.endTime ||
    draft.endsNextDay !== base.endsNextDay ||
    draft.grossText.trim() !== base.grossText ||
    draft.fuelText.trim() !== base.fuelText ||
    draft.otherText.trim() !== base.otherText ||
    draft.otherNote.trim() !== base.otherNote
  );
}

/** Belirsiz/kesin sonuçtan sonra formu serbest bırakır: yeni `requestId`, alan değerleri korunur. */
export function releaseEditDraft(draft: WorkEntryEditDraft, newId: () => string): WorkEntryEditDraft {
  return { ...draft, pending: false, frozenBody: null, attemptSent: false, requestId: newId() };
}

/** Kullanıcı güncel değerleri gördükten sonra kendi değerleriyle sürer: taslak güncel sürüme bağlanır. */
export function rebaseEditDraft(
  draft: WorkEntryEditDraft,
  currentVersion: number,
  newId: () => string,
): WorkEntryEditDraft {
  return { ...releaseEditDraft(draft, newId), baseVersion: currentVersion };
}

/** Bu kayıt bu ekranda düzenlenebilir mi (sunucu yine de KARAR VERİR). */
export function canEditEntry(
  mode: "driver" | "owner" | "staff",
  entry: Pick<WorkEntryDetail, "status" | "workDate">,
  today: string,
): boolean {
  if (entry.status === "confirmed") return false;
  if (mode === "driver") return entry.status === "pending" && entry.workDate === today;
  return true;
}

export interface WorkEntryPatchBody {
  requestId: string;
  version: number;
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
 * Taslaktan PATCH gövdesi. Kayıt türü, kişi/işletme/rol/pay/durum alanları
 * gövdeye ASLA konmaz; `workerPersonId` yalnız şoför kaydında gider. Geçersiz
 * tutar → `null`.
 */
export function buildWorkEntryPatchBody(
  draft: WorkEntryEditDraft,
  workKind: WorkKind,
): WorkEntryPatchBody | null {
  const gross = parseTlAmount(draft.grossText);
  const fuel = parseTlAmount(draft.fuelText);
  if (!gross.ok || !fuel.ok) return null;
  const note = draft.otherNote.trim();
  const otherUsed = draft.expenseOpen && (draft.otherText.trim() !== "" || note !== "");
  const other = otherUsed ? parseTlAmount(draft.otherText) : null;
  if (other && !other.ok) return null;
  return {
    requestId: draft.requestId,
    version: draft.baseVersion,
    ...(workKind === "driver" ? { workerPersonId: draft.personId } : {}),
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

export type WorkEntryUpdateOutcome =
  | { kind: "saved"; entry: WorkEntryDetail }
  | { kind: "ambiguous" }
  | { kind: "error"; status: number; code?: string; fields: Record<string, string> };

/**
 * PATCH yanıtını sınıflar. Belirsiz = ağ hatası, okunamayan gövde, 5xx veya
 * beklenen biçimde olmayan 200 (değişiklik yazılmış olabilir).
 */
export function classifyWorkEntryUpdateResponse(
  response: { status: number; body: unknown } | null,
): WorkEntryUpdateOutcome {
  if (response === null || response.body === undefined || response.status >= 500) {
    return { kind: "ambiguous" };
  }
  const body = response.body as { workEntry?: unknown; error?: { code?: unknown; fields?: unknown } } | null;
  if (response.status === 200) {
    const entry = parseWorkEntryDetail(body?.workEntry);
    return entry ? { kind: "saved", entry } : { kind: "ambiguous" };
  }
  const fields: Record<string, string> = {};
  if (body?.error?.fields && typeof body.error.fields === "object") {
    for (const [key, value] of Object.entries(body.error.fields)) {
      if (typeof value === "string") fields[key] = value;
    }
  }
  return {
    kind: "error",
    status: response.status,
    code: typeof body?.error?.code === "string" ? body.error.code : undefined,
    fields,
  };
}

/**
 * Kesin hata düzenleme formunu serbest bırakır mı? İlk denemede her kesin hata
 * bırakır. Daha önce ulaşmış olabilecek bir denemeden sonra yalnız bu
 * `requestId` altında hiçbir şey yazılmadığını KANITLAYAN yanıtlar bırakır:
 * 422, 409 REQUEST_ID_REUSED ve — makbuz araması kayıt/sürüm denetiminden ÖNCE
 * olduğundan — 409 VERSION_CONFLICT ile 409 ENTRY_CONFIRMED. 401/403/404
 * taslağı bekleyen tutar.
 */
export function shouldReleaseAfterUpdateError(
  outcome: { status: number; code?: string },
  earlierAttempt: boolean,
): boolean {
  if (!earlierAttempt) return true;
  if (outcome.status === 422) return true;
  return (
    outcome.status === 409 &&
    (outcome.code === "REQUEST_ID_REUSED" ||
      outcome.code === "VERSION_CONFLICT" ||
      outcome.code === "ENTRY_CONFIRMED")
  );
}

/** Sürüm çakışması veya onaylanmış kayıt: form serbest kalır ama güncel kayıt yeniden okunmalıdır. */
export function updateErrorNeedsReread(outcome: { status: number; code?: string }): boolean {
  return outcome.status === 409 && (outcome.code === "VERSION_CONFLICT" || outcome.code === "ENTRY_CONFIRMED");
}

/**
 * Teslim onayı (T4.2 istemcisi) — SAF yardımcılar. Onay taslağı düzenleme
 * taslağından AYRI saklanır ama adı `workEntryEditDraftPrefix` ile başlar:
 * kapsam değişince/çıkışta aynı süpürme onu da siler. Gövde İLK gönderimden
 * ÖNCE `frozenBody` olarak taslağa dondurulur; belirsiz sonuçta aynı
 * `requestId` + bu metin BAYTI BAYTINA yeniden yollanır, form durumundan
 * ya da yeniden okunan kayıttan asla yeniden kurulmaz.
 */
export function workEntryConfirmDraftName(vehicleId: string, entryId: string): string {
  return `${workEntryEditDraftPrefix(vehicleId)}${entryId}-onay`;
}

export interface WorkEntryConfirmDraft {
  requestId: string;
  /** Kullanıcı alana yazdı mı; yazmadıysa alan kaydın beklenen tutarıyla dolu gösterilir. */
  touched: boolean;
  receivedText: string;
  pending: boolean;
  frozenBody: string | null;
  attemptSent: boolean;
}

export function emptyConfirmDraft(newId: () => string): WorkEntryConfirmDraft {
  return { requestId: newId(), touched: false, receivedText: "", pending: false, frozenBody: null, attemptSent: false };
}

/** Kesin hata sonrası: yeni `requestId`, kullanıcının yazdığı tutar korunur. */
export function releaseConfirmDraft(draft: WorkEntryConfirmDraft, newId: () => string): WorkEntryConfirmDraft {
  return { ...draft, pending: false, frozenBody: null, attemptSent: false, requestId: newId() };
}

/**
 * Alınan tutar alanının ön dolumu: yalnız bekleyen şoför kaydında ve beklenen
 * tutar eksi değilken beklenen teslim ("6.200,00"). Ön dolum onay DEĞİLDİR;
 * eksi beklenen için alan boş kalır (eksi tutar geçersiz olurdu).
 */
export function receivedPrefill(
  entry: Pick<WorkEntryDetail, "workKind" | "status" | "remainderCents">,
): string {
  if (entry.workKind !== "driver" || entry.status !== "pending") return "";
  if (parseApiCents(entry.remainderCents) === null) return "";
  return centsToInputText(entry.remainderCents);
}

/**
 * Gönderimi bekleyen (dondurulmuş) gövdedeki tutar, alan için "6.000,00" metni;
 * gövde okunamazsa `null`. Bekleyen denemede alan, o an gönderilen tutarı gösterir.
 */
export function frozenReceivedText(frozenBody: string | null): string | null {
  if (frozenBody === null) return null;
  try {
    const received = (JSON.parse(frozenBody) as { receivedCents?: unknown } | null)?.receivedCents;
    return typeof received === "string" && parseApiCents(received) !== null ? centsToInputText(received) : null;
  } catch {
    return null;
  }
}

/** Beklenenden fark; eşit ya da geçersiz giriş `null`. */
export function receivedDifference(
  expectedCents: string,
  receivedText: string,
): { kind: "shortfall" | "excess"; cents: bigint } | null {
  const expected = parseSignedApiCents(expectedCents);
  const received = parseTlAmount(receivedText);
  if (expected === null || !received.ok || received.cents === expected) return null;
  return received.cents < expected
    ? { kind: "shortfall", cents: expected - received.cents }
    : { kind: "excess", cents: received.cents - expected };
}

export interface WorkEntryConfirmBody {
  requestId: string;
  version: number;
  receivedCents: string;
}

/** `receivedCents` her zaman AÇIKÇA gider; eksi/bozuk/boş tutar istek atılmadan alan hatasıdır. */
export function buildWorkEntryConfirmBody(input: {
  requestId: string;
  version: number;
  receivedText: string;
}): { ok: true; body: WorkEntryConfirmBody } | { ok: false; message: string } {
  const received = parseTlAmount(input.receivedText);
  if (!received.ok) return { ok: false, message: received.message };
  return {
    ok: true,
    body: { requestId: input.requestId, version: input.version, receivedCents: centsToApiString(received.cents) },
  };
}

export type WorkEntryConfirmOutcome =
  | { kind: "confirmed"; entry: WorkEntryDetail }
  | { kind: "ambiguous" }
  | { kind: "error"; status: number; code?: string; fields: Record<string, string> };

/**
 * Onay yanıtını sınıflar. Başarı YALNIZ `confirmed` durumlu ve onayı dolu bir
 * 200'den gelir; ağ hatası, okunamayan gövde, 5xx ve biçimi/durumu beklenmeyen
 * 200 belirsizdir (onay yazılmış olabilir).
 */
export function classifyWorkEntryConfirmResponse(
  response: { status: number; body: unknown } | null,
): WorkEntryConfirmOutcome {
  const outcome = classifyWorkEntryUpdateResponse(response);
  if (outcome.kind !== "saved") return outcome;
  if (outcome.entry.status !== "confirmed" || outcome.entry.confirmation === null) return { kind: "ambiguous" };
  return { kind: "confirmed", entry: outcome.entry };
}

/**
 * Sunucu makbuz aramasını kayıt/sürüm denetiminden ÖNCE yapar; bu yüzden
 * 409 VERSION_CONFLICT/ENTRY_CONFIRMED ve 422 bu `requestId` altında hiçbir
 * şey yazılmadığını kanıtlar — düzenlemeyle aynı kural.
 */
export function shouldReleaseAfterConfirmError(
  outcome: { status: number; code?: string },
  earlierAttempt: boolean,
): boolean {
  return shouldReleaseAfterUpdateError(outcome, earlierAttempt);
}

/** Sürüm çakışması veya başka yerde onaylanmış kayıt: güncel kayıt yeniden okunmalı. */
export function confirmErrorNeedsReread(outcome: { status: number; code?: string }): boolean {
  return updateErrorNeedsReread(outcome);
}

/**
 * Onaylı kaydı düzelt ve onayla (T4.3 istemcisi) — SAF yardımcılar. Düzeltme
 * taslağı düzenleme ve onay taslaklarından AYRI saklanır (adı yine
 * `workEntryEditDraftPrefix` ile başlar: kapsam süpürmesi onu da siler). Alanlar
 * kaydın güncel değerleridir; `receivedText` güncel ONAYIN tutarıyla başlar ve
 * hasılat/gider değişince ASLA yeni beklenen teslime kaymaz (ilk onaydaki
 * `receivedPrefill`den farkı budur). Gövde ilk gönderimden ÖNCE `frozenBody`
 * olarak dondurulur; belirsiz sonuçta aynı `requestId` + bu metin BAYTI BAYTINA
 * yeniden yollanır.
 */
export function workEntryCorrectDraftName(vehicleId: string, entryId: string): string {
  return `${workEntryEditDraftPrefix(vehicleId)}${entryId}-duzelt`;
}

export interface WorkEntryCorrectDraft extends WorkEntryEditDraft {
  /** "Aldığım tutar (TL)" alanı; güncel onayın alınan tutarıyla başlar. */
  receivedText: string;
}

/** Sunucudaki onaylı kayıttan TEMİZ taslak; alınan tutar `confirmation.receivedCents`tir, kalan değil. */
export function correctDraftFromEntry(entry: WorkEntryDetail, newId: () => string): WorkEntryCorrectDraft {
  return {
    ...editDraftFromEntry(entry, newId),
    receivedText: entry.confirmation ? centsToInputText(entry.confirmation.receivedCents) : "",
  };
}

/** Kullanıcının kayıttan/onaydan farklı bir değeri (veya sonucu belirsiz bir gönderimi) var mı. */
export function isCorrectDraftDirty(draft: WorkEntryCorrectDraft, entry: WorkEntryDetail): boolean {
  if (draft.pending) return true;
  const base = correctDraftFromEntry(entry, () => draft.requestId);
  return isEditDraftDirty(draft, entry) || draft.receivedText.trim() !== base.receivedText;
}

/** Belirsiz/kesin sonuçtan sonra formu serbest bırakır: yeni `requestId`, alan değerleri korunur. */
export function releaseCorrectDraft(draft: WorkEntryCorrectDraft, newId: () => string): WorkEntryCorrectDraft {
  return { ...draft, pending: false, frozenBody: null, attemptSent: false, requestId: newId() };
}

/** Kullanıcı güncel değerleri gördükten sonra kendi değerleriyle sürer: taslak güncel sürüme bağlanır. */
export function rebaseCorrectDraft(
  draft: WorkEntryCorrectDraft,
  currentVersion: number,
  newId: () => string,
): WorkEntryCorrectDraft {
  return { ...releaseCorrectDraft(draft, newId), baseVersion: currentVersion };
}

export interface WorkEntryCorrectBody extends WorkEntryPatchBody {
  receivedCents: string;
}

/**
 * Taslaktan düzelt-ve-onayla gövdesi (şoför kaydı): PATCH gövdesi + AÇIK
 * `receivedCents`. Tür/işletme/rol/pay/durum alanları gövdeye ASLA konmaz.
 * Geçersiz tutar (alınan dahil) → `null`.
 */
export function buildWorkEntryCorrectBody(draft: WorkEntryCorrectDraft): WorkEntryCorrectBody | null {
  const patch = buildWorkEntryPatchBody(draft, "driver");
  const received = parseTlAmount(draft.receivedText);
  if (!patch || !received.ok) return null;
  return { ...patch, receivedCents: centsToApiString(received.cents) };
}

export type WorkEntryCorrectOutcome =
  | { kind: "corrected"; entry: WorkEntryDetail }
  | { kind: "ambiguous" }
  | { kind: "error"; status: number; code?: string; fields: Record<string, string> };

/**
 * Düzeltme yanıtını sınıflar. Başarı YALNIZ onaylı durumlu, onayı dolu ve onayı
 * kaydın GÜNCEL sürümüne ait (`confirmation.entryVersion === version`) bir
 * 200'den gelir; ağ hatası, okunamayan gövde, 5xx ve beklenmeyen 200 belirsizdir.
 */
export function classifyWorkEntryCorrectResponse(
  response: { status: number; body: unknown } | null,
): WorkEntryCorrectOutcome {
  const outcome = classifyWorkEntryUpdateResponse(response);
  if (outcome.kind !== "saved") return outcome;
  const { entry } = outcome;
  if (entry.status !== "confirmed" || entry.confirmation === null || entry.confirmation.entryVersion !== entry.version) {
    return { kind: "ambiguous" };
  }
  return { kind: "corrected", entry };
}

/**
 * Sunucu makbuz aramasını kayıt/sürüm denetiminden ÖNCE yapar; bu yüzden 422,
 * 409 VERSION_CONFLICT ve 409 ENTRY_NOT_CONFIRMED bu `requestId` altında hiçbir
 * şey yazılmadığını kanıtlar — düzenlemeyle aynı kural.
 */
export function shouldReleaseAfterCorrectError(
  outcome: { status: number; code?: string },
  earlierAttempt: boolean,
): boolean {
  return (
    shouldReleaseAfterUpdateError(outcome, earlierAttempt) ||
    (outcome.status === 409 && outcome.code === "ENTRY_NOT_CONFIRMED")
  );
}

/** Sürüm çakışması veya kayıt artık onaylı değil: güncel kayıt yeniden okunmalı. */
export function correctErrorNeedsReread(outcome: { status: number; code?: string }): boolean {
  return outcome.status === 409 && (outcome.code === "VERSION_CONFLICT" || outcome.code === "ENTRY_NOT_CONFIRMED");
}

export interface EditPersonOption {
  personId: string;
  label: string;
}

/**
 * Kişi seçici: seçilebilir şoförler + kaydın GÜNCEL kişisi (pasifleşmiş olsa
 * bile, "(pasif)" etiketiyle). Diğer pasif kişiler önerilmez.
 */
export function editPersonOptions(
  selectable: SelectableDriver[],
  current: { id: string; fullName: string },
): EditPersonOption[] {
  const options = selectable.map((driver) => ({ personId: driver.personId, label: driver.fullName }));
  if (options.some((option) => option.personId === current.id)) return options;
  return [{ personId: current.id, label: TEXT.personInactiveSuffix(current.fullName) }, ...options];
}

/** `GET /api/v1/work-entries` yanıtı; bozuk biçim `null`. */
export function parseWorkEntryList(
  body: unknown,
): { entries: WorkEntryDetail[]; nextCursor: string | null } | null {
  const value = body as { workEntries?: unknown; nextCursor?: unknown } | null;
  if (!Array.isArray(value?.workEntries)) return null;
  if (value.nextCursor !== null && typeof value.nextCursor !== "string") return null;
  const entries: WorkEntryDetail[] = [];
  for (const item of value.workEntries) {
    const entry = parseWorkEntryDetail(item);
    if (!entry) return null;
    entries.push(entry);
  }
  return { entries, nextCursor: value.nextCursor };
}

export function buildWorkEntriesUrl(personId: string, cursor?: string): string {
  const params = new URLSearchParams({ workerPersonId: personId });
  if (cursor) params.set("cursor", cursor);
  return `/api/v1/work-entries?${params.toString()}`;
}
