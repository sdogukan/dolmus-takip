import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { LoadRunUsageError, parseLoadRunArgs } from "../../scripts/load-run.ts";

/**
 * `scripts/load-run.ts` argümanları (S6.6): varsayılan aşama süreleri mimari
 * önerisidir (5 dk ısınma, 5 dk artış, 30 dk sürdürülen); istemci zaman aşımı
 * sunucunun en uzun meşru beklemesinden (hash kuyruğu 10 sn + busy_timeout
 * 2 sn) kısa olamaz, yoksa kuyruk beklemesi kayıp gibi görünür.
 */

const required = [
  "--scenario", "active-mix",
  "--target", "https://dolmus.example.com/some/path",
  "--credentials", "/secure/creds.json",
  "--dataset", "/data/load.sqlite.counts.json",
  "--release-manifest", "/dist/x.manifest.json",
  "--out", "/reports",
];

describe("parseLoadRunArgs", () => {
  test("varsayılanlar: 300/300/1800 sn, 100 kullanıcı, 20 sn zaman aşımı, Origin hedefin origin'i", () => {
    const config = parseLoadRunArgs(required);
    expect(config).toMatchObject({
      scenario: "active-mix",
      targetUrl: "https://dolmus.example.com",
      origin: "https://dolmus.example.com",
      warmupSeconds: 300,
      rampSeconds: 300,
      sustainSeconds: 1800,
      users: 100,
      timeoutMs: 20_000,
      windowMonth: null,
    });
  });

  test("aşama süreleri ve Origin ayarlanabilir", () => {
    const config = parseLoadRunArgs([...required, "--warmup", "60", "--ramp", "0", "--sustain", "120", "--origin", "https://app.example.com/"]);
    expect(config).toMatchObject({ warmupSeconds: 60, rampSeconds: 0, sustainSeconds: 120, origin: "https://app.example.com" });
  });

  test("dalga varsayılanları senaryoya göre", () => {
    const burst = parseLoadRunArgs(required.map((v) => (v === "active-mix" ? "login-burst" : v)));
    expect(burst).toMatchObject({ waveIntervalSeconds: 60, waveSpreadSeconds: 10 });
    const peak = parseLoadRunArgs(required.map((v) => (v === "active-mix" ? "write-peak" : v)));
    expect(peak).toMatchObject({ waveIntervalSeconds: 30, waveSpreadSeconds: 1 });
  });

  test("zaman aşımı 12 sn ve altı reddedilir", () => {
    expect(() => parseLoadRunArgs([...required, "--timeout-ms", "12000"])).toThrow(LoadRunUsageError);
    expect(parseLoadRunArgs([...required, "--timeout-ms", "12001"]).timeoutMs).toBe(12_001);
  });

  test("bilinmeyen senaryo, eksik zorunlu argüman, bilinmeyen bayrak ve sıfır sürdürülen yük reddedilir", () => {
    expect(() => parseLoadRunArgs(required.map((v) => (v === "active-mix" ? "soak" : v)))).toThrow(/--scenario/u);
    expect(() => parseLoadRunArgs(required.slice(2))).toThrow(/--scenario/u);
    expect(() => parseLoadRunArgs([...required, "--spoof-ip", "1.2.3.4"])).toThrow(/Bilinmeyen/u);
    expect(() => parseLoadRunArgs([...required, "--sustain", "0"])).toThrow(LoadRunUsageError);
    expect(() => parseLoadRunArgs([...required, "--window-month", "2026-13"])).toThrow(LoadRunUsageError);
    expect(() => parseLoadRunArgs([...required, "--wave-interval", "5", "--wave-spread", "5"])).toThrow(LoadRunUsageError);
  });
});

describe("yük komutları rutin paketlerin dışında", () => {
  test("load:seed ve load:run var; ci-steps.json, CI iş akışları ve test:* komutları onları çalıştırmaz", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts["load:seed"]).toMatch(/scripts\/load-seed\.ts/u);
    expect(scripts["load:run"]).toMatch(/scripts\/load-run\.ts/u);
    for (const name of ["test:unit", "test:integration", "test:release", "test:e2e", "ci:local"]) {
      expect(scripts[name]).not.toMatch(/load[:-](seed|run)/u);
    }
    const ciInputs = [
      path.join(root, "scripts", "ci-steps.json"),
      ...fs.readdirSync(path.join(root, ".github", "workflows")).map((f) => path.join(root, ".github", "workflows", f)),
    ];
    for (const file of ciInputs) expect(fs.readFileSync(file, "utf8")).not.toMatch(/load[:-](seed|run)/u);
  });
});
