import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "../../src/instrumentation";
import { getAppDb, resetAppDbForTests } from "../../src/server/data/app-db";
import {
  createDb,
  openDatabaseConnection,
  takeWriteTransactionStats,
  withImmediateTransaction,
} from "../../src/server/data/db";
import { resetTrustedAppOriginForTests } from "../../src/server/auth/app-origin";
import {
  resetHashQueueForTests,
  runInHashQueue,
  takeHashQueueIntervalStats,
} from "../../src/server/auth/hash-queue";
import {
  RUNTIME_METRICS_INTERVAL_MS,
  stopRuntimeMetricsForTests,
} from "../../src/server/observability/runtime-metrics";

/**
 * `register()` → çalışma zamanı metrik satırı. Gerçek, migrate edilmiş geçici
 * SQLite dosyası; yalnız `setInterval` sahte zamanlayıcıyla
 * ilerletilir.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");

describe("instrumentation register() — runtime_metrics satırı", () => {
  let dir: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;
  const originalAppOrigin = process.env.APP_ORIGIN;
  const originalRuntime = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-runtime-metrics-"));
    const dbPath = path.join(dir, "test.sqlite");
    const setupSqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    migrate(createDb(setupSqlite), { migrationsFolder });
    setupSqlite.close();

    process.env.DOLMUS_DB_PATH = dbPath;
    process.env.APP_ORIGIN = "https://example.invalid";
    process.env.NEXT_RUNTIME = "nodejs";
    resetAppDbForTests();
    resetTrustedAppOriginForTests();
    resetHashQueueForTests();
    // Kurulumun (migration) kayıtları ölçülen aralığa taşınmasın.
    takeWriteTransactionStats();
    takeHashQueueIntervalStats();
  });

  afterEach(() => {
    stopRuntimeMetricsForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetAppDbForTests();
    resetHashQueueForTests();
    for (const [key, value] of [
      ["DOLMUS_DB_PATH", originalDbPath],
      ["APP_ORIGIN", originalAppOrigin],
      ["NEXT_RUNTIME", originalRuntime],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetTrustedAppOriginForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("iki register() çağrısında 60 sn'de tek satır yazar; satır aralığın sayaçlarını taşır ve sonra sıfırlanır", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await register();
    await register();

    const sqlite = getAppDb().$client;
    withImmediateTransaction(sqlite, () => undefined);
    withImmediateTransaction(sqlite, () => undefined);
    await runInHashQueue(async () => true);

    vi.advanceTimersByTime(RUNTIME_METRICS_INTERVAL_MS);
    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^<6>dolmus-runtime event=runtime_metrics ts=\S+ /);
    expect(lines[0]).toContain(" tx_count=2 ");
    expect(lines[0]).toContain(" tx_lock_failures=0 ");
    expect(lines[0]).toContain(" hash_verifications=1 ");
    for (const key of ["el_p50_ms", "el_p99_ms", "el_max_ms", "rss_bytes", "heap_used_bytes", "cpu_user_ms", "cpu_system_ms", "tx_p99_ms", "tx_max_ms", "hash_max_pending", "hash_longest_wait_ms"]) {
      expect(lines[0]).toMatch(new RegExp(` ${key}=\\d+(\\.\\d+)?( |$)`));
    }

    vi.advanceTimersByTime(RUNTIME_METRICS_INTERVAL_MS);
    const second = log.mock.calls.map(([line]) => String(line));
    expect(second).toHaveLength(2);
    expect(second[1]).toContain(" tx_count=0 ");
    expect(second[1]).toContain(" hash_verifications=0 ");
  });
});
