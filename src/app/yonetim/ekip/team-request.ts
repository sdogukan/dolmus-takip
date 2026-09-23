import type { TeamErrorOutcome } from "../../../lib/team-users-ui";

export type TeamOutcome<T> =
  /** Sunucuya ulaşıp ulaşmadığı bilinmiyor (ağ koptu / gövde okunamadı). */
  | { kind: "ambiguous" }
  | { kind: "success"; user: T }
  | ({ kind: "error" } & TeamErrorOutcome);

interface ResponseBody<T> {
  user?: T;
  error?: { code?: string; fields?: Record<string, string> };
}

/**
 * `/api/v1/admin/users` uçlarına CSRF başlıklı JSON isteği. Sunucunun
 * `error.message`'ı okunmaz (ekran metni `team-users-ui.ts`'ten gelir).
 */
export async function sendTeamRequest<T>(
  url: string,
  method: "POST" | "PATCH",
  csrfToken: string,
  body: Record<string, unknown>,
): Promise<TeamOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: "ambiguous" };
  }
  let parsed: ResponseBody<T> | undefined;
  try {
    parsed = (await response.json()) as ResponseBody<T>;
  } catch {
    return { kind: "ambiguous" };
  }
  if (response.ok) {
    return parsed?.user ? { kind: "success", user: parsed.user } : { kind: "ambiguous" };
  }
  return {
    kind: "error",
    status: response.status,
    code: parsed?.error?.code,
    fields: parsed?.error?.fields,
  };
}
