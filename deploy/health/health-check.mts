/**
 * Sağlık görevi (ARCHITECTURE §8.2): dolmus-takip-health.timer her 30 sn'de
 * bir kez çalıştırır. Yalnız `node:` yerleşikleri; /opt/dolmus-takip/current
 * veya uygulamanın node_modules'una bağlı DEĞİL. Root olarak çalışır, dış
 * komutlar `execFile` ile argüman dizisiyle çağrılır.
 *
 * HAZIRLANDI, gerçek sunucuda DENENMEDİ (manuel kurulumda denenecek).
 * docs/SERVER-SETUP.md.
 *
 * Paralel koşma engeli birim dosyasındaki `flock -n` sarmalayıcısıdır.
 * Elle çalıştırma da aynı sarmalayıcıyla yapılır (docs/OPS.md §5-B).
 * Kilit kaldırma ve systemd start sınırı sıfırlama BU GÖREVDE YOKTUR.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  decide,
  diskLevel,
  INITIAL_STATE,
  parseMemAvailablePercent,
  parseShow,
  restartNeedsLock,
  toUnitObservation,
  type HealthState,
  type UnitObservation,
} from "./health-decision.mts";

const run = promisify(execFile);

const SYSTEMCTL = "/usr/bin/systemctl";
const APP_UNIT = "dolmus-takip.service";
const CADDY_UNIT = "caddy.service";
const BASE = "http://127.0.0.1:3000";
const PROBE_TIMEOUT_MS = 3000;
// Uygulama birimi TimeoutStopSec (varsayılan 90 sn) + başlatma; sağlık
// birimindeki TimeoutStartSec bunun üstündedir.
const RESTART_TIMEOUT_MS = 200_000;

const DATA_DIR = "/var/lib/dolmus-takip/data";
const STATE_DIR = "/var/lib/dolmus-takip/health";
const STATE_FILE = path.join(STATE_DIR, "state.json");
const LOCK_FILE = path.join(STATE_DIR, "recovery.lock");
// Bakım işareti: kök sahipli; T6.5 bakım akışı oluşturur/kaldırır.
const MAINTENANCE_FILE = "/var/lib/dolmus-takip/maintenance";

type Level = "info" | "warn" | "err";
const PRIORITY: Record<Level, string> = { info: "<6>", warn: "<4>", err: "<3>" };

/** Tek satır logfmt; değerler güvenli karakter kümesine indirgenir. */
function log(level: Level, event: string, fields: Record<string, string | number | boolean> = {}): void {
  const kv = Object.entries(fields)
    .map(([k, v]) => `${k}=${String(v).replace(/[^A-Za-z0-9._:/@+-]/g, "_").slice(0, 120)}`)
    .join(" ");
  console.log(`${PRIORITY[level]}dolmus-health event=${event} ts=${new Date().toISOString()}${kv ? ` ${kv}` : ""}`);
}

function fsyncDir(dir: string): void {
  const fd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeTempFile(content: string): string {
  const tmpPath = path.join(STATE_DIR, `.tmp-${process.pid}-${Date.now()}`);
  const fd = fs.openSync(tmpPath, "wx", 0o600);
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return tmpPath;
}

/** temp + fsync + rename + dizin fsync: yarım yazım dosyayı bozmaz. */
function writeStateAtomic(state: HealthState): void {
  const tmpPath = writeTempFile(JSON.stringify({ v: 1, ...state }));
  fs.renameSync(tmpPath, STATE_FILE);
  fsyncDir(STATE_DIR);
}

/**
 * Kilidi kalıcı diske atomik yazar ve ASLA üzerine yazmaz (link EEXIST
 * verir). Süre dolması veya reboot kilidi kaldırmaz.
 */
function writeRecoveryLock(reason: string): void {
  const tmpPath = writeTempFile(
    `${JSON.stringify({ created_at: new Date().toISOString(), reason })}\n`,
  );
  try {
    fs.linkSync(tmpPath, LOCK_FILE);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  } finally {
    fs.unlinkSync(tmpPath);
  }
  fsyncDir(STATE_DIR);
}

function exists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

/** Dosya yoksa ilk koşu (başlangıç durumu); okunamaz/bozuksa corrupt. */
function loadState(): { state: HealthState; corrupt: boolean } {
  let raw: string;
  try {
    raw = fs.readFileSync(STATE_FILE, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { state: INITIAL_STATE, corrupt: false };
    }
    return { state: INITIAL_STATE, corrupt: true };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const p = parsed as Partial<HealthState> & { v?: number };
    if (
      p.v === 1 &&
      typeof p.consecutiveLiveFailures === "number" &&
      (p.appStartMs === null || typeof p.appStartMs === "number") &&
      Array.isArray(p.restartTimes) &&
      p.restartTimes.every((t) => typeof t === "number")
    ) {
      return {
        state: {
          consecutiveLiveFailures: p.consecutiveLiveFailures,
          appStartMs: p.appStartMs,
          restartTimes: p.restartTimes,
        },
        corrupt: false,
      };
    }
  } catch {
    // aşağıda corrupt
  }
  return { state: INITIAL_STATE, corrupt: true };
}

interface Probe {
  ok: boolean;
  status: number | null;
  ms: number;
  error: string;
}

async function probe(pathname: string): Promise<Probe> {
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}${pathname}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "manual",
    });
    await res.body?.cancel();
    return { ok: res.status === 200, status: res.status, ms: Math.round(performance.now() - started), error: "" };
  } catch (error) {
    return {
      ok: false,
      status: null,
      ms: Math.round(performance.now() - started),
      error: error instanceof Error ? error.name : "error",
    };
  }
}

async function showUnit(unit: string): Promise<UnitObservation> {
  const { stdout } = await run(
    SYSTEMCTL,
    ["show", unit, "-p", "ActiveState", "-p", "Result", "-p", "ActiveEnterTimestamp", "--timestamp=unix"],
    { timeout: 10_000 },
  );
  return toUnitObservation(parseShow(stdout));
}

function logMetrics(live: Probe, ready: Probe): void {
  let ram: number | string = "n/a";
  try {
    ram = parseMemAvailablePercent(fs.readFileSync("/proc/meminfo", "utf8")) ?? "n/a";
  } catch {
    // ölçüm alınamadı: "n/a"
  }
  let diskUsed: number | string = "n/a";
  let disk = "unknown";
  try {
    const s = fs.statfsSync(DATA_DIR);
    const used = Math.round((1 - s.bavail / s.blocks) * 100);
    diskUsed = used;
    disk = diskLevel(used);
  } catch {
    // ölçüm alınamadı
  }
  let walBytes: number | string = "n/a";
  try {
    walBytes = fs.statSync(path.join(DATA_DIR, "app.sqlite-wal")).size;
  } catch {
    walBytes = 0;
  }
  log(disk === "critical" ? "err" : disk === "warn" ? "warn" : "info", "metrics", {
    mem_available_pct: ram,
    disk_used_pct: diskUsed,
    disk_level: disk,
    wal_bytes: walBytes,
    live_ms: live.ms,
    ready_ms: ready.ms,
  });
}

async function main(): Promise<void> {
  const nowMs = Date.now();
  const { state: previous, corrupt } = loadState();
  if (corrupt) {
    log("err", "state_unreadable", { action: "no-restart", file: STATE_FILE });
  }

  const [app, caddy, live, ready] = await Promise.all([
    showUnit(APP_UNIT),
    showUnit(CADDY_UNIT),
    probe("/api/v1/health/live"),
    probe("/api/v1/health/ready"),
  ]);
  const maintenance = exists(MAINTENANCE_FILE);
  const lockPresent = exists(LOCK_FILE);

  logMetrics(live, ready);
  log(live.ok && ready.ok ? "info" : "warn", "probe", {
    live: live.status ?? live.error,
    ready: ready.status ?? ready.error,
    app: app.activeState,
    caddy: caddy.activeState,
    maintenance,
    lock: lockPresent,
  });

  let decision = decide(previous, {
    nowMs,
    live: live.ok,
    ready: ready.ok,
    app,
    caddy,
    maintenance,
    lockPresent,
  });
  // Bozuk durum dosyası bütçeyi bilinmez kılar: restart yok, dosya ezilmez.
  if (corrupt && decision.action === "restart") {
    decision = { ...decision, action: "none", reason: "state-unreadable" };
  }
  if (!corrupt) writeStateAtomic(decision.state);

  log(decision.action === "none" ? "info" : "warn", "decision", {
    action: decision.action,
    reason: decision.reason,
    consecutive_live_failures: decision.state.consecutiveLiveFailures,
  });

  if (decision.action === "write-lock") {
    writeRecoveryLock(decision.lockReason ?? decision.reason);
    log("err", "recovery_lock_written", { reason: decision.lockReason ?? decision.reason, path: LOCK_FILE });
    return;
  }

  if (decision.action === "restart") {
    log("warn", "corrective_restart", { unit: APP_UNIT });
    try {
      await run(SYSTEMCTL, ["restart", APP_UNIT], { timeout: RESTART_TIMEOUT_MS });
      log("info", "corrective_restart_done", { unit: APP_UNIT });
    } catch (error) {
      const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
      const after = await showUnit(APP_UNIT).catch(() => null);
      log("err", "corrective_restart_failed", {
        unit: APP_UNIT,
        result: after?.result ?? "unknown",
        message: stderr.trim().split("\n")[0] ?? "",
      });
      // Tekrar denenmez; start sınırı = bütçe aşıldı.
      if (restartNeedsLock(stderr, after?.result ?? "")) {
        writeRecoveryLock("start-limit-hit:dolmus-takip");
        log("err", "recovery_lock_written", { reason: "start-limit-hit:dolmus-takip", path: LOCK_FILE });
      }
    }
  }
}

main().catch((error: unknown) => {
  log("err", "health_task_failed", { error: error instanceof Error ? error.name : "error" });
  process.exitCode = 1;
});
