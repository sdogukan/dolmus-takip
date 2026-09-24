/**
 * Salt okunur veri bütünlüğü denetimi — `npm run integrity:check -- <db yolu>`
 * (S6.6 yük / veri bütünlüğü kabulü).
 *
 * DB dosyası KENDİ salt okunur bağlantısında (`readonly`, `fileMustExist`)
 * açılır; bu komut dosyaya hiçbir koşulda yazmaz, checkpoint yapmaz, eksik
 * dosyayı oluşturmaz. WAL modundaki dosyada `-wal`/`-shm` yoksa SQLite okuma
 * için bunları boş oluşturur; ana dosyanın baytları değişmez. `immutable`
 * kullanılmaz: checkpoint edilmemiş WAL içeriğini (ör. çöken bir sürecin
 * commit'i) yok sayıp eski veriyi denetlerdi.
 * Bütün kontroller TEK okuma işleminde (BEGIN … ROLLBACK)
 * koşar: sonuç tek bir anlık görüntüye aittir. Canlı WAL DB'de uzun bir okuma
 * işlemi checkpoint'i bekletip WAL'ı büyütür; bu yüzden yük senaryosundan
 * SONRA veya yedek kopyası üzerinde çalıştırılır.
 *
 * Kontroller:
 * - `scripts/lib/copy-verification.ts` `verifyDatabase` — yedek/restore ile
 *   AYNI kontroller (integrity_check, foreign_key_check, migration'lar,
 *   pay/kalan yeniden hesabı). İlk bulguda durur; nedeni `database_check`
 *   alanına yazılır.
 * - Şema: DB'de bu kodun `drizzle/` klasöründe olmayan migration yoksa
 *   `schema=current`. Şema güncel değilse veya integrity_check kaldıysa
 *   aşağıdaki iş kaydı kontrolleri anlamsızdır ve `invariants=skipped` olur.
 * - İş kaydı değişmezleri (`WORK_ENTRY_INVARIANTS`, her biri ihlal SAYISI):
 *   revizyonlar 1..version kesintisiz; onay var olan ve onaylayan
 *   (`confirm` / `correct_and_confirm`) revizyona bağlı, her onaylayan
 *   revizyonun tam bir onayı var; sürüm başına en fazla bir onay; `confirmed`
 *   kaydın GÜNCEL sürümünde onay var; şoför kaydı `pending` (hiç onaysız) veya
 *   `confirmed`; sahip kaydı `not_required` ve onaysız; onayı şoför rolü
 *   yazamaz; iş kaydı makbuzu, işlemin yazdığı revizyonu gösterir.
 *
 * Çıktı tek logfmt satırıdır (`formatLogLine`, etiket `dolmus-integrity`):
 * `integrity_passed` (çıkış 0) yalnız her kontrol geçtiğinde; aksi halde
 * `integrity_violations` veya komut çalışamadıysa `integrity_failed`
 * (çıkış 1). Kuruş toplamları `verifyDatabase` içinde METİN olarak okunur.
 *
 * Import ağacı açık `.ts` uzantılıdır; düz `node` ile, çözümleyici kancası
 * olmadan çalışır.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { assertMigrationsApplied } from "../src/server/data/db.ts";
import { formatLogLine, type LogLevel } from "./lib/backup-schedule.ts";
import {
  CopyRejectedError,
  countUnknownMigrations,
  verifyDatabase,
  type Fields,
} from "./lib/copy-verification.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = path.join(projectRoot, "drizzle");

const USAGE = "Kullanım: integrity-check.ts <db yolu>";

type Connection = InstanceType<typeof Database>;

/**
 * İş kaydı makbuzunun işlemi → o işlemin `result_version`'da yazdığı revizyon
 * eylemi. Anahtarlar `src/server/usecases/work-entries/*` `WORK_ENTRY_*_OPERATION`
 * sabitleridir (test eşitliği sabitler).
 */
export const RECEIPT_REVISION_ACTIONS: Readonly<Record<string, string>> = {
  "work_entry.create": "create",
  "work_entry.update": "update",
  "work_entry.confirm": "confirm",
  "work_entry.correct_and_confirm": "correct_and_confirm",
};

const CONFIRMING_ACTIONS = "('confirm', 'correct_and_confirm')";
const REVISIONS_OF_ENTRY = "FROM work_entry_revisions r WHERE r.business_id = e.business_id AND r.entry_id = e.id";
const RECEIPT_ACTION_CASE = `CASE m.operation ${Object.entries(RECEIPT_REVISION_ACTIONS)
  .map(([operation, action]) => `WHEN '${operation}' THEN '${action}'`)
  .join(" ")} END`;

/** Her sorgu tek satır `{ count }` döner: o değişmezi bozan satır sayısı. */
export const WORK_ENTRY_INVARIANTS = {
  revision_gaps:
    `SELECT COUNT(*) AS count FROM work_entries e WHERE ` +
    `(SELECT COUNT(*) ${REVISIONS_OF_ENTRY}) <> e.version ` +
    `OR (SELECT MIN(r.version) ${REVISIONS_OF_ENTRY}) IS NOT 1 ` +
    `OR (SELECT MAX(r.version) ${REVISIONS_OF_ENTRY}) IS NOT e.version`,
  confirmation_missing_revision:
    "SELECT COUNT(*) AS count FROM cash_confirmations c WHERE NOT EXISTS (" +
    "SELECT 1 FROM work_entry_revisions r WHERE r.business_id = c.business_id " +
    "AND r.entry_id = c.entry_id AND r.version = c.entry_version)",
  duplicate_confirmations:
    "SELECT COUNT(*) AS count FROM (SELECT 1 FROM cash_confirmations " +
    "GROUP BY business_id, entry_id, entry_version HAVING COUNT(*) > 1)",
  confirmation_revision_mismatch:
    "SELECT (SELECT COUNT(*) FROM cash_confirmations c JOIN work_entry_revisions r " +
    "ON r.business_id = c.business_id AND r.entry_id = c.entry_id AND r.version = c.entry_version " +
    `WHERE r.action NOT IN ${CONFIRMING_ACTIONS}) + ` +
    `(SELECT COUNT(*) FROM work_entry_revisions r WHERE r.action IN ${CONFIRMING_ACTIONS} ` +
    "AND NOT EXISTS (SELECT 1 FROM cash_confirmations c WHERE c.business_id = r.business_id " +
    "AND c.entry_id = r.entry_id AND c.entry_version = r.version)) AS count",
  confirmed_without_confirmation:
    "SELECT COUNT(*) AS count FROM work_entries e WHERE e.status = 'confirmed' AND NOT EXISTS (" +
    "SELECT 1 FROM cash_confirmations c WHERE c.business_id = e.business_id " +
    "AND c.entry_id = e.id AND c.entry_version = e.version)",
  driver_status_rule:
    "SELECT COUNT(*) AS count FROM work_entries e WHERE e.work_kind = 'driver' AND (" +
    "e.status NOT IN ('pending', 'confirmed') OR (e.status = 'pending' AND EXISTS (" +
    "SELECT 1 FROM cash_confirmations c WHERE c.business_id = e.business_id AND c.entry_id = e.id)))",
  owner_status_rule:
    "SELECT COUNT(*) AS count FROM work_entries e WHERE e.work_kind = 'owner' AND (" +
    "e.status <> 'not_required' OR EXISTS (" +
    "SELECT 1 FROM cash_confirmations c WHERE c.business_id = e.business_id AND c.entry_id = e.id))",
  confirmation_actor_rule: "SELECT COUNT(*) AS count FROM cash_confirmations WHERE actor_role = 'driver'",
  dangling_receipts:
    "SELECT COUNT(*) AS count FROM mutation_receipts m WHERE m.operation LIKE 'work_entry.%' AND NOT EXISTS (" +
    "SELECT 1 FROM work_entries e JOIN work_entry_revisions r ON r.business_id = e.business_id AND r.entry_id = e.id " +
    `WHERE e.id = m.entity_id AND r.version = m.result_version AND r.action = ${RECEIPT_ACTION_CASE})`,
} as const;

export type InvariantName = keyof typeof WORK_ENTRY_INVARIANTS;

class UsageError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "UsageError";
    this.reason = reason;
  }
}

function log(level: LogLevel, event: string, fields: Fields): void {
  console.log(formatLogLine(level, event, fields, new Date(), "dolmus-integrity"));
}

function countOf(sqlite: Connection, sql: string): number {
  return (sqlite.prepare(sql).get() as { count: number }).count;
}

function schemaIsCurrent(sqlite: Connection): boolean {
  try {
    assertMigrationsApplied(sqlite, migrationsFolder);
  } catch {
    return false;
  }
  return countUnknownMigrations(sqlite, migrationsFolder) === 0;
}

/** Tek anlık görüntüde bütün kontroller; dönen alanlar özet satırına aynen yazılır. */
function inspect(sqlite: Connection): { failedChecks: number; fields: Fields } {
  const fields: Fields = {};
  let failedChecks = 0;

  let databaseCheck = "ok";
  let uncheckedEntries: number | null = null;
  try {
    uncheckedEntries = verifyDatabase(sqlite, migrationsFolder).uncheckedEntries;
  } catch (error) {
    if (!(error instanceof CopyRejectedError)) throw error;
    databaseCheck = error.reason;
    failedChecks += 1;
    for (const [key, value] of Object.entries(error.fields)) fields[`database_${key}`] = value;
  }
  fields.database_check = databaseCheck;

  if (databaseCheck === "integrity_check_failed") {
    fields.schema = "unchecked";
    fields.invariants = "skipped";
    return { failedChecks, fields };
  }
  const schemaCurrent = schemaIsCurrent(sqlite);
  fields.schema = schemaCurrent ? "current" : "not_current";
  if (!schemaCurrent && databaseCheck !== "schema_not_current") failedChecks += 1;

  if (!schemaCurrent) {
    fields.invariants = "skipped";
    return { failedChecks, fields };
  }
  fields.invariants = "checked";
  for (const [name, sql] of Object.entries(WORK_ENTRY_INVARIANTS)) {
    const count = countOf(sqlite, sql);
    fields[name] = count;
    if (count > 0) failedChecks += 1;
  }
  fields.entries = countOf(sqlite, "SELECT COUNT(*) AS count FROM work_entries");
  fields.revisions = countOf(sqlite, "SELECT COUNT(*) AS count FROM work_entry_revisions");
  fields.confirmations = countOf(sqlite, "SELECT COUNT(*) AS count FROM cash_confirmations");
  fields.receipts = countOf(sqlite, "SELECT COUNT(*) AS count FROM mutation_receipts");
  if (uncheckedEntries !== null) fields.unchecked_entries = uncheckedEntries;
  return { failedChecks, fields };
}

function main(argv: readonly string[]): void {
  const startedAt = performance.now();
  if (argv.length !== 1 || argv[0]!.startsWith("-") || argv[0] === "") {
    throw new UsageError("usage", USAGE);
  }
  // Root, canlı DB'nin yanında root'a ait -wal/-shm bırakıp uygulamayı kilitleyebilir.
  if (process.getuid?.() === 0) {
    throw new UsageError("run_as_root", "DB komutları root olarak çalıştırılmaz; sudo -u dolmus-takip kullanın.");
  }
  const dbPath = path.resolve(argv[0]!);
  if (!fs.existsSync(dbPath)) throw new UsageError("db_missing", "DB dosyası yok; hiçbir dosya oluşturulmaz.");

  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    sqlite.exec("BEGIN");
    const { failedChecks, fields } = inspect(sqlite);
    sqlite.exec("ROLLBACK");
    const summary: Fields = {
      db: dbPath,
      failed_checks: failedChecks,
      ...fields,
      duration_ms: Math.round(performance.now() - startedAt),
    };
    if (failedChecks === 0) {
      log("info", "integrity_passed", summary);
    } else {
      log("err", "integrity_violations", summary);
      process.exitCode = 1;
    }
  } finally {
    sqlite.close();
  }
}

const isDirectRun = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const reason = error instanceof UsageError ? error.reason : "unexpected_error";
    const message = error instanceof Error ? error.message : String(error);
    log("err", "integrity_failed", { reason, message });
    process.exitCode = 1;
  }
}
