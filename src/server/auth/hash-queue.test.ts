import { afterEach, describe, expect, it } from "vitest";
import {
  getHashQueueMetrics,
  HASH_QUEUE_MAX_CONCURRENT,
  HASH_QUEUE_MAX_PENDING,
  HashQueueFullError,
  resetHashQueueForTests,
  runInHashQueue,
} from "./hash-queue";

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
