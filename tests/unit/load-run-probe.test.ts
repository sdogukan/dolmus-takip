import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import type { ClientOptions, HttpSample } from "../../scripts/lib/load-client.ts";
import { REQUEST_CLASSES, summarizeLatencies } from "../../scripts/lib/load-metrics.ts";
import { REACHABILITY_PROBE_PATH, renderLoadReportMarkdown, type LoadReport, type OutcomeCounts } from "../../scripts/lib/load-report.ts";
import { assertTargetReachable, probeReachability } from "../../scripts/load-run.ts";

/**
 * `load:run` erişilebilirlik sondası (S6.6): üretici dış makinede çalışır ve
 * Caddy `/api/v1/health*` yollarını dışarıya 404 döndürür; bu yüzden hazırlık
 * ve izleme döngüsü oturumsuz `GET /giris` ile yoklar. 200 koşuyu başlatır,
 * 200 dışı her yanıt yolu ve durumu adlandırarak durdurur (503 = bakım).
 */

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
}

let server: http.Server | null = null;

afterEach(async () => {
  const s = server;
  server = null;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
});

async function stub(status: number): Promise<{ seen: Seen[]; samples: HttpSample[]; client: ClientOptions }> {
  const seen: Seen[] = [];
  server = http.createServer((req, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
    res.writeHead(req.url === REACHABILITY_PROBE_PATH ? status : 500, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Giriş</title>");
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const samples: HttpSample[] = [];
  return { seen, samples, client: { baseUrl: base, origin: base, timeoutMs: 5_000, onSample: (s) => samples.push(s) } };
}

describe("erişilebilirlik sondası", () => {
  test("yol tek sabitte: /giris", () => {
    expect(REACHABILITY_PROBE_PATH).toBe("/giris");
  });

  test("200: hazırlık geçer; istek GET /giris, çerez ve CSRF başlığı yok, probe sınıfında kaydedilir", async () => {
    const { seen, samples, client } = await stub(200);
    await expect(assertTargetReachable(client)).resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "GET", url: "/giris" });
    expect(seen[0]!.headers.cookie).toBeUndefined();
    expect(seen[0]!.headers["x-csrf-token"]).toBeUndefined();
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ cls: "probe", route: "GET /giris", status: 200 });
  });

  test("404: hazırlık yolu ve durumu adlandırarak durur", async () => {
    const { client } = await stub(404);
    await expect(assertTargetReachable(client)).rejects.toThrow("Hedefe erişilemiyor: GET /giris → 404");
  });

  test("503: bakım olarak adlandırılır", async () => {
    const { client } = await stub(503);
    await expect(assertTargetReachable(client)).rejects.toThrow(/^Hedef bakımda: GET \/giris → 503 \(bakım/u);
  });

  test("bağlantı kurulamazsa hata kodu adlandırılır", async () => {
    const { client } = await stub(200);
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    await expect(assertTargetReachable(client)).rejects.toThrow("Hedefe erişilemiyor: GET /giris → NETWORK_ERROR");
  });

  test("izleme sondası her çağrıda yeni oturum kullanır: sunucu çerez yazsa da sonraki istek çerezsiz gider", async () => {
    const seen: string[] = [];
    server = http.createServer((req, res) => {
      seen.push(req.headers.cookie ?? "");
      res.writeHead(200, { "set-cookie": "dolmus_session=abc; Path=/; HttpOnly" });
      res.end();
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const client: ClientOptions = { baseUrl: base, origin: base, timeoutMs: 5_000, onSample: () => {} };
    expect((await probeReachability(client)).status).toBe(200);
    expect((await probeReachability(client)).status).toBe(200);
    expect(seen).toEqual(["", ""]);
  });

  test("yük üreticisi /api/v1/health altına istek göndermez", () => {
    const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts");
    const files = [path.join(scripts, "load-run.ts"), ...fs.readdirSync(path.join(scripts, "lib")).map((f) => path.join(scripts, "lib", f))];
    for (const file of files) expect(fs.readFileSync(file, "utf8"), file).not.toContain("/api/v1/health");
  });
});

describe("rapor: erişilebilirlik sondası satırı", () => {
  const empty = summarizeLatencies([]);
  const outcomes: OutcomeCounts = { requests: 0, success: 0, expected409: {}, rateLimited429: {}, unknownResult: {}, unexpected: {} };
  const byClass = Object.fromEntries(REQUEST_CLASSES.map((c) => [c, empty])) as LoadReport["latency"]["sustain"];
  const report: LoadReport = {
    kind: "dolmus-takip-load-report",
    formatVersion: 1,
    runId: "r1",
    scenario: "active-mix",
    generatedAt: "2026-09-24T00:00:00.000Z",
    target: { url: "https://dolmus.example.com", origin: "https://dolmus.example.com", loopback: false },
    release: { manifestFile: "m.json", sourceCommit: "c", artifactSha256: "s", nodeVersion: null, sqliteVersion: null, builtAt: null },
    dataset: {
      sourceCommit: "c", sha256: "s", history: { startDate: "2023-01-01", endDate: "2026-08-31", years: 3 },
      counts: {}, schemaMatchesRelease: true, commitMatchesRelease: true,
    },
    config: {
      users: 100, warmupSeconds: 300, rampSeconds: 300, sustainSeconds: 1800, arrival: "rate", timeoutMs: 20_000,
      maxRetries: 5, retryBackoffMs: 1000, maxInFlight: 2000, randomSeed: 1, windowMonth: null,
    },
    timeline: { setupStartedAt: "a", loadStartedAt: "b", sustainStartedAt: "c", loadEndedAt: "d", finishedAt: "e" },
    rate: { intendedSustainOps: 0, dispatchedSustainOps: 0, droppedOps: {}, intendedPerSecond: 0, achievedPerSecond: 0, dispatchLag: empty },
    latency: { warmup: byClass, ramp: byClass, sustain: byClass },
    outcomes: { sustain: outcomes, all: outcomes },
    writes: {
      ops: 0, applied: 0, rejected: 0, firstAttemptUnknown: 0, resolvedByRetry: 0, unresolved: 0, retries: 0,
      doubleSubmits: 0, concurrentCorrections: 0, fallbacks: 0,
    },
    waves: [],
    probes: {
      readAfterWrite: 0,
      mismatches: 0,
      reachability: { requests: 180, failures: 2, latency: summarizeLatencies([10, 20, 30]) },
      findings: [],
    },
    reconciliation: { status: "not_applicable", detail: "—" },
    loginWindow: {
      attempts: 0, failedAttempts: 0, firstAttemptAt: null, lastAttemptAt: null, ipFailedAttemptLimit: 120,
      windowMinutes: 15, nextLoginHeavyScenarioNotBefore: null,
    },
    targets: { kayitP95Ms: 2000, raporP95Ms: 3000, unexpectedRateLimit: 0.01 },
    verdict: { pass: true, checks: [] },
    acceptance_eligible: true,
    acceptance_reasons: [],
    runnerErrors: [],
  };

  test("GET /giris adlandırılır, health/ready etiketi yok, DB hazırlığı iddia edilmez", () => {
    const markdown = renderLoadReportMarkdown(report);
    expect(markdown).toContain("Erişilebilirlik sondası (GET /giris, oturumsuz; veritabanı hazırlığını göstermez) 180 istek, 2 başarısız, p95 30.0 ms.");
    expect(markdown).not.toMatch(/health|ready/iu);
  });
});
