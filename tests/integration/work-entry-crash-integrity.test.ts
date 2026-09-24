/**
 * Süreç ölümünde iş kaydı bütünlüğü (S6.6 veri bütünlüğü kabulü). Gerçek
 * geçici SQLite dosyası + gerçek migration + seed; her işlem
 * (`create` / `confirm` / `correct_and_confirm`) ayrı bir çocuk süreçte
 * GERÇEK use case ile çalışır ve SIGKILL ile öldürülür:
 *
 * - açık BEGIN IMMEDIATE transaction'ın içinde (makbuz INSERT'inden sonra,
 *   COMMIT'ten önce; bkz. `./work-entry-crash-child.ts`) → yazılan hiçbir
 *   satır kalmaz, eski tam durum;
 * - COMMIT'ten sonra → yeni tam durum (kayıt, revizyon, onay, makbuz birlikte).
 *
 * Her ölümden sonra `integrity:check` geçer; aynı `requestId` + aynı gövdeyle
 * yeniden deneme tam olarak bir kayıt/onay bırakır (ilk durumda ilk yazım,
 * ikincide replay).
 *
 * Çocuk durma noktasında üst sürece satır yazıp senkron bekler; SIGKILL o
 * satırdan SONRA gönderilir (uyku yarışı yok). Her çocuk kendi geçici DB'sini
 * kullanır; kalan çocuklar `afterEach`'te öldürülür, dosya kilidi sonraki
 * testlere taşınmaz.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS } from "../../scripts/db-seed-dev";
import { istanbulToday } from "../../src/lib/work-time";
import { createDb, openDatabaseConnection, type SqliteConnection } from "../../src/server/data/db";
import type { SessionContext } from "../../src/server/usecases/session/types";
import { createVehicleSession } from "../../src/server/usecases/session/create-vehicle-session";
import { CRASH_POINT_PREFIX, runCrashRequest, type CrashRequest, type KillPoint } from "./work-entry-crash-child";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const CHILD = path.join("tests", "integration", "work-entry-crash-child.ts");
const WRITE_TABLES = ["work_entries", "work_entry_revisions", "cash_confirmations", "mutation_receipts", "admin_audit"] as const;
const MARKER_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 60_000;

const daily = (grossCents = "1000000") => ({
  date: istanbulToday(),
  startTime: "08:00",
  endTime: "17:30",
  endsNextDay: false,
  grossCents,
  fuelCents: "150000",
  otherExpenseCents: "30000",
  otherExpenseNote: "otopark",
});

describe("iş kaydı yazımı süreç ölümünde bütün kalır (SIGKILL)", () => {
  let templateDir: string;
  let templatePath: string;
  let owner: SessionContext;
  let driver: SessionContext;
  let dir: string;
  let dbPath: string;
  const children = new Set<ChildProcess>();

  beforeAll(async () => {
    templateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-crash-template-"));
    templatePath = path.join(templateDir, "template.sqlite");
    const setup = openDatabaseConnection(templatePath, { createIfMissing: true });
    migrate(createDb(setup), { migrationsFolder });
    await seedDevData(setup);
    owner = (await createVehicleSession(createDb(setup), SEED_IDS.credA1Owner)).context;
    driver = (await createVehicleSession(createDb(setup), SEED_IDS.credA1Driver)).context;
    setup.close();
    // Son bağlantı kapanınca WAL ana dosyaya aktarılır; kopya tek dosyadır.
    expect(fs.existsSync(`${templatePath}-wal`)).toBe(false);
  });

  afterAll(() => {
    fs.rmSync(templateDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-crash-"));
    dbPath = path.join(dir, "test.sqlite");
    fs.copyFileSync(templatePath, dbPath);
  });

  afterEach(async () => {
    const alive = [...children].filter((child) => child.exitCode === null && child.signalCode === null);
    await Promise.all(
      alive.map(
        (child) =>
          new Promise<void>((resolve) => {
            child.once("close", () => resolve());
            child.kill("SIGKILL");
          }),
      ),
    );
    children.clear();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function withRaw<T>(fn: (sqlite: SqliteConnection) => T): T {
    const sqlite = openDatabaseConnection(dbPath);
    try {
      return fn(sqlite);
    } finally {
      sqlite.close();
    }
  }

  const rows = (sql: string, ...args: unknown[]) =>
    withRaw((sqlite) => sqlite.prepare(sql).all(...args)) as Record<string, unknown>[];

  const dump = () =>
    withRaw((sqlite) =>
      Object.fromEntries(WRITE_TABLES.map((table) => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])),
    );

  /** Üst süreçte aynı use case çağrısı (hazırlık ve yeniden deneme). */
  function runInProcess(request: CrashRequest) {
    return withRaw((sqlite) => runCrashRequest(createDb(sqlite), request));
  }

  /** Çocuğu başlatır, durma satırını bekler, SIGKILL gönderir; satırın alanlarını döner. */
  function killAt(killPoint: KillPoint, request: CrashRequest): Promise<Record<string, string>> {
    const child = spawn(
      process.execPath,
      ["--import", "./scripts/lib/ts-resolver.mjs", CHILD, dbPath, killPoint, JSON.stringify(request)],
      { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    children.add(child);
    let stdout = "";
    let stderr = "";
    let marker: string | undefined;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Durma satırı ${MARKER_TIMEOUT_MS} ms içinde gelmedi. stderr: ${stderr}`));
      }, MARKER_TIMEOUT_MS);
      child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        const line = stdout.split("\n").find((candidate) => candidate.startsWith(`${CRASH_POINT_PREFIX} `));
        if (line !== undefined && marker === undefined) {
          marker = line;
          child.kill("SIGKILL");
        }
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (marker === undefined || signal !== "SIGKILL") {
          reject(new Error(`Çocuk durma noktasından önce bitti (code=${code}, signal=${signal}). stderr: ${stderr}`));
          return;
        }
        resolve(Object.fromEntries(marker.split(" ").slice(1).map((pair) => pair.split("=") as [string, string])));
      });
    });
  }

  function expectIntegrityPasses(): void {
    const result = spawnSync(process.execPath, ["scripts/integrity-check.ts", dbPath], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    expect(result.stdout).toMatch(/ event=integrity_passed .* failed_checks=0 /u);
    expect(result.status).toBe(0);
  }

  const revisionsOf = (entryId: string) =>
    rows("SELECT version, action FROM work_entry_revisions WHERE entry_id = ? ORDER BY version", entryId);
  const confirmationsOf = (entryId: string) =>
    rows("SELECT entry_version, received_cents FROM cash_confirmations WHERE entry_id = ? ORDER BY entry_version", entryId);
  const receiptsOf = (requestId: string) =>
    rows("SELECT operation, entity_id, result_version, response_code FROM mutation_receipts WHERE request_id = ?", requestId);
  const entryOf = (entryId: string) =>
    rows("SELECT status, version, gross_cents FROM work_entries WHERE id = ?", entryId);
  const entryCount = () => rows("SELECT COUNT(*) AS n FROM work_entries")[0]!.n as number;

  /** Şoför kaydı oluşturur (sürüm 1, onay bekliyor). */
  function createPendingEntry(): string {
    const created = runInProcess({
      operation: "create",
      context: driver,
      requestId: "hazirlik-olustur",
      body: { workType: "driver", workerPersonId: SEED_IDS.driverA1a, ...daily() },
    });
    if (!created.ok) throw new Error(`Hazırlık kaydı oluşturulamadı: ${JSON.stringify(created)}`);
    return created.workEntry.id;
  }

  /** Şoför kaydını oluşturup 6.000 TL ile onaylar (sürüm 2). */
  function createConfirmedEntry(): string {
    const entryId = createPendingEntry();
    const confirmed = runInProcess({
      operation: "confirm",
      context: owner,
      requestId: "hazirlik-onay",
      entryId,
      version: 1,
      body: { receivedCents: "600000" },
    });
    if (!confirmed.ok) throw new Error(`Hazırlık onayı yapılamadı: ${JSON.stringify(confirmed)}`);
    return entryId;
  }

  interface OperationCase {
    operation: CrashRequest["operation"];
    status: number;
    /** Durumu hazırlar ve öldürülecek isteği döner. */
    prepare(): CrashRequest;
    /** Yeni tam durum; tam olarak bir kayıt/onay/makbuz. */
    expectCommitted(entryId: string, requestId: string, entriesBefore: number): void;
  }

  const cases: OperationCase[] = [
    {
      operation: "create",
      status: 201,
      prepare: () => ({
        operation: "create",
        context: driver,
        requestId: "olum-olustur",
        body: { workType: "driver", workerPersonId: SEED_IDS.driverA1a, ...daily() },
      }),
      expectCommitted(entryId, requestId, entriesBefore) {
        expect(entryCount()).toBe(entriesBefore + 1);
        expect(entryOf(entryId)).toEqual([{ status: "pending", version: 1, gross_cents: 1000000 }]);
        expect(revisionsOf(entryId)).toEqual([{ version: 1, action: "create" }]);
        expect(confirmationsOf(entryId)).toEqual([]);
        expect(receiptsOf(requestId)).toEqual([
          { operation: "work_entry.create", entity_id: entryId, result_version: 1, response_code: 201 },
        ]);
      },
    },
    {
      operation: "confirm",
      status: 200,
      prepare: () => ({
        operation: "confirm",
        context: owner,
        requestId: "olum-onay",
        entryId: createPendingEntry(),
        version: 1,
        body: { receivedCents: "620000" },
      }),
      expectCommitted(entryId, requestId, entriesBefore) {
        expect(entryCount()).toBe(entriesBefore);
        expect(entryOf(entryId)).toEqual([{ status: "confirmed", version: 2, gross_cents: 1000000 }]);
        expect(revisionsOf(entryId)).toEqual([
          { version: 1, action: "create" },
          { version: 2, action: "confirm" },
        ]);
        expect(confirmationsOf(entryId)).toEqual([{ entry_version: 2, received_cents: 620000 }]);
        expect(receiptsOf(requestId)).toEqual([
          { operation: "work_entry.confirm", entity_id: entryId, result_version: 2, response_code: 200 },
        ]);
      },
    },
    {
      operation: "correct_and_confirm",
      status: 200,
      prepare: () => ({
        operation: "correct_and_confirm",
        context: owner,
        requestId: "olum-duzelt",
        entryId: createConfirmedEntry(),
        version: 2,
        body: { ...daily("1100000"), receivedCents: "610000" },
      }),
      expectCommitted(entryId, requestId, entriesBefore) {
        expect(entryCount()).toBe(entriesBefore);
        expect(entryOf(entryId)).toEqual([{ status: "confirmed", version: 3, gross_cents: 1100000 }]);
        expect(revisionsOf(entryId)).toEqual([
          { version: 1, action: "create" },
          { version: 2, action: "confirm" },
          { version: 3, action: "correct_and_confirm" },
        ]);
        // Eski onay satırı olduğu gibi kalır; yeni sürüme tam olarak bir onay eklenir.
        expect(confirmationsOf(entryId)).toEqual([
          { entry_version: 2, received_cents: 600000 },
          { entry_version: 3, received_cents: 610000 },
        ]);
        expect(receiptsOf(requestId)).toEqual([
          { operation: "work_entry.correct_and_confirm", entity_id: entryId, result_version: 3, response_code: 200 },
        ]);
      },
    },
  ];

  describe.each(cases)("$operation", (spec) => {
    it(
      "açık transaction içinde SIGKILL eski tam durumu bırakır; aynı requestId yeniden deneme tek kez yazar",
      async () => {
        const request = spec.prepare();
        const before = dump();
        const entriesBefore = entryCount();

        const marker = await killAt("in_transaction", request);
        expect(marker).toEqual({ point: "in_transaction", in_transaction: "true" });
        expect(dump()).toEqual(before);
        expectIntegrityPasses();

        const retried = runInProcess(request);
        expect(retried.ok).toBe(true);
        if (!retried.ok) return;
        expect(retried.status).toBe(spec.status);
        spec.expectCommitted(retried.workEntry.id, request.requestId, entriesBefore);
        expectIntegrityPasses();
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "COMMIT sonrası SIGKILL yeni tam durumu bırakır; aynı requestId yeniden deneme replay olur",
      async () => {
        const request = spec.prepare();
        const entriesBefore = entryCount();

        const marker = await killAt("after_commit", request);
        expect(marker).toMatchObject({ point: "after_commit", in_transaction: "false", status: String(spec.status) });
        const entryId = marker.entry!;
        if (request.entryId !== undefined) expect(entryId).toBe(request.entryId);
        spec.expectCommitted(entryId, request.requestId, entriesBefore);
        expectIntegrityPasses();
        const afterKill = dump();

        const retried = runInProcess(request);
        expect(retried.ok).toBe(true);
        if (!retried.ok) return;
        expect(retried.status).toBe(spec.status);
        expect(retried.workEntry.id).toBe(entryId);
        expect(dump()).toEqual(afterKill);
        spec.expectCommitted(entryId, request.requestId, entriesBefore);
        expectIntegrityPasses();
      },
      TEST_TIMEOUT_MS,
    );
  });
});
