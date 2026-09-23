/**
 * `listAffectedVehiclesForPeople` — T2.5. Ekip Şoförlerim sayfası küresel
 * pasifleştirme onayında etkilenen araçları TEK sorguyla okur; işletme
 * sınırı sorguda uygulanır (başka işletmenin kişi kimliği sızmaz).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDevData, SEED_IDS } from "../../scripts/db-seed-dev";
import type { StaffScope } from "../../src/server/auth/scope";
import { createDb, openDatabaseConnection, type SqliteConnection } from "../../src/server/data/db";
import { listAffectedVehicles, listAffectedVehiclesForPeople } from "../../src/server/usecases/drivers";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsFolder = path.join(projectRoot, "drizzle");

function staffScope(businessId: string, vehicleId: string): StaffScope {
  return { kind: "staff", actor: "admin", businessId, vehicleId, platformUserId: "u-1", onBehalfOf: true };
}

describe("listAffectedVehiclesForPeople", () => {
  let dir: string;
  let sqlite: SqliteConnection;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-affected-"));
    sqlite = openDatabaseConnection(path.join(dir, "test.sqlite"), { createIfMissing: true });
    migrate(createDb(sqlite), { migrationsFolder });
    await seedDevData(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("kişi başına bağlı araçları döndürür ve tekil sorguyla aynı sonucu verir", () => {
    const db = createDb(sqlite);
    const scope = staffScope(SEED_IDS.businessA, SEED_IDS.vehicleA1);
    const ids = [SEED_IDS.driverA1a, SEED_IDS.driverA1d, SEED_IDS.driverA2a];
    const result = listAffectedVehiclesForPeople(db, scope, ids);

    expect(Object.keys(result).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(result[id]).toEqual(listAffectedVehicles(db, scope, id));
    }
    expect(result[SEED_IDS.driverA1d]?.map((v) => v.assignmentActive)).toEqual([false]);
  });

  it("boş kişi listesinde sorgu çalıştırmadan boş nesne döner", () => {
    expect(listAffectedVehiclesForPeople(createDb(sqlite), staffScope(SEED_IDS.businessA, SEED_IDS.vehicleA1), [])).toEqual({});
  });

  it("başka işletmenin kişi kimliğini sızdırmaz", () => {
    const result = listAffectedVehiclesForPeople(
      createDb(sqlite),
      staffScope(SEED_IDS.businessA, SEED_IDS.vehicleA1),
      [SEED_IDS.driverB1a],
    );
    expect(result).toEqual({});
  });
});
