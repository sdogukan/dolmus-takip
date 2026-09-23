/**
 * Ekip hesapları ekranlarının (`../app/yonetim/ekip/**`) SAF yardımcıları —
 * S2.6. DB/ağ/React YOK: alan doğrulama, istek gövdesi kurma, hata → ekran
 * metni eşlemesi ve taslak adları burada yaşar ki birim testleriyle
 * doğrulanabilsin. Kurallar `../server/usecases/admin-users/shared.ts` ile
 * AYNIDIR (sunucu modülü istemciye taşınmaz); asıl doğrulama sunucudadır.
 *
 * Gövdelerde yalnız alan verileri gider: aktörün rolü/kimliği veya URL
 * dışındaki hiçbir kimlik istemciden GÖNDERİLMEZ; rol alanı `platformRole`dür.
 * Şifre hiçbir taslağa/depoya girmez — burada yalnız istek gövdesine konur.
 */
import { PLATFORM_ROLE_LABELS, TEAM_USER_MESSAGES as TEXT, getErrorMessage } from "./messages";

export type TeamRole = "admin" | "support";

/** `GET/POST/PATCH /api/v1/admin/users` `user` görünümü. */
export interface TeamUser {
  id: string;
  username: string;
  fullName: string | null;
  platformRole: TeamRole;
  active: boolean;
  version: number;
}

export const TEAM_ROLES: readonly TeamRole[] = ["support", "admin"];
export const TEAM_FULL_NAME_MAX_LENGTH = 120;
export const TEAM_PASSWORD_MAX_LENGTH = 200;

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export function teamRoleLabel(role: TeamRole): string {
  return PLATFORM_ROLE_LABELS[role];
}

/** Kanonik kullanıcı adı: kırpılmış + küçük harf. */
export function normalizeTeamUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Kırp + iç boşlukları tek boşluğa indir. */
export function normalizeTeamFullName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Geçersizse alan mesajı, geçerliyse `undefined`. */
export function validateTeamUsername(raw: string): string | undefined {
  return USERNAME_PATTERN.test(normalizeTeamUsername(raw)) ? undefined : TEXT.usernameInvalid;
}

export function validateTeamFullName(raw: string): string | undefined {
  const length = normalizeTeamFullName(raw).length;
  return length >= 1 && length <= TEAM_FULL_NAME_MAX_LENGTH ? undefined : TEXT.fullNameInvalid;
}

/** Şifre kırpılmaz (platform girişi ham değeri karşılaştırır). */
export function validateTeamPassword(raw: string, emptyMessage: string = TEXT.passwordEmpty): string | undefined {
  if (raw.length === 0) return emptyMessage;
  return raw.length > TEAM_PASSWORD_MAX_LENGTH ? TEXT.passwordTooLong : undefined;
}

export interface CreateFormValues {
  username: string;
  fullName: string;
  platformRole: TeamRole;
  password: string;
}

export interface CreateFieldErrors {
  username?: string;
  fullName?: string;
  password?: string;
}

/** Gönderimden önce yerel doğrulama; boş nesne = geçerli. */
export function validateCreateForm(values: CreateFormValues): CreateFieldErrors {
  const errors: CreateFieldErrors = {};
  const username = validateTeamUsername(values.username);
  const fullName = validateTeamFullName(values.fullName);
  const password = validateTeamPassword(values.password);
  if (username) errors.username = username;
  if (fullName) errors.fullName = fullName;
  if (password) errors.password = password;
  return errors;
}

export function buildCreateUserBody(requestId: string, values: CreateFormValues) {
  return {
    requestId,
    username: normalizeTeamUsername(values.username),
    fullName: normalizeTeamFullName(values.fullName),
    platformRole: values.platformRole,
    password: values.password,
  };
}

export interface InfoFormValues {
  fullName: string;
  platformRole: TeamRole;
}

/** Bilgi formunda kayıttan FARKLI olan alanlar; boş = değişiklik yok. */
export function diffTeamUser(
  user: Pick<TeamUser, "fullName" | "platformRole">,
  values: InfoFormValues,
): { fullName?: string; platformRole?: TeamRole } {
  const changes: { fullName?: string; platformRole?: TeamRole } = {};
  const fullName = normalizeTeamFullName(values.fullName);
  if (fullName !== (user.fullName ?? "")) changes.fullName = fullName;
  if (values.platformRole !== user.platformRole) changes.platformRole = values.platformRole;
  return changes;
}

/** `version` HER ZAMAN taslağın dayandığı sürümdür (güncel değil). */
export function buildUpdateUserBody(
  requestId: string,
  version: number,
  changes: { fullName?: string; platformRole?: TeamRole; active?: boolean },
) {
  return { requestId, version, ...changes };
}

/** Bilgi formunun gönderimde dondurulan değişiklik kümesi (yalnız gizli olmayan alanlar). */
export interface InfoChanges {
  fullName?: string;
  platformRole?: TeamRole;
}

/**
 * Bilgi PATCH gövdesi YALNIZ dondurulmuş taslaktan kurulur: sonucu belirsiz istek
 * yeniden yüklemeden sonra da aynı anahtarlar ve değerlerle gider (sunucu bu
 * alanların özetini alır; sunucudaki güncel kayıtla yeniden fark almak
 * 409 REQUEST_ID_REUSED üretir).
 */
export function buildInfoPatchBody(frozen: { requestId: string; baseVersion: number; changes: InfoChanges }) {
  return buildUpdateUserBody(frozen.requestId, frozen.baseVersion, frozen.changes);
}

export function buildResetPasswordBody(requestId: string, newPassword: string) {
  return { requestId, newPassword };
}

export const TEAM_USERS_URL = "/api/v1/admin/users";

export function teamUserUrl(userId: string): string {
  return `${TEAM_USERS_URL}/${encodeURIComponent(userId)}`;
}

export function teamUserResetUrl(userId: string): string {
  return `${teamUserUrl(userId)}/reset-password`;
}

export const TEAM_NEW_DRAFT_NAME = "ekip-yeni";

export function teamDetailDraftName(userId: string): string {
  return `ekip-${userId}`;
}

export function teamResetDraftName(userId: string): string {
  return `ekip-sifre-${userId}`;
}

/** Oturum bitince giriş sayfasına gidilen adres (`?oturum=bitti` notu gösterir). */
export const TEAM_SESSION_ENDED_HREF = "/yonetim/giris?oturum=bitti";

export type TeamErrorKind =
  | "session-ended"
  | "unauthorized"
  | "conflict"
  | "request-reused"
  | "validation"
  | "connection";

/** Sunucu kesin yanıtının ekran sınıfı; sunucunun `error.message`'ı basılmaz. */
export function classifyTeamError(status: number, code?: string): TeamErrorKind {
  if (status >= 500) return "connection";
  if (status === 401) return "session-ended";
  if (status === 403) return "unauthorized";
  if (status === 409) return code === "VERSION_CONFLICT" ? "conflict" : "request-reused";
  if (status === 422) return "validation";
  return "connection";
}

export interface TeamErrorOutcome {
  status: number;
  code?: string;
  fields?: Record<string, string>;
}

/**
 * Alan hatası olmayan (veya alan hatasına eşlenemeyen) bir hatanın banner
 * metni. `requestReusedMessage` forma özgüdür (oluşturma/sıfırlama farklı
 * anlatır).
 */
export function teamBannerMessage(outcome: TeamErrorOutcome, requestReusedMessage: string): string {
  switch (classifyTeamError(outcome.status, outcome.code)) {
    case "session-ended":
      return TEXT.sessionEnded;
    case "unauthorized":
      return TEXT.unauthorized;
    case "conflict":
      return getErrorMessage("VERSION_CONFLICT") ?? TEXT.connection;
    case "request-reused":
      return requestReusedMessage;
    case "validation":
      return outcome.fields?.change ? TEXT.noChange : (getErrorMessage("VALIDATION_ERROR") ?? TEXT.connection);
    default:
      return TEXT.connection;
  }
}

/** 422 `fields`'ından yalnız `known` anahtarları; hiçbiri yoksa `undefined`. */
export function pickFieldErrors<K extends string>(
  outcome: TeamErrorOutcome,
  known: readonly K[],
): Partial<Record<K, string>> | undefined {
  if (outcome.status !== 422 || !outcome.fields) return undefined;
  const picked: Partial<Record<K, string>> = {};
  for (const key of known) {
    const message = outcome.fields[key];
    if (typeof message === "string" && message !== "") picked[key] = message;
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
}
