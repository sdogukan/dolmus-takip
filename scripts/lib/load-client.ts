/**
 * Yük üreticisinin HTTP istemcisi — `scripts/load-run.ts` (S6.6, T6.6).
 *
 * Yalnız Node'un yerleşik `fetch`'i; tarayıcının yaptığını yapar ve sunucunun
 * hiçbir korumasını atlatmaz: oturum çerezi, `Origin` = APP_ORIGIN, JSON içerik
 * türü ve `GET /api/v1/session`'dan alınan `X-CSRF-Token`. `X-Forwarded-For`
 * GÖNDERİLMEZ (IP'yi Caddy yazar).
 *
 * Gecikme, `fetch` çağrılmadan hemen önce alınan GERÇEK gönderim anından yanıt
 * gövdesinin tamamı okunana kadar ölçülür; planlı an ile gerçek gönderim
 * arasındaki gecikme ayrıca kaydedilir (üretici doyarsa görünür olsun).
 *
 * Sonucu bilinmeyen yazma (zaman aşımı, kopan bağlantı, 5xx) AYNI requestId ve
 * İLK gönderimde yakalanan bayt-bayt AYNI gövde metniyle yeniden denenir;
 * gövde hiçbir zaman yeniden kurulmaz (`sendWriteWithRetry`).
 */
import { performance } from "node:perf_hooks";
import { classifyResponse, type Classification, type RequestClass, type RequestKind } from "./load-metrics.ts";

export const SESSION_COOKIE_NAME = "dolmus_session";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpSample {
  cls: RequestClass;
  route: string;
  /** Koşunun zaman ekseninde (performance.now) gerçek gönderim anı. */
  sentAt: number;
  latencyMs: number;
  status: number | null;
  classification: Classification;
  attempt: number;
}

export interface ClientOptions {
  baseUrl: string;
  /** Yazmalarda gönderilen `Origin`; sunucunun APP_ORIGIN değeriyle aynı olmalı. */
  origin: string;
  timeoutMs: number;
  fetch?: FetchLike;
  now?: () => number;
  onSample: (sample: HttpSample) => void;
}

/** Bir kullanıcının çerez + CSRF durumu. Parola burada tutulmaz. */
export class LoadSession {
  cookie: string | null = null;
  csrfToken: string | null = null;

  /** `Set-Cookie` başlıklarından oturum çerezini günceller (silme dahil). */
  absorbSetCookie(headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const eq = pair?.indexOf("=") ?? -1;
      if (!pair || eq < 0 || pair.slice(0, eq).trim() !== SESSION_COOKIE_NAME) continue;
      const value = pair.slice(eq + 1).trim();
      const expired = attributes.some((a) => /^\s*max-age\s*=\s*0\s*$/iu.test(a));
      this.cookie = value.length === 0 || expired ? null : `${SESSION_COOKIE_NAME}=${value}`;
      if (this.cookie === null) this.csrfToken = null;
    }
  }
}

export interface RequestSpec {
  method: "GET" | "POST";
  path: string;
  /** Rapor/sayımda kullanılan yol şablonu (ör. `POST /api/v1/work-entries/:id/confirm`). */
  route: string;
  cls: RequestClass;
  kind: RequestKind;
  /** POST gövdesi, olduğu gibi gönderilir. */
  bodyText?: string;
  attempt?: number;
}

export interface RequestResult {
  status: number | null;
  body: unknown;
  classification: Classification;
  latencyMs: number;
  sentAt: number;
}

function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function failureKind(error: unknown): "timeout" | "network" {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
}

export async function sendRequest(options: ClientOptions, session: LoadSession, spec: RequestSpec): Promise<RequestResult> {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => performance.now());
  const headers: Record<string, string> = { accept: "application/json" };
  if (session.cookie) headers.cookie = session.cookie;
  if (spec.method === "POST") {
    headers["content-type"] = "application/json";
    headers.origin = options.origin;
    if (session.csrfToken) headers["x-csrf-token"] = session.csrfToken;
  }

  const sentAt = now();
  let status: number | null = null;
  let body: unknown = null;
  let failure: "timeout" | "network" | null = null;
  try {
    const response = await doFetch(new URL(spec.path, options.baseUrl).toString(), {
      method: spec.method,
      headers,
      body: spec.method === "POST" ? (spec.bodyText ?? "") : undefined,
      signal: AbortSignal.timeout(options.timeoutMs),
      redirect: "manual",
    });
    const text = await response.text();
    status = response.status;
    session.absorbSetCookie(response.headers);
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
  } catch (error) {
    failure = failureKind(error);
  }
  const latencyMs = now() - sentAt;
  const classification = classifyResponse({ kind: spec.kind, status, code: errorCode(body), failure });
  options.onSample({
    cls: spec.cls,
    route: spec.route,
    sentAt,
    latencyMs,
    status,
    classification,
    attempt: spec.attempt ?? 0,
  });
  return { status, body, classification, latencyMs, sentAt };
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface WriteResult {
  final: RequestResult;
  attempts: number;
  /** İlk deneme sonucu bilinmiyordu. */
  firstUnknown: boolean;
  /** `applied`: 2xx; `rejected`: kesin ret (409/422/…); `unresolved`: tüm denemeler bilinmeyen. */
  resolution: "applied" | "rejected" | "unresolved";
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Yazmayı gönderir; sonuç bilinmiyorsa aynı `bodyText` (aynı requestId'yi
 * içerir) ile üstel beklemeyle yeniden dener. Kesin bir yanıt (2xx dahil her
 * HTTP durumu, 5xx hariç) alınca durur.
 */
export async function sendWriteWithRetry(
  options: ClientOptions,
  session: LoadSession,
  spec: Omit<RequestSpec, "method" | "kind" | "attempt"> & { bodyText: string },
  policy: RetryPolicy,
): Promise<WriteResult> {
  const sleep = policy.sleep ?? defaultSleep;
  let attempt = 0;
  let firstUnknown = false;
  for (;;) {
    const final = await sendRequest(options, session, { ...spec, method: "POST", kind: "write", attempt });
    const outcome = final.classification.outcome;
    if (attempt === 0) firstUnknown = outcome === "unknown_result";
    if (outcome !== "unknown_result") {
      return { final, attempts: attempt + 1, firstUnknown, resolution: outcome === "success" ? "applied" : "rejected" };
    }
    if (attempt >= policy.maxRetries) return { final, attempts: attempt + 1, firstUnknown, resolution: "unresolved" };
    await sleep(policy.backoffMs * 2 ** attempt);
    attempt++;
  }
}
