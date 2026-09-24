import { describe, expect, test } from "vitest";
import {
  acceptanceEligibility,
  buildSchedule,
  classifyResponse,
  evaluateVerdict,
  isLoopbackHost,
  percentile,
  reconcileLedger,
  summarizeLatencies,
  type EntryState,
  type ExpectedEntry,
  type LatencySummary,
  type ObservedEntry,
  type RequestClass,
  type VerdictInput,
} from "../../scripts/lib/load-metrics.ts";

/**
 * `scripts/lib/load-metrics.ts` — yük kabul aracının (S6.6) saf yardımcıları:
 * yüzdelik, yanıt sınıflandırma, gönderim planı, defter mutabakatı ve
 * hedeflere karşı geçti/kaldı.
 */

describe("percentile / summarizeLatencies", () => {
  test("en yakın sıra yöntemi: 1..100 dizisinde p50=50, p95=95, p99=99", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 0.5)).toBe(50);
    expect(percentile(sorted, 0.95)).toBe(95);
    expect(percentile(sorted, 0.99)).toBe(99);
    expect(percentile(sorted, 1)).toBe(100);
  });

  test("küçük örneklemde enterpolasyon yapılmaz, gerçek bir örnek döner", () => {
    expect(percentile([10, 20, 30], 0.95)).toBe(30);
    expect(percentile([10, 20, 30], 0.5)).toBe(20);
    expect(percentile([7], 0.99)).toBe(7);
  });

  test("boş dizide null; geçersiz q hata", () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(() => percentile([1], 0)).toThrow(RangeError);
    expect(() => percentile([1], 1.5)).toThrow(RangeError);
  });

  test("summarizeLatencies sırasız girdiyi sıralar ve en yükseği verir", () => {
    const summary = summarizeLatencies([300, 100, 200, 5000]);
    expect(summary).toEqual({ count: 4, p50Ms: 200, p95Ms: 5000, p99Ms: 5000, maxMs: 5000 });
    expect(summarizeLatencies([])).toEqual({ count: 0, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null });
  });
});

describe("classifyResponse", () => {
  const write = (status: number | null, code: string | null = null, failure: "timeout" | "network" | null = null) =>
    classifyResponse({ kind: "write", status, code, failure });

  test("2xx başarı", () => {
    expect(write(201)).toEqual({ outcome: "success", code: "HTTP_201" });
    expect(classifyResponse({ kind: "read", status: 200, code: null, failure: null }).outcome).toBe("success");
  });

  test("eşzamanlılık 409'ları beklenen, REQUEST_ID_REUSED beklenmeyen", () => {
    expect(write(409, "VERSION_CONFLICT")).toEqual({ outcome: "expected_409", code: "VERSION_CONFLICT" });
    expect(write(409, "ENTRY_CONFIRMED").outcome).toBe("expected_409");
    expect(write(409, "ENTRY_NOT_CONFIRMED").outcome).toBe("expected_409");
    expect(write(409, "REQUEST_ID_REUSED")).toEqual({ outcome: "unexpected", code: "REQUEST_ID_REUSED" });
  });

  test("429 koduyla ayrı sayılır (meşru kullanıcı engeli), beklenmeyene karışmaz", () => {
    expect(classifyResponse({ kind: "login", status: 429, code: "RATE_LIMITED", failure: null })).toEqual({
      outcome: "rate_limited_429",
      code: "RATE_LIMITED",
    });
    expect(classifyResponse({ kind: "login", status: 429, code: "HASH_QUEUE_FULL", failure: null }).code).toBe("HASH_QUEUE_FULL");
  });

  test("yazmada zaman aşımı, kopan bağlantı ve 5xx sonucu bilinmeyen", () => {
    expect(write(null, null, "timeout")).toEqual({ outcome: "unknown_result", code: "TIMEOUT" });
    expect(write(null, null, "network")).toEqual({ outcome: "unknown_result", code: "NETWORK_ERROR" });
    expect(write(503, "SERVICE_UNAVAILABLE")).toEqual({ outcome: "unknown_result", code: "SERVICE_UNAVAILABLE" });
    expect(write(500)).toEqual({ outcome: "unknown_result", code: "HTTP_500" });
  });

  test("okuma ve girişte aynı hatalar beklenmeyen (yan etkisiz, yeniden denenmez)", () => {
    expect(classifyResponse({ kind: "read", status: null, code: null, failure: "timeout" }).outcome).toBe("unexpected");
    expect(classifyResponse({ kind: "read", status: 503, code: "SERVICE_UNAVAILABLE", failure: null }).outcome).toBe("unexpected");
    expect(classifyResponse({ kind: "login", status: null, code: null, failure: "network" }).outcome).toBe("unexpected");
  });

  test("diğer 4xx (401, 403 CSRF, 422) beklenmeyen", () => {
    expect(write(403, "CSRF_TOKEN_INVALID").outcome).toBe("unexpected");
    expect(write(422, "VALIDATION_ERROR").outcome).toBe("unexpected");
    expect(classifyResponse({ kind: "login", status: 401, code: "INVALID_CREDENTIALS", failure: null }).outcome).toBe("unexpected");
  });
});

describe("buildSchedule", () => {
  const durations = { warmupSeconds: 60, rampSeconds: 60, sustainSeconds: 120 };

  test("oran modeli: aşama başına beklenen işlem sayısı ve artan zaman", () => {
    const ops = buildSchedule(durations, { kind: "rate", sustainPerSecond: 10, warmupFraction: 0.1 });
    const count = (phase: string) => ops.filter((op) => op.phase === phase).length;
    expect(count("warmup")).toBe(60); // 1/sn × 60
    expect(count("ramp")).toBe(330); // (1 + 10) / 2 × 60
    expect(count("sustain")).toBe(1200); // 10/sn × 120
    for (let i = 1; i < ops.length; i++) expect(ops[i]!.atMs).toBeGreaterThan(ops[i - 1]!.atMs);
    expect(ops[ops.length - 1]!.atMs).toBeLessThan(240_000);
    expect(ops.map((op) => op.slot)).toEqual(ops.map((_, i) => i));
  });

  test("kademeli artışta aralıklar daralır (yoğunluk doğrusal artar)", () => {
    const ops = buildSchedule(durations, { kind: "rate", sustainPerSecond: 10, warmupFraction: 0.1 }).filter(
      (op) => op.phase === "ramp",
    );
    const firstGap = ops[1]!.atMs - ops[0]!.atMs;
    const lastGap = ops[ops.length - 1]!.atMs - ops[ops.length - 2]!.atMs;
    expect(firstGap).toBeGreaterThan(lastGap * 5);
  });

  test("ısınma oranı sıfırsa ısınmaya istek düşmez", () => {
    const ops = buildSchedule(durations, { kind: "rate", sustainPerSecond: 2, warmupFraction: 0 });
    expect(ops.filter((op) => op.phase === "warmup")).toHaveLength(0);
    expect(ops.filter((op) => op.phase === "sustain")).toHaveLength(240);
  });

  test("dalga modeli: sürdürülen yükte her dalga tam boyda ve yayılım içinde", () => {
    const ops = buildSchedule(durations, {
      kind: "waves",
      waveSize: 100,
      waveIntervalSeconds: 30,
      waveSpreadSeconds: 10,
      warmupFraction: 0.1,
    });
    const waves = new Map<number, typeof ops>();
    for (const op of ops) waves.set(op.wave!, [...(waves.get(op.wave!) ?? []), op]);
    expect(waves.size).toBe(8);
    const sizes = [...waves.values()].map((w) => w.length);
    expect(sizes).toEqual([10, 10, 10, 55, 100, 100, 100, 100]);
    for (const [wave, list] of waves) {
      const start = wave * 30_000;
      for (const op of list) {
        expect(op.atMs).toBeGreaterThanOrEqual(start);
        expect(op.atMs).toBeLessThan(start + 10_000);
      }
      expect(new Set(list.map((op) => op.slot)).size).toBe(list.length);
    }
    expect([...waves.get(4)!].every((op) => op.phase === "sustain")).toBe(true);
  });

  test("geçersiz girdiler reddedilir", () => {
    expect(() => buildSchedule({ ...durations, sustainSeconds: 0 }, { kind: "rate", sustainPerSecond: 1, warmupFraction: 0 })).toThrow(RangeError);
    expect(() => buildSchedule(durations, { kind: "rate", sustainPerSecond: 0, warmupFraction: 0 })).toThrow(RangeError);
    expect(() =>
      buildSchedule(durations, { kind: "waves", waveSize: 10, waveIntervalSeconds: 5, waveSpreadSeconds: 5, warmupFraction: 0 }),
    ).toThrow(RangeError);
  });
});

describe("reconcileLedger", () => {
  const base: EntryState = {
    version: 1,
    status: "pending",
    personId: "p1",
    workDate: "2026-09-03",
    startsAt: "2026-09-03T04:00:00.000Z",
    endsAt: "2026-09-03T13:00:00.000Z",
    grossCents: "1000000",
    fuelCents: "220000",
    otherExpenseCents: "0",
    receivedCents: null,
  };
  // şoför: pay = 1000000 × 2000 / 10000 = 200000; kalan = 1000000 − 220000 − 0 − 200000 = 580000
  const confirmed: EntryState = { ...base, version: 2, status: "confirmed", receivedCents: "580000" };

  const expected = (fingerprint: string, over: Partial<ExpectedEntry> = {}): ExpectedEntry => ({
    fingerprint,
    vehicleId: "v1",
    workKind: "driver",
    entryId: `id-${fingerprint}`,
    acknowledged: base,
    unresolved: [],
    ...over,
  });
  const observed = (fingerprint: string | null, state: EntryState, over: Partial<ObservedEntry> = {}): ObservedEntry => ({
    id: `id-${fingerprint}`,
    vehicleId: "v1",
    workKind: "driver",
    fingerprint,
    state,
    shareBps: 2000,
    shareCents: "200000",
    remainderCents: "580000",
    confirmationEntryVersion: state.status === "confirmed" ? state.version : null,
    ...over,
  });

  test("defter ve sunucu aynıysa her şey eşleşir", () => {
    const result = reconcileLedger(
      [expected("a"), expected("b", { acknowledged: confirmed })],
      [observed("a", base), observed("b", confirmed)],
    );
    expect(result).toMatchObject({ matched: 2, lost: 0, duplicate: 0, inconsistent: 0 });
    expect(result.findings).toEqual([]);
  });

  test("kabul edilmiş kaydın yokluğu kayıptır", () => {
    const result = reconcileLedger([expected("a")], []);
    expect(result).toMatchObject({ lost: 1, matched: 0 });
    expect(result.findings[0]).toMatchObject({ kind: "lost", fingerprint: "a" });
  });

  test("kabul edilmiş onayın sunucuda olmaması (sürüm geride) kayıptır", () => {
    const result = reconcileLedger([expected("a", { acknowledged: confirmed })], [observed("a", base)]);
    expect(result).toMatchObject({ lost: 1, inconsistent: 0 });
  });

  test("aynı parmak iziyle ikinci kayıt ve defterde olmayan kayıt çifttir", () => {
    const result = reconcileLedger(
      [expected("a")],
      [observed("a", base), observed("a", base, { id: "id-a-2" }), observed(null, base, { id: "stray" }), observed("x", base, { id: "other" })],
    );
    expect(result).toMatchObject({ matched: 1, duplicate: 3, lost: 0 });
  });

  test("tutar, onay tutarı veya hesap kuralı farkı tutarsızdır", () => {
    const wrongGross = reconcileLedger([expected("a")], [observed("a", { ...base, grossCents: "1000100" })]);
    expect(wrongGross.inconsistent).toBe(1);

    const wrongReceived = reconcileLedger(
      [expected("a", { acknowledged: confirmed })],
      [observed("a", { ...confirmed, receivedCents: "570000" })],
    );
    expect(wrongReceived.inconsistent).toBe(1);
    expect(wrongReceived.findings[0]!.detail).toContain("receivedCents");

    const wrongRemainder = reconcileLedger([expected("a")], [observed("a", base, { remainderCents: "580001" })]);
    expect(wrongRemainder.inconsistent).toBe(1);

    const staleConfirmation = reconcileLedger(
      [expected("a", { acknowledged: confirmed })],
      [observed("a", confirmed, { confirmationEntryVersion: 1 })],
    );
    expect(staleConfirmation.inconsistent).toBe(1);
  });

  test("sonucu bilinmeyen işlem: iki olası durumdan biri kabul edilir, sayılar ayrı tutulur", () => {
    const unresolvedConfirm = expected("a", { unresolved: [confirmed] });
    expect(reconcileLedger([unresolvedConfirm], [observed("a", confirmed)])).toMatchObject({ matched: 1, unresolvedApplied: 1, inconsistent: 0 });
    expect(reconcileLedger([unresolvedConfirm], [observed("a", base)])).toMatchObject({ matched: 1, unresolvedApplied: 0 });

    const unresolvedCreate = expected("b", { entryId: null, acknowledged: null, unresolved: [base] });
    expect(reconcileLedger([unresolvedCreate], [])).toMatchObject({ lost: 0, unresolvedNotApplied: 1 });
    expect(reconcileLedger([unresolvedCreate], [observed("b", base)])).toMatchObject({ matched: 1, unresolvedApplied: 1 });
  });

  test("defterde kimliği bilinen kayıt yerine başka kimlik varsa kayıp + çift", () => {
    const result = reconcileLedger([expected("a")], [observed("a", base, { id: "someone-else" })]);
    expect(result).toMatchObject({ lost: 1, duplicate: 1, matched: 0 });
  });
});

describe("evaluateVerdict", () => {
  const summary = (p95Ms: number | null, count = 100): LatencySummary => ({ count, p50Ms: p95Ms, p95Ms, p99Ms: p95Ms, maxMs: p95Ms });
  const classes = (over: Partial<Record<RequestClass, LatencySummary>> = {}): Record<RequestClass, LatencySummary> => ({
    login: summary(null, 0),
    kayit: summary(1500),
    rapor: summary(2500),
    okuma: summary(100),
    probe: summary(null, 0),
    ...over,
  });
  const input = (over: Partial<VerdictInput> = {}): VerdictInput => ({
    classes: classes(),
    requiredClasses: ["kayit", "rapor"],
    totalRequests: 1000,
    unexpected: 0,
    unresolvedUnknown: 0,
    rateLimited: 0,
    reconciliation: { lost: 0, duplicate: 0, inconsistent: 0 },
    probeMismatches: 0,
    runnerErrors: 0,
    ...over,
  });
  const status = (result: ReturnType<typeof evaluateVerdict>, id: string) => result.checks.find((c) => c.id === id)!.status;

  test("tüm hedefler sağlanınca geçer", () => {
    const result = evaluateVerdict(input());
    expect(result.pass).toBe(true);
    expect(result.checks.every((c) => c.status === "pass")).toBe(true);
  });

  test("sınır değerler: kayıt p95 = 2000 ms ve rapor p95 = 3000 ms geçer, bir üstü kalır", () => {
    expect(evaluateVerdict(input({ classes: classes({ kayit: summary(2000), rapor: summary(3000) }) })).pass).toBe(true);
    const slowWrite = evaluateVerdict(input({ classes: classes({ kayit: summary(2000.1) }) }));
    expect(slowWrite.pass).toBe(false);
    expect(status(slowWrite, "kayit_p95")).toBe("fail");
    expect(status(evaluateVerdict(input({ classes: classes({ rapor: summary(3001) }) })), "rapor_p95")).toBe("fail");
  });

  test("beklenmeyen oranı %1'in ALTINDA olmalı; çözülemeyen bilinmeyen sonuç da sayılır", () => {
    expect(evaluateVerdict(input({ unexpected: 9 })).pass).toBe(true);
    expect(status(evaluateVerdict(input({ unexpected: 10 })), "unexpected_rate")).toBe("fail");
    expect(status(evaluateVerdict(input({ unexpected: 5, unresolvedUnknown: 5 })), "unexpected_rate")).toBe("fail");
    expect(status(evaluateVerdict(input({ totalRequests: 0 })), "unexpected_rate")).toBe("fail");
  });

  test("meşru kullanıcıya tek bir 429 bile geçmez", () => {
    const result = evaluateVerdict(input({ rateLimited: 1 }));
    expect(result.pass).toBe(false);
    expect(status(result, "legitimate_user_blocking")).toBe("fail");
  });

  test("mali kayıp, çift veya tutarsızlık (sonda uyuşmazlığı dahil) sıfır olmalı", () => {
    expect(status(evaluateVerdict(input({ reconciliation: { lost: 1, duplicate: 0, inconsistent: 0 } })), "financial_loss")).toBe("fail");
    expect(status(evaluateVerdict(input({ reconciliation: { lost: 0, duplicate: 1, inconsistent: 0 } })), "financial_duplication")).toBe("fail");
    expect(status(evaluateVerdict(input({ reconciliation: { lost: 0, duplicate: 0, inconsistent: 1 } })), "inconsistency")).toBe("fail");
    expect(status(evaluateVerdict(input({ probeMismatches: 1 })), "inconsistency")).toBe("fail");
  });

  test("mutabakat tamamlanamazsa kalır; yazmayan senaryoda uygulanmaz", () => {
    const failed = evaluateVerdict(input({ reconciliation: "failed" }));
    expect(failed.pass).toBe(false);
    expect(status(failed, "financial_loss")).toBe("fail");

    const noWrites = evaluateVerdict(input({ reconciliation: null, requiredClasses: [], classes: classes({ kayit: summary(null, 0), rapor: summary(null, 0) }) }));
    expect(noWrites.pass).toBe(true);
    expect(status(noWrites, "financial_loss")).toBe("not_applicable");
    expect(status(noWrites, "kayit_p95")).toBe("not_applicable");
  });

  test("senaryonun üretmesi gereken sınıfta örnek yoksa kalır", () => {
    const result = evaluateVerdict(input({ classes: classes({ rapor: summary(null, 0) }) }));
    expect(status(result, "rapor_p95")).toBe("fail");
    expect(result.pass).toBe(false);
  });

  test("koşucu hatası varsa kalır", () => {
    expect(status(evaluateVerdict(input({ runnerErrors: 1 })), "runner_errors")).toBe("fail");
  });
});

describe("acceptanceEligibility / isLoopbackHost", () => {
  const eligible = { sustainSeconds: 1800, targetUrl: "https://dolmus.example.com", users: 100, datasetMatchesRelease: true };

  test("30 dk sürdürülen, dış hedef, 100 kullanıcı ve aynı şema: uygun", () => {
    expect(acceptanceEligibility(eligible)).toEqual({ eligible: true, reasons: [] });
  });

  test("30 dakikadan kısa sürdürülen yük uygun değil", () => {
    const result = acceptanceEligibility({ ...eligible, sustainSeconds: 1799 });
    expect(result.eligible).toBe(false);
    expect(result.reasons.join()).toContain("1799");
  });

  test("geri döngü hedefi uygun değil", () => {
    for (const targetUrl of ["http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000", "http://app.localhost"]) {
      expect(acceptanceEligibility({ ...eligible, targetUrl }).eligible).toBe(false);
    }
  });

  test("100'den az kullanıcı veya yayından farklı şema uygun değil", () => {
    expect(acceptanceEligibility({ ...eligible, users: 99 }).eligible).toBe(false);
    expect(acceptanceEligibility({ ...eligible, datasetMatchesRelease: false }).eligible).toBe(false);
  });

  test("isLoopbackHost", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.10.0.5")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("10.0.0.5")).toBe(false);
    expect(isLoopbackHost("dolmus.example.com")).toBe(false);
    expect(isLoopbackHost("127.0.0.1.nip.io")).toBe(false);
  });
});
