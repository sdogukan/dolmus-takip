import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDb,
  extractTransientSqliteLockError,
  MissingDatabaseFileError,
  openDatabaseConnection,
  resolveDbPathFromEnv,
  takeWriteTransactionStats,
  withImmediateTransaction,
  WRITE_TX_SAMPLE_CAPACITY,
  type SqliteConnection,
} from "../../src/server/data/db";

/**
 * Gerçek geçici SQLite dosyalarıyla çalışan entegrasyon testleri.
 *
 * Finansal DB testleri yalnız mock veya :memory: üzerinde kabul edilmez.
 * Bu testler her defasında `os.tmpdir()` altında yeni, benzersiz bir dosya
 * kullanır ve sonunda temizler; taklit/mock DB yoktur.
 *
 * Şema/migration ADIM 2'de geleceğinden, transaction yardımcısını
 * doğrulamak için burada yalnız bu test dosyasına özgü geçici bir tablo
 * (`exec` ile) açılır; bu gerçek uygulama şeması değildir.
 */
describe("openDatabaseConnection", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-db-"));
    dbPath = path.join(dir, "test.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("eksik dosyada sessizce oluşturmaz; MissingDatabaseFileError fırlatır", () => {
    expect(() => openDatabaseConnection(dbPath)).toThrow(
      MissingDatabaseFileError,
    );
    // Sessizce boş DB oluşturmadığını dosya sisteminden de doğrula.
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("createIfMissing: true ile dizini ve dosyayı açıkça oluşturur", () => {
    const nestedPath = path.join(dir, "nested", "dev.sqlite");
    const sqlite = openDatabaseConnection(nestedPath, {
      createIfMissing: true,
    });
    try {
      expect(fs.existsSync(nestedPath)).toBe(true);
    } finally {
      sqlite.close();
    }
  });

  it("var olan dosyayı createIfMissing olmadan açar", () => {
    // Önce açık kurulumla oluştur, sonra normal (createIfMissing: false)
    // modda tekrar aç — gerçek uygulama akışını taklit eder.
    openDatabaseConnection(dbPath, { createIfMissing: true }).close();

    const sqlite = openDatabaseConnection(dbPath);
    try {
      expect(sqlite.open).toBe(true);
    } finally {
      sqlite.close();
    }
  });

  it("PRAGMA'ları uygular: foreign_keys, WAL, synchronous=FULL, busy_timeout", () => {
    const sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    try {
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
      // SQLite synchronous: 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA.
      expect(sqlite.pragma("synchronous", { simple: true })).toBe(2);
      expect(sqlite.pragma("busy_timeout", { simple: true })).toBe(2000);
    } finally {
      sqlite.close();
    }
  });

  it('":memory:" veritabanını reddeder', () => {
    expect(() => openDatabaseConnection(":memory:")).toThrow(
      /:memory:.*desteklenmez/,
    );
  });
});

describe("withImmediateTransaction", () => {
  let dir: string;
  let sqlite: SqliteConnection;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-tx-"));
    sqlite = openDatabaseConnection(path.join(dir, "test.sqlite"), {
      createIfMissing: true,
    });
    // Bu adımda gerçek şema yok; yardımcıyı sınamak için yalnız bu teste
    // özgü geçici bir tablo açılır (ADIM 2'de gerçek migration gelecek).
    sqlite.exec(
      "CREATE TABLE test_counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)",
    );
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("başarılı transaction'ı commit eder", () => {
    withImmediateTransaction(sqlite, () => {
      sqlite
        .prepare("INSERT INTO test_counter (id, value) VALUES (1, 10)")
        .run();
    });

    const row = sqlite
      .prepare("SELECT value FROM test_counter WHERE id = 1")
      .get() as { value: number } | undefined;
    expect(row?.value).toBe(10);
  });

  it("hata durumunda transaction'ı geri alır (yarım kayıt bırakmaz)", () => {
    expect(() =>
      withImmediateTransaction(sqlite, () => {
        sqlite
          .prepare("INSERT INTO test_counter (id, value) VALUES (2, 20)")
          .run();
        throw new Error("kasıtlı hata: rollback doğrulaması");
      }),
    ).toThrow("kasıtlı hata");

    const row = sqlite
      .prepare("SELECT value FROM test_counter WHERE id = 2")
      .get();
    expect(row).toBeUndefined();
  });

  it("transaction sırasında inTransaction true'dur, sonrasında false'a döner", () => {
    expect(sqlite.inTransaction).toBe(false);
    let observedDuring = false;
    withImmediateTransaction(sqlite, () => {
      observedDuring = sqlite.inTransaction;
    });
    expect(observedDuring).toBe(true);
    expect(sqlite.inTransaction).toBe(false);
  });
});

describe("withImmediateTransaction — yazma transaction'ı metrikleri", () => {
  let dir: string;
  let dbPath: string;
  let sqlite: SqliteConnection;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-txstats-"));
    dbPath = path.join(dir, "test.sqlite");
    sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    sqlite.exec(
      "CREATE TABLE test_counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)",
    );
    // Önceki testlerin kayıtları bu aralığa taşınmasın.
    takeWriteTransactionStats();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("örnek yokken tüm alanlar 0'dır", () => {
    expect(takeWriteTransactionStats()).toEqual({
      count: 0,
      lockFailures: 0,
      p99Ms: 0,
      maxMs: 0,
    });
  });

  it("dönüş değerini değiştirmeden sayar; okuma sayaçları sıfırlar", () => {
    const result = withImmediateTransaction(sqlite, () => {
      sqlite.prepare("INSERT INTO test_counter (id, value) VALUES (1, 10)").run();
      return { inserted: 1 };
    });
    expect(result).toEqual({ inserted: 1 });
    withImmediateTransaction(sqlite, () => undefined);

    const stats = takeWriteTransactionStats();
    expect(stats.count).toBe(2);
    expect(stats.lockFailures).toBe(0);
    expect(stats.maxMs).toBeGreaterThanOrEqual(stats.p99Ms);
    expect(stats.p99Ms).toBeGreaterThanOrEqual(0);

    expect(takeWriteTransactionStats()).toEqual({
      count: 0,
      lockFailures: 0,
      p99Ms: 0,
      maxMs: 0,
    });
  });

  it("fn'in hatası AYNI nesne olarak fırlar ve transaction sayılır, kilit hatası sayılmaz", () => {
    const failure = new Error("kasıtlı hata");
    let thrown: unknown;
    try {
      withImmediateTransaction(sqlite, () => {
        throw failure;
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(failure);

    const stats = takeWriteTransactionStats();
    expect(stats.count).toBe(1);
    expect(stats.lockFailures).toBe(0);
  });

  it("başka bağlantı yazma kilidini tutarken SQLITE_BUSY değişmeden fırlar ve lockFailures artar", () => {
    const holder = openDatabaseConnection(dbPath);
    // Beklemeyi kısaltmak için yalnız bu testin bağlantısında busy_timeout 0.
    sqlite.pragma("busy_timeout = 0");
    holder.exec("BEGIN IMMEDIATE");
    try {
      let thrown: unknown;
      try {
        withImmediateTransaction(sqlite, () => {
          sqlite.prepare("INSERT INTO test_counter (id, value) VALUES (3, 30)").run();
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Database.SqliteError);
      expect(extractTransientSqliteLockError(thrown)).toBe(thrown);

      const stats = takeWriteTransactionStats();
      expect(stats.count).toBe(1);
      expect(stats.lockFailures).toBe(1);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
  });

  it("iç içe çağrı (SAVEPOINT) ayrı bir transaction olarak sayılmaz", () => {
    const inner = withImmediateTransaction(sqlite, () =>
      withImmediateTransaction(sqlite, () => "iç"),
    );
    expect(inner).toBe("iç");
    expect(takeWriteTransactionStats().count).toBe(1);
  });

  it("p99 nearest-rank'tır; kapasite aşıldığında count ve max tam kalır", () => {
    // Süreler performance.now() ile belirlenir: i. transaction i ms sürer,
    // sonuncusu 50 000 ms. Math.random 0 → rezervuarın 0. yuvası değişir.
    const durations = [
      ...Array.from({ length: WRITE_TX_SAMPLE_CAPACITY }, (_, i) => i + 1),
      50_000,
    ];
    let clock = 0;
    let call = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      const index = Math.floor(call / 2);
      if (call % 2 === 1) {
        clock += durations[index]!;
      }
      call++;
      return clock;
    });
    vi.spyOn(Math, "random").mockReturnValue(0);

    for (let i = 0; i < durations.length; i++) {
      withImmediateTransaction(sqlite, () => undefined);
    }

    const stats = takeWriteTransactionStats();
    expect(stats.count).toBe(WRITE_TX_SAMPLE_CAPACITY + 1);
    expect(stats.maxMs).toBe(50_000);
    // Rezervuar: 2..10000 ve 50000 (1 ms'lik örneğin yerini aldı);
    // rank = ceil(0.99 × 10000) = 9900 → 9901 ms.
    expect(stats.p99Ms).toBe(9901);
  });
});

describe("createDb", () => {
  let dir: string;
  let sqlite: SqliteConnection;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-drizzle-"));
    sqlite = openDatabaseConnection(path.join(dir, "test.sqlite"), {
      createIfMissing: true,
    });
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ham better-sqlite3 bağlantısını $client üzerinden geri verir", () => {
    const db = createDb(sqlite);
    expect(db.$client).toBe(sqlite);
  });
});

/**
 * DÜZELTME TURU 2 — denetim bulgusu ("high", `guvenlik` merceği): bkz.
 * `../../src/server/data/db.ts` `extractTransientSqliteLockError` üst
 * notu. Uçtan uca (route seviyesinde) tekrar üretim
 * `tests/integration/session-routes.test.ts`'te; burada sınıflandırıcının
 * KENDİSİ, GERÇEK bir kilit dahil, izole olarak sınanır (mock/`:memory:`
 * yasağı gerçek `better-sqlite3` bağlantısıyla korunur).
 */
describe("extractTransientSqliteLockError", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-lock-"));
    dbPath = path.join(dir, "test.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it(
    "gerçek eşzamanlı BEGIN IMMEDIATE kilidinden doğan SQLITE_BUSY'i doğrudan tanır",
    () => {
      const writer = openDatabaseConnection(dbPath, { createIfMissing: true });
      writer.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      const locker = openDatabaseConnection(dbPath);
      locker.exec("BEGIN IMMEDIATE");
      try {
        let caught: unknown;
        try {
          writer.prepare("INSERT INTO t (id) VALUES (1)").run();
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(Database.SqliteError);
        const lockError = extractTransientSqliteLockError(caught);
        expect(lockError).toBeDefined();
        expect(lockError?.code).toBe("SQLITE_BUSY");
      } finally {
        locker.exec("ROLLBACK");
        locker.close();
        writer.close();
      }
    },
    10_000,
  );

  it("DrizzleQueryError gibi bir sarmalayıcının .cause'undaki SqliteError'ı da tanır (Drizzle'ın asenkron API'sinin gerçek sarma davranışı)", () => {
    const inner = new Database.SqliteError("database is locked", "SQLITE_BUSY");
    const wrapper = new Error("Failed query: insert into ...");
    (wrapper as { cause?: unknown }).cause = inner;

    const lockError = extractTransientSqliteLockError(wrapper);
    expect(lockError).toBe(inner);
  });

  it("ilgisiz bir hatayı geçici kilit SAYMAZ", () => {
    expect(
      extractTransientSqliteLockError(new Error("başka bir hata")),
    ).toBeUndefined();
  });

  it("kilit DIŞI bir SqliteError'ı (ör. UNIQUE kısıt ihlali) geçici kilit SAYMAZ — 409/422 kendi yoluna bırakılır, 503'e gizlenmez", () => {
    const constraintError = new Database.SqliteError(
      "UNIQUE constraint failed: t.id",
      "SQLITE_CONSTRAINT_UNIQUE",
    );
    expect(extractTransientSqliteLockError(constraintError)).toBeUndefined();
  });

  it("SQLITE_LOCKED kodunu da (SQLITE_BUSY ile aynı) geçici kilit sayar", () => {
    const lockedError = new Database.SqliteError(
      "database table is locked",
      "SQLITE_LOCKED",
    );
    expect(extractTransientSqliteLockError(lockedError)).toBe(lockedError);
  });
});

describe("resolveDbPathFromEnv", () => {
  it("DOLMUS_DB_PATH tanımlıysa değeri döner", () => {
    expect(resolveDbPathFromEnv({ DOLMUS_DB_PATH: "./data/dev.sqlite" })).toBe(
      "./data/dev.sqlite",
    );
  });

  it("DOLMUS_DB_PATH eksikse anlaşılır hata fırlatır", () => {
    expect(() => resolveDbPathFromEnv({})).toThrow(/DOLMUS_DB_PATH/);
  });

  it("DOLMUS_DB_PATH boş dizeyse anlaşılır hata fırlatır", () => {
    expect(() => resolveDbPathFromEnv({ DOLMUS_DB_PATH: "   " })).toThrow(
      /DOLMUS_DB_PATH/,
    );
  });
});
