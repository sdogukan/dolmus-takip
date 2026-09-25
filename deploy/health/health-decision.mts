/**
 * Sağlık görevinin SAF karar modülü. G/Ç yok: tüm girdi `Observation` ve
 * önceki `HealthState`, çıktı `Decision`. Görev her 30 sn'de
 * yeni bir süreç olduğundan sayaçlar ve restart zamanları `HealthState`'te
 * taşınır ve çağıran tarafından kalıcı dosyaya yazılır.
 *
 * HAZIRLANDI, gerçek sunucuda DENENMEDİ (manuel kurulumda denenecek).
 *
 * Bilerek YOK: kurtarma kilidini kaldırma ve systemd start sınırını sıfırlama.
 * `Action` bu iki eylemi taşımaz; bunlar yalnız ekibin elle yaptığı işlerdir.
 */

/** Başlangıçtan sonra karar verilmeyen tolerans süresi. */
export const GRACE_MS = 90_000;
/** Restart için gereken ardışık canlılık başarısızlığı. */
export const FAILURE_THRESHOLD = 3;
/** Pencere içinde izin verilen düzeltici restart sayısı. */
export const MAX_RESTARTS = 2;
export const RESTART_WINDOW_MS = 15 * 60_000;

export interface HealthState {
  consecutiveLiveFailures: number;
  /** Uygulama biriminin son görülen ActiveEnter zamanı (epoch ms). */
  appStartMs: number | null;
  /** Son düzeltici restart zamanları (epoch ms). */
  restartTimes: number[];
}

export const INITIAL_STATE: HealthState = {
  consecutiveLiveFailures: 0,
  appStartMs: null,
  restartTimes: [],
};

export interface UnitObservation {
  activeState: string;
  /** systemd `Result` özelliği; start sınırında "start-limit-hit". */
  result: string;
  startedAtMs: number | null;
}

export interface Observation {
  nowMs: number;
  live: boolean;
  ready: boolean;
  app: UnitObservation;
  caddy: UnitObservation;
  maintenance: boolean;
  lockPresent: boolean;
}

export type Action = "none" | "restart" | "write-lock";

export interface Decision {
  action: Action;
  reason: string;
  /** Yalnız action=write-lock iken. */
  lockReason?: string;
  state: HealthState;
}

export function decide(previous: HealthState, obs: Observation): Decision {
  const { nowMs, app } = obs;

  // Start sınırı, kilit yoksa her koşulda kilit yazdırır: sınır systemd'nin
  // kendi hükmüdür ve otomatik sıfırlanmaz (bakım işaretinden bağımsız).
  const limited =
    app.result === "start-limit-hit"
      ? "dolmus-takip"
      : obs.caddy.result === "start-limit-hit"
        ? "caddy"
        : null;
  if (limited !== null && !obs.lockPresent) {
    return {
      action: "write-lock",
      reason: "start-limit-hit",
      lockReason: `start-limit-hit:${limited}`,
      state: previous,
    };
  }

  // Yeniden başlamış birimde önceki başarısızlıklar taşınmaz.
  const restarted = app.startedAtMs !== previous.appStartMs;
  const tracked: HealthState = {
    ...previous,
    appStartMs: app.startedAtMs,
    consecutiveLiveFailures: restarted ? 0 : previous.consecutiveLiveFailures,
  };
  const idle = (reason: string): Decision => ({
    action: "none",
    reason,
    state: { ...tracked, consecutiveLiveFailures: 0 },
  });

  if (obs.lockPresent) return idle("recovery-lock");
  if (obs.maintenance) return idle("maintenance");
  if (app.activeState !== "active") return idle(`unit-${app.activeState}`);
  if (app.startedAtMs === null) return idle("start-time-unknown");
  if (nowMs - app.startedAtMs < GRACE_MS) return idle("start-grace");

  if (obs.live) {
    return {
      action: "none",
      reason: obs.ready ? "healthy" : "ready-failing-live-ok",
      state: { ...tracked, consecutiveLiveFailures: 0 },
    };
  }

  const failures = tracked.consecutiveLiveFailures + 1;
  if (failures < FAILURE_THRESHOLD) {
    return {
      action: "none",
      reason: "live-failing",
      state: { ...tracked, consecutiveLiveFailures: failures },
    };
  }

  // Gelecekteki zaman damgası (saat geri gitti) pencerede sayılır: bütçe
  // yanlışlıkla genişlemez.
  const recent = tracked.restartTimes.filter((t) => nowMs - t < RESTART_WINDOW_MS);
  if (recent.length >= MAX_RESTARTS) {
    return {
      action: "write-lock",
      reason: "restart-budget-exceeded",
      lockReason: "restart-budget-exceeded",
      state: { ...tracked, consecutiveLiveFailures: failures, restartTimes: recent },
    };
  }
  return {
    action: "restart",
    reason: "live-failed-3x",
    state: {
      ...tracked,
      consecutiveLiveFailures: 0,
      restartTimes: [...recent, nowMs],
    },
  };
}

/**
 * Düzeltici `systemctl restart` başarısız olduysa: start sınırına takıldıysa
 * bütçe aşılmıştır (kilit yazılır); başka her hata yalnız loglanır, tekrar
 * denenmez.
 */
export function restartNeedsLock(stderr: string, resultAfter: string): boolean {
  return (
    resultAfter === "start-limit-hit" ||
    /start request repeated too quickly|start-limit/i.test(stderr)
  );
}

/** `systemctl show` çıktısı (`Key=Value` satırları). */
export function parseShow(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1).trim();
  }
  return out;
}

/** `--timestamp=unix` çıktısı "@<sn>" biçimindedir; boş/"n/a" → null. */
export function parseUnixTimestampMs(value: string | undefined): number | null {
  const match = /^@(\d+)/.exec(value ?? "");
  return match ? Number(match[1]) * 1000 : null;
}

export function toUnitObservation(props: Record<string, string>): UnitObservation {
  return {
    activeState: props.ActiveState ?? "unknown",
    result: props.Result ?? "unknown",
    startedAtMs: parseUnixTimestampMs(props.ActiveEnterTimestamp),
  };
}

export function parseMemAvailablePercent(meminfo: string): number | null {
  const total = /^MemTotal:\s+(\d+) kB/m.exec(meminfo);
  const avail = /^MemAvailable:\s+(\d+) kB/m.exec(meminfo);
  if (!total || !avail || Number(total[1]) === 0) return null;
  return Math.round((Number(avail[1]) / Number(total[1])) * 100);
}

/** Başlangıç eşikleri: %80 uyarı, %90 kritik. */
export function diskLevel(usedPercent: number): "ok" | "warn" | "critical" {
  if (usedPercent >= 90) return "critical";
  if (usedPercent >= 80) return "warn";
  return "ok";
}
