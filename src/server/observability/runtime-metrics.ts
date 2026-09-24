/**
 * Süreç içi çalışma zamanı metrik örnekleyicisi.
 *
 * `../../instrumentation.ts` `register()` (yalnız nodejs runtime'ı)
 * `startRuntimeMetrics()`'i çağırır; her 60 sn'de stdout'a (journald) TEK
 * logfmt satırı yazılır — sağlık görevinin (`deploy/health/health-check.mts`)
 * ve yedeğin biçimiyle aynı:
 *
 *   <6>dolmus-runtime event=runtime_metrics ts=<UTC ISO> el_p50_ms=... ...
 *
 * Satır yalnız sabit anahtarlı SAYILAR taşır; plaka, kullanıcı adı, parola,
 * token, çerez, IP veya istek gövdesi hiçbir kaynaktan buraya ulaşmaz.
 *
 * Örnekleyici DB'yi sorgulamaz ve sağlık uçlarını çağırmaz: yazma
 * transaction'ı ve Argon2 kuyruğu sayaçları bellek içi "oku ve sıfırla"
 * anlık görüntüleridir (`../data/db.ts` `takeWriteTransactionStats`,
 * `../auth/hash-queue.ts` `takeHashQueueIntervalStats`).
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import {
  takeWriteTransactionStats,
  type WriteTransactionStats,
} from "../data/db";
import {
  takeHashQueueIntervalStats,
  type HashQueueIntervalStats,
} from "../auth/hash-queue";

export const RUNTIME_METRICS_INTERVAL_MS = 60_000;
/** `monitorEventLoopDelay` örnekleme aralığı (Node varsayılanı). */
export const EVENT_LOOP_RESOLUTION_MS = 10;

/** `monitorEventLoopDelay` histogramının kullanılan alt kümesi (ns). */
export interface EventLoopHistogram {
  readonly count: number;
  readonly max: number;
  percentile(percentile: number): number;
  reset(): void;
}

export interface RuntimeMetricsSources {
  eventLoop: EventLoopHistogram;
  memoryUsage: () => NodeJS.MemoryUsage;
  /** `process.cpuUsage(previous)` imzası: µs cinsinden fark. */
  cpuUsage: (previous?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
  now: () => number;
  takeWriteTransactionStats: () => WriteTransactionStats;
  takeHashQueueIntervalStats: () => HashQueueIntervalStats;
}

export interface RuntimeMetricsSample {
  intervalMs: number;
  eventLoopP50Ms: number;
  eventLoopP99Ms: number;
  eventLoopMaxMs: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  writeTx: WriteTransactionStats;
  hashQueue: HashQueueIntervalStats;
}

/**
 * Histogram her zamanlayıcı turunu çözünürlük aralığı DAHİL kaydeder (boşta
 * ~10 ms); rapor edilen gecikme aralığın ÜSTÜNDEKİ kısımdır. Boş histogramda
 * `percentile()` 0 değil bir sınır değeri döndüğünden `count === 0` ayrıca
 * denetlenir.
 */
function eventLoopDelayMs(histogram: EventLoopHistogram, nanoseconds: number): number {
  if (histogram.count === 0) {
    return 0;
  }
  return Math.max(0, nanoseconds / 1e6 - EVENT_LOOP_RESOLUTION_MS);
}

/**
 * Her `sample()` çağrısı, bir önceki çağrıdan (ilki için oluşturulma
 * anından) bu yana geçen aralığı özetler ve aralık sayaçlarını sıfırlar.
 * Tüm okumalar ve sıfırlamalar aynı senkron adımdadır.
 */
export function createRuntimeMetricsSampler(sources: RuntimeMetricsSources): {
  sample: () => RuntimeMetricsSample;
} {
  let previousCpu = sources.cpuUsage();
  let previousAt = sources.now();

  return {
    sample(): RuntimeMetricsSample {
      const at = sources.now();
      const cpu = sources.cpuUsage(previousCpu);
      const memory = sources.memoryUsage();
      const { eventLoop } = sources;
      const result: RuntimeMetricsSample = {
        intervalMs: at - previousAt,
        eventLoopP50Ms: eventLoopDelayMs(eventLoop, eventLoop.percentile(50)),
        eventLoopP99Ms: eventLoopDelayMs(eventLoop, eventLoop.percentile(99)),
        eventLoopMaxMs: eventLoopDelayMs(eventLoop, eventLoop.max),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        cpuUserMs: cpu.user / 1000,
        cpuSystemMs: cpu.system / 1000,
        writeTx: sources.takeWriteTransactionStats(),
        hashQueue: sources.takeHashQueueIntervalStats(),
      };
      eventLoop.reset();
      previousCpu = sources.cpuUsage();
      previousAt = at;
      return result;
    },
  };
}

/** Milisaniye değerleri 0,1 ms'ye yuvarlanır; sayaç ve baytlar tamsayıdır. */
function ms(value: number): number {
  return Math.round(value * 10) / 10;
}

export function formatRuntimeMetricsLine(sample: RuntimeMetricsSample, now: Date): string {
  const fields: [string, number][] = [
    ["interval_ms", Math.round(sample.intervalMs)],
    ["el_p50_ms", ms(sample.eventLoopP50Ms)],
    ["el_p99_ms", ms(sample.eventLoopP99Ms)],
    ["el_max_ms", ms(sample.eventLoopMaxMs)],
    ["rss_bytes", Math.round(sample.rssBytes)],
    ["heap_used_bytes", Math.round(sample.heapUsedBytes)],
    ["heap_total_bytes", Math.round(sample.heapTotalBytes)],
    ["cpu_user_ms", ms(sample.cpuUserMs)],
    ["cpu_system_ms", ms(sample.cpuSystemMs)],
    ["tx_count", sample.writeTx.count],
    ["tx_p99_ms", ms(sample.writeTx.p99Ms)],
    ["tx_max_ms", ms(sample.writeTx.maxMs)],
    ["tx_lock_failures", sample.writeTx.lockFailures],
    ["hash_verifications", sample.hashQueue.verifications],
    ["hash_max_pending", sample.hashQueue.maxPending],
    ["hash_longest_wait_ms", ms(sample.hashQueue.longestWaitMs)],
  ];
  const kv = fields.map(([key, value]) => `${key}=${value}`).join(" ");
  return `<6>dolmus-runtime event=runtime_metrics ts=${now.toISOString()} ${kv}`;
}

interface RuntimeMetricsState {
  timer: ReturnType<typeof setInterval>;
  disable: () => void;
}

// `next dev` `register()`'ı aynı süreçte birden çok kez (ayrı modül
// örnekleriyle) çalıştırabilir; tekil durum bu yüzden modül değişkeninde
// değil süreç genelindeki `globalThis`'te tutulur.
const STATE_KEY = Symbol.for("dolmus-takip.runtime-metrics");
type GlobalWithState = typeof globalThis & { [STATE_KEY]?: RuntimeMetricsState };

/**
 * Örnekleyiciyi süreç başına EN FAZLA bir kez başlatır; sonraki çağrılar
 * hiçbir şey yapmaz. Zamanlayıcı `unref()` edilir: duran bir sürecin
 * kapanmasını tutmaz.
 */
export function startRuntimeMetrics(): void {
  const holder = globalThis as GlobalWithState;
  if (holder[STATE_KEY]) {
    return;
  }
  const eventLoop = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
  eventLoop.enable();
  const sampler = createRuntimeMetricsSampler({
    eventLoop,
    memoryUsage: () => process.memoryUsage(),
    cpuUsage: (previous) => process.cpuUsage(previous),
    now: () => performance.now(),
    takeWriteTransactionStats,
    takeHashQueueIntervalStats: () => takeHashQueueIntervalStats(),
  });
  const timer = setInterval(() => {
    try {
      console.log(formatRuntimeMetricsLine(sampler.sample(), new Date()));
    } catch (error) {
      // Metrik okuma hatası isteği etkilemez; satır bir sonraki turda
      // yeniden denenir. Mesaj serbest metin olduğundan yalnız hata adı yazılır.
      const name = error instanceof Error ? error.name : "unknown";
      console.error(
        `<3>dolmus-runtime event=runtime_metrics_failed ts=${new Date().toISOString()} error=${name.replace(/[^A-Za-z0-9_]/g, "_")}`,
      );
    }
  }, RUNTIME_METRICS_INTERVAL_MS);
  timer.unref();
  holder[STATE_KEY] = { timer, disable: () => eventLoop.disable() };
}

/** Yalnız testler içindir — zamanlayıcıyı durdurur ve tekil durumu siler. */
export function stopRuntimeMetricsForTests(): void {
  const holder = globalThis as GlobalWithState;
  const state = holder[STATE_KEY];
  if (state) {
    clearInterval(state.timer);
    state.disable();
    delete holder[STATE_KEY];
  }
}
