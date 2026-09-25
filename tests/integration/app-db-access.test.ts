import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS } from "../../scripts/db-seed-dev";
import { getAppDb, resetAppDbForTests } from "../../src/server/data/app-db";
import {
  createDb,
  openDatabaseConnection,
  type SqliteConnection,
} from "../../src/server/data/db";
import { setVehicleActive } from "../../src/server/usecases/access";
import { createVehicleSession } from "../../src/server/usecases/session/create-vehicle-session";
import { SessionRevokedError } from "../../src/server/usecases/session/errors";
import { resolveSession } from "../../src/server/usecases/session/resolve-session";

/**
 * `getAppDb()` × `src/server/usecases/access/*` entegrasyonu — T1.4
 * düzeltme turu 1.
 *
 * Denetim bulgusu ("medium"): `getAppDb()`'nin dönüş tipi ÖNCEDEN açıkça
 * `BetterSQLite3Database<Schema>` olarak DARALTILMIŞTI (bkz. `../../src/
 * server/data/db.ts` `AppDatabase` tipinin üst notu); `../../src/server/
 * usecases/access/*` ise `$client` alanını İÇEREN `AppDatabase` bekler
 * (BEGIN IMMEDIATE transaction'ı ham `sqlite.transaction(fn).immediate()`
 * ile açmak için). Sonuç: `getAppDb()`'nin ÇIKTISI bu kullanım
 * durumlarına DERLENEMİYORDU — `npx tsc --noEmit` ile doğrulandı
 * (`Property '$client' is missing`). `../../src/server/data/app-db.ts`
 * artık `AppDatabase` döner; bu test GERÇEK `getAppDb()` tekiliyle (ayrı
 * bir `createDb()` bağlantısıyla DEĞİL) `setVehicleActive`'in hem
 * DERLENDİĞİNİ hem de İPTAL YAYILIMININ (`resolveSession` sonraki
 * çağrıda `SessionRevokedError` fırlatması) gerçekten ÇALIŞTIĞINI
 * kanıtlar — bkz. `./session-revocation.test.ts` (orası kendi
 * `createDb()` bağlantısını kullanır, `getAppDb()`'yi DEĞİL, bu yüzden bu
 * tip uyumsuzluğunu YAKALAYAMAZDI).
 *
 * Gerçek geçici SQLite + migration + seed; mock/`:memory:` yok.
 */

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");

describe("getAppDb() → src/server/usecases/access/* (T1.4 düzeltme turu 1)", () => {
  let dir: string;
  const originalDbPath = process.env.DOLMUS_DB_PATH;

  afterEach(() => {
    resetAppDbForTests();
    if (originalDbPath === undefined) {
      delete process.env.DOLMUS_DB_PATH;
    } else {
      process.env.DOLMUS_DB_PATH = originalDbPath;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("getAppDb()'nin döndürdüğü GERÇEK üretim bağlantısı setVehicleActive'e geçilebilir ve iptal yayılımı çalışır", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-app-db-access-"));
    const dbPath = path.join(dir, "test.sqlite");

    const setupSqlite: SqliteConnection = openDatabaseConnection(dbPath, {
      createIfMissing: true,
    });
    const setupDb = createDb(setupSqlite);
    migrate(setupDb, { migrationsFolder });
    await seedDevData(setupSqlite);
    setupSqlite.close();

    process.env.DOLMUS_DB_PATH = dbPath;
    resetAppDbForTests();

    // GERÇEK üretim tekili — testin kendi ayrı bağlantısı DEĞİL.
    const db = getAppDb();

    const session = await createVehicleSession(db, SEED_IDS.credA1Owner);
    await expect(resolveSession(db, session.token)).resolves.toMatchObject({
      kind: "vehicle",
      credentialId: SEED_IDS.credA1Owner,
    });

    // Önceki sürümde bu satır `npx tsc --noEmit` altında DERLENMEZDİ
    // (`Property '$client' is missing in type 'BetterSQLite3Database<...>'
    // but required in type '{ $client: Database; }'`).
    setVehicleActive(db, SEED_IDS.vehicleA1, false);

    await expect(resolveSession(db, session.token)).rejects.toBeInstanceOf(
      SessionRevokedError,
    );
  });
});
