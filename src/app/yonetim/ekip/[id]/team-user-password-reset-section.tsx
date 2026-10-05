"use client";

/**
 * Ekip hesabı şifre sıfırlama bölümü (istemci bileşeni) — S2.6.
 *
 * `../../araclar/[id]/password-reset-section.tsx` İLE AYNI gizli-alan kalıbı:
 * yeni şifre taslağa/localStorage'a/URL'e ASLA yazılmaz, yalnız React
 * durumunda tutulur; taslak yalnız `requestId` ve `pending` taşır. Bağlantı
 * kopunca AYNI requestId AYNI şifreyle tekrar gönderilir (farklı şifre 409
 * REQUEST_ID_REUSED alır); sayfa yenilenirse şifre alanı boş başlar ve
 * "Tekrar kontrol et" için yeniden girilmesi gerekir. Sıfırlama `version`ı
 * DEĞİŞTİRMEZ, bu yüzden bilgi/aktiflik taslaklarına dokunmaz.
 *
 * Kendi şifresini sıfırlayan yöneticinin oturumu sunucuda kapanır: başarıdan
 * sonra girişe (`?oturum=bitti`) gönderilir.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ClientStateScope } from "../../../../lib/client-state";
import { TEAM_USER_MESSAGES as TEXT } from "../../../../lib/messages";
import {
  TEAM_SESSION_ENDED_HREF,
  buildResetPasswordBody,
  classifyTeamError,
  pickFieldErrors,
  teamBannerMessage,
  teamResetDraftName,
  teamUserResetUrl,
  validateTeamPassword,
  type TeamUser,
} from "../../../../lib/team-users-ui";
import { useStoredDraft } from "../../../../lib/use-stored-draft";
import { useUnsavedChanges } from "../../../_components/unsaved-changes";
import { sendTeamRequest } from "../team-request";

interface ResetDraft {
  requestId: string;
  pending: boolean;
}

function emptyDraft(): ResetDraft {
  return { requestId: crypto.randomUUID(), pending: false };
}

export function TeamUserPasswordResetSection({
  user,
  isSelf,
  csrfToken,
  scopeKey,
}: {
  user: TeamUser;
  isSelf: boolean;
  csrfToken: string;
  scopeKey: string;
}) {
  const router = useRouter();
  const scope: ClientStateScope = { scopeKey };
  const [draft, persist] = useStoredDraft<ResetDraft>(scope, teamResetDraftName(user.id), emptyDraft);

  // Gizli alan — dosya üstü notu: taslakta ASLA saklanmaz.
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Bu oturumda gönderilmiş şifre (yalnız bellekte).
  const [submittedPassword, setSubmittedPassword] = useState<string | null>(null);

  const [isFetching, setIsFetching] = useState(false);
  const phase: "idle" | "submitting" | "ambiguous" = isFetching ? "submitting" : draft.pending ? "ambiguous" : "idle";
  const [banner, setBanner] = useState<{ message: string; conflict: boolean } | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const focusPasswordWhenIdle = useRef(false);
  useEffect(() => {
    // Sunucu alan hatası gönderim sürerken gelir ve alan o sırada devre dışıdır.
    if (phase !== "idle" || !focusPasswordWhenIdle.current) return;
    focusPasswordWhenIdle.current = false;
    passwordRef.current?.focus();
  }, [phase]);

  function hadKnownResult(): boolean {
    return passwordError !== null || banner !== null;
  }

  async function send(body: ResetDraft, password: string): Promise<void> {
    setBanner(null);
    const outcome = await sendTeamRequest<{ id: string; username: string }>(
      teamUserResetUrl(user.id),
      "POST",
      csrfToken,
      buildResetPasswordBody(body.requestId, password),
    );
    if (outcome.kind === "ambiguous") {
      persist({ ...body, pending: true });
      return;
    }
    if (outcome.kind === "success") {
      persist(emptyDraft());
      // Sıfırlanan şifre ekranda bir daha gösterilmez.
      setNewPassword("");
      setShowPassword(false);
      setSubmittedPassword(null);
      setPasswordError(null);
      if (isSelf) {
        router.push(TEAM_SESSION_ENDED_HREF);
        return;
      }
      setSuccessMessage(TEXT.resetDone(user.username));
      return;
    }

    // Kesin sonuç: taslağa hemen yeni requestId yazılır.
    persist({ requestId: crypto.randomUUID(), pending: false });
    setSubmittedPassword(null);
    if (classifyTeamError(outcome.status, outcome.code) === "session-ended") {
      router.push(TEAM_SESSION_ENDED_HREF);
      return;
    }
    const fields = pickFieldErrors(outcome, ["newPassword"] as const);
    if (fields?.newPassword) {
      setPasswordError(fields.newPassword);
      focusPasswordWhenIdle.current = true;
      return;
    }
    setBanner({
      message: teamBannerMessage(outcome, TEXT.requestIdReusedReset),
      conflict: classifyTeamError(outcome.status, outcome.code) === "conflict",
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase !== "idle") return;
    const error = validateTeamPassword(newPassword, TEXT.newPasswordEmpty);
    setPasswordError(error ?? null);
    if (error) {
      passwordRef.current?.focus();
      return;
    }
    setBanner(null);
    setSuccessMessage(null);
    setIsFetching(true);
    setSubmittedPassword(newPassword);
    const sent = { ...draft, pending: true };
    persist(sent);
    await send(sent, newPassword);
    setIsFetching(false);
  }

  async function handleRetryCheck(): Promise<void> {
    setIsFetching(true);
    const password = submittedPassword ?? newPassword;
    setSubmittedPassword(password);
    await send(draft, password);
    setIsFetching(false);
  }

  function handlePasswordChange(value: string): void {
    if (hadKnownResult()) {
      setPasswordError(null);
      setBanner(null);
      persist({ requestId: crypto.randomUUID(), pending: false });
    }
    setSuccessMessage(null);
    setNewPassword(value);
  }

  const passwordLocked = phase === "submitting" || (phase === "ambiguous" && submittedPassword !== null);
  const canRetry = phase === "ambiguous" && (submittedPassword !== null || newPassword !== "");
  useUnsavedChanges("ekip-sifre", newPassword !== "");

  return (
    <div id="sifre-sifirlama" className="flex flex-col gap-3 border-t border-[var(--color-divider)] pt-6">
      <h2 className="ds-section-title">{TEXT.resetTitle}</h2>
      <p className="text-base text-[var(--color-text-secondary)]">{TEXT.resetHint}</p>
      {isSelf && <p className="text-base text-[var(--color-warning)]">{TEXT.resetSelfWarning}</p>}

      <form onSubmit={handleSubmit} noValidate aria-busy={phase === "submitting"} className="flex flex-col gap-4">
        {successMessage && (
          <p role="status" className="ds-notice ds-notice-success break-words">
            {successMessage}
          </p>
        )}
        {banner && (
          <p role="alert" className="ds-notice ds-notice-error break-words">
            {banner.message}
            {banner.conflict && (
              <>
                {" "}
                <button type="button" onClick={() => window.location.reload()} className="underline">
                  {TEXT.reloadLatest}
                </button>
              </>
            )}
          </p>
        )}
        {phase === "ambiguous" && (
          <p role="status" className="ds-notice ds-notice-warning">
            {TEXT.checking}
            {submittedPassword === null && ` ${TEXT.reenterPassword}`}
          </p>
        )}

        <div>
          <label htmlFor="team-reset-password" className="ds-label block">
            {TEXT.newPasswordLabel}
          </label>
          <div className="mt-1 flex items-stretch gap-2">
            <input
              ref={passwordRef}
              id="team-reset-password"
              name="newPassword"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={newPassword}
              disabled={passwordLocked}
              onChange={(event) => handlePasswordChange(event.target.value)}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? "team-reset-password-error" : undefined}
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
          {passwordError && (
            <p id="team-reset-password-error" role="alert" className="ds-error-text ds-error-icon mt-1">
              {passwordError}
            </p>
          )}
        </div>

        <p aria-live="polite" className="sr-only">
          {phase === "submitting" ? TEXT.resetting : ""}
        </p>

        {phase === "ambiguous" ? (
          <button
            type="button"
            onClick={handleRetryCheck}
            disabled={!canRetry}
            className="ds-btn ds-btn-secondary self-start"
          >
            {TEXT.retryCheck}
          </button>
        ) : (
          <button
            type="submit"
            disabled={phase !== "idle"}
            aria-busy={phase === "submitting"}
            className="ds-btn ds-btn-primary self-start"
          >
            {phase === "submitting" ? TEXT.resetting : TEXT.resetSubmit}
          </button>
        )}
      </form>
    </div>
  );
}
