import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  decide,
  diskLevel,
  FAILURE_THRESHOLD,
  GRACE_MS,
  INITIAL_STATE,
  MAX_RESTARTS,
  parseMemAvailablePercent,
  parseShow,
  parseUnixTimestampMs,
  RESTART_WINDOW_MS,
  restartNeedsLock,
  toUnitObservation,
  type HealthState,
  type Observation,
  type UnitObservation,
} from "../../deploy/health/health-decision.mts";

/**
 * Sağlık görevinin saf karar modülü (ARCHITECTURE §8.2). Gerçek systemd/HTTP
 * yok; yalnız karar tablosu. Gerçek davranış SERVER-SETUP §5 satır 10–16'da
 * elle kurulumda doğrulanır.
 */

const START = 1_000_000_000_000;
const NOW = START + GRACE_MS + 60_000; // tolerans dolmuş

const running: UnitObservation = { activeState: "active", result: "success", startedAtMs: START };
const caddyOk: UnitObservation = { activeState: "active", result: "success", startedAtMs: START };

function obs(over: Partial<Observation> = {}): Observation {
  return {
    nowMs: NOW,
    live: true,
    ready: true,
    app: running,
    caddy: caddyOk,
    maintenance: false,
    lockPresent: false,
    ...over,
  };
}

function state(over: Partial<HealthState> = {}): HealthState {
  return { ...INITIAL_STATE, appStartMs: START, ...over };
}

/** Ardışık başarısız koşular; durum bir koşudan ötekine taşınır. */
function failRuns(count: number, from: HealthState, over: Partial<Observation> = {}) {
  let s = from;
  let last = decide(s, obs({ live: false, ...over }));
  s = last.state;
  for (let i = 1; i < count; i++) {
    last = decide(s, obs({ live: false, nowMs: (over.nowMs ?? NOW) + i * 30_000, ...over }));
    s = last.state;
  }
  return last;
}

describe("decide — restart kararı", () => {
  test("90 sn tolerans içinde hiç eylem yok ve sayaç işlemez", () => {
    const inGrace = obs({ live: false, nowMs: START + GRACE_MS - 1 });
    const d = decide(state({ consecutiveLiveFailures: 2 }), inGrace);
    expect(d.action).toBe("none");
    expect(d.reason).toBe("start-grace");
    expect(d.state.consecutiveLiveFailures).toBe(0);
  });

  test("tolerans sınırında (tam 90 sn) kontrol başlar", () => {
    const d = decide(state(), obs({ live: false, nowMs: START + GRACE_MS }));
    expect(d.reason).toBe("live-failing");
    expect(d.state.consecutiveLiveFailures).toBe(1);
  });

  test("ilk iki başarısızlıkta restart yok, üçüncüde tek restart", () => {
    let s = state();
    for (let i = 1; i < FAILURE_THRESHOLD; i++) {
      const d = decide(s, obs({ live: false, nowMs: NOW + i * 30_000 }));
      expect(d.action).toBe("none");
      expect(d.state.consecutiveLiveFailures).toBe(i);
      s = d.state;
    }
    const third = decide(s, obs({ live: false, nowMs: NOW + 90_000 }));
    expect(third.action).toBe("restart");
    expect(third.state.restartTimes).toEqual([NOW + 90_000]);
    expect(third.state.consecutiveLiveFailures).toBe(0);
  });

  test("başarılı canlılık sayacı sıfırlar; kesintili başarısızlıklar restart üretmez", () => {
    const failing = decide(state(), obs({ live: false }));
    const ok = decide(failing.state, obs({ live: true }));
    expect(ok.state.consecutiveLiveFailures).toBe(0);
    expect(decide(ok.state, obs({ live: false })).action).toBe("none");
  });

  test("birim yeniden başlamışsa (başlangıç zamanı değişti) önceki başarısızlıklar taşınmaz", () => {
    const restarted: UnitObservation = { ...running, startedAtMs: START + 5_000 };
    const d = decide(
      state({ consecutiveLiveFailures: 2 }),
      obs({ live: false, app: restarted, nowMs: START + 5_000 + GRACE_MS + 1 }),
    );
    expect(d.action).toBe("none");
    expect(d.state.consecutiveLiveFailures).toBe(1);
    expect(d.state.appStartMs).toBe(START + 5_000);
  });

  test.each(["activating", "auto-restart", "failed", "inactive", "deactivating"])(
    "birim %s iken üç hata bile restart üretmez",
    (activeState) => {
      const d = decide(
        state({ consecutiveLiveFailures: 5 }),
        obs({ live: false, app: { ...running, activeState } }),
      );
      expect(d.action).toBe("none");
      expect(d.state.consecutiveLiveFailures).toBe(0);
    },
  );

  test("başlangıç zamanı bilinmiyorsa eylem yok (güvenli taraf)", () => {
    const d = decide(state({ appStartMs: null }), obs({ live: false, app: { ...running, startedAtMs: null } }));
    expect(d.action).toBe("none");
    expect(d.reason).toBe("start-time-unknown");
  });
});

describe("decide — bakım işareti, kilit ve ready", () => {
  const due = state({ consecutiveLiveFailures: FAILURE_THRESHOLD - 1 });

  test("bakım işareti varken restart yok", () => {
    const d = decide(due, obs({ live: false, maintenance: true }));
    expect(d.action).toBe("none");
    expect(d.reason).toBe("maintenance");
    expect(d.state.consecutiveLiveFailures).toBe(0);
  });

  test("kurtarma kilidi varken restart yok", () => {
    const d = decide(due, obs({ live: false, lockPresent: true }));
    expect(d.action).toBe("none");
    expect(d.reason).toBe("recovery-lock");
  });

  test("kilit varken bütçe dolu olsa da yeni kilit yazılmaz", () => {
    const full = state({
      consecutiveLiveFailures: FAILURE_THRESHOLD - 1,
      restartTimes: [NOW - 1000, NOW - 2000],
    });
    expect(decide(full, obs({ live: false, lockPresent: true })).action).toBe("none");
  });

  test("ready hatası + live OK asla restart üretmez (tekrarlı koşularda da)", () => {
    let s = state({ consecutiveLiveFailures: 2 });
    for (let i = 0; i < 20; i++) {
      const d = decide(s, obs({ live: true, ready: false, nowMs: NOW + i * 30_000 }));
      expect(d.action).toBe("none");
      expect(d.reason).toBe("ready-failing-live-ok");
      expect(d.state.consecutiveLiveFailures).toBe(0);
      s = d.state;
    }
  });
});

describe("decide — restart bütçesi ve start sınırı", () => {
  test(`15 dk içinde en çok ${MAX_RESTARTS} restart; sıradaki ihtiyaç kilit yazar`, () => {
    const first = failRuns(FAILURE_THRESHOLD, state());
    expect(first.action).toBe("restart");

    // Restart sonrası yeni başlangıç zamanı; tolerans sonrası tekrar donma.
    const t1 = NOW + 5 * 60_000;
    const second = failRuns(
      FAILURE_THRESHOLD,
      { ...first.state, appStartMs: t1 - GRACE_MS - 1 },
      { nowMs: t1, app: { ...running, startedAtMs: t1 - GRACE_MS - 1 } },
    );
    expect(second.action).toBe("restart");
    expect(second.state.restartTimes).toHaveLength(2);

    const t2 = t1 + 5 * 60_000;
    const third = failRuns(
      FAILURE_THRESHOLD,
      { ...second.state, appStartMs: t2 - GRACE_MS - 1 },
      { nowMs: t2, app: { ...running, startedAtMs: t2 - GRACE_MS - 1 } },
    );
    expect(third.action).toBe("write-lock");
    expect(third.lockReason).toBe("restart-budget-exceeded");
    expect(third.state.restartTimes).toHaveLength(2);
  });

  test("pencere dışına düşen restart bütçeden düşer", () => {
    const old = state({
      consecutiveLiveFailures: FAILURE_THRESHOLD - 1,
      restartTimes: [NOW - RESTART_WINDOW_MS - 1, NOW - 1000],
    });
    const d = decide(old, obs({ live: false }));
    expect(d.action).toBe("restart");
    expect(d.state.restartTimes).toEqual([NOW - 1000, NOW]);
  });

  test("gelecekteki zaman damgası (saat geri gitti) pencerede sayılır", () => {
    const skewed = state({
      consecutiveLiveFailures: FAILURE_THRESHOLD - 1,
      restartTimes: [NOW + 10 * 60_000, NOW + 11 * 60_000],
    });
    expect(decide(skewed, obs({ live: false })).action).toBe("write-lock");
  });

  test.each([
    ["dolmus-takip", { app: { ...running, activeState: "failed", result: "start-limit-hit" } }],
    ["caddy", { caddy: { ...caddyOk, activeState: "failed", result: "start-limit-hit" } }],
  ] as const)("%s start-limit-hit kilit yazar", (unit, over) => {
    const d = decide(state(), obs({ ...over }));
    expect(d.action).toBe("write-lock");
    expect(d.lockReason).toBe(`start-limit-hit:${unit}`);
  });

  test("start-limit-hit bakım işaretinden bağımsız kilit yazar; kilit varsa tekrar yazmaz", () => {
    const limited = { app: { ...running, activeState: "failed", result: "start-limit-hit" } };
    expect(decide(state(), obs({ ...limited, maintenance: true })).action).toBe("write-lock");
    expect(decide(state(), obs({ ...limited, lockPresent: true })).action).toBe("none");
  });
});

describe("decide — kilit ve start sınırı asla otomatik kaldırılmaz", () => {
  test("hiçbir girdi kombinasyonu restart/write-lock dışında eylem üretmez", () => {
    const actions = new Set<string>();
    for (const live of [true, false])
      for (const ready of [true, false])
        for (const maintenance of [true, false])
          for (const lockPresent of [true, false])
            for (const activeState of ["active", "failed", "activating"])
              for (const result of ["success", "start-limit-hit"]) {
                const d = decide(
                  state({ consecutiveLiveFailures: 2 }),
                  obs({ live, ready, maintenance, lockPresent, app: { ...running, activeState, result } }),
                );
                actions.add(d.action);
              }
    expect([...actions].sort()).toEqual(["none", "restart", "write-lock"]);
  });

  test("görev kaynağında kilit silme veya start sınırı sıfırlama yok", () => {
    const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "deploy", "health");
    for (const file of ["health-check.mts", "health-decision.mts"]) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      expect(source, file).not.toContain("reset-failed");
      expect(source, file).not.toContain("resetFailed");
      expect(source, file).not.toMatch(/\brmSync\b|\brmdirSync\b|\bfs\.rm\b/);
      // Tek unlink: kilit yazımının geçici dosyası.
      for (const call of source.match(/unlinkSync\([^)]*\)/g) ?? []) {
        expect(call, file).toBe("unlinkSync(tmpPath)");
      }
    }
  });
});

describe("restartNeedsLock", () => {
  test("start sınırı hatası bütçe aşımıdır", () => {
    expect(restartNeedsLock("Job failed: Start request repeated too quickly.", "")).toBe(true);
    expect(restartNeedsLock("", "start-limit-hit")).toBe(true);
  });
  test("başka hata kilit yazdırmaz", () => {
    expect(restartNeedsLock("Failed to restart: Connection timed out", "timeout")).toBe(false);
    expect(restartNeedsLock("", "")).toBe(false);
  });
});

describe("systemctl çıktısı ve ölçüm yardımcıları", () => {
  test("parseShow + toUnitObservation", () => {
    const props = parseShow("ActiveState=active\nResult=success\nActiveEnterTimestamp=@1758712800\n");
    expect(toUnitObservation(props)).toEqual({
      activeState: "active",
      result: "success",
      startedAtMs: 1758712800_000,
    });
  });
  test("eksik özellikler güvenli varsayılan: unknown/null", () => {
    expect(toUnitObservation({})).toEqual({ activeState: "unknown", result: "unknown", startedAtMs: null });
  });
  test.each([["", null], ["n/a", null], [undefined, null], ["@0", 0], ["@12", 12_000]])(
    "parseUnixTimestampMs(%j)",
    (input, expected) => {
      expect(parseUnixTimestampMs(input)).toBe(expected);
    },
  );
  test("MemAvailable yüzdesi", () => {
    expect(parseMemAvailablePercent("MemTotal:  2000000 kB\nMemAvailable:  500000 kB\n")).toBe(25);
    expect(parseMemAvailablePercent("nonsense")).toBeNull();
    expect(parseMemAvailablePercent("MemTotal: 0 kB\nMemAvailable: 0 kB\n")).toBeNull();
  });
  test("disk eşikleri %80 uyarı, %90 kritik", () => {
    expect(diskLevel(79)).toBe("ok");
    expect(diskLevel(80)).toBe("warn");
    expect(diskLevel(89)).toBe("warn");
    expect(diskLevel(90)).toBe("critical");
  });
});
