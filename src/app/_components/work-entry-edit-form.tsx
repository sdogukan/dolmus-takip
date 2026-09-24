"use client";

/**
 * Kayıt detayı ve düzenleme (T3.5 istemcisi); `mode` ile sahip, şoför ve ekip
 * sayfalarında kullanılır. Üstte SUNUCUNUN kaydı (sürüm, pay, teslim, durum) —
 * yalnız sunucu yanıtından gelir, tarayıcıda hesaplanıp "kayıtlı" gösterilmez;
 * altta düzenleme formu. Kayıt türü formda DEĞİŞTİRİLEMEZ (yalnız gösterilir);
 * şoför kaydında kişi değiştirilebilir. Onaylı kayıt ve şoför için bugün
 * dışındaki/doğrulanmış kayıt salt okunurdur; asıl karar sunucudadır.
 *
 * Taslak (`kayit-duzenle-<araç>-<kayıt>`) oluşturma taslağından AYRIDIR ve
 * dayandığı sürümü (`baseVersion`) taşır: PATCH taslağın sürümünü yollar, o an
 * okunan taze sürümü DEĞİL. Taslağın sürümü kayıttan farklıysa (başka sekme/cihaz
 * kaydetti) taslak BAYATTIR: alanlar kilitlenir, güncel kayıt yukarıda görünür ve
 * kullanıcı "Güncel değerleri yükle" ya da "Benim değerlerimle devam et"i seçer —
 * ikincisi taslağı, kullanıcı güncel değerleri gördükten sonra güncel sürüme
 * bağlar. Başarıda depoya temiz taslak (yeni sürüm) yazılır; böylece diğer sekme
 * bayat sürümü kaydedilebilir göstermez.
 *
 * Gönderim: gövde fetch'ten ÖNCE taslağa DONDURULUR; belirsiz sonuçta (ağ, 5xx,
 * okunamayan gövde) alanlar kilitlenir ve aynı `requestId` + dondurulmuş gövde
 * (aynı sürüm dahil) BAYTI BAYTINA yeniden yollanır. Serbest bırakma kuralı
 * `shouldReleaseAfterUpdateError`da. 409 VERSION_CONFLICT / ENTRY_CONFIRMED
 * bırakır ama kullanıcının alan değerleri karşılaştırma taslağı olarak KALIR ve
 * güncel kayıt yeniden okunur. Sunucunun `error.message`'ı BASILMAZ.
 */
import { useEffect, useRef, useState } from "react";
import type { ClientStateScope } from "../../lib/client-state";
import {
  COMMON_SCREEN_MESSAGES,
  DRIVER_FIELD_MESSAGES,
  getErrorMessage,
  WORK_ENTRY_MESSAGES as TEXT,
} from "../../lib/messages";
import { formatTlAmount, parseSignedApiCents, parseTlAmount } from "../../lib/money";
import { isDraftStale } from "../../lib/draft-version";
import { useStoredDraft } from "../../lib/use-stored-draft";
import {
  buildWorkEntryPatchBody,
  canEditEntry,
  classifyWorkEntryUpdateResponse,
  editDraftFromEntry,
  editPersonOptions,
  emptyConfirmDraft,
  formatWorkTimeRange,
  hasEarlierAttempt,
  isEditDraftDirty,
  parseWorkEntryDetail,
  rebaseEditDraft,
  releaseEditDraft,
  shouldReleaseAfterUpdateError,
  updateErrorNeedsReread,
  workEntryConfirmDraftName,
  workEntryEditDraftName,
  workEntryErrorMessage,
  type SelectableDriver,
  type WorkEntryDetail,
  type WorkEntryConfirmDraft,
  type WorkEntryEditDraft,
  type WorkEntryUpdateOutcome,
} from "../../lib/work-entry-ui";
import { evaluateWorkTime, formatDuration, formatWorkDate, istanbulWallClock } from "../../lib/work-time";
import { ConfirmDialog } from "./confirm-dialog";
import { useUnsavedChanges } from "./unsaved-changes";
import { WorkEntryConfirmPanel } from "./work-entry-confirm-panel";
import {
  amountInputProps,
  computeSummary,
  controlClass,
  errorTextClass,
  fetchDrivers,
  labelClass,
  OTHER_NOTE_MAX_LENGTH,
  primaryButtonClass,
  randomRequestId,
  secondaryButtonClass,
  type FetchResult,
  type WorkEntryMode,
} from "./work-entry-form";

type ListState =
  | { status: "loading" }
  | { status: "loaded"; drivers: SelectableDriver[] }
  | { status: "error"; message: string; retryable: boolean };

function requestHeaders(csrfToken: string | null, targetVehicleId: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
    headers["Content-Type"] = "application/json";
  }
  if (targetVehicleId) headers["X-Target-Vehicle"] = targetVehicleId;
  return headers;
}

/** Dondurulmuş gövdeyi olduğu gibi yollar; sonuç `classifyWorkEntryUpdateResponse`ta sınıflanır. */
async function patchWorkEntry(
  entryId: string,
  frozenBody: string,
  csrfToken: string,
  targetVehicleId: string | undefined,
): Promise<WorkEntryUpdateOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/work-entries/${encodeURIComponent(entryId)}`, {
      method: "PATCH",
      headers: requestHeaders(csrfToken, targetVehicleId),
      body: frozenBody,
    });
  } catch {
    return classifyWorkEntryUpdateResponse(null);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return classifyWorkEntryUpdateResponse({ status: response.status, body });
}

type RereadResult = { ok: true; entry: WorkEntryDetail } | { ok: false; message: string };

async function fetchWorkEntry(entryId: string, targetVehicleId: string | undefined): Promise<RereadResult> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/work-entries/${encodeURIComponent(entryId)}`, {
      headers: requestHeaders(null, targetVehicleId),
    });
  } catch {
    return { ok: false, message: TEXT.refreshFailed };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: TEXT.refreshFailed };
  }
  if (!response.ok) {
    const code = (body as { error?: { code?: string } } | null)?.error?.code;
    return { ok: false, message: workEntryErrorMessage(response.status, code) };
  }
  const entry = parseWorkEntryDetail((body as { workEntry?: unknown } | null)?.workEntry);
  return entry ? { ok: true, entry } : { ok: false, message: TEXT.refreshFailed };
}

function formatCents(text: string): string {
  const cents = parseSignedApiCents(text);
  return cents === null ? "—" : formatTlAmount(cents);
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-4 text-lg tabular-nums">
      <span>{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </p>
  );
}

function statusText(status: WorkEntryDetail["status"]): string {
  if (status === "pending") return TEXT.statusPending;
  if (status === "confirmed") return TEXT.statusConfirmed;
  return TEXT.statusNotRequired;
}

function EntryDetail({ entry }: { entry: WorkEntryDetail }) {
  const start = istanbulWallClock(entry.startsAt);
  const end = istanbulWallClock(entry.endsAt);
  return (
    <section
      id="entry-detail"
      aria-label={TEXT.currentValuesTitle}
      className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] p-4"
    >
      <DetailRow label={TEXT.kindLabel} value={entry.workKind === "owner" ? TEXT.kindOwner : TEXT.kindDriver} />
      <DetailRow label={TEXT.detailPerson} value={entry.person.fullName} />
      <DetailRow label={TEXT.detailDate} value={formatWorkDate(entry.workDate)} />
      <DetailRow label={TEXT.detailTime} value={`${start.time} – ${end.time}`} />
      {end.date !== start.date && (
        <p className="text-base text-[var(--color-text-secondary)]">{TEXT.endsOn(formatWorkDate(end.date), end.time)}</p>
      )}
      <DetailRow label={TEXT.detailDuration} value={formatDuration(entry.durationMinutes)} />
      <DetailRow label={TEXT.detailGross} value={formatCents(entry.grossCents)} />
      <DetailRow label={TEXT.detailFuel} value={formatCents(entry.fuelCents)} />
      {(entry.otherExpenseCents !== "0" || entry.otherExpenseNote !== null) && (
        <DetailRow
          label={entry.otherExpenseNote ? `${TEXT.detailOther} (${entry.otherExpenseNote})` : TEXT.detailOther}
          value={formatCents(entry.otherExpenseCents)}
        />
      )}
      <DetailRow label={TEXT.detailShare} value={formatCents(entry.shareCents)} />
      <DetailRow
        label={entry.workKind === "owner" ? TEXT.detailOwnerRemainder : TEXT.detailRemainder}
        value={formatCents(entry.remainderCents)}
      />
      <p className="text-lg font-medium text-[var(--color-text)]">{statusText(entry.status)}</p>
      <p className="text-base text-[var(--color-text-secondary)]">{TEXT.versionLabel(entry.version)}</p>
    </section>
  );
}

/**
 * Sahip görünümü ("Kayıt detayı ve teslim onayı" wireframe'i): kişi · plaka,
 * gün · saat aralığı, durum ve tutar satırları. Yalnız sunucu kaydını gösterir.
 */
function OwnerEntrySummary({ entry, plate }: { entry: WorkEntryDetail; plate: string }) {
  return (
    <section id="entry-detail" aria-label={TEXT.currentValuesTitle} className="flex flex-col gap-2">
      <p className="text-xl font-semibold text-[var(--color-text)]">{TEXT.savedWho(entry.person.fullName, plate)}</p>
      <p className="text-lg tabular-nums text-[var(--color-text)]">
        {TEXT.savedWhen(formatWorkDate(entry.workDate), formatWorkTimeRange(entry.startsAt, entry.endsAt))}
      </p>
      <p role="status" className="text-lg font-medium text-[var(--color-text)]">
        {entry.status === "confirmed" ? TEXT.deliveryConfirmed : statusText(entry.status)}
      </p>
      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] p-4">
        <DetailRow label={TEXT.detailGross} value={formatCents(entry.grossCents)} />
        <DetailRow label={TEXT.detailFuel} value={formatCents(entry.fuelCents)} />
        {(entry.otherExpenseCents !== "0" || entry.otherExpenseNote !== null) && (
          <DetailRow
            label={entry.otherExpenseNote ? `${TEXT.detailOther} (${entry.otherExpenseNote})` : TEXT.detailOther}
            value={formatCents(entry.otherExpenseCents)}
          />
        )}
        <DetailRow label={TEXT.detailShare} value={formatCents(entry.shareCents)} />
        <DetailRow
          label={entry.workKind === "owner" ? TEXT.detailOwnerRemainder : TEXT.expectedLabel}
          value={formatCents(entry.remainderCents)}
        />
      </div>
    </section>
  );
}

export function WorkEntryEditForm({
  entry: initialEntry,
  today,
  mode,
  targetVehicleId,
  disabled = false,
  vehicleId,
  scopeKey,
  csrfToken,
  plate,
}: {
  /** Sunucuda kapsamla okunmuş kayıt. */
  entry: WorkEntryDetail;
  /** "Bugün" sunucuda BİR KEZ hesaplanır (şoför penceresi için). */
  today: string;
  mode: WorkEntryMode;
  /** Ekip modunda hedef araç (URL'den, sunucuda doğrulanmış). */
  targetVehicleId?: string;
  /** Pasif hedef: kayıt okunur, düzenlenemez. */
  disabled?: boolean;
  vehicleId: string;
  scopeKey: string;
  csrfToken: string;
  /** Yalnız sahip modunda: başlıktaki "kişi · plaka" için. */
  plate?: string;
}) {
  const scope: ClientStateScope = { scopeKey };
  const [entry, setEntry] = useState(initialEntry);
  const [draft, persistDraft] = useStoredDraft<WorkEntryEditDraft>(
    scope,
    workEntryEditDraftName(vehicleId, initialEntry.id),
    () => editDraftFromEntry(initialEntry, randomRequestId),
  );
  // Onay taslağı yalnız sahip modunda yazılır; diğer modlarda hiç dokunulmaz.
  const [confirmDraft, persistConfirmDraft] = useStoredDraft<WorkEntryConfirmDraft>(
    scope,
    workEntryConfirmDraftName(vehicleId, initialEntry.id),
    () => emptyConfirmDraft(randomRequestId),
  );
  const [editOpen, setEditOpen] = useState(false);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [personError, setPersonError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const sequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const refreshedKeyRef = useRef("");
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });

  const editable = !disabled && canEditEntry(mode, entry, today);
  const needsPerson = entry.workKind === "driver";
  const stale = isDraftStale({
    baseVersion: draft.baseVersion,
    currentVersion: entry.version,
    pending: draft.pending,
  });
  const dirty = isEditDraftDirty(draft, entry);
  useUnsavedChanges("work-entry-edit", editable && dirty);
  const ownerView = mode === "owner";
  // Sonucu belirsiz onay varken düzenleme kilitlenir: PATCH sürümü değiştirip onayı çakıştırmasın.
  const confirmLocked = ownerView && confirmDraft.pending;
  // Sahipte form "Kaydı düzenle" ile açılır; bekleyen/bayat/yarım taslak formu kendiliğinden açık tutar.
  const editVisible = !ownerView || editOpen || dirty || stale;

  function update(patch: Partial<WorkEntryEditDraft>): void {
    persistDraft((prev) => ({ ...prev, ...patch }));
  }

  function touch(): void {
    setFormMessage(null);
    setSaved(false);
    setServerFields({});
  }

  /** Yeni şoför listesi isteği; öncekini keser. `null` = kesildi/eski yanıt. */
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
    if (!needsPerson || !editable) return;
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

  /** Güncel kaydı okur; başarısızsa mesajı gösterir, kayıt ve taslağa dokunmaz. */
  async function refreshEntry(): Promise<void> {
    const result = await fetchWorkEntry(entry.id, targetVehicleId);
    if (result.ok) setEntry(result.entry);
    else setFormMessage(result.message);
  }

  // Başka sekme/cihaz kaydedince taslağın sürümü kayıttan ayrılır: güncel kaydı BİR KEZ okuruz.
  const staleKey = stale ? `${draft.baseVersion}:${entry.version}` : "";
  useEffect(() => {
    if (staleKey === "" || refreshedKeyRef.current === staleKey) return;
    refreshedKeyRef.current = staleKey;
    void refreshEntry();
    // refreshEntry her render'da yeniden kurulur; tetikleyici yalnız `staleKey`.
  }, [staleKey]);

  const timeInput = { date: draft.date, startTime: draft.startTime, endTime: draft.endTime, endsNextDay: draft.endsNextDay };
  const evaluation = evaluateWorkTime(timeInput);
  const fieldErrors = evaluation.ok ? {} : evaluation.errors;
  const relationVisible = draft.startTime !== "" && draft.endTime !== "";
  const dateError = (submitted ? fieldErrors.date : undefined) ?? serverFields.date;
  const startError = (submitted ? fieldErrors.startTime : undefined) ?? serverFields.startTime;
  const endError =
    (fieldErrors.endTime && (submitted || relationVisible) ? fieldErrors.endTime : undefined) ??
    serverFields.endTime;

  const grossResult = parseTlAmount(draft.grossText);
  const fuelResult = parseTlAmount(draft.fuelText);
  const otherUsed = draft.expenseOpen && (draft.otherText.trim() !== "" || draft.otherNote.trim() !== "");
  const otherResult = otherUsed ? parseTlAmount(draft.otherText) : null;
  const summary = computeSummary(entry.workKind, grossResult, fuelResult, otherResult);
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
    if (draft.otherText.trim() !== "" || draft.otherNote.trim() !== "") {
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

  /** Dondurulmuş gövdeyi yollar ve sonucu işler; çağıran gövdeyi ÖNCEDEN taslağa dondurmuştur. */
  async function send(frozenBody: string, earlierAttempt: boolean): Promise<void> {
    setSubmitting(true);
    setFormMessage(null);
    const outcome = await patchWorkEntry(entry.id, frozenBody, csrfToken, targetVehicleId);
    setSubmitting(false);
    if (outcome.kind === "ambiguous") return; // taslak `pending` kalır: form kilitli, tekrar dene.
    if (outcome.kind === "saved") {
      setEntry(outcome.entry);
      persistDraft(() => editDraftFromEntry(outcome.entry, randomRequestId));
      setSubmitted(false);
      setPersonError(null);
      setServerFields({});
      setSaved(true);
      return;
    }
    setFormMessage(outcome.fields.change ?? workEntryErrorMessage(outcome.status, outcome.code));
    // Daha önce ulaşmış olabilecek denemede yazılmadığı kanıtlanmadıysa taslak bekleyen kalır.
    if (!shouldReleaseAfterUpdateError(outcome, earlierAttempt)) return;
    persistDraft((prev) => releaseEditDraft(prev, randomRequestId));
    if (updateErrorNeedsReread(outcome)) {
      // Kullanıcının değerleri taslakta kalır; güncel kayıt yanında görünür.
      await refreshEntry();
      return;
    }
    if (outcome.status === 422) {
      setServerFields(outcome.fields);
      if (outcome.fields.workerPersonId) {
        setPersonError(outcome.fields.workerPersonId);
        void loadList();
      }
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !editable || stale || confirmLocked) return;
    if (draft.pending && draft.frozenBody !== null) {
      // Belirsiz sonuç: dondurulmuş gövde aynen, aynı requestId ile.
      await send(draft.frozenBody, hasEarlierAttempt(draft));
      return;
    }
    setSubmitted(true);
    setFormMessage(null);
    setServerFields({});
    setSaved(false);

    let hasError = !evaluation.ok;
    if (needsPerson && draft.personId === "") {
      setPersonError(TEXT.managedPersonRequired);
      hasError = true;
    }
    if (!grossResult.ok || !fuelResult.ok || (otherResult && !otherResult.ok)) hasError = true;
    if (summary.status === "invalid") hasError = true;
    if (hasError || !evaluation.ok) return;
    if (!dirty) {
      setFormMessage(DRIVER_FIELD_MESSAGES.noChange);
      return;
    }

    setPersonError(null);
    const body = buildWorkEntryPatchBody(draft, entry.workKind);
    if (!body) {
      setFormMessage(TEXT.connectionFailed);
      return;
    }
    const frozenBody = JSON.stringify(body);
    // Gövde fetch'ten ÖNCE dondurulur; `attemptSent` de fetch'ten ÖNCE yazılır.
    update({ pending: true, frozenBody, requestId: body.requestId, attemptSent: true });
    await send(frozenBody, false);
  }

  const drivers = list.status === "loaded" ? list.drivers : [];
  const personOptions =
    list.status === "loaded"
      ? editPersonOptions(drivers, entry.person)
      : [{ personId: entry.person.id, label: entry.person.fullName }];
  const shareLabel =
    mode === "driver"
      ? TEXT.driverShareLabel
      : entry.workKind === "owner"
        ? TEXT.ownerShareLabel
        : TEXT.onBehalfShareLabel;
  const remainderLabel = entry.workKind === "owner" ? TEXT.ownerRemainderLabel : TEXT.remainderLabel;
  const readOnlyNote =
    entry.status === "confirmed"
      ? getErrorMessage("ENTRY_CONFIRMED")
      : mode === "driver"
        ? TEXT.driverEditWindow
        : undefined;
  const keptDraft = !editable && entry.status === "confirmed" && dirty;

  /**
   * Onay akışından gelen kaydı benimser. Temiz (yarım değişikliği ve bekleyen
   * gönderimi olmayan) düzenleme taslağı yeni sürüme taşınır; yoksa temiz taslak
   * bayat görünür ve onayı kilitlerdi. Yarım taslak korunur ("saklı taslak" / bayat uyarısı).
   */
  function adoptEntry(next: WorkEntryDetail): void {
    setEntry(next);
    const current = draftRef.current;
    if (!current.pending && !isEditDraftDirty(current, entry)) {
      persistDraft(() => editDraftFromEntry(next, randomRequestId));
    }
  }

  /** Onay çakışmasında güncel kaydı okur; başarısızsa kullanıcıya gösterilecek mesajı döner. */
  async function rereadForConfirm(): Promise<string | null> {
    const result = await fetchWorkEntry(entry.id, targetVehicleId);
    if (!result.ok) return result.message;
    adoptEntry(result.entry);
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      {ownerView ? <OwnerEntrySummary entry={entry} plate={plate ?? "—"} /> : <EntryDetail entry={entry} />}

      {ownerView && (
        <WorkEntryConfirmPanel
          entry={entry}
          draft={confirmDraft}
          persistDraft={persistConfirmDraft}
          blocked={disabled || draft.pending || stale}
          csrfToken={csrfToken}
          onEntry={adoptEntry}
          onReread={rereadForConfirm}
        />
      )}

      {saved && (
        <p role="status" className="text-2xl font-semibold text-[var(--color-success)]">
          {TEXT.updated}
        </p>
      )}

      {!editable && (
        <div className="flex flex-col gap-3">
          {formMessage && (
            <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
              {formMessage}
            </p>
          )}
          {!disabled && readOnlyNote && (
            <p role="status" className="text-base text-[var(--color-text-secondary)]">
              {readOnlyNote}
            </p>
          )}
          {keptDraft && (
            <section
              aria-label={TEXT.yourDraftTitle}
              className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-divider)] p-4"
            >
              <p className="text-lg font-medium text-[var(--color-text)]">{TEXT.yourDraftTitle}</p>
              <p className="text-base text-[var(--color-text-secondary)]">{TEXT.confirmedDraftKept}</p>
              <p className="text-base tabular-nums">
                {formatWorkDate(draft.date)} · {draft.startTime} – {draft.endTime}
              </p>
              <p className="text-base tabular-nums">
                {TEXT.detailGross}: {draft.grossText} · {TEXT.detailFuel}: {draft.fuelText}
              </p>
              <button
                type="button"
                onClick={() => persistDraft(() => editDraftFromEntry(entry, randomRequestId))}
                className={secondaryButtonClass}
              >
                {TEXT.discardDraft}
              </button>
            </section>
          )}
        </div>
      )}

      {editable && !editVisible && (
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="inline-flex min-h-[var(--control-min-height)] items-center self-start rounded-[var(--radius-control)] px-1 text-base font-medium text-[var(--color-primary)] underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          {TEXT.editTitle}
        </button>
      )}

      {editable && editVisible && (
        <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
          <h2 className="text-xl font-semibold text-[var(--color-text)]">{TEXT.editTitle}</h2>

          {stale && (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-3 text-base text-[var(--color-error)]"
            >
              <p>{COMMON_SCREEN_MESSAGES.concurrentEditConflict}</p>
              <p className="font-medium">{TEXT.yourDraftTitle}</p>
              <button
                type="button"
                onClick={() => {
                  persistDraft(() => editDraftFromEntry(entry, randomRequestId));
                  touch();
                }}
                className={secondaryButtonClass}
              >
                {TEXT.useCurrent}
              </button>
              <button
                type="button"
                onClick={() => {
                  persistDraft((prev) => rebaseEditDraft(prev, entry.version, randomRequestId));
                  touch();
                }}
                className={secondaryButtonClass}
              >
                {TEXT.keepMine}
              </button>
            </div>
          )}

          <fieldset disabled={draft.pending || stale || confirmLocked} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
            <div>
              <label htmlFor="edit-date" className={labelClass}>
                {TEXT.dateLabel}
              </label>
              <input
                id="edit-date"
                type="date"
                value={draft.date}
                onChange={(event) => {
                  update({ date: event.target.value });
                  touch();
                }}
                aria-invalid={dateError ? true : undefined}
                aria-describedby={dateError ? "edit-date-error" : undefined}
                className={controlClass}
              />
              {dateError && (
                <p id="edit-date-error" role="alert" className={errorTextClass}>
                  {dateError}
                </p>
              )}
            </div>

            {needsPerson && (
              <div>
                <label htmlFor="edit-person" className={labelClass}>
                  {TEXT.personLabel}
                </label>
                <select
                  id="edit-person"
                  value={draft.personId}
                  disabled={list.status === "loading"}
                  onChange={(event) => {
                    update({ personId: event.target.value });
                    setPersonError(null);
                    touch();
                  }}
                  aria-invalid={personError ? true : undefined}
                  aria-describedby={personError ? "edit-person-error" : list.status === "error" ? "edit-person-list-error" : undefined}
                  className={controlClass}
                >
                  {personOptions.map((option) => (
                    <option key={option.personId} value={option.personId}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {list.status === "error" && (
                  <div className="mt-2 flex flex-col gap-2">
                    <p id="edit-person-list-error" role="alert" className="text-base text-[var(--color-error)]">
                      {list.message}
                    </p>
                    {list.retryable && (
                      <button type="button" disabled={submitting} onClick={() => void loadList()} className={secondaryButtonClass}>
                        {TEXT.retry}
                      </button>
                    )}
                  </div>
                )}
                {personError && (
                  <p id="edit-person-error" role="alert" className={errorTextClass}>
                    {personError}
                  </p>
                )}
              </div>
            )}

            <div>
              <label htmlFor="edit-start" className={labelClass}>
                {TEXT.startLabel}
              </label>
              <input
                id="edit-start"
                type="time"
                value={draft.startTime}
                onChange={(event) => {
                  update({ startTime: event.target.value });
                  touch();
                }}
                aria-invalid={startError ? true : undefined}
                aria-describedby={startError ? "edit-start-error" : undefined}
                className={controlClass}
              />
              {startError && (
                <p id="edit-start-error" role="alert" className={errorTextClass}>
                  {startError}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="edit-end" className={labelClass}>
                {TEXT.endLabel}
              </label>
              <input
                id="edit-end"
                type="time"
                value={draft.endTime}
                onChange={(event) => {
                  update({ endTime: event.target.value });
                  touch();
                }}
                aria-invalid={endError ? true : undefined}
                aria-describedby={endError ? "edit-end-error" : undefined}
                className={controlClass}
              />
              <label
                htmlFor="edit-next-day"
                className="mt-2 flex min-h-[var(--control-min-height)] items-center gap-3 text-base text-[var(--color-text)]"
              >
                <input
                  id="edit-next-day"
                  type="checkbox"
                  checked={draft.endsNextDay}
                  onChange={(event) => {
                    update({ endsNextDay: event.target.checked });
                    touch();
                  }}
                  className="size-6"
                />
                {TEXT.nextDayLabel}
              </label>
              {endError && (
                <p id="edit-end-error" role="alert" className={errorTextClass}>
                  {endError}
                </p>
              )}
              {evaluation.ok && (
                <p role="status" className="mt-2 text-lg font-medium text-[var(--color-text)]">
                  {TEXT.duration(formatDuration(evaluation.durationMinutes))}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="edit-gross" className={labelClass}>
                {TEXT.grossLabel}
              </label>
              <input
                id="edit-gross"
                {...amountInputProps}
                value={draft.grossText}
                onChange={(event) => {
                  update({ grossText: event.target.value });
                  touch();
                }}
                aria-invalid={grossError ? true : undefined}
                aria-describedby={grossError ? "edit-gross-error" : undefined}
                className={`${controlClass} tabular-nums`}
              />
              {grossError && (
                <p id="edit-gross-error" role="alert" className={errorTextClass}>
                  {grossError}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="edit-fuel" className={labelClass}>
                {TEXT.fuelLabel}
              </label>
              <input
                id="edit-fuel"
                {...amountInputProps}
                value={draft.fuelText}
                onChange={(event) => {
                  update({ fuelText: event.target.value });
                  touch();
                }}
                aria-invalid={fuelError ? true : undefined}
                aria-describedby={fuelError ? "edit-fuel-error" : undefined}
                className={`${controlClass} tabular-nums`}
              />
              {fuelError && (
                <p id="edit-fuel-error" role="alert" className={errorTextClass}>
                  {fuelError}
                </p>
              )}
            </div>

            {draft.expenseOpen ? (
              <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--color-divider)] p-4">
                <div>
                  <label htmlFor="edit-other" className={labelClass}>
                    {TEXT.otherExpenseLabel}
                  </label>
                  <input
                    id="edit-other"
                    {...amountInputProps}
                    value={draft.otherText}
                    onChange={(event) => {
                      update({ otherText: event.target.value });
                      touch();
                    }}
                    aria-invalid={otherError ? true : undefined}
                    aria-describedby={otherError ? "edit-other-error" : undefined}
                    className={`${controlClass} tabular-nums`}
                  />
                  {otherError && (
                    <p id="edit-other-error" role="alert" className={errorTextClass}>
                      {otherError}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="edit-other-note" className={labelClass}>
                    {TEXT.otherExpenseNoteLabel}
                  </label>
                  <input
                    id="edit-other-note"
                    type="text"
                    maxLength={OTHER_NOTE_MAX_LENGTH}
                    autoComplete="off"
                    value={draft.otherNote}
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
            </div>
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

          {formMessage && !stale && (
            <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
              {formMessage}
            </p>
          )}
          {draft.pending && !submitting && (
            <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
              {TEXT.editUnknownResult}
            </p>
          )}

          {!stale && (
            <button type="submit" disabled={submitting || confirmLocked} className={primaryButtonClass}>
              {submitting ? TEXT.submitting : draft.pending ? TEXT.editSubmitRetry : TEXT.editSubmit}
            </button>
          )}
        </form>
      )}
    </div>
  );
}
