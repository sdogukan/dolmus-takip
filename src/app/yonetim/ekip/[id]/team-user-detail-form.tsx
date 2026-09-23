"use client";

/**
 * Ekip hesabı detay formu (istemci bileşeni) — S2.6. Bilgi (ad soyad + yetki)
 * ve aktiflik AYRI mini-formlardır; her biri kendi `requestId`sini taşır ve
 * `../../araclar/[id]/vehicle-detail-form.tsx` İLE AYNI kuralları uygular:
 * PATCH HER ZAMAN taslağın dayandığı `baseVersion`ı gönderir (`isDraftStale`
 * bayat taslağı sunucu değerleriyle değiştirir), sonucu belirsiz istek AYNI
 * gövdeyle tekrarlanır, 409 sürüm çatışması sessizce ezilmez.
 *
 * Kendi hesabını pasifleştiren yönetici sunucuda oturumunu kaybeder: başarıdan
 * sonra bir sonraki isteği 401 beklemeden girişe (`?oturum=bitti`) gönderilir.
 * Kendi yetkisini indiren yönetici için sayfa sunucuda yenilenir (yetkisiz
 * metni oradan gelir). Taslakta yalnız gizli OLMAYAN alanlar saklanır.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ClientStateScope } from "../../../../lib/client-state";
import { isDraftStale } from "../../../../lib/draft-version";
import { TEAM_USER_MESSAGES as TEXT, getErrorMessage } from "../../../../lib/messages";
import {
  TEAM_ROLES,
  TEAM_SESSION_ENDED_HREF,
  buildInfoPatchBody,
  buildUpdateUserBody,
  classifyTeamError,
  diffTeamUser,
  pickFieldErrors,
  teamBannerMessage,
  teamDetailDraftName,
  teamRoleLabel,
  teamUserUrl,
  validateTeamFullName,
  type InfoChanges,
  type TeamErrorOutcome,
  type TeamRole,
  type TeamUser,
} from "../../../../lib/team-users-ui";
import { useStoredDraft } from "../../../../lib/use-stored-draft";
import { ConfirmDialog } from "../../../_components/confirm-dialog";
import { useUnsavedChanges } from "../../../_components/unsaved-changes";
import { sendTeamRequest, type TeamOutcome } from "../team-request";
import { TeamUserPasswordResetSection } from "./team-user-password-reset-section";

interface InfoDraft {
  requestId: string;
  fullName: string;
  platformRole: TeamRole;
  pending: boolean;
  baseVersion: number;
  /** Gönderimde bir kez hesaplanıp dondurulan fark; yeniden deneme YALNIZ bunu yollar. */
  changes: InfoChanges;
}

interface ActiveDraft {
  requestId: string;
  target: boolean;
  pending: boolean;
  baseVersion: number;
}

interface DetailDraft {
  info: InfoDraft;
  active: ActiveDraft | null;
}

function emptyInfo(user: TeamUser): InfoDraft {
  return {
    requestId: crypto.randomUUID(),
    fullName: user.fullName ?? "",
    platformRole: user.platformRole,
    pending: false,
    baseVersion: user.version,
    changes: {},
  };
}

const REQUEST_ID_REUSED_MESSAGE = getErrorMessage("REQUEST_ID_REUSED") ?? TEXT.connection;

const secondaryButtonClass =
  "min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70";

function Banner({ message, conflict }: { message: string; conflict: boolean }) {
  return (
    <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base break-words text-[var(--color-error)]">
      {message}
      {conflict && (
        <>
          {" "}
          <button type="button" onClick={() => window.location.reload()} className="underline">
            {TEXT.reloadLatest}
          </button>
        </>
      )}
    </p>
  );
}

function CheckingNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
      <p>{TEXT.checking}</p>
      <button type="button" onClick={onRetry} className={secondaryButtonClass}>
        {TEXT.retryCheck}
      </button>
    </div>
  );
}

export function TeamUserDetailForm({
  initialUser,
  isSelf,
  csrfToken,
  scopeKey,
}: {
  initialUser: TeamUser;
  isSelf: boolean;
  csrfToken: string;
  scopeKey: string;
}) {
  const scope: ClientStateScope = { scopeKey };
  const [user, setUser] = useState<TeamUser>(initialUser);
  const [draft, persist] = useStoredDraft<DetailDraft>(scope, teamDetailDraftName(initialUser.id), () => ({
    info: emptyInfo(initialUser),
    active: null,
  }));

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold break-all text-[var(--color-text)]">{user.username}</h1>
          <span
            className={
              user.active
                ? "rounded-full bg-[var(--color-success-surface)] px-2 py-0.5 text-base font-medium text-[var(--color-success)]"
                : "rounded-full bg-[var(--color-warning-surface)] px-2 py-0.5 text-base font-medium text-[var(--color-warning)]"
            }
          >
            {user.active ? TEXT.activeBadge : TEXT.inactiveBadge}
          </span>
        </div>
        <p className="text-base text-[var(--color-text-secondary)]">
          {user.fullName ?? TEXT.noFullName} · {teamRoleLabel(user.platformRole)}
        </p>
      </div>

      <InfoSection
        user={user}
        isSelf={isSelf}
        csrfToken={csrfToken}
        draft={draft.info}
        onDraftChange={(info) => persist((prev) => ({ ...prev, info }))}
        onSaved={setUser}
      />

      <ActiveSection
        user={user}
        isSelf={isSelf}
        csrfToken={csrfToken}
        draft={draft.active}
        onDraftChange={(active) => persist((prev) => ({ ...prev, active }))}
        onSaved={setUser}
      />

      <TeamUserPasswordResetSection user={user} isSelf={isSelf} csrfToken={csrfToken} scopeKey={scopeKey} />
    </div>
  );
}

type PatchOutcome = TeamOutcome<TeamUser>;

function sendPatch(
  user: TeamUser,
  csrfToken: string,
  requestId: string,
  version: number,
  changes: { fullName?: string; platformRole?: TeamRole; active?: boolean },
): Promise<PatchOutcome> {
  return sendTeamRequest<TeamUser>(teamUserUrl(user.id), "PATCH", csrfToken, buildUpdateUserBody(requestId, version, changes));
}

function isConflict(outcome: TeamErrorOutcome): boolean {
  return classifyTeamError(outcome.status, outcome.code) === "conflict";
}

// ---------------------------------------------------------------------------
// Ad soyad + yetki — tek PATCH (yalnız değişen alanlar gider).
// ---------------------------------------------------------------------------

function InfoSection({
  user,
  isSelf,
  csrfToken,
  draft,
  onDraftChange,
  onSaved,
}: {
  user: TeamUser;
  isSelf: boolean;
  csrfToken: string;
  draft: InfoDraft;
  onDraftChange: (next: InfoDraft) => void;
  onSaved: (user: TeamUser) => void;
}) {
  const router = useRouter();
  const [isFetching, setIsFetching] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ fullName?: string; platformRole?: string }>({});
  const [banner, setBanner] = useState<{ message: string; conflict: boolean } | null>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const focusFullNameWhenIdle = useRef(false);

  // Bayat taslak içerikle güvenilmez; sonucu belirsiz (pending) taslak asla
  // atılmaz. Yeniden render'da depoya yazılmaz — yalnız bu render için taze
  // sunucu değerleri kullanılır.
  const stale = isDraftStale({ baseVersion: draft.baseVersion, currentVersion: user.version, pending: draft.pending });
  const effective = stale ? emptyInfo(user) : draft;
  const phase: "idle" | "submitting" | "ambiguous" = isFetching ? "submitting" : effective.pending ? "ambiguous" : "idle";

  useEffect(() => {
    // Sunucu alan hatası gönderim sürerken gelir ve alan o sırada devre dışıdır.
    if (phase !== "idle" || !focusFullNameWhenIdle.current) return;
    focusFullNameWhenIdle.current = false;
    fullNameRef.current?.focus();
  }, [phase]);

  async function run(body: InfoDraft): Promise<void> {
    setBanner(null);
    // Gövde yalnız dondurulmuş taslaktan kurulur; `user` ile yeniden fark alınmaz.
    const outcome = await sendTeamRequest<TeamUser>(teamUserUrl(user.id), "PATCH", csrfToken, buildInfoPatchBody(body));
    if (outcome.kind === "ambiguous") {
      onDraftChange({ ...body, pending: true });
      return;
    }
    if (outcome.kind === "success") {
      onDraftChange(emptyInfo(outcome.user));
      onSaved(outcome.user);
      // Kendi yetkisini indiren yönetici: sayfa sunucuda taze rolle yeniden çizilir.
      if (isSelf && body.changes.platformRole !== undefined) router.refresh();
      return;
    }
    onDraftChange({ ...body, pending: false });
    if (classifyTeamError(outcome.status, outcome.code) === "session-ended") {
      router.push(TEAM_SESSION_ENDED_HREF);
      return;
    }
    const fields = pickFieldErrors(outcome, ["fullName", "platformRole"] as const);
    if (fields) {
      setFieldErrors(fields);
      if (fields.fullName) focusFullNameWhenIdle.current = true;
      return;
    }
    setBanner({ message: teamBannerMessage(outcome, REQUEST_ID_REUSED_MESSAGE), conflict: isConflict(outcome) });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase !== "idle") return;
    const fullNameError = validateTeamFullName(effective.fullName);
    setFieldErrors(fullNameError ? { fullName: fullNameError } : {});
    if (fullNameError) {
      fullNameRef.current?.focus();
      return;
    }
    const sent = { ...effective, changes: diffTeamUser(user, effective), pending: true };
    onDraftChange(sent);
    setIsFetching(true);
    await run(sent);
    setIsFetching(false);
  }

  function handleChange(next: Partial<Pick<InfoDraft, "fullName" | "platformRole">>): void {
    const hadKnownResult = Object.values(fieldErrors).some(Boolean) || banner !== null;
    if (hadKnownResult) {
      setFieldErrors({});
      setBanner(null);
    }
    onDraftChange({
      ...effective,
      ...next,
      requestId: hadKnownResult ? crypto.randomUUID() : effective.requestId,
      pending: false,
      changes: {},
    });
  }

  const disabled = phase !== "idle";
  const hasChange = Object.keys(diffTeamUser(user, effective)).length > 0;
  useUnsavedChanges("ekip-bilgi", hasChange);

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={phase === "submitting"} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-[var(--color-text)]">{TEXT.infoTitle}</h2>
      {banner && <Banner message={banner.message} conflict={banner.conflict} />}
      {phase === "ambiguous" && (
        <CheckingNotice
          onRetry={async () => {
            setIsFetching(true);
            await run(effective);
            setIsFetching(false);
          }}
        />
      )}

      <div>
        <label htmlFor="team-detail-full-name" className="block text-lg font-medium text-[var(--color-text)]">
          {TEXT.fullNameLabel}
        </label>
        <input
          ref={fullNameRef}
          id="team-detail-full-name"
          type="text"
          autoComplete="off"
          value={effective.fullName}
          disabled={disabled}
          onChange={(event) => handleChange({ fullName: event.target.value })}
          aria-invalid={fieldErrors.fullName ? true : undefined}
          aria-describedby={fieldErrors.fullName ? "team-detail-full-name-error" : undefined}
          className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
        />
        {fieldErrors.fullName && (
          <p id="team-detail-full-name-error" role="alert" className="mt-1 text-base text-[var(--color-error)]">
            {fieldErrors.fullName}
          </p>
        )}
      </div>

      <fieldset
        className="flex flex-col gap-2"
        disabled={disabled}
        aria-describedby={fieldErrors.platformRole ? "team-detail-role-error" : undefined}
      >
        <legend className="text-lg font-medium text-[var(--color-text)]">{TEXT.roleLegend}</legend>
        {TEAM_ROLES.map((role) => (
          <label
            key={role}
            className="flex min-h-[var(--control-min-height)] items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-3 text-lg font-medium text-[var(--color-text)]"
          >
            <input
              type="radio"
              name="team-detail-role"
              value={role}
              checked={effective.platformRole === role}
              onChange={() => handleChange({ platformRole: role })}
              className="h-5 w-5"
            />
            {teamRoleLabel(role)}
          </label>
        ))}
      </fieldset>
      {fieldErrors.platformRole && (
        <p id="team-detail-role-error" role="alert" className="text-base text-[var(--color-error)]">
          {fieldErrors.platformRole}
        </p>
      )}

      <button
        type="submit"
        disabled={disabled || !hasChange}
        className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
      >
        {phase === "submitting" ? TEXT.saving : TEXT.infoSubmit}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Aktiflik — pasifleştirme ConfirmDialog'lu, yeniden aktifleştirme doğrudan.
// ---------------------------------------------------------------------------

function ActiveSection({
  user,
  isSelf,
  csrfToken,
  draft,
  onDraftChange,
  onSaved,
}: {
  user: TeamUser;
  isSelf: boolean;
  csrfToken: string;
  draft: ActiveDraft | null;
  onDraftChange: (next: ActiveDraft | null) => void;
  onSaved: (user: TeamUser) => void;
}) {
  const router = useRouter();
  const [isFetching, setIsFetching] = useState(false);
  const [banner, setBanner] = useState<{ message: string; conflict: boolean } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const stale =
    draft !== null && isDraftStale({ baseVersion: draft.baseVersion, currentVersion: user.version, pending: draft.pending });
  const effective = stale ? null : draft;
  const phase: "idle" | "submitting" | "ambiguous" = isFetching ? "submitting" : effective?.pending ? "ambiguous" : "idle";

  async function run(body: ActiveDraft): Promise<void> {
    setBanner(null);
    const outcome = await sendPatch(user, csrfToken, body.requestId, body.baseVersion, { active: body.target });
    if (outcome.kind === "ambiguous") {
      onDraftChange({ ...body, pending: true });
      return;
    }
    if (outcome.kind === "success") {
      onDraftChange(null);
      onSaved(outcome.user);
      // Kendi hesabını pasifleştirenin oturumu sunucuda kapandı.
      if (isSelf && !body.target) router.push(TEAM_SESSION_ENDED_HREF);
      return;
    }
    onDraftChange({ ...body, pending: false });
    if (classifyTeamError(outcome.status, outcome.code) === "session-ended") {
      router.push(TEAM_SESSION_ENDED_HREF);
      return;
    }
    const fieldMessage = pickFieldErrors(outcome, ["active"] as const)?.active;
    setBanner({
      message: fieldMessage ?? teamBannerMessage(outcome, REQUEST_ID_REUSED_MESSAGE),
      conflict: isConflict(outcome),
    });
  }

  async function startAction(target: boolean): Promise<void> {
    const body: ActiveDraft = { requestId: crypto.randomUUID(), target, pending: false, baseVersion: user.version };
    if (target) {
      const sent = { ...body, pending: true };
      onDraftChange(sent);
      setIsFetching(true);
      await run(sent);
      setIsFetching(false);
    } else {
      onDraftChange(body);
      setDialogOpen(true);
    }
  }

  async function confirmDeactivate(): Promise<void> {
    setDialogOpen(false);
    if (!effective) return;
    const sent = { ...effective, pending: true };
    onDraftChange(sent);
    setIsFetching(true);
    await run(sent);
    setIsFetching(false);
  }

  const disabled = phase !== "idle";

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--color-divider)] pt-6">
      <h2 className="text-xl font-semibold text-[var(--color-text)]">{TEXT.activeTitle}</h2>
      {banner && <Banner message={banner.message} conflict={banner.conflict} />}
      {phase === "ambiguous" && effective && (
        <CheckingNotice
          onRetry={async () => {
            setIsFetching(true);
            await run(effective);
            setIsFetching(false);
          }}
        />
      )}

      {user.active ? (
        <>
          <p className="text-base text-[var(--color-text-secondary)]">{TEXT.deactivateHint}</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => startAction(false)}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] bg-[var(--color-error)] px-4 text-base font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-error)] disabled:opacity-70"
          >
            {phase === "submitting" && effective?.target === false ? TEXT.deactivating : TEXT.deactivateSubmit}
          </button>
        </>
      ) : (
        <>
          <p className="text-base text-[var(--color-text-secondary)]">{TEXT.reactivateHint}</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => startAction(true)}
            className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 text-base font-semibold text-[var(--color-on-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
          >
            {phase === "submitting" && effective?.target === true ? TEXT.reactivating : TEXT.reactivateSubmit}
          </button>
        </>
      )}

      <ConfirmDialog
        open={dialogOpen && effective !== null}
        title={TEXT.deactivateDialogTitle}
        description={
          <div className="flex flex-col gap-2">
            <p>
              <strong>{user.username}</strong> hesabı pasifleştirilecek. {TEXT.deactivateHint}
            </p>
            {isSelf && <p>{TEXT.deactivateSelfWarning}</p>}
          </div>
        }
        confirmLabel={TEXT.deactivateDialogConfirm}
        danger
        isSubmitting={phase === "submitting"}
        onConfirm={confirmDeactivate}
        onCancel={() => {
          setDialogOpen(false);
          onDraftChange(null);
        }}
      />
    </div>
  );
}
