/**
 * Araç credential parolası — Argon2id hashleme/doğrulama + sahip/şoför
 * "aynı olamaz" kuralı — T2.2, T2.3'ün de PAYLAŞACAĞI tek kaynak.
 *
 * node-argon2 ile Argon2id; başlangıç 19 MiB, t=2, p=1
 * (`scripts/db-seed-dev.ts`/`scripts/platform-admin.ts` `ARGON2ID_
 * OPTIONS` ile BİREBİR AYNI parametreler — K9). Hash işlemi HİÇBİR ZAMAN
 * bir yazma transaction'ı İÇİNDE çalışmaz; bu yüzden her iki fonksiyon
 * da `../auth/hash-queue.ts` `runInHashQueue` ÜZERİNDEN çalışır (429
 * `HashQueueFullError` ihtimali burada doğar, çağıran bunu HTTP 429
 * HASH_QUEUE_FULL'e çevirir) ve çağıranın onları
 * `withImmediateTransaction(...)` bloğunun DIŞINDA çağırması gerekir
 * (better-sqlite3'ün native transaction sarmalayıcısı senkron bir
 * fonksiyon bekler — bkz. `../data/db.ts` `AppDatabase` üst notu).
 */
import { argon2id, hash, verify } from "argon2";
import { systemClock, type Clock } from "./session";
import { runInHashQueue } from "./hash-queue";

const ARGON2ID_OPTIONS = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Yeni bir araç credential parolasını Argon2id ile özetler — hash kuyruğu
 * üzerinden (`../data/db.ts` `withImmediateTransaction` bloğu DIŞINDA
 * çağrılmalıdır).
 */
export async function hashVehiclePassword(
  password: string,
  clock: Clock = systemClock,
): Promise<string> {
  return runInHashQueue(() => hash(password, ARGON2ID_OPTIONS), clock);
}

/**
 * Bir araç credential parolasını saklanan Argon2id özetine karşı doğrular
 * — hash kuyruğu üzerinden (aynı 429 ihtimali).
 */
export async function verifyVehiclePassword(
  passwordHash: string,
  password: string,
  clock: Clock = systemClock,
): Promise<boolean> {
  return runInHashQueue(() => verify(passwordHash, password), clock);
}

/**
 * T2.2 görev tanımı — "sahip ve şoför şifreleri aynı olamaz." Salt bir
 * karşılaştırmadır (hiçbir HTTP/422 şekli İCAT ETMEZ — çağıran KENDİ alan
 * hatası sınıfını üretir); T2.3'ün (parola sıfırlama) de KULLANACAĞI ortak
 * kural, iki yerde AYRI yazılmaz.
 */
export function passwordsAreDistinct(ownerPassword: string, driverPassword: string): boolean {
  return ownerPassword !== driverPassword;
}
