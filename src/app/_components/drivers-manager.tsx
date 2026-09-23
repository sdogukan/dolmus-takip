"use client";

/**
 * Şoförlerim yönetim bileşeni (istemci) — T2.5. `/sahip/soforler` (sahip
 * oturumu) ile `/yonetim/araclar/[id]/soforler` (ekip) İKİSİ de AYNI bileşeni
 * kullanır; fark yalnız `mode`dur: ekip isteklerine `X-Target-Vehicle`
 * eklenir, küresel kişi aktifliği (tüm araçlarda pasife alma) ve şifre
 * sıfırlama bağlantısı YALNIZ ekipte görünür. Bir düğmeyi gizlemek
 * yetkilendirme DEĞİLDİR — sunucu sahip oturumunda `active` alanını 403 ile
 * reddeder (`../api/v1/drivers/[personId]/route.ts`).
 *
 * `../yonetim/araclar/[id]/vehicle-detail-form.tsx` İLE AYNI istemci
 * desenleri: her işlem kendi `requestId`sini taşır ve taslakla birlikte
 * `useStoredDraft` ile kapsam anahtarı (`scopeKey` + araç) başına saklanır;
 * sonucu belirsiz (ağ/5xx) işlemde AYNI `requestId` korunur ve alanlar
 * çözülene kadar kilitlenir; 409'da yerel taslak sunucu değerleriyle
 * değiştirilir, yeni sürümle SESSİZCE yeniden gönderilmez. İstek gövdesine
 * kişi/işletme/rol kimliği KONMAZ (`../../lib/drivers-ui.ts`). Şifre/token
 * taslağa yazılmaz. Adlar düz metin olarak (React kaçışıyla) basılır.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { ClientStateScope } from "../../lib/client-state";
import {
  buildAddRequest,
  buildOpRequest,
  describeAffectedVehicle,
  driverErrorMessage,
  driversDraftName,
  emptyAddDraft,
  emptyDriversDraft,
  findSimilarCandidates,
  isAmbiguousStatus,
  isOpStale,
  splitDrivers,
  validateDriverName,
  type AffectedVehicleRow,
  type DriverOpDraft,
  type DriverRequest,
  type DriverRow,
  type DriversDraft,
  type DriversView,
} from "../../lib/drivers-ui";
import { DRIVER_SCREEN_MESSAGES } from "../../lib/messages";
import { useStoredDraft } from "../../lib/use-stored-draft";
import { ConfirmDialog } from "./confirm-dialog";
import { useUnsavedChanges } from "./unsaved-changes";

type Outcome =
  | { kind: "ambiguous" }
  | { kind: "success"; data: Record<string, unknown> }
  | { kind: "error"; status: number; code?: string; fields?: Record<string, string> };

interface ErrorBody {
  error?: { code?: string; fields?: Record<string, string> };
}

function randomRequestId(): string {
  return crypto.randomUUID();
}

async function send(
  request: DriverRequest | { method: "GET"; url: string },
  csrfToken: string,
  targetVehicleId: string | undefined,
): Promise<Outcome> {
  const headers: Record<string, string> = { "X-CSRF-Token": csrfToken };
  if (targetVehicleId) headers["X-Target-Vehicle"] = targetVehicleId;
  const hasBody = "body" in request;
  if (hasBody) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers,
      body: hasBody ? JSON.stringify(request.body) : undefined,
    });
  } catch {
    return { kind: "ambiguous" };
  }
  let parsed: (Record<string, unknown> & ErrorBody) | undefined;
  try {
    parsed = (await response.json()) as Record<string, unknown> & ErrorBody;
  } catch {
    return isAmbiguousStatus(response.status) || response.ok
      ? { kind: "ambiguous" }
      : { kind: "error", status: response.status };
  }
  if (response.ok) return { kind: "success", data: parsed };
  if (isAmbiguousStatus(response.status)) return { kind: "ambiguous" };
  return {
    kind: "error",
    status: response.status,
    code: parsed?.error?.code,
    fields: parsed?.error?.fields,
  };
}

const inputClass =
  "mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] disabled:opacity-70";
const secondaryButtonClass =
  "min-h-[var(--control-min-height)] rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] disabled:opacity-70";
const primaryButtonClass =
  "min-h-[var(--control-min-height)] rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] disabled:opacity-70";
const dangerButtonClass =
  "min-h-[var(--control-min-height)] rounded-[var(--radius-control)] bg-[var(--color-error)] px-4 text-base font-semibold text-white disabled:opacity-70";

export function DriversManager({
  mode,
  vehicleId,
  plateDisplay,
  csrfToken,
  scopeKey,
  initialView,
  affectedVehicles,
  passwordResetHref,
}: {
  mode: "owner" | "staff";
  vehicleId: string;
  plateDisplay: string;
  csrfToken: string;
  scopeKey: string;
  initialView: DriversView;
  /** Yalnız ekip: kişi → bağlı olduğu tüm araçlar (sunucuda okunur,
   * `router.refresh()` ile tazelenir). */
  affectedVehicles?: Record<string, AffectedVehicleRow[]>;
  passwordResetHref?: string;
}) {
  const isStaff = mode === "staff";
  const targetVehicleId = isStaff ? vehicleId : undefined;
  const router = useRouter();
  const scope: ClientStateScope = { scopeKey };
  const [view, setView] = useState<DriversView>(initialView);
  const [draft, persistDraft] = useStoredDraft<DriversDraft>(scope, driversDraftName(vehicleId), () =>
    emptyDriversDraft(randomRequestId),
  );
  const [isBusy, setIsBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(draft.add.fullName !== "" || draft.add.pending);
  const [showInactive, setShowInactive] = useState(false);
  const [showSharedPasswordWarning, setShowSharedPasswordWarning] = useState(false);
  const [affectedNotice, setAffectedNotice] = useState<AffectedVehicleRow[] | null>(null);
  const [dialogPersonId, setDialogPersonId] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  const op = draft.op && !isOpStale(draft.op, view) ? draft.op : null;
  const locked = isBusy || draft.add.pending || op?.pending === true;
  const { active, inactive } = splitDrivers(view.drivers);
  const similar = findSimilarCandidates(draft.add.fullName, view.candidates);
  // Yalnız ekip modunda: yazılmış ama gönderilmemiş ad veya açık bir satır işlemi.
  useUnsavedChanges("soforler", isStaff && (draft.add.fullName.trim() !== "" || op !== null));

  function persistOp(next: DriverOpDraft | null): void {
    persistDraft((prev) => ({ ...prev, op: next }));
  }

  async function loadView(): Promise<DriversView | null> {
    const outcome = await send({ method: "GET", url: "/api/v1/drivers" }, csrfToken, targetVehicleId);
    if (outcome.kind !== "success") {
      setBanner(driverErrorMessage(outcome.kind === "error" ? outcome.status : 500, undefined));
      return null;
    }
    const fresh: DriversView = {
      drivers: (outcome.data.drivers as DriverRow[] | undefined) ?? [],
      candidates: (outcome.data.candidates as DriversView["candidates"] | undefined) ?? [],
    };
    setView(fresh);
    if (isStaff) router.refresh();
    return fresh;
  }

  function startOp(next: Omit<DriverOpDraft, "requestId" | "pending">): DriverOpDraft {
    return { ...next, requestId: randomRequestId(), pending: false };
  }

  async function executeOp(target: DriverOpDraft): Promise<void> {
    setBanner(null);
    setRenameError(null);
    setIsBusy(true);
    const sent: DriverOpDraft = { ...target, pending: true };
    persistOp(sent);
    const outcome = await send(buildOpRequest(sent, vehicleId), csrfToken, targetVehicleId);
    if (outcome.kind === "ambiguous") {
      setIsBusy(false);
      return;
    }
    if (outcome.kind === "success") {
      persistOp(null);
      setShowSharedPasswordWarning(!isStaff && sent.kind === "assignment" && !sent.active);
      const affected = outcome.data.affectedVehicles as AffectedVehicleRow[] | undefined;
      setAffectedNotice(sent.kind === "person" && !sent.active && affected ? affected : null);
      await loadView();
      setIsBusy(false);
      return;
    }
    setShowSharedPasswordWarning(false);
    setBanner(driverErrorMessage(outcome.status, outcome.code));
    if (outcome.status === 409 || outcome.status === 404) {
      // Yerel taslak sunucu değerleriyle değiştirilir; yeni sürümle sessizce
      // yeniden GÖNDERİLMEZ.
      const fresh = await loadView();
      const row = fresh?.drivers.find((driver) => driver.personId === sent.personId);
      persistOp(
        sent.kind === "rename" && row
          ? startOp({
              kind: "rename",
              personId: row.personId,
              baseVersion: row.personVersion,
              fullName: row.fullName,
              active: true,
            })
          : null,
      );
    } else if (sent.kind === "rename") {
      persistOp({ ...sent, pending: false, requestId: randomRequestId() });
      if (outcome.status === 422) {
        setRenameError(outcome.fields?.fullName ?? outcome.fields?.change ?? null);
      }
    } else {
      persistOp(null);
    }
    setIsBusy(false);
  }

  async function executeAdd(target: DriversDraft["add"]): Promise<void> {
    setBanner(null);
    setAddError(null);
    setIsBusy(true);
    const sent = { ...target, pending: true };
    persistDraft((prev) => ({ ...prev, add: sent }));
    const outcome = await send(buildAddRequest(sent), csrfToken, targetVehicleId);
    if (outcome.kind === "ambiguous") {
      setIsBusy(false);
      return;
    }
    if (outcome.kind === "success") {
      persistDraft((prev) => ({ ...prev, add: emptyAddDraft(randomRequestId) }));
      setAddOpen(false);
      setShowSharedPasswordWarning(false);
      await loadView();
      setIsBusy(false);
      return;
    }
    persistDraft((prev) => ({ ...prev, add: { ...sent, pending: false, requestId: randomRequestId() } }));
    if (outcome.status === 422 && outcome.fields?.fullName) {
      setAddError(outcome.fields.fullName);
      addInputRef.current?.focus();
    } else {
      setBanner(driverErrorMessage(outcome.status, outcome.code));
    }
    setIsBusy(false);
  }

  function handleAddSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (locked) return;
    const invalid = validateDriverName(draft.add.fullName);
    if (invalid) {
      setAddError(invalid);
      addInputRef.current?.focus();
      return;
    }
    void executeAdd(draft.add);
  }

  function rowAssignmentOp(row: DriverRow, activeTarget: boolean): DriverOpDraft {
    return startOp({
      kind: "assignment",
      personId: row.personId,
      baseVersion: row.assignment?.version ?? null,
      fullName: row.fullName,
      active: activeTarget,
    });
  }

  const dialogRow = dialogPersonId ? view.drivers.find((row) => row.personId === dialogPersonId) : undefined;
  const dialogAffected = dialogRow
    ? (affectedVehicles?.[dialogRow.personId] ?? [
        { vehicleId, plateNormalized: plateDisplay, assignmentActive: true },
      ])
    : [];

  function renderRow(row: DriverRow, isActiveList: boolean) {
    const editing = op?.kind === "rename" && op.personId === row.personId ? op : null;
    return (
      <li
        key={row.personId}
        className="flex flex-col gap-3 border-b border-[var(--color-divider)] py-3"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-lg font-medium text-[var(--color-text)]">{row.fullName}</span>
          <span
            className={
              isActiveList
                ? "rounded-full bg-[var(--color-success-surface)] px-2 py-0.5 text-base font-medium text-[var(--color-success)]"
                : "rounded-full bg-[var(--color-warning-surface)] px-2 py-0.5 text-base font-medium text-[var(--color-warning)]"
            }
          >
            {isActiveList ? "Aktif" : "Pasif"}
          </span>
        </div>

        {!row.personActive && (
          <p className="text-base text-[var(--color-text-secondary)]">
            Kişi tüm araçlarda pasif.
            {!isStaff && " Ekipten aktifleştirilmesini iste."}
          </p>
        )}

        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (locked) return;
              const invalid = validateDriverName(editing.fullName);
              if (invalid) {
                setRenameError(invalid);
                return;
              }
              void executeOp(editing);
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor={`driver-rename-${row.personId}`} className="block text-lg font-medium text-[var(--color-text)]">
              Ad soyad
            </label>
            <input
              id={`driver-rename-${row.personId}`}
              type="text"
              value={editing.fullName}
              disabled={locked}
              onChange={(event) => {
                setRenameError(null);
                persistOp({ ...editing, fullName: event.target.value });
              }}
              aria-invalid={renameError ? true : undefined}
              aria-describedby={`driver-rename-note-${row.personId}`}
              className={inputClass}
            />
            <p id={`driver-rename-note-${row.personId}`} className="text-base text-[var(--color-text-secondary)]">
              {DRIVER_SCREEN_MESSAGES.renameNote}
            </p>
            {renameError && (
              <p role="alert" className="text-base text-[var(--color-error)]">
                {renameError}
              </p>
            )}
            <div className="flex gap-3">
              <button type="submit" disabled={locked} className={primaryButtonClass}>
                {isBusy ? "Kaydediliyor…" : "Kaydet"}
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  setRenameError(null);
                  persistOp(null);
                }}
                className={secondaryButtonClass}
              >
                Vazgeç
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                setRenameError(null);
                persistOp(
                  startOp({
                    kind: "rename",
                    personId: row.personId,
                    baseVersion: row.personVersion,
                    fullName: row.fullName,
                    active: true,
                  }),
                );
              }}
              className={secondaryButtonClass}
            >
              Düzenle
            </button>
            {isActiveList ? (
              <>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => void executeOp(rowAssignmentOp(row, false))}
                  className={secondaryButtonClass}
                >
                  Bu araçta pasife al
                </button>
                {isStaff && passwordResetHref && (
                  <Link href={passwordResetHref} className="text-base font-medium text-[var(--color-primary)] underline">
                    Şifre sıfırla
                  </Link>
                )}
              </>
            ) : (
              row.personActive && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => void executeOp(rowAssignmentOp(row, true))}
                  className={primaryButtonClass}
                >
                  Yeniden aktifleştir
                </button>
              )
            )}
            {isStaff && row.personActive && (
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  persistOp(
                    startOp({
                      kind: "person",
                      personId: row.personId,
                      baseVersion: row.personVersion,
                      fullName: row.fullName,
                      active: false,
                    }),
                  );
                  setDialogPersonId(row.personId);
                }}
                className={dangerButtonClass}
              >
                Tüm araçlarda pasife al
              </button>
            )}
            {isStaff && !row.personActive && (
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  void executeOp(
                    startOp({
                      kind: "person",
                      personId: row.personId,
                      baseVersion: row.personVersion,
                      fullName: row.fullName,
                      active: true,
                    }),
                  )
                }
                className={primaryButtonClass}
              >
                Kişiyi yeniden aktifleştir
              </button>
            )}
          </div>
        )}
      </li>
    );
  }

  const pendingOp = op?.pending ? op : null;
  const pendingAdd = draft.add.pending ? draft.add : null;

  return (
    <div className="flex flex-col gap-6">
      {banner && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]">
          {banner}
        </p>
      )}
      {(pendingOp || pendingAdd) && !isBusy && (
        <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          <p>Kaydın sonucu kontrol ediliyor.</p>
          <button
            type="button"
            onClick={() => (pendingOp ? void executeOp(pendingOp) : pendingAdd ? void executeAdd(pendingAdd) : undefined)}
            className={`${secondaryButtonClass} self-start`}
          >
            Tekrar kontrol et
          </button>
        </div>
      )}
      {showSharedPasswordWarning && (
        <p role="status" className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          {DRIVER_SCREEN_MESSAGES.sharedPasswordWarning}
        </p>
      )}
      {affectedNotice && (
        <div role="status" className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          <p>Kişi tüm araçlarda pasife alındı. Etkilenen araçlar:</p>
          <ul className="list-disc pl-6">
            {affectedNotice.map((vehicle) => (
              <li key={vehicle.vehicleId}>{describeAffectedVehicle(vehicle)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          aria-expanded={addOpen}
          aria-controls="driver-add-panel"
          onClick={() => setAddOpen((open) => !open)}
          className={`${primaryButtonClass} self-start`}
        >
          + Şoför ekle
        </button>
        {addOpen && (
          <div id="driver-add-panel" className="flex flex-col gap-4">
            <form onSubmit={handleAddSubmit} className="flex flex-col gap-3">
              <div>
                <label htmlFor="driver-add-name" className="block text-lg font-medium text-[var(--color-text)]">
                  Ad soyad
                </label>
                <input
                  ref={addInputRef}
                  id="driver-add-name"
                  type="text"
                  value={draft.add.fullName}
                  disabled={locked}
                  onChange={(event) => {
                    setAddError(null);
                    persistDraft((prev) => ({ ...prev, add: { ...prev.add, fullName: event.target.value } }));
                  }}
                  aria-invalid={addError ? true : undefined}
                  aria-describedby={addError ? "driver-add-name-error" : undefined}
                  className={inputClass}
                />
                {addError && (
                  <p id="driver-add-name-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
                    {addError}
                  </p>
                )}
              </div>
              {similar.length > 0 && (
                <div role="note" className="text-base text-[var(--color-text-secondary)]">
                  <p>
                    Benzer adlı kayıtlı kişi var: {similar.map((candidate) => candidate.fullName).join(", ")}.
                    Yeni kişi açmak yerine aşağıdan bağlayabilirsin.
                  </p>
                </div>
              )}
              <button type="submit" disabled={locked} className={`${primaryButtonClass} self-start`}>
                {isBusy && !op ? "Kaydediliyor…" : "Şoförü kaydet"}
              </button>
            </form>

            {view.candidates.length > 0 && (
              <div className="flex flex-col gap-2">
                <h2 className="text-xl font-semibold text-[var(--color-text)]">Kayıtlı kişiyi bağla</h2>
                <ul>
                  {view.candidates.map((candidate) => (
                    <li
                      key={candidate.personId}
                      className="flex items-center justify-between gap-3 border-b border-[var(--color-divider)] py-2"
                    >
                      <span className="text-base text-[var(--color-text)]">{candidate.fullName}</span>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() =>
                          void executeOp(
                            startOp({
                              kind: "link",
                              personId: candidate.personId,
                              baseVersion: null,
                              fullName: candidate.fullName,
                              active: true,
                            }),
                          )
                        }
                        className={secondaryButtonClass}
                      >
                        Bu araca bağla
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-[var(--color-text)]">Aktif şoförler</h2>
        {active.length === 0 ? (
          <p className="text-base text-[var(--color-text-secondary)]">{DRIVER_SCREEN_MESSAGES.emptyActiveList}</p>
        ) : (
          <ul>{active.map((row) => renderRow(row, true))}</ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={showInactive}
          onClick={() => setShowInactive((shown) => !shown)}
          className={`${secondaryButtonClass} self-start`}
        >
          {showInactive ? "Pasif şoförleri gizle" : "Pasif şoförleri göster"}
        </button>
        {showInactive && (
          <>
            <h2 className="text-xl font-semibold text-[var(--color-text)]">Pasif şoförler</h2>
            {inactive.length === 0 ? (
              <p className="text-base text-[var(--color-text-secondary)]">Pasif şoför yok.</p>
            ) : (
              <ul>{inactive.map((row) => renderRow(row, false))}</ul>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={dialogPersonId !== null && op?.kind === "person" && op.personId === dialogPersonId}
        title="Kişiyi tüm araçlarda pasife al"
        description={
          <div className="flex flex-col gap-2">
            <p>
              <strong>{dialogRow?.fullName}</strong> bağlı olduğu tüm araçlarda şoför olarak seçilemez hale gelir.
              Atamalar ve geçmiş kayıtlar silinmez; oturumlar kapatılmaz.
            </p>
            <p>Etkilenen araçlar:</p>
            <ul className="list-disc pl-6">
              {dialogAffected.map((vehicle) => (
                <li key={vehicle.vehicleId}>{describeAffectedVehicle(vehicle)}</li>
              ))}
            </ul>
          </div>
        }
        confirmLabel="Pasife al"
        danger
        isSubmitting={isBusy}
        onConfirm={() => {
          const confirmed = op;
          setDialogPersonId(null);
          if (confirmed?.kind === "person") void executeOp(confirmed);
        }}
        onCancel={() => {
          setDialogPersonId(null);
          persistOp(null);
        }}
      />
    </div>
  );
}
