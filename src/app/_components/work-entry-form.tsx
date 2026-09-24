"use client";

/**
 * Günlük kayıt formu (T3.1); `mode` ile şoför, sahip ve ekip ekranlarında
 * kullanılır. Şoförde tür sabit "driver"dır. Sahip/ekipte kayıt türü AÇIK
 * seçilir (önceden seçili değil): "sahip çalıştı" → kişi sahibin kendisi,
 * pay 0; "şoför adına" → yönetim görünümünden türetilen AKTİF şoförler, pay
 * %20. Ekip istekleri `X-Target-Vehicle` taşır. `disabled` (pasif hedef)
 * formu kilitler. Pay/kalan yalnız gösterimdir; hiçbir türetilmiş değer
 * yetki olarak gönderilmez.
 *
 * T3.4: "Kaydet" `POST /api/v1/work-entries` yollar. Alanlar + `requestId`
 * `useStoredDraft` ile saklanır (24 saat); gönderilecek gövde fetch'ten ÖNCE
 * taslağa DONDURULUR. "Kaydedildi" yalnız 201'den sonra görünür ve taslağı
 * siler. Sonuç belirsizse (ağ hatası, okunamayan gövde, 5xx) alanlar kilitlenir;
 * "tekrar dene" ve sayfa yenilemesi sonrası aynı `requestId` ile dondurulmuş
 * gövde BAYTI BAYTINA yeniden yollanır — gövde asla form durumundan yeniden
 * kurulmaz ve o yolda şoför listesi TAZE okunmaz. İlk denemede kesin hatalar formu serbest
 * bırakır ve yeni `requestId` üretir; belirsiz bir denemeden sonra yalnız 422 ve
 * 409 REQUEST_ID_REUSED bırakır, 401/403/404 vb. taslağı bekleyen tutar.
 *
 * T3.7: sonuç ekranı ("Kaydedildi" + sunucunun kişi/plaka/gün/saat/tutarı, "Yenile",
 * "Kaydı aç"); `navigator.onLine === false` tek "gönderilmedi" kanıtıdır (hiçbir
 * şey yollanmaz, alanlar korunur). Belirsiz sonuç; düğme, sayfa açılışında bir
 * kez ve çevrimiçi olayı ile AYNI `requestId` ve dondurulmuş gövdeyle çözülür.
 * Senkron `inFlightRef` çift dokunuşu ve paralel çözümleri keser; taslak yalnız
 * hâlâ bu isteğe aitse boşaltılır/serbest bırakılır (bayat sekme yenisini silmez).
 * 401'de taslak bekleyen kalır ve sabit iç yola giriş bağlantısı çıkar.
 *
 * Liste durumları AYRIDIR: loading / loaded / empty / error. Ağ hatası,
 * 401/403 veya 5xx "boş liste" metnini ASLA göstermez; yalnız `200` +
 * `drivers: []` boş durumdur. Üst üste binen istekler: her istek bir sıra
 * numarası taşır ve öncekini keser; eski yanıt yeni listeyi EZEMEZ.
 * İstemcideki liste yetki VERMEZ (kişi kimliği yalnız seçim değeridir, hiçbir
 * istekte yetki olarak gönderilmez) ve tarayıcı depolamasına yazılmaz.
 * "Bugün" sunucuda BİR KEZ hesaplanıp prop gelir (hydration'da kaymaz).
 *
 * T3.2: hasılat/mazot zorunlu (açık 0 geçerli), tek "diğer masraf" + açıklama
 * isteğe bağlı. Şoför payı ve teslim edilecek tutar tarayıcıda CANLI ve
 * YALNIZ GÖSTERİM olarak hesaplanır (düzenlenebilir kontrol değil, hiçbir
 * isteğe gönderilmez, depolamaya yazılmaz); eksik/geçersiz girdide "—" görünür.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { adminReadErrorMessage } from "../../lib/admin-search";
import { readClientState, type ClientStateScope } from "../../lib/client-state";
import { COMMON_SCREEN_MESSAGES, WORK_ENTRY_MESSAGES as TEXT } from "../../lib/messages";
import { formatTlAmount, parseTlAmount, type ParseTlResult } from "../../lib/money";
import { useStoredDraft } from "../../lib/use-stored-draft";
import { AmountOutOfRangeError, calculateWorkEntryAmounts, type WorkKind } from "../../lib/work-calculation";
import {
  buildWorkEntryBody,
  canResolveUnknown,
  classifyWorkEntryResponse,
  deliveryStatusView,
  draftAfterCreated,
  draftAfterRelease,
  emptyWorkEntryDraft,
  formatWorkTimeRange,
  hasEarlierAttempt,
  isWorkEntryDraftDirty,
  parseWorkEntryDetail,
  savedEntryFromDetail,
  selectableFromDriversResponse,
  shouldReleaseAfterError,
  workEntryDetailHref,
  workEntryDraftName,
  workEntryErrorMessage,
  workEntryLoginHref,
  type SavedWorkEntry,
  type SelectableDriver,
  type WorkEntryDraft,
  type WorkEntrySendOutcome,
} from "../../lib/work-entry-ui";
import { evaluateWorkTime, formatDuration, formatWorkDate } from "../../lib/work-time";
import { ConfirmDialog } from "./confirm-dialog";
import { useUnsavedChanges } from "./unsaved-changes";
import { WorkEntryDeliveryStatus } from "./work-entry-delivery-status";

export type WorkEntryMode = "driver" | "owner" | "staff";

type ListState =
  | { status: "loading" }
  | { status: "loaded"; drivers: SelectableDriver[] }
  | { status: "error"; message: string; retryable: boolean };

export type FetchResult =
  | { ok: true; drivers: SelectableDriver[] }
  | { ok: false; message: string; retryable: boolean };

export async function fetchDrivers(
  signal: AbortSignal,
  targetVehicleId: string | undefined,
): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetch("/api/v1/drivers", {
      signal,
      headers: targetVehicleId ? { "X-Target-Vehicle": targetVehicleId } : undefined,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, message: adminReadErrorMessage(null), retryable: true };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return {
      ok: false,
      message: adminReadErrorMessage(response.ok ? null : response.status),
      retryable: response.status !== 401,
    };
  }
  if (!response.ok) {
    const code = (body as { error?: { code?: string } } | null)?.error?.code;
    return {
      ok: false,
      message: adminReadErrorMessage(response.status, code),
      retryable: response.status !== 401,
    };
  }
  const drivers = selectableFromDriversResponse(body);
  if (!drivers) return { ok: false, message: adminReadErrorMessage(null), retryable: true };
  return { ok: true, drivers };
}

export function randomRequestId(): string {
  return crypto.randomUUID();
}

/** Dondurulmuş gövdeyi olduğu gibi yollar; sonuç `classifyWorkEntryResponse`ta sınıflanır. */
async function postWorkEntry(
  frozenBody: string,
  csrfToken: string,
  targetVehicleId: string | undefined,
): Promise<WorkEntrySendOutcome> {
  const headers: Record<string, string> = {
    "X-CSRF-Token": csrfToken,
    "Content-Type": "application/json",
  };
  if (targetVehicleId) headers["X-Target-Vehicle"] = targetVehicleId;
  let response: Response;
  try {
    response = await fetch("/api/v1/work-entries", { method: "POST", headers, body: frozenBody });
  } catch {
    return classifyWorkEntryResponse(null);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return classifyWorkEntryResponse({ status: response.status, body });
}

type RefreshResult =
  | { ok: true; entry: SavedWorkEntry }
  | { ok: false; message: string; sessionEnded: boolean };

/** "Yenile": kaydı okur (yazmaz). Sunucunun `error.message`'ı BASILMAZ; 404 "silindi" DEMEZ. */
async function fetchSavedEntry(
  entryId: string,
  targetVehicleId: string | undefined,
): Promise<RefreshResult> {
  const failed: RefreshResult = { ok: false, message: TEXT.refreshFailed, sessionEnded: false };
  let response: Response;
  try {
    response = await fetch(`/api/v1/work-entries/${encodeURIComponent(entryId)}`, {
      headers: targetVehicleId ? { "X-Target-Vehicle": targetVehicleId } : undefined,
    });
  } catch {
    return failed;
  }
  if (response.status === 401) {
    return { ok: false, message: COMMON_SCREEN_MESSAGES.sessionEnded, sessionEnded: true };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failed;
  }
  if (!response.ok) return failed;
  const entry = parseWorkEntryDetail((body as { workEntry?: unknown } | null)?.workEntry);
  return entry ? { ok: true, entry: savedEntryFromDetail(entry) } : failed;
}

export const labelClass = "block text-lg font-medium text-[var(--color-text)]";
export const controlClass =
  "mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]";
export const errorTextClass = "mt-1 text-base text-[var(--color-error)]";
export const secondaryButtonClass =
  "min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70";
export const primaryButtonClass =
  "min-h-14 w-full rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-lg font-semibold text-[var(--color-on-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:opacity-70";

export const linkButtonClass =
  "inline-flex min-h-[var(--control-min-height)] items-center self-start rounded-[var(--radius-control)] px-1 text-base font-medium text-[var(--color-primary)] underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]";

export const OTHER_NOTE_MAX_LENGTH = 200;
export const amountInputProps = { type: "text", inputMode: "decimal", autoComplete: "off" } as const;

export type SummaryState =
  | { status: "invalid"; tooLarge: boolean }
  | { status: "ready"; shareCents: number; remainderCents: number };

export function computeSummary(
  workKind: WorkKind,
  gross: ParseTlResult,
  fuel: ParseTlResult,
  other: ParseTlResult | null,
): SummaryState {
  // `other === null` = kullanılmayan bölüm (0); geçersizse özet "—" olur.
  if (!gross.ok || !fuel.ok || (other !== null && !other.ok)) {
    return { status: "invalid", tooLarge: false };
  }
  try {
    const amounts = calculateWorkEntryAmounts(
      workKind,
      gross.cents,
      fuel.cents,
      other?.ok ? other.cents : 0n,
    );
    return {
      status: "ready",
      shareCents: amounts.shareCents,
      remainderCents: amounts.remainderCents,
    };
  } catch (error) {
    if (error instanceof AmountOutOfRangeError) return { status: "invalid", tooLarge: true };
    throw error;
  }
}

export function WorkEntryForm({
  today,
  plate,
  mode = "driver",
  ownerName,
  targetVehicleId,
  disabled = false,
  vehicleId,
  scopeKey,
  csrfToken,
}: {
  today: string;
  /** Sonuç ekranındaki plaka (sunucuda doğrulanmış, gösterim biçiminde). */
  plate: string;
  mode?: WorkEntryMode;
  /** Sahibin adı (sunucudan); sahip/ekip modunda "sahip çalıştı" için. */
  ownerName?: string;
  /** Ekip modunda hedef araç (URL'den, sunucuda doğrulanmış). */
  targetVehicleId?: string;
  /** Pasif hedef: form kilitlenir, kayıt yapılamaz. */
  disabled?: boolean;
  /** Taslak adı için araç kimliği (oturumdan veya URL'den, sunucuda doğrulanmış). */
  vehicleId: string;
  /** Taslak kapsamı (`computeScopeKey`). */
  scopeKey: string;
  csrfToken: string;
}) {
  const scope: ClientStateScope = { scopeKey };
  const [draft, persistDraft] = useStoredDraft<WorkEntryDraft>(
    scope,
    workEntryDraftName(vehicleId),
    () => emptyWorkEntryDraft(today, randomRequestId),
  );
  const {
    workType,
    date,
    personId,
    startTime,
    endTime,
    endsNextDay,
    grossText,
    fuelText,
    expenseOpen,
    otherText,
    otherNote,
  } = draft;
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<SavedWorkEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Sürmekte olan gönderim belirsiz bir sonucun kontrolü mü (ilk gönderim değil).
  const [checking, setChecking] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [refresh, setRefresh] = useState<
    { status: "loading" } | { status: "error"; message: string } | null
  >(null);
  const [workTypeError, setWorkTypeError] = useState<string | null>(null);
  // `submitting` render kapanışından okunur; çift dokunuşu yalnız senkron ref keser.
  const inFlightRef = useRef(false);
  const refreshingRef = useRef(false);
  const savedHeadingRef = useRef<HTMLParagraphElement | null>(null);
  const resolveRef = useRef<(frozenBody: string, requestId: string) => Promise<void>>(async () => {});
  const sequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });

  function update(patch: Partial<WorkEntryDraft>): void {
    persistDraft((prev) => ({ ...prev, ...patch }));
  }

  /** Yeni istek başlatır; öncekini keser. `null` = kesildi/eski yanıt. */
  async function request(): Promise<FetchResult | null> {
    const sequence = ++sequenceRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let result: FetchResult;
    try {
      result = await fetchDrivers(controller.signal, targetVehicleId);
    } catch {
      return null;
    }
    return sequence === sequenceRef.current ? result : null;
  }

  function applyList(result: FetchResult): void {
    const current = draftRef.current;
    // Bekleyen (dondurulmuş) gönderimde seçim ASLA değiştirilmez; kişinin
    // seçilebilirliğine sunucu karar verir.
    if (
      result.ok &&
      !current.pending &&
      current.personId !== "" &&
      !result.drivers.some((driver) => driver.personId === current.personId)
    ) {
      update({ personId: "" });
    }
    setList(
      result.ok
        ? { status: "loaded", drivers: result.drivers }
        : { status: "error", message: result.message, retryable: result.retryable },
    );
  }

  async function loadList(): Promise<void> {
    setList({ status: "loading" });
    const result = await request();
    if (result) applyList(result);
  }

  useEffect(() => {
    // İlk yükleme: durum zaten "loading" (senkron setState yok).
    void request().then((result) => {
      if (result) applyList(result);
    });
    return () => {
      sequenceRef.current += 1;
      controllerRef.current?.abort();
    };
    // Yalnız mount'ta bir kez; request/applyList ref/set fonksiyonlarını kullanır.
  }, []);

  useEffect(() => {
    resolveRef.current = (frozenBody, requestId) =>
      guarded(() => resolveUnknown(frozenBody, requestId, false));
  });

  useEffect(() => {
    // Sayfa açılışında bir kez: sonucu belirsiz taslak varsa AYNI istek kontrol edilir.
    // Hydration'da `draft` henüz sunucu anlık görüntüsü olabilir; depo doğrudan okunur.
    const stored = readClientState<WorkEntryDraft>(
      window.localStorage,
      { scopeKey },
      workEntryDraftName(vehicleId),
    );
    if (stored && stored.frozenBody !== null && canResolveUnknown(stored, { online: navigator.onLine, disabled })) {
      void resolveRef.current(stored.frozenBody, stored.requestId);
    }
    function onOnline(): void {
      const current = draftRef.current;
      if (current.frozenBody !== null && canResolveUnknown(current, { online: true, disabled })) {
        void resolveRef.current(current.frozenBody, current.requestId);
      }
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // Yalnız mount'ta; en güncel çözümleyici `resolveRef` üzerinden çağrılır.
  }, []);

  const hasSaved = saved !== null;
  useEffect(() => {
    if (hasSaved) savedHeadingRef.current?.focus();
  }, [hasSaved]);

  function touch(): void {
    setFormMessage(null);
    setServerFields({});
  }

  const timeInput = { date, startTime, endTime, endsNextDay };
  const evaluation = evaluateWorkTime(timeInput);
  const fieldErrors = evaluation.ok ? {} : evaluation.errors;
  // Süre/sıra ilişkisi hataları saatler dolunca CANLI görünür; eksik alan
  // hataları gönderimden sonra.
  const relationVisible = startTime !== "" && endTime !== "";
  const dateError = (submitted ? fieldErrors.date : undefined) ?? serverFields.date;
  const startError = (submitted ? fieldErrors.startTime : undefined) ?? serverFields.startTime;
  const endError =
    (fieldErrors.endTime && (submitted || relationVisible) ? fieldErrors.endTime : undefined) ??
    serverFields.endTime;

  const workKind: WorkKind | null = mode === "driver" ? "driver" : workType === "" ? null : workType;
  const needsPerson = workKind === "driver";
  const dirty = isWorkEntryDraftDirty(draft, today);
  useUnsavedChanges("work-entry", dirty);

  const grossResult = parseTlAmount(grossText);
  const fuelResult = parseTlAmount(fuelText);
  // Tutar boş + açıklama boş = kullanılmadı (0); açıklamalı boş tutar 0 SAYILMAZ.
  const otherUsed = expenseOpen && (otherText.trim() !== "" || otherNote.trim() !== "");
  const otherResult = otherUsed ? parseTlAmount(otherText) : null;
  const summary = computeSummary(workKind ?? "driver", grossResult, fuelResult, otherResult);
  const grossError =
    (submitted && !grossResult.ok ? grossResult.message : undefined) ?? serverFields.grossCents;
  const fuelError =
    (submitted && !fuelResult.ok
      ? fuelResult.message
      : submitted && summary.status === "invalid" && summary.tooLarge
        ? TEXT.amountsTooLarge
        : undefined) ?? serverFields.fuelCents;
  const otherError =
    (submitted && otherResult && !otherResult.ok ? otherResult.message : undefined) ??
    serverFields.otherExpenseCents ??
    serverFields.otherExpenseNote;

  function requestRemoveExpense(): void {
    if (otherText.trim() !== "" || otherNote.trim() !== "") {
      setConfirmingRemove(true);
      return;
    }
    update({ expenseOpen: false });
    touch();
  }

  function confirmRemoveExpense(): void {
    setConfirmingRemove(false);
    update({ expenseOpen: false, otherText: "", otherNote: "" });
    touch();
  }

  /** Aynı anda tek istek: ikinci dokunuş, çevrimiçi olayı veya sayfa açılışı paralel başlatmaz. */
  async function guarded(run: () => Promise<void>): Promise<void> {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await run();
    } finally {
      inFlightRef.current = false;
    }
  }

  /** Dondurulmuş gövdeyi yollar ve sonucu işler; çağıran gövdeyi ÖNCEDEN taslağa dondurmuştur. */
  async function send(
    frozenBody: string,
    requestId: string,
    earlierAttempt: boolean,
  ): Promise<void> {
    setSubmitting(true);
    setChecking(earlierAttempt);
    setFormMessage(null);
    setSessionEnded(false);
    const outcome = await postWorkEntry(frozenBody, csrfToken, targetVehicleId);
    setSubmitting(false);
    setChecking(false);
    if (outcome.kind === "ambiguous") return; // taslak `pending` kalır: form kilitli, sonuç kontrol edilir.
    if (outcome.kind === "created") {
      persistDraft((current) =>
        draftAfterCreated(current, requestId, () => emptyWorkEntryDraft(today, randomRequestId)),
      );
      setSubmitted(false);
      setPersonError(null);
      setServerFields({});
      setSaved(outcome.entry);
      return;
    }
    setFormMessage(workEntryErrorMessage(outcome.status, outcome.code));
    if (outcome.status === 401) setSessionEnded(true);
    // Daha önce ulaşmış olabilecek denemede kayıt yokluğu kanıtlanmadıysa taslak
    // bekleyen kalır: aynı requestId ve dondurulmuş gövde korunur.
    if (!shouldReleaseAfterError(outcome, earlierAttempt)) return;
    // Kesin hata: form serbest kalır, sonraki kayıt yeni requestId ile gider.
    const newRequestId = randomRequestId();
    persistDraft((current) => draftAfterRelease(current, requestId, newRequestId));
    if (outcome.status === 422) {
      setServerFields(outcome.fields);
      if (outcome.fields.workerPersonId) {
        update({ personId: "" });
        setPersonError(outcome.fields.workerPersonId);
        void loadList();
      }
    }
  }

  /**
   * Sonucu belirsiz gönderimi çözer: dondurulmuş gövde AYNI requestId ile aynen
   * yeniden yollanır. Çevrimdışıyken hiçbir şey yollanmaz; sonuç bilinmeyen kalır
   * ("Henüz kaydedilmedi" DENMEZ — istek daha önce sunucuya ulaşmış olabilir).
   */
  async function resolveUnknown(
    frozenBody: string,
    requestId: string,
    manual: boolean,
  ): Promise<void> {
    if (!navigator.onLine) {
      if (manual) setFormMessage(TEXT.stillOffline);
      return;
    }
    await send(frozenBody, requestId, true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (disabled) return;
    await guarded(async () => {
      if (draft.pending && draft.frozenBody !== null) {
        // Belirsiz sonuç: dondurulmuş gövde aynen, aynı requestId ile; liste okunmaz.
        if (!hasEarlierAttempt(draft)) {
          await send(draft.frozenBody, draft.requestId, false);
          return;
        }
        await resolveUnknown(draft.frozenBody, draft.requestId, true);
        return;
      }
      await submitNew();
    });
  }

  async function submitNew(): Promise<void> {
    setSubmitted(true);
    setFormMessage(null);
    setSessionEnded(false);
    setServerFields({});

    let hasError = !evaluation.ok;
    if (workKind === null) {
      setWorkTypeError(TEXT.workTypeInvalid);
      hasError = true;
    }
    if (needsPerson && personId === "") {
      setPersonError(mode === "driver" ? TEXT.personRequired : TEXT.managedPersonRequired);
      hasError = true;
    }
    if (!grossResult.ok || !fuelResult.ok || (otherResult && !otherResult.ok)) hasError = true;
    if (summary.status === "invalid") hasError = true;
    if (hasError || !evaluation.ok) return;

    // Çevrimdışı = "gönderilmedi"nin tek kanıtı: istek yollanmaz, taslak dondurulmaz, alanlar korunur.
    if (!navigator.onLine) {
      setFormMessage(TEXT.connectionFailed);
      return;
    }

    setSubmitting(true);
    if (workKind === "driver") {
      // Kişi hâlâ seçilebilir mi — istemci listesine GÜVENİLMEZ, taze okunur.
      const result = await request();
      if (!result) {
        setSubmitting(false);
        return;
      }
      if (!result.ok) {
        setSubmitting(false);
        setFormMessage(
          result.retryable ? TEXT.connectionFailed : COMMON_SCREEN_MESSAGES.sessionEnded,
        );
        setSessionEnded(!result.retryable);
        return;
      }
      applyList(result);
      if (!result.drivers.some((driver) => driver.personId === personId)) {
        setSubmitting(false);
        update({ personId: "" });
        setPersonError(TEXT.personUnavailable);
        return;
      }
    }
    setPersonError(null);
    const body = buildWorkEntryBody(draft, mode);
    if (!body) {
      setSubmitting(false);
      setFormMessage(TEXT.connectionFailed);
      return;
    }
    const frozenBody = JSON.stringify(body);
    // Gövde fetch'ten ÖNCE dondurulur; yenileme/yeniden deneme bunu yollar.
    // `attemptSent` fetch'ten ÖNCE yazılır: ilk istek uçarken yenileme veya başka
    // sekmeden yapılan tekrar, onu görülmemiş bir deneme olarak ele alır.
    update({ pending: true, frozenBody, requestId: body.requestId, attemptSent: true });
    await send(frozenBody, body.requestId, false);
  }

  async function refreshSaved(): Promise<void> {
    if (!saved || refreshingRef.current) return;
    refreshingRef.current = true;
    const entryId = saved.id;
    setRefresh({ status: "loading" });
    setSessionEnded(false);
    const result = await fetchSavedEntry(entryId, targetVehicleId);
    refreshingRef.current = false;
    if (result.ok) {
      setSaved((current) => (current?.id === entryId ? result.entry : current));
      setRefresh(null);
      return;
    }
    setRefresh({ status: "error", message: result.message });
    setSessionEnded(result.sessionEnded);
  }

  function chooseWorkType(next: WorkKind): void {
    if (next === workType) return;
    // Tür değişince kişi ve hatası temizlenir; bayat kişi kimliği sahip türüne taşınmaz.
    update({ workType: next, personId: "" });
    setWorkTypeError(null);
    setPersonError(null);
    touch();
  }

  const drivers = list.status === "loaded" ? list.drivers : [];
  const personEmptyText =
    mode === "owner" ? TEXT.ownerPersonEmpty : mode === "staff" ? TEXT.staffPersonEmpty : TEXT.personEmpty;
  const shareLabel =
    mode === "driver"
      ? TEXT.driverShareLabel
      : workKind === "owner"
        ? TEXT.ownerShareLabel
        : TEXT.onBehalfShareLabel;
  const remainderLabel = workKind === "owner" ? TEXT.ownerRemainderLabel : TEXT.remainderLabel;
  const personDescribedBy = personError
    ? "work-person-error"
    : list.status === "loaded" && drivers.length === 0
      ? "work-person-empty"
      : list.status === "error"
        ? "work-person-list-error"
        : undefined;

  if (saved) {
    const wrapClass = "[overflow-wrap:anywhere]";
    return (
      <section className="flex min-w-0 flex-col gap-4">
        <p
          ref={savedHeadingRef}
          tabIndex={-1}
          role="status"
          className="text-2xl font-semibold text-[var(--color-success)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          {TEXT.saved}
        </p>
        <p className={`text-lg font-medium text-[var(--color-text)] ${wrapClass}`}>
          {TEXT.savedWho(saved.personName, plate)}
        </p>
        <p className={`text-lg text-[var(--color-text)] ${wrapClass}`}>
          {TEXT.savedWhen(formatWorkDate(saved.workDate), formatWorkTimeRange(saved.startsAt, saved.endsAt))}
        </p>
        <WorkEntryDeliveryStatus view={deliveryStatusView(saved, mode)} />
        <div role="status" aria-live="polite">
          {refresh?.status === "loading" && (
            <p className="text-base text-[var(--color-text-secondary)]">{TEXT.refreshing}</p>
          )}
        </div>
        {refresh?.status === "error" && (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]"
          >
            {refresh.message}
          </p>
        )}
        {sessionEnded && (
          <Link href={workEntryLoginHref(mode)} className={linkButtonClass}>
            {TEXT.loginLink}
          </Link>
        )}
        <button
          type="button"
          disabled={refresh?.status === "loading"}
          onClick={() => void refreshSaved()}
          className={secondaryButtonClass}
        >
          {TEXT.refresh}
        </button>
        <Link href={workEntryDetailHref(mode, saved.id, vehicleId)} className={linkButtonClass}>
          {TEXT.openEntry}
        </Link>
        <button
          type="button"
          onClick={() => {
            setSaved(null);
            setRefresh(null);
            setSessionEnded(false);
          }}
          className={secondaryButtonClass}
        >
          {TEXT.newEntry}
        </button>
      </section>
    );
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)}>
      <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
      <fieldset disabled={draft.pending} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
      {mode !== "driver" && (
        <div role="group" aria-labelledby="work-type-label">
          <p id="work-type-label" className={labelClass}>
            {TEXT.workTypeLabel}
          </p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(
              [
                ["owner", mode === "staff" ? TEXT.staffOwnerWorked : TEXT.ownerWorked],
                ["driver", TEXT.onBehalfOfDriver],
              ] as const
            ).map(([kind, text]) => (
              <button
                key={kind}
                type="button"
                aria-pressed={workType === kind}
                onClick={() => chooseWorkType(kind)}
                className={`min-h-[var(--control-min-height)] rounded-[var(--radius-control)] border px-3 text-base font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70 ${
                  workType === kind
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                    : "border-[var(--color-input-border)] text-[var(--color-text)]"
                }`}
              >
                {text}
              </button>
            ))}
          </div>
          {workTypeError && (
            <p role="alert" className={errorTextClass}>
              {workTypeError}
            </p>
          )}
          {workKind === "owner" && (
            <p className="mt-2 text-lg font-medium text-[var(--color-text)]">
              {TEXT.ownerEmployee(ownerName ?? "—")}
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="work-date" className={labelClass}>
          {TEXT.dateLabel}
        </label>
        <input
          id="work-date"
          type="date"
          value={date}
          onChange={(event) => {
            update({ date: event.target.value });
            touch();
          }}
          aria-invalid={dateError ? true : undefined}
          aria-describedby={dateError ? "work-date-error" : "work-date-display"}
          className={controlClass}
        />
        <p id="work-date-display" className="mt-1 text-base text-[var(--color-text-secondary)]">
          {formatWorkDate(date)}
        </p>
        {dateError && (
          <p id="work-date-error" role="alert" className={errorTextClass}>
            {dateError}
          </p>
        )}
      </div>

      {(mode === "driver" || workKind === "driver") && (
      <div>
        <label htmlFor="work-person" className={labelClass}>
          {TEXT.personLabel}
        </label>
        <select
          id="work-person"
          value={personId}
          disabled={list.status !== "loaded" || drivers.length === 0}
          onChange={(event) => {
            update({ personId: event.target.value });
            setPersonError(null);
            touch();
          }}
          aria-invalid={personError ? true : undefined}
          aria-describedby={personDescribedBy}
          className={controlClass}
        >
          <option value="">
            {list.status === "loading"
              ? TEXT.personLoading
              : mode === "driver"
                ? TEXT.personPlaceholder
                : TEXT.managedPersonPlaceholder}
          </option>
          {drivers.map((driver) => (
            <option key={driver.personId} value={driver.personId}>
              {driver.fullName}
            </option>
          ))}
        </select>
        {list.status === "loaded" && drivers.length === 0 && (
          <p id="work-person-empty" role="status" className="mt-1 text-base text-[var(--color-text-secondary)]">
            {personEmptyText}
          </p>
        )}
        {list.status === "error" && (
          <div className="mt-2 flex flex-col gap-2">
            <p id="work-person-list-error" role="alert" className="text-base text-[var(--color-error)]">
              {list.message}
            </p>
            {list.retryable && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void loadList()}
                className={secondaryButtonClass}
              >
                {TEXT.retry}
              </button>
            )}
          </div>
        )}
        {personError && (
          <p id="work-person-error" role="alert" className={errorTextClass}>
            {personError}
          </p>
        )}
      </div>
      )}

      <div>
        <label htmlFor="work-start" className={labelClass}>
          {TEXT.startLabel}
        </label>
        <input
          id="work-start"
          type="time"
          value={startTime}
          onChange={(event) => {
            update({ startTime: event.target.value });
            touch();
          }}
          aria-invalid={startError ? true : undefined}
          aria-describedby={startError ? "work-start-error" : undefined}
          className={controlClass}
        />
        {startError && (
          <p id="work-start-error" role="alert" className={errorTextClass}>
            {startError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="work-end" className={labelClass}>
          {TEXT.endLabel}
        </label>
        <input
          id="work-end"
          type="time"
          value={endTime}
          onChange={(event) => {
            update({ endTime: event.target.value });
            touch();
          }}
          aria-invalid={endError ? true : undefined}
          aria-describedby={endError ? "work-end-error" : undefined}
          className={controlClass}
        />
        <label
          htmlFor="work-next-day"
          className="mt-2 flex min-h-[var(--control-min-height)] items-center gap-3 text-base text-[var(--color-text)]"
        >
          <input
            id="work-next-day"
            type="checkbox"
            checked={endsNextDay}
            onChange={(event) => {
              update({ endsNextDay: event.target.checked });
              touch();
            }}
            className="size-6"
          />
          {TEXT.nextDayLabel}
        </label>
        {endError && (
          <p id="work-end-error" role="alert" className={errorTextClass}>
            {endError}
          </p>
        )}
        {evaluation.ok && (
          <div role="status" className="mt-2 flex flex-col gap-1 text-base text-[var(--color-text)]">
            {endsNextDay && (
              <p>{TEXT.endsOn(formatWorkDate(evaluation.endDate), endTime)}</p>
            )}
            <p className="text-lg font-medium">
              {TEXT.duration(formatDuration(evaluation.durationMinutes))}
            </p>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="work-gross" className={labelClass}>
          {TEXT.grossLabel}
        </label>
        <input
          id="work-gross"
          {...amountInputProps}
          value={grossText}
          onChange={(event) => {
            update({ grossText: event.target.value });
            touch();
          }}
          aria-invalid={grossError ? true : undefined}
          aria-describedby={grossError ? "work-gross-error" : undefined}
          className={`${controlClass} tabular-nums`}
        />
        {grossError && (
          <p id="work-gross-error" role="alert" className={errorTextClass}>
            {grossError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="work-fuel" className={labelClass}>
          {TEXT.fuelLabel}
        </label>
        <input
          id="work-fuel"
          {...amountInputProps}
          value={fuelText}
          onChange={(event) => {
            update({ fuelText: event.target.value });
            touch();
          }}
          aria-invalid={fuelError ? true : undefined}
          aria-describedby={fuelError ? "work-fuel-error" : undefined}
          className={`${controlClass} tabular-nums`}
        />
        {fuelError && (
          <p id="work-fuel-error" role="alert" className={errorTextClass}>
            {fuelError}
          </p>
        )}
      </div>

      {expenseOpen ? (
        <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--color-divider)] p-4">
          <div>
            <label htmlFor="work-other" className={labelClass}>
              {TEXT.otherExpenseLabel}
            </label>
            <input
              id="work-other"
              {...amountInputProps}
              value={otherText}
              onChange={(event) => {
                update({ otherText: event.target.value });
                touch();
              }}
              aria-invalid={otherError ? true : undefined}
              aria-describedby={otherError ? "work-other-error" : undefined}
              className={`${controlClass} tabular-nums`}
            />
            {otherError && (
              <p id="work-other-error" role="alert" className={errorTextClass}>
                {otherError}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="work-other-note" className={labelClass}>
              {TEXT.otherExpenseNoteLabel}
            </label>
            <input
              id="work-other-note"
              type="text"
              maxLength={OTHER_NOTE_MAX_LENGTH}
              autoComplete="off"
              value={otherNote}
              onChange={(event) => {
                update({ otherNote: event.target.value });
                touch();
              }}
              className={controlClass}
            />
          </div>
          <button type="button" onClick={requestRemoveExpense} className={secondaryButtonClass}>
            {TEXT.removeExpense}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            update({ expenseOpen: true });
            touch();
          }}
          className={secondaryButtonClass}
        >
          {TEXT.addExpense}
        </button>
      )}

      {workKind !== null && (
      <div
        id="work-summary"
        role="status"
        aria-live="polite"
        aria-label={TEXT.summaryTitle}
        className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] p-4 text-lg tabular-nums"
      >
        <p className="flex justify-between gap-4">
          <span>{shareLabel}</span>
          <span className="font-semibold">
            {summary.status === "ready" ? formatTlAmount(summary.shareCents) : "—"}
          </span>
        </p>
        <p className="flex justify-between gap-4">
          <span>{remainderLabel}</span>
          <span className="font-semibold">
            {summary.status === "ready" ? formatTlAmount(summary.remainderCents) : "—"}
          </span>
        </p>
        {summary.status === "ready" && summary.remainderCents < 0 && (
          <p className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
            {TEXT.remainderNegative}
          </p>
        )}
        {mode !== "driver" && workKind === "owner" && (
          <p className="text-base font-normal text-[var(--color-text-secondary)]">
            {mode === "staff" ? TEXT.staffOwnerNoShareNote : TEXT.ownerNoShareNote}
          </p>
        )}
      </div>
      )}

      </fieldset>

      <ConfirmDialog
        open={confirmingRemove}
        title={TEXT.removeExpenseTitle}
        description={TEXT.removeExpenseDescription}
        confirmLabel={TEXT.removeExpenseConfirm}
        cancelLabel={TEXT.removeExpenseCancel}
        onConfirm={confirmRemoveExpense}
        onCancel={() => setConfirmingRemove(false)}
      />

      {formMessage && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
          {formMessage}
        </p>
      )}
      {sessionEnded && (
        <Link href={workEntryLoginHref(mode)} className={linkButtonClass}>
          {TEXT.loginLink}
        </Link>
      )}
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {submitting && !checking && (
          <p className="text-base text-[var(--color-text)]">{TEXT.submitting}</p>
        )}
        {(checking || (draft.pending && !submitting)) && (
          <div className="flex flex-col gap-1 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
            <p>{TEXT.checking}</p>
            <p>{TEXT.checkHint}</p>
          </div>
        )}
      </div>

      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting ? (checking ? TEXT.checkingButton : TEXT.submitting) : draft.pending ? TEXT.checkNow : TEXT.submit}
      </button>
      </fieldset>
    </form>
  );
}
