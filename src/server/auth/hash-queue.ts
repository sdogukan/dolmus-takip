/**
 * Argon2 doğrulama kuyruğu — T1.2 ADIM 1/2, S1.2.
 *
 * Kaynak — ARCHITECTURE.md §6 "Hash yükü" satırı (birebir): "Eşzamanlı
 * hash işine ve bekleyen kuyruğa üst sınır; başlangıç 4 çalışan/100
 * bekleyen, en fazla 10 saniye. Aşım 429; sınırsız bellek kuyruğu yok."
 * Görev tanımı (3, birebir): "en fazla 4 eşzamanlı doğrulama, en fazla
 * 100 bekleyen, bekleme üst sınırı 10 sn; aşım 429 HASH_QUEUE_FULL
 * (mesaj: sistem yoğun, tekrar dene); DECISIONS F10: her giriş denemesi
 * ≤ 2 hash işlemi sayılır; kuyruk metriği (bekleyen sayısı, en uzun
 * bekleme) loglanabilir."
 *
 * Bu modül DB'ye veya Argon2'ye HİÇ dokunmaz — yalnız GENEL bir "en fazla
 * N eşzamanlı, en fazla M bekleyen, en fazla T ms bekleme" semaforu
 * sağlar; `../usecases/auth/vehicle-login.ts` her `argon2.verify(...)`
 * çağrısını (gerçek VEYA dummy-hash yolu — ikisi de eşit CPU maliyeti
 * taşıdığından kuyruk açısından AYNI şekilde sayılır) bu semafor
 * ÜZERİNDEN çalıştırır.
 *
 * ## Adil (FIFO) devir mekanizması — yarış durumu notu
 *
 * `release()` bir kotayı BOŞALTTIĞINDA, eğer bekleyen bir istek VARSA,
 * o kotayı doğrudan (aktif sayacı HİÇ DÜŞÜRMEDEN) bekleyene DEVREDER —
 * `active` sayacını `0`'a düşürüp SONRA tekrar `1`'e çıkarmaz. Bu, aradaki
 * mikro-görev penceresinde YENİ bir çağrının (henüz kuyrukta olmayan) boş
 * görünen kotayı bekleyen istekten ÖNCE kapmasını (haksız/FIFO-dışı sıra
 * atlaması) engeller — `acquire()` içindeki `active < MAX_CONCURRENT`
 * kontrolü, bir kota yalnız GERÇEKTEN serbest (kimseye devredilmeden)
 * kaldığında `true` görür.
 */
import { systemClock, type Clock } from "./session";

/** Görev tanımı — "en fazla 4 eşzamanlı doğrulama". */
export const HASH_QUEUE_MAX_CONCURRENT = 4;
/** Görev tanımı — "en fazla 100 bekleyen". */
export const HASH_QUEUE_MAX_PENDING = 100;
/** Görev tanımı — "bekleme üst sınırı 10 sn". */
export const HASH_QUEUE_MAX_WAIT_MS = 10_000;

export class HashQueueFullError extends Error {
  constructor(
    message = "Sistem şu anda yoğun. Lütfen tekrar dene.",
  ) {
    super(message);
    this.name = "HashQueueFullError";
  }
}

interface PendingEntry {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  enqueuedAtMs: number;
}

let active = 0;
let pending: PendingEntry[] = [];

/** Yalnız testler içindir — bekleyen/aktif durumu sıfırlar. Üretim kodu
 * bunu ÇAĞIRMAZ (bkz. `../../data/app-db.ts` `resetAppDbForTests` aynı
 * "yalnız test" deseni). */
export function resetHashQueueForTests(): void {
  for (const entry of pending) {
    clearTimeout(entry.timeoutHandle);
  }
  pending = [];
  active = 0;
}

export interface HashQueueMetrics {
  activeCount: number;
  pendingCount: number;
  /** En uzun bekleyen isteğin şu ana kadar kuyrukta geçirdiği süre (ms);
   * kuyruk boşsa `0`. "Kuyruk metriği (bekleyen sayısı, en uzun bekleme)
   * loglanabilir" — bu fonksiyon değeri SAĞLAR, loglamayı ZORUNLU KILMAZ
   * (çağıran, ör. eşik aşıldığında `console.info`/`console.warn` ile
   * kendi loglama kararını verir). */
  longestWaitMs: number;
}

export function getHashQueueMetrics(clock: Clock = systemClock): HashQueueMetrics {
  const now = clock().getTime();
  const longestWaitMs =
    pending.length === 0
      ? 0
      : now - Math.min(...pending.map((entry) => entry.enqueuedAtMs));
  return {
    activeCount: active,
    pendingCount: pending.length,
    longestWaitMs,
  };
}

/**
 * Bir kotayı ELDE EDER (aktif sayacı artırır) VEYA kuyruğa girer VEYA
 * (kuyruk doluysa) hemen `HashQueueFullError` fırlatır. `clock` yalnız
 * `enqueuedAtMs` METRİĞİ içindir (zaman kontrollü testler `getHashQueue
 * Metrics`'i sınayabilsin diye) — 10 saniyelik bekleme ZAMAN AŞIMININ
 * KENDİSİ gerçek `setTimeout` ile ölçülür (enjekte edilebilir bir sahte
 * zamanlayıcı GEREKTİRMEZ; testler gerçek ama KISA bir aşım süresi
 * geçirerek bu yolu sınar — bkz. `hash-queue.test.ts`).
 */
async function acquire(clock: Clock, maxWaitMs: number): Promise<void> {
  if (active < HASH_QUEUE_MAX_CONCURRENT) {
    active++;
    return;
  }
  if (pending.length >= HASH_QUEUE_MAX_PENDING) {
    throw new HashQueueFullError();
  }
  await new Promise<void>((resolve, reject) => {
    const entry: PendingEntry = {
      resolve,
      reject,
      enqueuedAtMs: clock().getTime(),
      timeoutHandle: setTimeout(() => {
        const idx = pending.indexOf(entry);
        if (idx !== -1) {
          pending.splice(idx, 1);
        }
        reject(new HashQueueFullError());
      }, maxWaitMs),
    };
    pending.push(entry);
  });
}

/**
 * Bir kotayı SERBEST BIRAKIR. Bekleyen VARSA, kotayı doğrudan ona
 * DEVREDER (dosya üstü not — "adil devir mekanizması"); YOKSA aktif
 * sayacı düşürür.
 */
function release(): void {
  const next = pending.shift();
  if (next) {
    clearTimeout(next.timeoutHandle);
    next.resolve();
    return;
  }
  active--;
}

/**
 * `fn`'i kuyruk üzerinden çalıştırır — görev tanımının BİREBİR
 * kullanacağı imza: `../usecases/auth/vehicle-login.ts` her Argon2
 * doğrulamasını `runInHashQueue(() => verify(digest, password))` ile
 * sarar. Kuyruk doluysa/zaman aşımına uğrarsa `HashQueueFullError`
 * FIRLAR (çağıran bunu 429 `HASH_QUEUE_FULL`'e çevirir); `fn`'in
 * KENDİSİ hiç ÇAĞRILMAZ.
 *
 * `maxWaitMs` yalnız TESTLER içindir (varsayılan `HASH_QUEUE_MAX_WAIT_MS`
 * — üretim çağrıları bunu HİÇ geçirmez): 10 saniyelik gerçek zaman aşımı
 * yolunu (bkz. dosya üstü not — bu SÜRE `Clock` enjeksiyonuyla
 * HIZLANDIRILAMAZ, gerçek `setTimeout` ile ölçülür) makul bir test
 * süresinde sınayabilmek için kısa bir değer geçirilebilir.
 */
export async function runInHashQueue<T>(
  fn: () => Promise<T>,
  clock: Clock = systemClock,
  maxWaitMs: number = HASH_QUEUE_MAX_WAIT_MS,
): Promise<T> {
  await acquire(clock, maxWaitMs);
  try {
    return await fn();
  } finally {
    release();
  }
}
