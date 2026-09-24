/**
 * `work-entry-crash-integrity.test.ts`'in çocuk süreci: bir iş kaydı
 * işlemini (`create` / `confirm` / `correct_and_confirm`) GERÇEK use case
 * ile çalıştırır ve üst süreç SIGKILL gönderene kadar bu noktada senkron
 * bekler:
 *
 * - `in_transaction`: yalnız bu bağlantıda tanımlı TEMP trigger, makbuz
 *   INSERT'inden (use case'in COMMIT'ten önceki SON yazımı) hemen sonra bir
 *   kullanıcı fonksiyonunu çağırır; fonksiyon açık BEGIN IMMEDIATE
 *   transaction'ın içinde önce üst sürece satır yazar, sonra süreci durdurur.
 * - `after_commit`: use case döndükten (COMMIT'ten) sonra aynı şekilde durur.
 *
 * Satır `fs.writeSync` ile yazılır (asenkron akış bekleme öncesi boşalmaz);
 * bekleme `Atomics.wait` ile olay döngüsünü de durdurur. Test dosyası değildir
 * (`*.test.ts` deseni dışında).
 *
 * Kullanım: node --import ./scripts/lib/ts-resolver.mjs
 *   tests/integration/work-entry-crash-child.ts <db> <in_transaction|after_commit> <istek JSON>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scopeFromVehicleSession } from "../../src/server/auth/scope";
import { createDb, openDatabaseConnection, type AppDatabase } from "../../src/server/data/db";
import type { SessionContext } from "../../src/server/usecases/session/types";
import { confirmWorkEntry } from "../../src/server/usecases/work-entries/confirm";
import { correctAndConfirmWorkEntry } from "../../src/server/usecases/work-entries/correct-and-confirm";
import { createWorkEntry } from "../../src/server/usecases/work-entries/create";

export const CRASH_POINT_PREFIX = "CRASH_POINT";
export const KILL_POINTS = ["in_transaction", "after_commit"] as const;
export type KillPoint = (typeof KILL_POINTS)[number];

export interface CrashRequest {
  operation: "create" | "confirm" | "correct_and_confirm";
  context: SessionContext;
  requestId: string;
  /** `confirm` / `correct_and_confirm` için. */
  entryId?: string;
  version?: number;
  body: unknown;
}

/** Üst süreçteki yeniden deneme de AYNI çağrıyı kullanır. */
export function runCrashRequest(db: AppDatabase, request: CrashRequest) {
  const scope = scopeFromVehicleSession(request.context);
  const { context, requestId, body } = request;
  if (request.operation === "create") return createWorkEntry(db, context, scope, { requestId, body });
  const params = { requestId, entryId: request.entryId!, version: request.version!, body };
  if (request.operation === "confirm") return confirmWorkEntry(db, context, scope, params);
  return correctAndConfirmWorkEntry(db, context, scope, params);
}

function holdForKill(fields: string): never {
  fs.writeSync(1, `${CRASH_POINT_PREFIX} ${fields}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("SIGKILL bekleniyordu; bekleme sona erdi.");
}

function main(argv: readonly string[]): void {
  const [dbPath, killPoint, requestJson] = argv;
  if (!dbPath || !KILL_POINTS.includes(killPoint as KillPoint) || !requestJson) {
    throw new Error("Kullanım: work-entry-crash-child.ts <db> <in_transaction|after_commit> <istek JSON>");
  }
  const request = JSON.parse(requestJson) as CrashRequest;
  const sqlite = openDatabaseConnection(dbPath);
  const db = createDb(sqlite);

  if (killPoint === "in_transaction") {
    sqlite.function("crash_test_hold", () =>
      holdForKill(`point=in_transaction in_transaction=${sqlite.inTransaction}`),
    );
    sqlite.exec(
      "CREATE TEMP TRIGGER crash_test_hold AFTER INSERT ON mutation_receipts BEGIN SELECT crash_test_hold(); END",
    );
  }

  const result = runCrashRequest(db, request);
  if (killPoint === "in_transaction") {
    throw new Error("Makbuz yazılmadan işlem bitti; transaction içi durma noktasına ulaşılmadı.");
  }
  if (!result.ok) throw new Error(`İşlem başarısız: ${JSON.stringify(result)}`);
  holdForKill(
    `point=after_commit in_transaction=${sqlite.inTransaction} status=${result.status} ` +
      `entry=${result.workEntry.id} version=${result.workEntry.version}`,
  );
}

const isDirectRun = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) main(process.argv.slice(2));
