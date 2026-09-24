import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRuntimeMetricsSampler,
  EVENT_LOOP_RESOLUTION_MS,
  formatRuntimeMetricsLine,
  RUNTIME_METRICS_INTERVAL_MS,
  startRuntimeMetrics,
  stopRuntimeMetricsForTests,
  type EventLoopHistogram,
  type RuntimeMetricsSample,
  type RuntimeMetricsSources,
} from "./runtime-metrics";

/**
 * `runtime-metrics.ts` birim testleri — aralık özeti (toplama ve sıfırlama),
 * satır biçimi ve süreç başına tek zamanlayıcı. DB'ye dokunmaz: yazma
 * transaction'ı ve Argon2 kuyruğu kaynakları sahte fonksiyonlarla verilir
 * (gerçek sayaçlar `tests/integration/db-connection.test.ts` ve
 * `../auth/hash-queue.test.ts`'te sınanır).
 */

const NS_PER_MS = 1e6;

function fakeHistogram(valuesMs: number[]): EventLoopHistogram & { resets: number } {
  const histogram = {
    resets: 0,
    values: [...valuesMs],
    get count() {
      return this.values.length;
    },
    get max() {
      return this.values.length === 0 ? 0 : Math.max(...this.values) * NS_PER_MS;
    },
    percentile(p: number) {
      if (this.values.length === 0) {
        return 511; // Gerçek boş histogramın döndürdüğü sınır değer (ns).
      }
      const sorted = [...this.values].sort((a, b) => a - b);
      return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]! * NS_PER_MS;
    },
    reset() {
      this.values = [];
      this.resets++;
    },
  };
  return histogram;
}

function memory(rss: number, heapUsed: number, heapTotal: number): NodeJS.MemoryUsage {
  return { rss, heapUsed, heapTotal, external: 0, arrayBuffers: 0 };
}

describe("createRuntimeMetricsSampler — aralık özeti", () => {
  it("olay döngüsü gecikmesini çözünürlüğün üstündeki kısım olarak, CPU'yu önceki okumaya göre fark olarak verir", () => {
    const R = EVENT_LOOP_RESOLUTION_MS;
    const eventLoop = fakeHistogram([R + 1, R + 2, R + 3, R + 40]);
    // Kümülatif µs: oluşturma 1000/500, ilk örnek 4000/1500.
    const cumulative = [
      { user: 1_000, system: 500 },
      { user: 4_000, system: 1_500 },
      { user: 4_000, system: 1_500 },
    ];
    let cpuReads = 0;
    let nowMs = 0;
    const sources: RuntimeMetricsSources = {
      eventLoop,
      memoryUsage: () => memory(100_000_000, 40_000_000, 60_000_000),
      cpuUsage: (previous) => {
        const current = cumulative[Math.min(cpuReads++, cumulative.length - 1)]!;
        return previous
          ? { user: current.user - previous.user, system: current.system - previous.system }
          : current;
      },
      now: () => nowMs,
      takeWriteTransactionStats: () => ({ count: 7, lockFailures: 1, p99Ms: 12.34, maxMs: 55.5 }),
      takeHashQueueIntervalStats: () => ({ verifications: 9, maxPending: 3, longestWaitMs: 250 }),
    };

    const sampler = createRuntimeMetricsSampler(sources);
    nowMs = 60_000;
    const sample = sampler.sample();

    expect(sample).toEqual<RuntimeMetricsSample>({
      intervalMs: 60_000,
      eventLoopP50Ms: 2,
      eventLoopP99Ms: 40,
      eventLoopMaxMs: 40,
      rssBytes: 100_000_000,
      heapUsedBytes: 40_000_000,
      heapTotalBytes: 60_000_000,
      cpuUserMs: 3,
      cpuSystemMs: 1,
      writeTx: { count: 7, lockFailures: 1, p99Ms: 12.34, maxMs: 55.5 },
      hashQueue: { verifications: 9, maxPending: 3, longestWaitMs: 250 },
    });
    expect(eventLoop.resets).toBe(1);
  });

  it("her örnek yalnız kendi aralığını kapsar (histogram sıfırlanır, CPU tabanı ilerler)", () => {
    const eventLoop = fakeHistogram([EVENT_LOOP_RESOLUTION_MS + 100]);
    let cumulativeUser = 0;
    let nowMs = 1_000;
    const takeWrite = vi.fn(() => ({ count: 0, lockFailures: 0, p99Ms: 0, maxMs: 0 }));
    const takeHash = vi.fn(() => ({ verifications: 0, maxPending: 0, longestWaitMs: 0 }));
    const sampler = createRuntimeMetricsSampler({
      eventLoop,
      memoryUsage: () => memory(1, 1, 1),
      cpuUsage: (previous) =>
        previous
          ? { user: cumulativeUser - previous.user, system: 0 }
          : { user: cumulativeUser, system: 0 },
      now: () => nowMs,
      takeWriteTransactionStats: takeWrite,
      takeHashQueueIntervalStats: takeHash,
    });

    cumulativeUser = 5_000;
    nowMs = 61_000;
    const first = sampler.sample();
    expect(first.eventLoopMaxMs).toBe(100);
    expect(first.cpuUserMs).toBe(5);

    cumulativeUser = 7_000;
    nowMs = 121_500;
    const second = sampler.sample();
    // Aralıkta yeni histogram örneği yok → 0 (boş histogramın 511 ns'si değil).
    expect(second.eventLoopP50Ms).toBe(0);
    expect(second.eventLoopP99Ms).toBe(0);
    expect(second.eventLoopMaxMs).toBe(0);
    expect(second.cpuUserMs).toBe(2);
    expect(second.intervalMs).toBe(60_500);
    expect(takeWrite).toHaveBeenCalledTimes(2);
    expect(takeHash).toHaveBeenCalledTimes(2);
  });

  it("çözünürlükten kısa ölçümü negatif değil 0 olarak verir", () => {
    const sampler = createRuntimeMetricsSampler({
      eventLoop: fakeHistogram([EVENT_LOOP_RESOLUTION_MS - 0.5]),
      memoryUsage: () => memory(1, 1, 1),
      cpuUsage: () => ({ user: 0, system: 0 }),
      now: () => 0,
      takeWriteTransactionStats: () => ({ count: 0, lockFailures: 0, p99Ms: 0, maxMs: 0 }),
      takeHashQueueIntervalStats: () => ({ verifications: 0, maxPending: 0, longestWaitMs: 0 }),
    });
    expect(sampler.sample().eventLoopP50Ms).toBe(0);
  });
});

describe("formatRuntimeMetricsLine", () => {
  const sample: RuntimeMetricsSample = {
    intervalMs: 60_012.7,
    eventLoopP50Ms: 0.456,
    eventLoopP99Ms: 12.349,
    eventLoopMaxMs: 88.04,
    rssBytes: 123_456_789,
    heapUsedBytes: 45_678_901,
    heapTotalBytes: 67_890_123,
    cpuUserMs: 1234.567,
    cpuSystemMs: 89.01,
    writeTx: { count: 42, lockFailures: 2, p99Ms: 17.25, maxMs: 2003.9 },
    hashQueue: { verifications: 15, maxPending: 4, longestWaitMs: 812 },
  };

  it("sağlık görevinin logfmt biçimini ve sabit anahtar sırasını izler", () => {
    const line = formatRuntimeMetricsLine(sample, new Date("2026-09-24T21:30:00.000Z"));
    expect(line).toBe(
      "<6>dolmus-runtime event=runtime_metrics ts=2026-09-24T21:30:00.000Z " +
        "interval_ms=60013 el_p50_ms=0.5 el_p99_ms=12.3 el_max_ms=88 " +
        "rss_bytes=123456789 heap_used_bytes=45678901 heap_total_bytes=67890123 " +
        "cpu_user_ms=1234.6 cpu_system_ms=89 " +
        "tx_count=42 tx_p99_ms=17.3 tx_max_ms=2003.9 tx_lock_failures=2 " +
        "hash_verifications=15 hash_max_pending=4 hash_longest_wait_ms=812",
    );
  });

  it("tek satırdır ve ts dışında yalnız sayısal değerler taşır (serbest metin yok)", () => {
    const line = formatRuntimeMetricsLine(sample, new Date("2026-09-24T21:30:00.000Z"));
    expect(line).not.toContain("\n");
    const [prefix, ...pairs] = line.split(" ");
    expect(prefix).toBe("<6>dolmus-runtime");
    for (const pair of pairs) {
      expect(pair).toMatch(/^(event=runtime_metrics|ts=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z|[a-z0-9_]+=\d+(\.\d+)?)$/);
    }
  });
});

describe("startRuntimeMetrics — zamanlayıcı", () => {
  afterEach(() => {
    stopRuntimeMetricsForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("her 60 sn'de tam bir satır yazar; ikinci çağrı ikinci zamanlayıcı başlatmaz", () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    startRuntimeMetrics();
    startRuntimeMetrics();

    vi.advanceTimersByTime(RUNTIME_METRICS_INTERVAL_MS - 1);
    expect(log).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(log).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RUNTIME_METRICS_INTERVAL_MS);
    expect(log).toHaveBeenCalledTimes(2);

    for (const [line] of log.mock.calls) {
      expect(String(line)).toMatch(/^<6>dolmus-runtime event=runtime_metrics ts=\S+ interval_ms=\d+ /);
    }
  });

  it("zamanlayıcı unref() edilir (süreç kapanışını tutmaz)", () => {
    const realSetInterval = globalThis.setInterval;
    let created: ReturnType<typeof setInterval> | undefined;
    vi.spyOn(globalThis, "setInterval").mockImplementation(((
      handler: () => void,
      ms: number,
    ) => {
      created = realSetInterval(handler, ms);
      return created;
    }) as typeof setInterval);

    startRuntimeMetrics();

    expect(created).toBeDefined();
    expect(created!.hasRef()).toBe(false);
  });
});
