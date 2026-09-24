import { afterEach, describe, expect, it } from "vitest";
import {
  getHashQueueMetrics,
  HASH_QUEUE_MAX_CONCURRENT,
  HASH_QUEUE_MAX_PENDING,
  HashQueueFullError,
  resetHashQueueForTests,
  runInHashQueue,
  takeHashQueueIntervalStats,
} from "./hash-queue";
import type { Clock } from "./session";

/**
 * `hash-queue.ts` birim testleri — T1.2 ADIM 1/2, S1.2, görev tanımı (3).
 * DB/Argon2 içermeyen saf bir eşzamanlılık/kuyruk semaforu; `unit` Vitest
 * projesindedir. Gerçek Argon2 doğrulaması üzerinden entegrasyon senaryosu
 * (yavaş sahte verify ile kuyruk aşımı) `tests/integration/vehicle-login-
 * route.test.ts`'tedir.
 */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  resetHashQueueForTests();
});

describe("runInHashQueue — eşzamanlılık sınırı", () => {
  it("en fazla HASH_QUEUE_MAX_CONCURRENT (4) iş AYNI ANDA çalışır", async () => {
    const started: number[] = [];
    const deferreds = Array.from({ length: HASH_QUEUE_MAX_CONCURRENT }, () =>
      createDeferred<void>(),
    );

    const tasks = deferreds.map((deferred, index) =>
      runInHashQueue(async () => {
        started.push(index);
        await deferred.promise;
      }),
    );

    // Mikro-görev kuyruğunun boşalması için bir tık bekle — 4 görevin
    // HEPSİNİN "started" içine yazmış olması gerekir (4 < 4 KOŞULU HER
    // BİRİ için ayrı ayrı doğru olduğundan hiçbiri kuyruğa GİRMEZ).
    await Promise.resolve();
    await Promise.resolve();
    expect(started.length).toBe(HASH_QUEUE_MAX_CONCURRENT);
    expect(getHashQueueMetrics().activeCount).toBe(HASH_QUEUE_MAX_CONCURRENT);
    expect(getHashQueueMetrics().pendingCount).toBe(0);

    deferreds.forEach((d) => d.resolve());
    await Promise.all(tasks);
    expect(getHashQueueMetrics().activeCount).toBe(0);
  });

  it("5. istek 4 kota dolu olduğunda BEKLER; bir kota boşalınca hemen ÇALIŞIR", async () => {
    const started: number[] = [];
    const deferreds = Array.from({ length: HASH_QUEUE_MAX_CONCURRENT }, () =>
      createDeferred<void>(),
    );

    const activeTasks = deferreds.map((deferred, index) =>
      runInHashQueue(async () => {
        started.push(index);
        await deferred.promise;
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(started.length).toBe(HASH_QUEUE_MAX_CONCURRENT);

    let fifthStarted = false;
    const fifthTask = runInHashQueue(async () => {
      fifthStarted = true;
    });

    // Hâlâ 4 kota DOLU — 5. görev HENÜZ çalışmamış olmalı.
    await Promise.resolve();
    await Promise.resolve();
    expect(fifthStarted).toBe(false);
    expect(getHashQueueMetrics().pendingCount).toBe(1);

    // İlk kotayı serbest bırak — 5. görev artık ÇALIŞMALI.
    deferreds[0]!.resolve();
    await fifthTask;
    expect(fifthStarted).toBe(true);

    deferreds.slice(1).forEach((d) => d.resolve());
    await Promise.all(activeTasks);
  });

  it("F10: her giriş denemesi ≤ 2 hash işlemi sırayla çalıştırılabilir (art arda 2 çağrı sorunsuz biter)", async () => {
    const first = await runInHashQueue(async () => "owner-check");
    const second = await runInHashQueue(async () => "driver-check");
    expect(first).toBe("owner-check");
    expect(second).toBe("driver-check");
    expect(getHashQueueMetrics().activeCount).toBe(0);
  });
});

describe("runInHashQueue — bekleyen kuyruk üst sınırı (100)", () => {
  it("kuyruk TAM 100 beklerken 101. istek İŞ BAŞLAMADAN HashQueueFullError fırlatır", async () => {
    const activeDeferreds = Array.from(
      { length: HASH_QUEUE_MAX_CONCURRENT },
      () => createDeferred<void>(),
    );
    const activeTasks = activeDeferreds.map((d) =>
      runInHashQueue(async () => {
        await d.promise;
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    // Kuyruğu TAM 100'e doldur — hepsi büyük bir maxWaitMs ile (bu test
    // içinde HİÇ zaman aşımına UĞRAMAYACAK şekilde) bekletilir.
    const queuedDeferreds = Array.from({ length: HASH_QUEUE_MAX_PENDING }, () =>
      createDeferred<void>(),
    );
    const queuedTasks = queuedDeferreds.map((d) =>
      runInHashQueue(
        async () => {
          await d.promise;
        },
        undefined,
        60_000,
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(getHashQueueMetrics().pendingCount).toBe(HASH_QUEUE_MAX_PENDING);

    let overflowCalled = false;
    await expect(
      runInHashQueue(async () => {
        overflowCalled = true;
      }),
    ).rejects.toThrow(HashQueueFullError);
    expect(overflowCalled).toBe(false);

    // Temizlik — bekleyen/aktif tüm görevleri serbest bırak.
    activeDeferreds.forEach((d) => d.resolve());
    queuedDeferreds.forEach((d) => d.resolve());
    await Promise.all([...activeTasks, ...queuedTasks]);
  });
});

describe("runInHashQueue — bekleme üst sınırı (zaman aşımı)", () => {
  it("kuyrukta maxWaitMs kadar bekleyip kota GELMEZSE HashQueueFullError fırlatır", async () => {
    const activeDeferreds = Array.from(
      { length: HASH_QUEUE_MAX_CONCURRENT },
      () => createDeferred<void>(),
    );
    const activeTasks = activeDeferreds.map((d) =>
      runInHashQueue(async () => {
        await d.promise;
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    // Gerçek (ama KISA — 30ms) bir zaman aşımıyla kuyruğa gir; hiçbir
    // aktif kota SERBEST BIRAKILMAYACAK, bu yüzden zaman aşımına
    // UĞRAMASI beklenir.
    await expect(
      runInHashQueue(async () => "hiç çalışmamalı", undefined, 30),
    ).rejects.toThrow(HashQueueFullError);

    expect(getHashQueueMetrics().pendingCount).toBe(0);

    activeDeferreds.forEach((d) => d.resolve());
    await Promise.all(activeTasks);
  });

  it("zaman aşımına uğrayan istek, SONRADAN boşalan bir kotayı ARTIK almaz (kuyruktan zaten düşmüştür)", async () => {
    const activeDeferreds = Array.from(
      { length: HASH_QUEUE_MAX_CONCURRENT },
      () => createDeferred<void>(),
    );
    const activeTasks = activeDeferreds.map((d) =>
      runInHashQueue(async () => {
        await d.promise;
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    const timedOut = runInHashQueue(async () => "gec", undefined, 20);
    await expect(timedOut).rejects.toThrow(HashQueueFullError);

    // Zaman aşımından SONRA bir kota boşalt — yeni bir istek bu kotayı
    // sorunsuz kullanabilmeli (kuyruk BOZULMAMIŞ olmalı).
    activeDeferreds[0]!.resolve();
    const result = await runInHashQueue(async () => "yeni-istek");
    expect(result).toBe("yeni-istek");

    activeDeferreds.slice(1).forEach((d) => d.resolve());
    await Promise.all(activeTasks);
  });
});

describe("getHashQueueMetrics", () => {
  it("boş kuyrukta activeCount/pendingCount/longestWaitMs sıfırdır", () => {
    const metrics = getHashQueueMetrics();
    expect(metrics).toEqual({
      activeCount: 0,
      pendingCount: 0,
      longestWaitMs: 0,
    });
  });
});

describe("takeHashQueueIntervalStats — aralık metrikleri (oku ve sıfırla)", () => {
  function manualClock(startMs: number): { clock: Clock; advance: (ms: number) => void } {
    let nowMs = startMs;
    return {
      clock: () => new Date(nowMs),
      advance: (ms) => {
        nowMs += ms;
      },
    };
  }

  it("boş kuyrukta tüm alanlar 0'dır", () => {
    expect(takeHashQueueIntervalStats()).toEqual({
      verifications: 0,
      maxPending: 0,
      longestWaitMs: 0,
    });
  });

  it("çalışan doğrulamaları sayar; dönüş değeri ve fn hatası değişmeden geçer", async () => {
    expect(await runInHashQueue(async () => "ok")).toBe("ok");
    const failure = new Error("verify patladı");
    await expect(
      runInHashQueue(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    const stats = takeHashQueueIntervalStats();
    expect(stats.verifications).toBe(2);
    expect(stats.maxPending).toBe(0);
    expect(stats.longestWaitMs).toBe(0);
    // Okuma sayaçları sıfırlar.
    expect(takeHashQueueIntervalStats().verifications).toBe(0);
  });

  it("kuyruk dolu (HashQueueFullError) olduğunda fn çağrılmaz ve doğrulama sayılmaz", async () => {
    const activeDeferreds = Array.from({ length: HASH_QUEUE_MAX_CONCURRENT }, () =>
      createDeferred<void>(),
    );
    const activeTasks = activeDeferreds.map((d) =>
      runInHashQueue(async () => {
        await d.promise;
      }),
    );
    await Promise.resolve();

    await expect(runInHashQueue(async () => "gec", undefined, 5)).rejects.toThrow(
      HashQueueFullError,
    );

    activeDeferreds.forEach((d) => d.resolve());
    await Promise.all(activeTasks);
    const stats = takeHashQueueIntervalStats();
    expect(stats.verifications).toBe(HASH_QUEUE_MAX_CONCURRENT);
    expect(stats.maxPending).toBe(1);
  });

  it("en yüksek bekleyen sayısını ve kuyruktan çıkanların en uzun beklemesini raporlar", async () => {
    const { clock, advance } = manualClock(1_000_000);
    const activeDeferreds = Array.from({ length: HASH_QUEUE_MAX_CONCURRENT }, () =>
      createDeferred<void>(),
    );
    const activeTasks = activeDeferreds.map((d) =>
      runInHashQueue(async () => {
        await d.promise;
      }, clock),
    );
    await Promise.resolve();

    const first = runInHashQueue(async () => "birinci", clock);
    advance(300);
    const second = runInHashQueue(async () => "ikinci", clock);
    await Promise.resolve();
    expect(getHashQueueMetrics(clock).pendingCount).toBe(2);

    advance(700);
    // İki kota boşalır: birinci 1000 ms, ikinci 700 ms beklemiş olur.
    activeDeferreds[0]!.resolve();
    activeDeferreds[1]!.resolve();
    expect(await first).toBe("birinci");
    expect(await second).toBe("ikinci");

    const stats = takeHashQueueIntervalStats(clock);
    expect(stats.maxPending).toBe(2);
    expect(stats.longestWaitMs).toBe(1000);
    expect(stats.verifications).toBe(HASH_QUEUE_MAX_CONCURRENT + 2);

    activeDeferreds.slice(2).forEach((d) => d.resolve());
    await Promise.all(activeTasks);
  });

  it("okuma anında hâlâ bekleyen isteği hem bu aralıkta hem sonrakinde raporlar", async () => {
    const { clock, advance } = manualClock(2_000_000);
    const activeDeferreds = Array.from({ length: HASH_QUEUE_MAX_CONCURRENT }, () =>
      createDeferred<void>(),
    );
    const activeTasks = activeDeferreds.map((d) =>
      runInHashQueue(async () => {
        await d.promise;
      }, clock),
    );
    await Promise.resolve();

    const waiting = runInHashQueue(async () => "bekleyen", clock, 60_000);
    advance(400);

    const firstInterval = takeHashQueueIntervalStats(clock);
    expect(firstInterval.maxPending).toBe(1);
    expect(firstInterval.longestWaitMs).toBe(400);
    expect(firstInterval.verifications).toBe(HASH_QUEUE_MAX_CONCURRENT);

    advance(100);
    activeDeferreds[0]!.resolve();
    expect(await waiting).toBe("bekleyen");

    const secondInterval = takeHashQueueIntervalStats(clock);
    // Yeni aralık hâlâ bekleyen istekle başlar; toplam beklemesi 500 ms.
    expect(secondInterval.maxPending).toBe(1);
    expect(secondInterval.longestWaitMs).toBe(500);
    expect(secondInterval.verifications).toBe(1);

    activeDeferreds.slice(1).forEach((d) => d.resolve());
    await Promise.all(activeTasks);
    expect(takeHashQueueIntervalStats(clock)).toEqual({
      verifications: 0,
      maxPending: 0,
      longestWaitMs: 0,
    });
  });

  it("zaman aşımına uğrayan isteğin beklemesi de sayılır", async () => {
    const activeDeferreds = Array.from({ length: HASH_QUEUE_MAX_CONCURRENT }, () =>
      createDeferred<void>(),
    );
    const activeTasks = activeDeferreds.map((d) =>
      runInHashQueue(async () => {
        await d.promise;
      }),
    );
    await Promise.resolve();

    await expect(runInHashQueue(async () => "gec", undefined, 20)).rejects.toThrow(
      HashQueueFullError,
    );
    const stats = takeHashQueueIntervalStats();
    expect(stats.longestWaitMs).toBeGreaterThanOrEqual(15);
    expect(stats.maxPending).toBe(1);

    activeDeferreds.forEach((d) => d.resolve());
    await Promise.all(activeTasks);
  });
});
