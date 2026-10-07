"use client";

/**
 * Ekip hesabı açma formu (istemci bileşeni) — S2.6.
 *
 * `../../isletmeler/yeni/new-business-form.tsx` İLE AYNI tekrar-gönderim
 * kuralları: `requestId` içerik değişmedikçe sabit, sonucu
 * belirsiz gönderimde alanlar dondurulur ve AYNI istek tekrar edilir.
 * Şifre GİZLİ alandır: taslağa/localStorage'a ASLA yazılmaz, yalnız React
 * durumunda tutulur (`../../araclar/[id]/password-reset-section.tsx` ile
 * aynı gerekçe). Sayfa yenilenip taslak "ambiguous" geri yüklenirse şifre
 * alanı BOŞ başlar ve tekrar girilmesi gerekir — sunucu tekrar gönderimde
 * şifreyi kayıtlı özete karşı doğrular.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import type { ClientStateScope } from "../../../../lib/client-state";
import { TEAM_USER_MESSAGES as TEXT } from "../../../../lib/messages";
import {
  TEAM_NEW_DRAFT_NAME,
  TEAM_ROLES,
  TEAM_SESSION_ENDED_HREF,
  TEAM_USERS_URL,
  buildCreateUserBody,
  classifyTeamError,
  pickFieldErrors,
  teamBannerMessage,
  teamRoleLabel,
  validateCreateForm,
  type CreateFieldErrors,
  type TeamRole,
  type TeamUser,
} from "../../../../lib/team-users-ui";
import { useStoredDraft } from "../../../../lib/use-stored-draft";
import { useUnsavedChanges } from "../../../_components/unsaved-changes";
import { sendTeamRequest } from "../team-request";

interface Draft {
  requestId: string;
  username: string;
  fullName: string;
  platformRole: TeamRole;
  pending: boolean;
}

function emptyDraft(): Draft {
  return { requestId: crypto.randomUUID(), username: "", fullName: "", platformRole: "support", pending: false };
}

const inputClass =
  "ds-input mt-1 w-full";

export function NewTeamUserForm({ csrfToken, scopeKey }: { csrfToken: string; scopeKey: string }) {
  const router = useRouter();
  const scope: ClientStateScope = { scopeKey };
  const [draft, persist] = useStoredDraft<Draft>(scope, TEAM_NEW_DRAFT_NAME, emptyDraft);

  // Gizli alan — dosya üstü notu: taslakta ASLA saklanmaz.
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Bu oturumda gönderilmiş şifre (yalnız bellekte): kilit ve "Tekrar kontrol
  // et" bu değerin VARLIĞINA bakar.
  const [submittedPassword, setSubmittedPassword] = useState<string | null>(null);
  useUnsavedChanges("ekip-yeni", draft.username !== "" || draft.fullName !== "" ||
    draft.platformRole !== "support" || password !== "" || draft.pending);

  const [isFetching, setIsFetching] = useState(false);
  const phase: "idle" | "submitting" | "ambiguous" = isFetching ? "submitting" : draft.pending ? "ambiguous" : "idle";
  const [banner, setBanner] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<CreateFieldErrors>({});
  const usernameRef = useRef<HTMLInputElement>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // Sunucu alan hatası gönderim sürerken gelir ve alanlar o sırada devre dışıdır;
  // odak, form tekrar açılınca verilir.
  const focusWhenIdle = useRef<RefObject<HTMLInputElement | null> | null>(null);
  useEffect(() => {
    if (phase !== "idle" || !focusWhenIdle.current) return;
    focusWhenIdle.current.current?.focus();
    focusWhenIdle.current = null;
  }, [phase]);

  async function send(body: Draft, sentPassword: string): Promise<void> {
    setBanner(null);
    const outcome = await sendTeamRequest<TeamUser>(
      TEAM_USERS_URL,
      "POST",
      csrfToken,
      buildCreateUserBody(body.requestId, { ...body, password: sentPassword }),
    );
    if (outcome.kind === "ambiguous") {
      persist({ ...body, pending: true });
      return;
    }
    if (outcome.kind === "success") {
      persist(emptyDraft());
      setPassword("");
      setSubmittedPassword(null);
      router.push(`/yonetim/ekip/${outcome.user.id}`);
      return;
    }

    // Kesin sonuç: taslağa hemen yeni requestId yazılır (sayfa yenilenirse
    // aynı id kalıp sonraki her gönderimi 409 yapmasın).
    persist({ ...body, requestId: crypto.randomUUID(), pending: false });
    setSubmittedPassword(null);
    if (classifyTeamError(outcome.status, outcome.code) === "session-ended") {
      router.push(TEAM_SESSION_ENDED_HREF);
      return;
    }
    const fields = pickFieldErrors(outcome, ["username", "fullName", "password"] as const);
    if (fields) {
      setFieldErrors(fields);
      focusWhenIdle.current = fields.username ? usernameRef : fields.fullName ? fullNameRef : passwordRef;
      return;
    }
    setBanner(teamBannerMessage(outcome, TEXT.requestIdReusedCreate));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase !== "idle") return;
    const errors = validateCreateForm({ ...draft, password });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      (errors.username ? usernameRef : errors.fullName ? fullNameRef : passwordRef).current?.focus();
      return;
    }
    setBanner(null);
    setIsFetching(true);
    setSubmittedPassword(password);
    const sent = { ...draft, pending: true };
    persist(sent);
    await send(sent, password);
    setIsFetching(false);
  }

  async function handleRetryCheck(): Promise<void> {
    setIsFetching(true);
    const sentPassword = submittedPassword ?? password;
    setSubmittedPassword(sentPassword);
    await send(draft, sentPassword);
    setIsFetching(false);
  }

  function handleFieldChange(next: Partial<Pick<Draft, "username" | "fullName" | "platformRole">>): void {
    const hadKnownResult = Object.values(fieldErrors).some(Boolean) || banner !== null;
    if (hadKnownResult) {
      setFieldErrors({});
      setBanner(null);
    }
    persist({
      ...draft,
      ...next,
      requestId: hadKnownResult ? crypto.randomUUID() : draft.requestId,
      pending: false,
    });
  }

  function handlePasswordChange(value: string): void {
    const hadKnownResult = Object.values(fieldErrors).some(Boolean) || banner !== null;
    if (hadKnownResult) {
      setFieldErrors({});
      setBanner(null);
      persist({ ...draft, requestId: crypto.randomUUID(), pending: false });
    }
    setPassword(value);
  }

  const frozen = phase !== "idle";
  const passwordLocked = phase === "submitting" || (phase === "ambiguous" && submittedPassword !== null);
  const canRetry = phase === "ambiguous" && (submittedPassword !== null || password !== "");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="ds-title">{TEXT.newTitle}</h1>
        <p className="mt-1 text-base text-[var(--color-text-secondary)]">{TEXT.newIntro}</p>
      </div>

      <form onSubmit={handleSubmit} noValidate aria-busy={phase === "submitting"} className="flex flex-col gap-6">
        {banner && (
          <p role="alert" className="ds-notice ds-notice-error break-words">
            {banner}
          </p>
        )}
        {phase === "ambiguous" && (
          <div role="status" className="ds-notice ds-notice-warning flex flex-col gap-3">
            <p>
              {TEXT.checking}
              {submittedPassword === null && ` ${TEXT.reenterPassword}`}
            </p>
          </div>
        )}

        <section aria-labelledby="new-team-info-title" className="ds-panel flex flex-col gap-6">
          <h2 id="new-team-info-title" className="ds-section-title">Hesap bilgileri</h2>
          <div>
            <label htmlFor="team-username" className="ds-label block">
              {TEXT.usernameLabel}
            </label>
            <input
              ref={usernameRef}
              id="team-username"
              name="username"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={draft.username}
              disabled={frozen}
              onChange={(event) => handleFieldChange({ username: event.target.value })}
              aria-invalid={fieldErrors.username ? true : undefined}
              aria-describedby={fieldErrors.username ? "team-username-error" : "team-username-help"}
              className={inputClass}
            />
            <p id="team-username-help" className="mt-1 text-base text-[var(--color-text-secondary)]">
              {TEXT.usernameHelp}
            </p>
            {fieldErrors.username && (
              <p id="team-username-error" role="alert" className="ds-error-text ds-error-icon mt-1">
                {fieldErrors.username}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="team-full-name" className="ds-label block">
              {TEXT.fullNameLabel}
            </label>
            <input
              ref={fullNameRef}
              id="team-full-name"
              name="fullName"
              type="text"
              autoComplete="off"
              value={draft.fullName}
              disabled={frozen}
              onChange={(event) => handleFieldChange({ fullName: event.target.value })}
              aria-invalid={fieldErrors.fullName ? true : undefined}
              aria-describedby={fieldErrors.fullName ? "team-full-name-error" : undefined}
              className={inputClass}
            />
            {fieldErrors.fullName && (
              <p id="team-full-name-error" role="alert" className="ds-error-text ds-error-icon mt-1">
                {fieldErrors.fullName}
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="new-team-access-title" className="ds-panel flex flex-col gap-6">
          <h2 id="new-team-access-title" className="ds-section-title">Yetki ve şifre</h2>
          <fieldset className="flex flex-col gap-2" disabled={frozen}>
            <legend className="ds-label">{TEXT.roleLegend}</legend>
            {TEAM_ROLES.map((role) => (
              <label
                key={role}
                className="ds-choice-row flex items-center gap-3"
              >
                <input
                  type="radio"
                  name="platformRole"
                  value={role}
                  checked={draft.platformRole === role}
                  onChange={() => handleFieldChange({ platformRole: role })}
                  className="ds-check"
                />
                {teamRoleLabel(role)}
              </label>
            ))}
          </fieldset>

          <div>
            <label htmlFor="team-password" className="ds-label block">
              {TEXT.passwordLabel}
            </label>
            <div className="mt-1 flex items-stretch gap-2">
              <input
                ref={passwordRef}
                id="team-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                disabled={passwordLocked}
                onChange={(event) => handlePasswordChange(event.target.value)}
                aria-invalid={fieldErrors.password ? true : undefined}
                aria-describedby={fieldErrors.password ? "team-password-error" : undefined}
                className="ds-input w-full flex-1"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-pressed={showPassword}
                className="ds-btn ds-btn-secondary min-w-[3rem] shrink-0"
              >
                {showPassword ? TEXT.hide : TEXT.show}
              </button>
            </div>
            {fieldErrors.password && (
              <p id="team-password-error" role="alert" className="ds-error-text ds-error-icon mt-1">
                {fieldErrors.password}
              </p>
            )}
          </div>
        </section>

        <p aria-live="polite" className="sr-only">
          {phase === "submitting" ? TEXT.creating : ""}
        </p>

        {phase === "ambiguous" ? (
          <button
            type="button"
            onClick={handleRetryCheck}
            disabled={!canRetry}
            className="ds-btn ds-btn-secondary ds-btn-lg w-full"
          >
            {TEXT.retryCheck}
          </button>
        ) : (
          <button
            type="submit"
            disabled={phase !== "idle"}
            aria-busy={phase === "submitting"}
            className="ds-btn ds-btn-primary ds-btn-lg w-full"
          >
            {phase === "submitting" ? TEXT.creating : TEXT.createSubmit}
          </button>
        )}
      </form>
    </div>
  );
}
