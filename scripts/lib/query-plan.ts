/**
 * EXPLAIN QUERY PLAN yardımcısı — hem `scripts/report-query-plan.ts` (beş yıllık
 * ölçüm) hem `tests/integration/report-query-plan.test.ts` (küçük veriyle plan
 * ratchet'ı) kullanır. Sorgu, use case'in çalıştırdığı Drizzle kurucusunun
 * `.toSQL()` çıktısıdır; elle kopyalanmış SQL değildir.
 */
import type { SqliteConnection } from "../../src/server/data/db.ts";

export interface BuiltQuery {
  toSQL(): { sql: string; params: unknown[] };
}

export interface PlanRow {
  id: number;
  parent: number;
  detail: string;
}

export function explainQueryPlan(sqlite: SqliteConnection, query: BuiltQuery): { sql: string; plan: PlanRow[] } {
  const { sql, params } = query.toSQL();
  const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { id: number; parent: number; detail: string }[];
  return { sql, plan: rows.map(({ id, parent, detail }) => ({ id, parent, detail })) };
}

/** `SCAN <tablo>` satırı tam tablo (veya kısıtsız indeks) taramasıdır; `SEARCH` kısıtlı aramadır. */
export function fullScanRows(plan: PlanRow[], table: string): PlanRow[] {
  return plan.filter((row) => new RegExp(`^SCAN ${table}( |$)`, "u").test(row.detail));
}

/** `work_entries` için kısıtlı `SEARCH ... USING [COVERING] INDEX idx_work_entries_*` satırları. */
export function workEntriesIndexSearches(plan: PlanRow[]): PlanRow[] {
  return plan.filter((row) => /^SEARCH work_entries USING (COVERING )?INDEX idx_work_entries_/u.test(row.detail));
}
