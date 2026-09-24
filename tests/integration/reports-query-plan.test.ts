/**
 * S5.5 indeks kullanımı ratchet'ı: her rapor/liste use case'inin GERÇEKTEN çalıştırdığı SQL
 * yakalanır (elle kopyalanmış SQL yok; SQL kayması testi kırar) ve aynı parametrelerle
 * EXPLAIN QUERY PLAN alınır. `work_entries` bir `idx_work_entries_*` indeksiyle kısıtlı
 * aranmalı; tam tarama olmamalı. Küçük veriyle çalışır; beş yıllık ölçüm `npm run perf:reports`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveReportPeriod } from "../../src/lib/report-period";
import type { Scope, StaffScope, VehicleScope } from "../../src/server/auth/scope";
import { createDb, openDatabaseConnection, type SqliteConnection } from "../../src/server/data/db";
import {
  readOwnerSummaryForScope,
  readPeoplePeriodReportForScope,
  readPersonPeriodReportForScope,
  readVehiclePeriodReportForScope,
} from "../../src/server/usecases/reports";
import { listWorkEntriesForScope } from "../../src/server/usecases/work-entries/queries";
import { encodeCursor } from "../../src/server/usecases/list-cursor";
import { fullScanRows, workEntriesIndexSearches, type PlanRow } from "../../scripts/lib/query-plan";
import { DAY, driverBody, ownerBody, SEED_IDS, setupReportHarness } from "./report-harness";

const month = resolveReportPeriod("month", DAY)!;
const year = resolveReportPeriod("year", DAY)!;

const ownerScope: VehicleScope = {
  kind: "vehicle",
  actor: "owner",
  businessId: SEED_IDS.businessA,
  vehicleId: SEED_IDS.vehicleA1,
  credentialId: SEED_IDS.credA1Owner,
};
const driverScope: VehicleScope = { ...ownerScope, actor: "driver", credentialId: SEED_IDS.credA1Driver };
const staffScope: StaffScope = {
  kind: "staff",
  actor: "admin",
  businessId: SEED_IDS.businessA,
  vehicleId: SEED_IDS.vehicleA1,
  platformUserId: SEED_IDS.platformAdmin1,
  onBehalfOf: true,
};

interface Executed {
  sql: string;
  params: unknown[];
}

/** Use case'lerin çalıştırdığı her ifadeyi (SQL + parametre) kaydeden bağlantı vekili. */
function recordingConnection(sqlite: SqliteConnection): { connection: SqliteConnection; executed: Executed[] } {
  const executed: Executed[] = [];
  const connection = new Proxy(sqlite, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== "prepare") return typeof value === "function" ? value.bind(target) : value;
      return (sql: string) => {
        const statement = target.prepare(sql);
        const wrapped: object = new Proxy(statement, {
          get(inner, name) {
            const member = Reflect.get(inner, name, inner);
            if (name === "raw" || name === "pluck") {
              return (...args: unknown[]) => {
                member.apply(inner, args);
                return wrapped;
              };
            }
            if (name === "all" || name === "get" || name === "run" || name === "values") {
              return (...params: unknown[]) => {
                executed.push({ sql, params });
                return member.apply(inner, params);
              };
            }
            return typeof member === "function" ? member.bind(inner) : member;
          },
        });
        return wrapped;
      };
    },
  }) as SqliteConnection;
  return { connection, executed };
}

function planOf(sqlite: SqliteConnection, statement: Executed): PlanRow[] {
  return sqlite.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`).all(...statement.params) as PlanRow[];
}

describe("rapor sorgu planı ratchet'ı", () => {
  const h = setupReportHarness("reports-plan");

  async function withReader(run: (connection: SqliteConnection, record: (read: (db: ReturnType<typeof createDb>) => void) => Executed[]) => void) {
    await h.create(h.driver, driverBody("d-1"));
    await h.create(h.driver, driverBody("d-2", "2026-09-14", {}, SEED_IDS.driverA1b));
    await h.create(h.owner, ownerBody("o-1"));
    const raw = openDatabaseConnection(h.dbPath, {});
    try {
      run(raw, (read) => {
        const { connection, executed } = recordingConnection(raw);
        read(createDb(connection));
        return executed;
      });
    } finally {
      raw.close();
    }
  }

  const cursor = encodeCursor(["2026-09-30", "zzzzzzzz"]);
  const cases: { name: string; run: (db: ReturnType<typeof createDb>) => unknown }[] = [
    { name: "sahip özeti", run: (db) => readOwnerSummaryForScope(db, ownerScope, month) },
    { name: "sahip özeti (yıl)", run: (db) => readOwnerSummaryForScope(db, ownerScope, year) },
    { name: "araç dönem raporu", run: (db) => readVehiclePeriodReportForScope(db, staffScope, year) },
    { name: "kişi listesi", run: (db) => readPeoplePeriodReportForScope(db, ownerScope, year) },
    { name: "kişi detayı", run: (db) => readPersonPeriodReportForScope(db, ownerScope, year, SEED_IDS.driverA1a, { limit: 50 }) },
    { name: "kişi detayı (imleçli)", run: (db) => readPersonPeriodReportForScope(db, ownerScope, year, SEED_IDS.driverA1a, { limit: 50, cursor }) },
    { name: "gün gün liste", run: (db) => listWorkEntriesForScope(db, ownerScope, { period: month, limit: 50 }) },
    { name: "gün gün liste (tarih sınırı yok)", run: (db) => listWorkEntriesForScope(db, ownerScope, { limit: 50 }) },
    { name: "bekleyen listesi", run: (db) => listWorkEntriesForScope(db, ownerScope, { period: month, status: "pending", limit: 50 }) },
    { name: "kişi süzgeçli liste", run: (db) => listWorkEntriesForScope(db, ownerScope, { period: month, workerPersonId: SEED_IDS.driverA1a, limit: 50 }) },
    { name: "imleçli liste", run: (db) => listWorkEntriesForScope(db, ownerScope, { period: month, cursor, limit: 50 }) },
    { name: "ekip kapsamlı liste", run: (db) => listWorkEntriesForScope(db, staffScope as Scope, { period: month, status: "confirmed", limit: 50 }) },
    {
      name: "şoför kapsamlı liste (K1)",
      run: (db) => listWorkEntriesForScope(db, driverScope, { period: month, workerPersonId: SEED_IDS.driverA1a, limit: 50 }),
    },
  ];

  it.each(cases)("$name: work_entries indeksle kısıtlı aranır, tam tarama yok", async ({ run }) => {
    await withReader((raw, record) => {
      const executed = record(run).filter((s) => /\bwork_entries\b/u.test(s.sql));
      expect(executed.length).toBeGreaterThan(0);
      for (const statement of executed) {
        const plan = planOf(raw, statement);
        const detail = plan.map((row) => row.detail).join("\n");
        expect(fullScanRows(plan, "work_entries"), detail).toEqual([]);
        expect(workEntriesIndexSearches(plan).length, detail).toBeGreaterThan(0);
        // Birleşilen tablolar da anahtarla aranır (SCAN yok).
        expect(plan.filter((row) => /^SCAN /u.test(row.detail)), detail).toEqual([]);
      }
    });
  });

  it("ratchet kendini doğrular: indekssiz bir work_entries sorgusu yakalanır", async () => {
    await withReader((raw) => {
      const plan = planOf(raw, { sql: "SELECT COUNT(*) FROM work_entries WHERE gross_cents > ?", params: [0] });
      expect(fullScanRows(plan, "work_entries").length).toBeGreaterThan(0);
      expect(workEntriesIndexSearches(plan)).toEqual([]);
    });
  });

  it("beş yıllık ölçüm ayrı bir komuttur: perf:reports var, ci-steps.json ve test:integration içinde değil", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts["perf:reports"]).toMatch(/report-query-plan/u);
    expect(scripts["test:integration"]).not.toMatch(/perf|report-query-plan/u);
    expect(fs.readFileSync(path.join(root, "scripts", "ci-steps.json"), "utf8")).not.toMatch(/perf:reports|report-query-plan/u);
  });
});
