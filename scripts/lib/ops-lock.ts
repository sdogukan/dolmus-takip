/**
 * Ortak işletim kilidi (`/var/lib/dolmus-takip/ops.lock`, SERVER-SETUP §2):
 * günlük yedek, kontrollü restore (`scripts/db-restore.ts install`) ve yayın
 * (`scripts/release-apply.ts`) AYNI dosyayı `flock` ile kilitler.
 *
 * Node'da `flock` yoktur: kilit dosyası bu süreçte açılır, `flock` aracı aynı
 * açık dosyayı (fd 3) kilitleyip çıkar; kilit açık dosya tanımına bağlıdır ve
 * bu süreç kapatana/çıkana dek tutulur. Kilit dosyası yoksa oluşturulmaz.
 *
 * `DOLMUS_OPS_LOCK_FD`: kilidi zaten tutan üst süreçten (yayın aracı, DB
 * geri dönüşünde restore aracını çağırırken) devralınan açık tanıtıcı. Aynı
 * açık dosya tanımı üzerinde `flock` hemen başarır; tanıtıcı kilit dosyasını
 * göstermiyorsa reddedilir (başka bir dosyayı "kilitleyip" korumasız
 * çalışmamak için). Tanıtıcı açık değilse `flock` başarısız olur ve komut
 * çalışmaz.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CopyRejectedError } from "./copy-verification.ts";

export const DEFAULT_OPS_LOCK_WAIT_SECONDS = 900;
/** `flock -E`: kilit süresinde alınamadı (yedek birimiyle aynı kod). */
export const LOCK_BUSY_EXIT = 75;

type Env = Record<string, string | undefined>;

function lockWaitSeconds(env: Env): number {
  const raw = env.DOLMUS_OPS_LOCK_WAIT;
  if (raw === undefined || raw === "") return DEFAULT_OPS_LOCK_WAIT_SECONDS;
  const seconds = Number(raw);
  if (!/^\d+$/u.test(raw) || seconds > 3600) {
    throw new CopyRejectedError("usage", `DOLMUS_OPS_LOCK_WAIT 0–3600 arası tam saniye olmalı: "${raw}".`);
  }
  return seconds;
}

function openLockFile(lockPath: string, env: Env): { fd: number; inherited: boolean } {
  const raw = env.DOLMUS_OPS_LOCK_FD;
  if (raw === undefined || raw === "") {
    try {
      return { fd: fs.openSync(lockPath, "r"), inherited: false };
    } catch (error) {
      throw new CopyRejectedError("ops_lock_missing", error instanceof Error ? error.message : String(error));
    }
  }
  if (!/^\d+$/u.test(raw) || Number(raw) < 3) {
    throw new CopyRejectedError("usage", `DOLMUS_OPS_LOCK_FD 3 veya büyük bir tanıtıcı olmalı: "${raw}".`);
  }
  const fd = Number(raw);
  let held: fs.Stats;
  let file: fs.Stats;
  try {
    held = fs.fstatSync(fd);
    file = fs.statSync(lockPath);
  } catch (error) {
    throw new CopyRejectedError("ops_lock_unavailable", error instanceof Error ? error.message : String(error));
  }
  if (held.dev !== file.dev || held.ino !== file.ino) {
    throw new CopyRejectedError("ops_lock_unavailable", "Devralınan tanıtıcı ortak kilit dosyasını göstermiyor.", {
      fd,
    });
  }
  return { fd, inherited: true };
}

/**
 * Kilidi alır ve kilidi tutan tanıtıcıyı döndürür; çağıran işi bitince
 * `fs.closeSync` ile kapatır. Süresinde alınamazsa `ops_lock_busy`.
 */
export function acquireOpsLock(env: Env, defaultLockPath: string): number {
  const lockPath = path.resolve(env.DOLMUS_OPS_LOCK || defaultLockPath);
  const wait = lockWaitSeconds(env);
  const { fd, inherited } = openLockFile(lockPath, env);
  const result = spawnSync("flock", ["-w", String(wait), "-E", String(LOCK_BUSY_EXIT), "3"], {
    stdio: ["ignore", "ignore", "pipe", fd],
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    fs.closeSync(fd);
  }
  if (result.error) {
    throw new CopyRejectedError("ops_lock_unavailable", `flock çalıştırılamadı: ${result.error.message}`);
  }
  if (result.status === LOCK_BUSY_EXIT) {
    throw new CopyRejectedError(
      "ops_lock_busy",
      "Ortak işletim kilidi süresinde alınamadı; başka bir yayın/yedek/restore sürüyor.",
      { wait_seconds: wait },
    );
  }
  if (result.status !== 0) {
    throw new CopyRejectedError("ops_lock_unavailable", `flock başarısız (exit ${result.status}): ${result.stderr.trim()}`, {
      inherited,
    });
  }
  return fd;
}
