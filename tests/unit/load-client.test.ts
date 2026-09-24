import { describe, expect, test } from "vitest";
import {
  LoadSession,
  sendRequest,
  sendWriteWithRetry,
  type ClientOptions,
  type FetchLike,
  type HttpSample,
} from "../../scripts/lib/load-client.ts";

/**
 * `scripts/lib/load-client.ts` — yük üreticisinin HTTP katmanı (S6.6).
 * Sunucu korumalarını atlatmadığı (Origin, CSRF, çerez; X-Forwarded-For yok),
 * gecikmeyi gerçek gönderimden ölçtüğü ve sonucu bilinmeyen yazmayı aynı
 * requestId + bayt-bayt aynı gövdeyle yeniden denediği burada sabitlenir.
 */

interface Call {
  url: string;
  init: RequestInit;
}

function json(status: number, body: unknown, headers: Record<string, string | string[]> = {}): Response {
  const h = new Headers({ "content-type": "application/json" });
  for (const [k, v] of Object.entries(headers)) for (const value of [v].flat()) h.append(k, value);
  return new Response(JSON.stringify(body), { status, headers: h });
}

function timeoutError(): Error {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return error;
}

function harness(responses: (() => Promise<Response>)[], clock?: () => number) {
  const calls: Call[] = [];
  const samples: HttpSample[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("beklenmeyen istek");
    return next();
  };
  const options: ClientOptions = {
    baseUrl: "https://dolmus.example.com",
    origin: "https://dolmus.example.com",
    timeoutMs: 20_000,
    fetch,
    now: clock,
    onSample: (s) => samples.push(s),
  };
  return { calls, samples, options };
}

const header = (call: Call, name: string) => new Headers(call.init.headers).get(name);

describe("sendRequest", () => {
  test("yazma: Origin, JSON içerik türü, CSRF ve çerez gönderilir; X-Forwarded-For gönderilmez", async () => {
    const { calls, options } = harness([async () => json(201, { workEntry: { id: "e1" } })]);
    const session = new LoadSession();
    session.cookie = "dolmus_session=abc";
    session.csrfToken = "csrf-1";
    await sendRequest(options, session, {
      method: "POST",
      path: "/api/v1/work-entries",
      route: "POST /api/v1/work-entries",
      cls: "kayit",
      kind: "write",
      bodyText: '{"requestId":"r1"}',
    });
    const call = calls[0]!;
    expect(call.url).toBe("https://dolmus.example.com/api/v1/work-entries");
    expect(call.init.method).toBe("POST");
    expect(header(call, "origin")).toBe("https://dolmus.example.com");
    expect(header(call, "content-type")).toBe("application/json");
    expect(header(call, "x-csrf-token")).toBe("csrf-1");
    expect(header(call, "cookie")).toBe("dolmus_session=abc");
    expect(header(call, "x-forwarded-for")).toBeNull();
    expect(call.init.body).toBe('{"requestId":"r1"}');
  });

  test("okuma: yalnız çerez; Origin/CSRF/içerik türü yok", async () => {
    const { calls, options } = harness([async () => json(200, { ok: true })]);
    const session = new LoadSession();
    session.cookie = "dolmus_session=abc";
    session.csrfToken = "csrf-1";
    await sendRequest(options, session, { method: "GET", path: "/api/v1/session", route: "GET /api/v1/session", cls: "okuma", kind: "read" });
    expect(header(calls[0]!, "cookie")).toBe("dolmus_session=abc");
    expect(header(calls[0]!, "origin")).toBeNull();
    expect(header(calls[0]!, "x-csrf-token")).toBeNull();
    expect(calls[0]!.init.body).toBeUndefined();
  });

  test("gecikme fetch'e verilen gerçek gönderim anından tam gövde okunana kadar ölçülür", async () => {
    let t = 1000;
    const clock = () => t;
    const { samples, options } = harness(
      [
        async () => {
          t += 250; // sunucu süresi
          return json(200, {});
        },
      ],
      clock,
    );
    t = 5000; // planlı andan geç başlayan gönderim: gecikme bu andan sayılır
    const result = await sendRequest(options, new LoadSession(), {
      method: "GET", path: "/x", route: "GET /x", cls: "rapor", kind: "read",
    });
    expect(result.sentAt).toBe(5000);
    expect(result.latencyMs).toBe(250);
    expect(samples[0]).toMatchObject({ cls: "rapor", route: "GET /x", sentAt: 5000, latencyMs: 250, status: 200 });
  });

  test("Set-Cookie oturum çerezini alır ve silme çerezinde CSRF ile birlikte temizler", async () => {
    const { options } = harness([
      async () => json(201, {}, { "set-cookie": ["other=1; Path=/", "dolmus_session=tok%3D1; Path=/; HttpOnly; SameSite=Lax"] }),
      async () => json(200, {}, { "set-cookie": "dolmus_session=; Path=/; Max-Age=0" }),
    ]);
    const session = new LoadSession();
    await sendRequest(options, session, { method: "POST", path: "/login", route: "POST /login", cls: "login", kind: "login", bodyText: "{}" });
    expect(session.cookie).toBe("dolmus_session=tok%3D1");
    session.csrfToken = "csrf";
    await sendRequest(options, session, { method: "POST", path: "/logout", route: "POST /logout", cls: "okuma", kind: "write", bodyText: "{}" });
    expect(session.cookie).toBeNull();
    expect(session.csrfToken).toBeNull();
  });

  test("hata gövdesindeki kod sınıflandırmaya taşınır; zaman aşımı TIMEOUT olur", async () => {
    const { options } = harness([
      async () => json(409, { error: { code: "VERSION_CONFLICT", message: "x" }, request_id: "r" }),
      async () => {
        throw timeoutError();
      },
    ]);
    const conflict = await sendRequest(options, new LoadSession(), {
      method: "POST", path: "/c", route: "POST /c", cls: "kayit", kind: "write", bodyText: "{}",
    });
    expect(conflict.classification).toEqual({ outcome: "expected_409", code: "VERSION_CONFLICT" });
    const timedOut = await sendRequest(options, new LoadSession(), {
      method: "POST", path: "/c", route: "POST /c", cls: "kayit", kind: "write", bodyText: "{}",
    });
    expect(timedOut.status).toBeNull();
    expect(timedOut.classification).toEqual({ outcome: "unknown_result", code: "TIMEOUT" });
  });
});

describe("sendWriteWithRetry", () => {
  const body = JSON.stringify({ requestId: "lr-run-0000001", version: 3, receivedCents: "580000" });
  const noSleep = { maxRetries: 5, backoffMs: 1000, sleep: async () => {} };

  test("bilinmeyen sonuç (zaman aşımı, kopan bağlantı, 503) aynı gövde ve requestId ile yeniden denenir", async () => {
    const { calls, samples, options } = harness([
      async () => {
        throw timeoutError();
      },
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => json(503, { error: { code: "SERVICE_UNAVAILABLE" } }),
      async () => json(200, { workEntry: { id: "e1", version: 4 } }),
    ]);
    const result = await sendWriteWithRetry(
      options,
      new LoadSession(),
      { path: "/api/v1/work-entries/e1/confirm", route: "POST /api/v1/work-entries/:id/confirm", cls: "kayit", bodyText: body },
      noSleep,
    );
    expect(result).toMatchObject({ attempts: 4, firstUnknown: true, resolution: "applied" });
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.init.body).toBe(body); // bayt-bayt aynı; yeniden kurulmaz
      expect(JSON.parse(call.init.body as string).requestId).toBe("lr-run-0000001");
    }
    expect(samples.map((s) => s.attempt)).toEqual([0, 1, 2, 3]);
    expect(samples.map((s) => s.classification.outcome)).toEqual(["unknown_result", "unknown_result", "unknown_result", "success"]);
  });

  test("yeniden denemede 409 REQUEST_ID_REUSED kesin ret ve beklenmeyen olarak kalır", async () => {
    const { options, samples } = harness([
      async () => {
        throw timeoutError();
      },
      async () => json(409, { error: { code: "REQUEST_ID_REUSED" } }),
    ]);
    const result = await sendWriteWithRetry(options, new LoadSession(), { path: "/w", route: "POST /w", cls: "kayit", bodyText: body }, noSleep);
    expect(result.resolution).toBe("rejected");
    expect(samples[1]!.classification).toEqual({ outcome: "unexpected", code: "REQUEST_ID_REUSED" });
  });

  test("ilk yanıt kesinse yeniden denenmez", async () => {
    const { calls, options } = harness([async () => json(409, { error: { code: "VERSION_CONFLICT" } })]);
    const result = await sendWriteWithRetry(options, new LoadSession(), { path: "/w", route: "POST /w", cls: "kayit", bodyText: body }, noSleep);
    expect(result).toMatchObject({ attempts: 1, firstUnknown: false, resolution: "rejected" });
    expect(calls).toHaveLength(1);
  });

  test("deneme hakkı biterse çözülemedi; bekleme üstel artar", async () => {
    const waits: number[] = [];
    const { calls, options } = harness(Array.from({ length: 3 }, () => async () => json(500, {})));
    const result = await sendWriteWithRetry(
      options,
      new LoadSession(),
      { path: "/w", route: "POST /w", cls: "kayit", bodyText: body },
      { maxRetries: 2, backoffMs: 100, sleep: async (ms) => void waits.push(ms) },
    );
    expect(result).toMatchObject({ attempts: 3, resolution: "unresolved", firstUnknown: true });
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([100, 200]);
  });
});
