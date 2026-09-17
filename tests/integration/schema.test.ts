import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertMigrationsApplied,
  assertSupportedSqliteVersion,
  createDb,
  openDatabaseConnection,
  PendingMigrationsError,
  UnsupportedSqliteVersionError,
  type SqliteConnection,
} from "../../src/server/data/db";

/**
 * Şema + migration entegrasyon testleri (S1.1 ADIM 2/3).
 *
 * QA-PLAN.md §1 — "Finansal DB testleri yalnız mock veya :memory: üzerinde
 * kabul edilmez." Her test kendi geçici gerçek SQLite dosyasını açar,
 * gerçek `drizzle-orm/better-sqlite3/migrator` ile ARCHITECTURE.md
 * §3.2'deki tabloları kurar ve gerçek SQL ile (mock YOK) kısıtları dener.
 *
 * Kapsanan görev gereksinimleri (S1.1 ADIM 2 kapı listesi):
 * - PRAGMA'lar (foreign_keys/WAL/synchronous/busy_timeout) — ayrıca
 *   `tests/integration/db-connection.test.ts`'te; burada migration'la
 *   birlikte de doğrulanır.
 * - SQLite sürüm kapısı (gerçek bağlantıya karşı geçme/reddetme).
 * - Migration iki kez çalışınca tablo/indeks sayısı çoğalmaz.
 * - Yanlış işletmeye ait kişi/araç/atama satırı birleşik FK ile reddedilir.
 * - UNIQUE kısıtları: plate_normalized, vehicle_credentials(vehicle,role),
 *   sessions.token_hash, mutation_receipts(scope_key, request_id).
 * - CHECK kısıtları: role/work_kind/status/actor_kind ve K3 süre sınırı.
 * - DB kapatılıp yeniden açılınca veri korunur.
 */

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsFolder = path.join(projectRoot, "drizzle");

function uuid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function countByType(sqlite: SqliteConnection, type: "table" | "index"): number {
  const row = sqlite
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = ?")
    .get(type) as { count: number };
  return row.count;
}

const APP_TABLES = [
  "businesses",
  "people",
  "vehicles",
  "vehicle_drivers",
  "vehicle_credentials",
  "platform_users",
  "sessions",
  "work_entries",
  "work_entry_revisions",
  "cash_confirmations",
  "mutation_receipts",
  "admin_audit",
];

describe("schema migration (S1.1 ADIM 2)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-takip-schema-"));
    dbPath = path.join(dir, "test.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function openAndMigrate(
    options: { createIfMissing?: boolean } = { createIfMissing: true },
  ): SqliteConnection {
    const sqlite = openDatabaseConnection(dbPath, options);
    const db = createDb(sqlite);
    migrate(db, { migrationsFolder });
    return sqlite;
  }

  it("ilk kurulumda ARCHITECTURE.md §3.2'deki tüm tabloları oluşturur", () => {
    const sqlite = openAndMigrate();
    try {
      const names = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((r) => (r as { name: string }).name);
      for (const table of APP_TABLES) {
        expect(names).toContain(table);
      }
    } finally {
      sqlite.close();
    }
  });

  it("PRAGMA'lar migration sonrasında da korunur (foreign_keys/WAL/synchronous/busy_timeout)", () => {
    const sqlite = openAndMigrate();
    try {
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(sqlite.pragma("synchronous", { simple: true })).toBe(2);
      expect(sqlite.pragma("busy_timeout", { simple: true })).toBe(2000);
    } finally {
      sqlite.close();
    }
  });

  it("migration iki kez çalışınca tablo/indeks sayısı çoğalmaz (STORIES S1.1)", () => {
    const first = openAndMigrate();
    const tablesAfterFirst = countByType(first, "table");
    const indexesAfterFirst = countByType(first, "index");
    first.close();

    // db:init'in tekrar çalıştırılmasını taklit eder: dosya zaten var,
    // createIfMissing gerekmez.
    const second = openAndMigrate({ createIfMissing: false });
    const tablesAfterSecond = countByType(second, "table");
    const indexesAfterSecond = countByType(second, "index");
    second.close();

    expect(tablesAfterSecond).toBe(tablesAfterFirst);
    expect(indexesAfterSecond).toBe(indexesAfterFirst);
  });

  it("DB kapatılıp yeniden açılınca veri korunur (restart)", () => {
    const first = openAndMigrate();
    const businessId = uuid();
    first
      .prepare(
        "INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)",
      )
      .run(businessId, "Kalıcı İşletme", nowIso());
    first.close();

    const second = openDatabaseConnection(dbPath);
    try {
      const row = second
        .prepare("SELECT name FROM businesses WHERE id = ?")
        .get(businessId) as { name: string } | undefined;
      expect(row?.name).toBe("Kalıcı İşletme");
    } finally {
      second.close();
    }
  });

  describe("assertMigrationsApplied — açılışta bekleyen migration kapısı", () => {
    it("tüm migration'lar uygulanmışken hata vermez (pozitif kontrol)", () => {
      const sqlite = openAndMigrate();
      try {
        expect(() =>
          assertMigrationsApplied(sqlite, migrationsFolder),
        ).not.toThrow();
      } finally {
        sqlite.close();
      }
    });

    it("diskte olup DB'de uygulanmamış bir migration varsa PendingMigrationsError fırlatır", () => {
      const sqlite = openAndMigrate();
      try {
        // Gerçek migration klasörünü, henüz uygulanmamış EK bir migration
        // dosyasıyla birlikte geçici bir klasöre kopyala (mock DEĞİL —
        // `assertMigrationsApplied` bu klasörü ve gerçek DB'yi normal
        // şekilde okur; yalnız test kurgusu "yeni migration eklendi ama
        // db:init çalıştırılmadı" durumunu üretir).
        const journalPath = path.join(migrationsFolder, "meta/_journal.json");
        const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
          version: string;
          dialect: string;
          entries: {
            idx: number;
            version: string;
            when: number;
            tag: string;
            breakpoints: boolean;
          }[];
        };

        const pendingTag = "0001_pending_test_only";
        const pendingDir = fs.mkdtempSync(
          path.join(os.tmpdir(), "dolmus-takip-pending-migrations-"),
        );
        fs.mkdirSync(path.join(pendingDir, "meta"), { recursive: true });

        // Uygulanmış olan migration dosyalarını AYNEN kopyala (hash eşleşmesi
        // için içerik birebir korunmalı).
        for (const entry of journal.entries) {
          fs.copyFileSync(
            path.join(migrationsFolder, `${entry.tag}.sql`),
            path.join(pendingDir, `${entry.tag}.sql`),
          );
        }
        // Henüz DB'de karşılığı olmayan yeni bir migration dosyası ekle.
        fs.writeFileSync(
          path.join(pendingDir, `${pendingTag}.sql`),
          "-- yalnız test: gerçek uygulamada hiç çalıştırılmaz\n",
        );

        const pendingJournal = {
          ...journal,
          entries: [
            ...journal.entries,
            {
              idx: journal.entries.length,
              version: journal.entries[0]?.version ?? "6",
              when: Date.now(),
              tag: pendingTag,
              breakpoints: true,
            },
          ],
        };
        fs.writeFileSync(
          path.join(pendingDir, "meta/_journal.json"),
          JSON.stringify(pendingJournal, null, 2),
        );

        try {
          expect(() => assertMigrationsApplied(sqlite, pendingDir)).toThrow(
            PendingMigrationsError,
          );
          expect(() => assertMigrationsApplied(sqlite, pendingDir)).toThrow(
            /1 migration henüz uygulanmamış/,
          );
        } finally {
          fs.rmSync(pendingDir, { recursive: true, force: true });
        }
      } finally {
        sqlite.close();
      }
    });
  });

  describe("SQLite sürüm kapısı (ARCHITECTURE.md §3.6)", () => {
    it("gerçek bağlantı çalışan sürümün altındaki bir eşiği geçer", () => {
      const sqlite = openAndMigrate();
      try {
        const version = assertSupportedSqliteVersion(sqlite, "0.0.1");
        expect(typeof version).toBe("string");
        expect(version.split(".").length).toBeGreaterThanOrEqual(2);
      } finally {
        sqlite.close();
      }
    });

    it("gerçek bağlantı çalışan sürümün üstündeki bir eşikte reddedilir", () => {
      const sqlite = openAndMigrate();
      expect(() => assertSupportedSqliteVersion(sqlite, "999.0.0")).toThrow(
        UnsupportedSqliteVersionError,
      );
    });
  });

  describe("Birleşik FK: yanlış işletmeye ilişki reddi", () => {
    let sqlite: SqliteConnection;
    let bizA: string;
    let bizB: string;
    let ownerA: string;
    let ownerB: string;
    let vehA: string;

    beforeEach(() => {
      sqlite = openAndMigrate();
      bizA = uuid();
      bizB = uuid();
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizA, "İşletme A", nowIso());
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizB, "İşletme B", nowIso());

      ownerA = uuid();
      ownerB = uuid();
      sqlite
        .prepare(
          "INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)",
        )
        .run(bizA, ownerA, "Sahip A");
      sqlite
        .prepare(
          "INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)",
        )
        .run(bizB, ownerB, "Sahip B");

      vehA = uuid();
      sqlite
        .prepare(
          "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
        )
        .run(bizA, vehA, "34AAA001", ownerA);
    });

    afterEach(() => {
      sqlite.close();
    });

    it("aynı işletmedeki sahiple araç oluşturma kabul edilir (pozitif kontrol)", () => {
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
          )
          .run(bizA, uuid(), "34AAA099", ownerA),
      ).not.toThrow();
    });

    it("başka işletmenin kişisini sahip yapan araç reddedilir (vehicles.owner_person_id)", () => {
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
          )
          .run(bizA, uuid(), "34AAA002", ownerB),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it("başka işletmenin kişisini şoför atayan vehicle_drivers reddedilir", () => {
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO vehicle_drivers (business_id, vehicle_id, person_id, active, version) VALUES (?, ?, ?, 1, 1)",
          )
          .run(bizA, vehA, ownerB),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it("business_id uyuşmayan aracı referanslayan vehicle_drivers reddedilir", () => {
      // vehA gerçekte bizA'ya ait; bizB kapsamında bu vehicle_id ile atama
      // denemesi birleşik FK (business_id, vehicle_id) tarafından reddedilir.
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO vehicle_drivers (business_id, vehicle_id, person_id, active, version) VALUES (?, ?, ?, 1, 1)",
          )
          .run(bizB, vehA, ownerB),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it("aynı işletmedeki araç+şoför ataması kabul edilir (pozitif kontrol)", () => {
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO vehicle_drivers (business_id, vehicle_id, person_id, active, version) VALUES (?, ?, ?, 1, 1)",
          )
          .run(bizA, vehA, ownerA),
      ).not.toThrow();
    });
  });

  describe("UNIQUE kısıtları", () => {
    let sqlite: SqliteConnection;

    beforeEach(() => {
      sqlite = openAndMigrate();
    });

    afterEach(() => {
      sqlite.close();
    });

    it("vehicles.plate_normalized platform genelinde UNIQUE'dir (farklı işletmeler dahil)", () => {
      const bizA = uuid();
      const bizB = uuid();
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizA, "A", nowIso());
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizB, "B", nowIso());
      const ownerA = uuid();
      const ownerB = uuid();
      sqlite
        .prepare("INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)")
        .run(bizA, ownerA, "A");
      sqlite
        .prepare("INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)")
        .run(bizB, ownerB, "B");
      sqlite
        .prepare(
          "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
        )
        .run(bizA, uuid(), "34XYZ001", ownerA);

      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
          )
          .run(bizB, uuid(), "34XYZ001", ownerB),
      ).toThrow(/UNIQUE constraint failed/);
    });

    it("vehicle_credentials aynı araç+rol için ikinci kaydı reddeder", () => {
      const bizA = uuid();
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizA, "A", nowIso());
      const ownerA = uuid();
      sqlite
        .prepare("INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)")
        .run(bizA, ownerA, "A");
      const vehA = uuid();
      sqlite
        .prepare(
          "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
        )
        .run(bizA, vehA, "34UNQ001", ownerA);
      sqlite
        .prepare(
          "INSERT INTO vehicle_credentials (business_id, id, vehicle_id, role, password_hash, credential_version) VALUES (?, ?, ?, 'owner', 'hash1', 1)",
        )
        .run(bizA, uuid(), vehA);

      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO vehicle_credentials (business_id, id, vehicle_id, role, password_hash, credential_version) VALUES (?, ?, ?, 'owner', 'hash2', 1)",
          )
          .run(bizA, uuid(), vehA),
      ).toThrow(/UNIQUE constraint failed/);

      // Aynı araçta farklı rol (driver) kabul edilir (pozitif kontrol).
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO vehicle_credentials (business_id, id, vehicle_id, role, password_hash, credential_version) VALUES (?, ?, ?, 'driver', 'hash3', 1)",
          )
          .run(bizA, uuid(), vehA),
      ).not.toThrow();
    });

    it("sessions.token_hash UNIQUE'dir", () => {
      const platformUserId = uuid();
      sqlite
        .prepare(
          "INSERT INTO platform_users (id, username, password_hash, platform_role, active, credential_version) VALUES (?, ?, 'hash', 'admin', 1, 1)",
        )
        .run(platformUserId, "yonetici1");
      const commonTokenHash = "a".repeat(64);
      sqlite
        .prepare(
          "INSERT INTO sessions (id, token_hash, credential_id, platform_user_id, issued_version, created_at, last_seen_at, expires_at) VALUES (?, ?, NULL, ?, 1, ?, ?, ?)",
        )
        .run(uuid(), commonTokenHash, platformUserId, nowIso(), nowIso(), nowIso());

      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO sessions (id, token_hash, credential_id, platform_user_id, issued_version, created_at, last_seen_at, expires_at) VALUES (?, ?, NULL, ?, 1, ?, ?, ?)",
          )
          .run(uuid(), commonTokenHash, platformUserId, nowIso(), nowIso(), nowIso()),
      ).toThrow(/UNIQUE constraint failed/);
    });

    it("mutation_receipts (scope_key, request_id) UNIQUE'dir", () => {
      sqlite
        .prepare(
          "INSERT INTO mutation_receipts (scope_key, request_id, operation, request_hash, entity_id, result_version, response_code, created_at) VALUES (?, ?, 'create_work_entry', 'hash-a', ?, 1, 201, ?)",
        )
        .run("vehicle:veh-1", "req-1", uuid(), nowIso());

      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO mutation_receipts (scope_key, request_id, operation, request_hash, entity_id, result_version, response_code, created_at) VALUES (?, ?, 'create_work_entry', 'hash-b', ?, 1, 201, ?)",
          )
          .run("vehicle:veh-1", "req-1", uuid(), nowIso()),
      ).toThrow(/UNIQUE constraint failed|constraint failed: mutation_receipts/);

      // Farklı scope_key ile aynı request_id kabul edilir (kapsam ayrımı doğru çalışıyor).
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO mutation_receipts (scope_key, request_id, operation, request_hash, entity_id, result_version, response_code, created_at) VALUES (?, ?, 'create_work_entry', 'hash-c', ?, 1, 201, ?)",
          )
          .run("vehicle:veh-2", "req-1", uuid(), nowIso()),
      ).not.toThrow();
    });

    it("vehicle_drivers üçlü anahtar için ikinci kaydı reddeder", () => {
      const bizA = uuid();
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizA, "A", nowIso());
      const ownerA = uuid();
      sqlite
        .prepare("INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)")
        .run(bizA, ownerA, "A");
      const vehA = uuid();
      sqlite
        .prepare(
          "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
        )
        .run(bizA, vehA, "34UNQ099", ownerA);
      sqlite
        .prepare(
          "INSERT INTO vehicle_drivers (business_id, vehicle_id, person_id, active, version) VALUES (?, ?, ?, 1, 1)",
        )
        .run(bizA, vehA, ownerA);

      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO vehicle_drivers (business_id, vehicle_id, person_id, active, version) VALUES (?, ?, ?, 0, 2)",
          )
          .run(bizA, vehA, ownerA),
      ).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
    });
  });

  describe("CHECK kısıtları (status/role/kind ve K3 süre sınırı)", () => {
    let sqlite: SqliteConnection;
    let bizA: string;
    let ownerA: string;
    let vehA: string;

    beforeEach(() => {
      sqlite = openAndMigrate();
      bizA = uuid();
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizA, "A", nowIso());
      ownerA = uuid();
      sqlite
        .prepare("INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)")
        .run(bizA, ownerA, "A");
      vehA = uuid();
      sqlite
        .prepare(
          "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
        )
        .run(bizA, vehA, "34CHK001", ownerA);
    });

    afterEach(() => {
      sqlite.close();
    });

    it("vehicle_credentials.role geçersiz değeri reddeder", () => {
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO vehicle_credentials (business_id, id, vehicle_id, role, password_hash, credential_version) VALUES (?, ?, ?, 'superadmin', 'hash', 1)",
          )
          .run(bizA, uuid(), vehA),
      ).toThrow(/CHECK constraint failed/);
    });

    function insertWorkEntry(overrides: Partial<Record<string, unknown>> = {}) {
      const base = {
        businessId: bizA,
        id: uuid(),
        vehicleId: vehA,
        personId: ownerA,
        workKind: "owner",
        workDate: "2026-09-17",
        startsAt: nowIso(),
        endsAt: nowIso(),
        durationMinutes: 570,
        grossCents: 1_000_000,
        fuelCents: 150_000,
        otherExpenseCents: 30_000,
        shareBps: 0,
        shareCents: 0,
        remainderCents: 820_000,
        status: "not_required",
        ...overrides,
      };
      return sqlite
        .prepare(
          `INSERT INTO work_entries (
            business_id, id, vehicle_id, person_id, work_kind, work_date,
            starts_at, ends_at, duration_minutes, gross_cents, fuel_cents,
            other_expense_cents, share_bps, share_cents, remainder_cents,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          base.businessId,
          base.id,
          base.vehicleId,
          base.personId,
          base.workKind,
          base.workDate,
          base.startsAt,
          base.endsAt,
          base.durationMinutes,
          base.grossCents,
          base.fuelCents,
          base.otherExpenseCents,
          base.shareBps,
          base.shareCents,
          base.remainderCents,
          base.status,
        );
    }

    it("PRD/K3 örneği: aynı gün 08:00–17:30 → 570 dakika kabul edilir (pozitif kontrol)", () => {
      expect(() => insertWorkEntry()).not.toThrow();
    });

    it("K3 — süre 0 veya negatif olamaz", () => {
      expect(() => insertWorkEntry({ durationMinutes: 0 })).toThrow(
        /CHECK constraint failed/,
      );
    });

    it("K3 — süre 1440 dakikayı (24 saat) aşamaz", () => {
      expect(() => insertWorkEntry({ durationMinutes: 1441 })).toThrow(
        /CHECK constraint failed/,
      );
    });

    it("work_entries.status geçersiz değeri reddeder", () => {
      expect(() => insertWorkEntry({ status: "approved" })).toThrow(
        /CHECK constraint failed/,
      );
    });

    it("work_entries.work_kind geçersiz değeri reddeder", () => {
      expect(() => insertWorkEntry({ workKind: "manager" })).toThrow(
        /CHECK constraint failed/,
      );
    });

    it("§3.3 hesap kuralı v1 — share_bps yalnız 0 veya 2000 olabilir", () => {
      expect(() => insertWorkEntry({ shareBps: 1000 })).toThrow(
        /CHECK constraint failed/,
      );
    });

    it("girdi tutarları negatif olamaz (§3.3)", () => {
      expect(() => insertWorkEntry({ grossCents: -1 })).toThrow(
        /CHECK constraint failed/,
      );
    });
  });

  describe("cash_confirmations → work_entry_revisions birleşik FK", () => {
    let sqlite: SqliteConnection;
    let bizA: string;
    let ownerA: string;
    let vehA: string;
    let entryId: string;
    let platformUserId: string;

    beforeEach(() => {
      sqlite = openAndMigrate();
      bizA = uuid();
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizA, "A", nowIso());
      ownerA = uuid();
      sqlite
        .prepare("INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)")
        .run(bizA, ownerA, "A");
      vehA = uuid();
      sqlite
        .prepare(
          "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
        )
        .run(bizA, vehA, "34CSH001", ownerA);
      entryId = uuid();
      sqlite
        .prepare(
          `INSERT INTO work_entries (
            business_id, id, vehicle_id, person_id, work_kind, work_date,
            starts_at, ends_at, duration_minutes, gross_cents, fuel_cents,
            other_expense_cents, share_bps, share_cents, remainder_cents, status
          ) VALUES (?, ?, ?, ?, 'driver', '2026-09-17', ?, ?, 570, 1000000, 150000, 30000, 2000, 200000, 620000, 'pending')`,
        )
        .run(bizA, entryId, vehA, ownerA, nowIso(), nowIso());

      platformUserId = uuid();
      sqlite
        .prepare(
          "INSERT INTO platform_users (id, username, password_hash, platform_role, active, credential_version) VALUES (?, ?, 'hash', 'support', 1, 1)",
        )
        .run(platformUserId, "destek1");

      sqlite
        .prepare(
          `INSERT INTO work_entry_revisions (
            business_id, entry_id, version, action, snapshot_json,
            actor_kind, actor_session_id, actor_role,
            actor_credential_id, actor_platform_user_id,
            on_behalf_of_kind, on_behalf_of_person_id, created_at
          ) VALUES (?, ?, 1, 'create', '{}', 'platform_user', ?, 'support', NULL, ?, NULL, NULL, ?)`,
        )
        .run(bizA, entryId, uuid(), platformUserId, nowIso());
    });

    afterEach(() => {
      sqlite.close();
    });

    it("gerçek revizyona (doğru entry_version) onay eklenmesi kabul edilir", () => {
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO cash_confirmations (
              business_id, id, entry_id, entry_version, received_cents, confirmed_at,
              actor_kind, actor_session_id, actor_role, actor_credential_id,
              actor_platform_user_id, on_behalf_of_kind, on_behalf_of_person_id
            ) VALUES (?, ?, ?, 1, 600000, ?, 'platform_user', ?, 'support', NULL, ?, 'owner', ?)`,
          )
          .run(bizA, uuid(), entryId, nowIso(), uuid(), platformUserId, ownerA),
      ).not.toThrow();
    });

    it("var olmayan sürüme (entry_version uyuşmazlığı) onay reddedilir", () => {
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO cash_confirmations (
              business_id, id, entry_id, entry_version, received_cents, confirmed_at,
              actor_kind, actor_session_id, actor_role, actor_credential_id,
              actor_platform_user_id, on_behalf_of_kind, on_behalf_of_person_id
            ) VALUES (?, ?, ?, 2, 600000, ?, 'platform_user', ?, 'support', NULL, ?, 'owner', ?)`,
          )
          .run(bizA, uuid(), entryId, nowIso(), uuid(), platformUserId, ownerA),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it("negatif alınan tutar reddedilir (K5)", () => {
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO cash_confirmations (
              business_id, id, entry_id, entry_version, received_cents, confirmed_at,
              actor_kind, actor_session_id, actor_role, actor_credential_id,
              actor_platform_user_id, on_behalf_of_kind, on_behalf_of_person_id
            ) VALUES (?, ?, ?, 1, -1, ?, 'platform_user', ?, 'support', NULL, ?, 'owner', ?)`,
          )
          .run(bizA, uuid(), entryId, nowIso(), uuid(), platformUserId, ownerA),
      ).toThrow(/CHECK constraint failed/);
    });
  });

  describe("sessions actor exclusivity CHECK (§3.2 — İki aktör türünden tam biri)", () => {
    let sqlite: SqliteConnection;

    beforeEach(() => {
      sqlite = openAndMigrate();
    });

    afterEach(() => {
      sqlite.close();
    });

    it("credential_id ve platform_user_id ikisi de NULL olunca reddedilir", () => {
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO sessions (id, token_hash, credential_id, platform_user_id, issued_version, created_at, last_seen_at, expires_at) VALUES (?, ?, NULL, NULL, 1, ?, ?, ?)",
          )
          .run(uuid(), "b".repeat(64), nowIso(), nowIso(), nowIso()),
      ).toThrow(/CHECK constraint failed/);
    });

    it("credential_id ve platform_user_id ikisi de dolu olunca reddedilir", () => {
      const platformUserId = uuid();
      sqlite
        .prepare(
          "INSERT INTO platform_users (id, username, password_hash, platform_role, active, credential_version) VALUES (?, ?, 'hash', 'admin', 1, 1)",
        )
        .run(platformUserId, "yonetici2");

      const bizA = uuid();
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizA, "A", nowIso());
      const ownerA = uuid();
      sqlite
        .prepare("INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)")
        .run(bizA, ownerA, "A");
      const vehA = uuid();
      sqlite
        .prepare(
          "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
        )
        .run(bizA, vehA, "34SES001", ownerA);
      const credentialId = uuid();
      sqlite
        .prepare(
          "INSERT INTO vehicle_credentials (business_id, id, vehicle_id, role, password_hash, credential_version) VALUES (?, ?, ?, 'owner', 'hash', 1)",
        )
        .run(bizA, credentialId, vehA);

      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO sessions (id, token_hash, credential_id, platform_user_id, issued_version, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)",
          )
          .run(uuid(), "c".repeat(64), credentialId, platformUserId, nowIso(), nowIso(), nowIso()),
      ).toThrow(/CHECK constraint failed/);
    });
  });

  describe("admin_audit.on_behalf_of_person_id — business_id NULL iken FK (düzeltme turu 1)", () => {
    // Audit bulgusu: admin_audit.business_id §3.2 gereği nullable
    // ("gerektiğinde"). SQLite'ta birleşik bir FK'nin (business_id,
    // on_behalf_of_person_id) herhangi bir çocuk sütunu NULL ise kısıt
    // denetlenmeden geçer (https://www.sqlite.org/foreignkeys.html).
    // vehicle_id zaten tekil sütunlu ayrı bir FK'ye sahip olduğundan bu
    // durumda da korunuyordu; on_behalf_of_person_id'ye eklenen eşdeğer
    // tekil sütunlu FK (actorTrackingColumns()) burada doğrulanır.
    //
    // GÜNCELLEME (düzeltme turu 3 — audit bulgusu): tekil sütunlu FK yalnız
    // "kişi var mı" sorusunu cevaplıyordu, "hangi işletmeye ait" sorusunu
    // değil (people.id PRIMARY KEY, işletmeden bağımsız global benzersiz).
    // Bu yüzden business_id NULL + var OLAN ama BAŞKA işletmeden bir kişi
    // reddedilmiyordu. Eklenen
    // `admin_audit_business_id_required_for_scoped_refs_check` artık
    // on_behalf_of_person_id (veya vehicle_id) doluyken business_id'yi de
    // zorunlu kılıyor; bu da aşağıdaki "business_id NULL + gerçek kişi
    // kabul edilir" pozitif kontrolünü GEÇERSİZ kıldı (artık reddediliyor)
    // — ayrıntılı çapraz-işletme senaryosu aşağıdaki "düzeltme turu 3" grubunda.
    let sqlite: SqliteConnection;
    let bizA: string;
    let bizB: string;
    let ownerA: string;
    let ownerB: string;
    let platformUserId: string;

    function insertAdminAudit(overrides: {
      businessId: string | null;
      onBehalfOfPersonId: string;
    }) {
      return sqlite
        .prepare(
          `INSERT INTO admin_audit (
            id, business_id, vehicle_id, entity_type, entity_id, action,
            before_json, after_json, actor_kind, actor_session_id, actor_role,
            actor_credential_id, actor_platform_user_id,
            on_behalf_of_kind, on_behalf_of_person_id, occurred_at
          ) VALUES (?, ?, NULL, 'person', ?, 'rename', NULL, '{}', 'platform_user', ?, 'support', NULL, ?, 'owner', ?, ?)`,
        )
        .run(
          uuid(),
          overrides.businessId,
          uuid(),
          uuid(),
          platformUserId,
          overrides.onBehalfOfPersonId,
          nowIso(),
        );
    }

    beforeEach(() => {
      sqlite = openAndMigrate();
      bizA = uuid();
      bizB = uuid();
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizA, "İşletme A", nowIso());
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizB, "İşletme B", nowIso());
      ownerA = uuid();
      ownerB = uuid();
      sqlite
        .prepare(
          "INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)",
        )
        .run(bizA, ownerA, "Sahip A");
      sqlite
        .prepare(
          "INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)",
        )
        .run(bizB, ownerB, "Sahip B");
      platformUserId = uuid();
      sqlite
        .prepare(
          "INSERT INTO platform_users (id, username, password_hash, platform_role, active, credential_version) VALUES (?, ?, 'hash', 'support', 1, 1)",
        )
        .run(platformUserId, "destek-audit");
    });

    afterEach(() => {
      sqlite.close();
    });

    it("business_id NULL + var olmayan on_behalf_of_person_id reddedilir (audit bulgusu; düzeltme turu 3'ten sonra CHECK ile)", () => {
      // Düzeltme turu 3 öncesi bu satır single-column FK'den
      // "FOREIGN KEY constraint failed" ile reddediliyordu; artık business_id
      // NULL + on_behalf_of_person_id DOLU kombinasyonunun kendisi
      // `admin_audit_business_id_required_for_scoped_refs_check` CHECK'ini
      // ihlal ettiğinden SQLite CHECK'i FK'den önce değerlendirip reddediyor
      // (kişinin var olup olmaması artık bu senaryoda hiç sorulmuyor —
      // business_id zaten NULL olduğu için reddediliyor). Sonuç aynı: satır
      // kabul edilmiyor.
      expect(() =>
        insertAdminAudit({
          businessId: null,
          onBehalfOfPersonId: "NONEXISTENT-PERSON-ID-XYZ",
        }),
      ).toThrow(/CHECK constraint failed/);
    });

    it("business_id NULL + gerçek kişi ID'si artık REDDEDİLİR (düzeltme turu 3 — eski pozitif kontrol geçersiz)", () => {
      // Bu test eskiden (düzeltme turu 1) "not.toThrow()" bekliyordu; o
      // varsayım tam da bu paketin turu 3 bulgusuydu (business_id NULL +
      // GERÇEK ama başka işletmeden bir kişi/araç sessizce kabul
      // edilebiliyordu). Artık business_id, on_behalf_of_person_id
      // doluyken zorunlu; ownerA gerçek ve var olsa da business_id NULL
      // olduğu sürece CHECK ile reddedilir.
      expect(() =>
        insertAdminAudit({ businessId: null, onBehalfOfPersonId: ownerA }),
      ).toThrow(/CHECK constraint failed/);
    });

    it("business_id dolu + başka işletmenin kişisi birleşik FK ile reddedilir (vehicle_id ile aynı desen)", () => {
      expect(() =>
        insertAdminAudit({ businessId: bizA, onBehalfOfPersonId: ownerB }),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it("business_id dolu + aynı işletmenin kişisi kabul edilir (pozitif kontrol)", () => {
      expect(() =>
        insertAdminAudit({ businessId: bizA, onBehalfOfPersonId: ownerA }),
      ).not.toThrow();
    });
  });

  describe("admin_audit.vehicle_id — business_id dolu iken çapraz-işletme reddi (düzeltme turu 2)", () => {
    // Audit bulgusu (düşük önem, güvenlik merceği): admin_audit_business_vehicle_fk
    // (businessId, vehicleId) -> vehicles(businessId, id) birleşik FK'sinin
    // "business_id dolu + başka işletmenin vehicle_id'si" reddini koruyan
    // otomatik bir regresyon testi yoktu (yalnız on_behalf_of_person_id için
    // yukarıdaki grup vardı). Aşağıdaki iki test, "Birleşik FK: yanlış
    // işletmeye ilişki reddi" grubundaki vehicle_drivers deseninin
    // admin_audit karşılığıdır.
    let sqlite: SqliteConnection;
    let bizA: string;
    let bizB: string;
    let ownerA: string;
    let ownerB: string;
    let vehA: string;
    let vehB: string;
    let platformUserId: string;

    function insertAdminAuditForVehicle(overrides: {
      businessId: string;
      vehicleId: string;
    }) {
      return sqlite
        .prepare(
          `INSERT INTO admin_audit (
            id, business_id, vehicle_id, entity_type, entity_id, action,
            before_json, after_json, actor_kind, actor_session_id, actor_role,
            actor_credential_id, actor_platform_user_id,
            on_behalf_of_kind, on_behalf_of_person_id, occurred_at
          ) VALUES (?, ?, ?, 'vehicle', ?, 'update', NULL, '{}', 'platform_user', ?, 'support', NULL, ?, NULL, NULL, ?)`,
        )
        .run(
          uuid(),
          overrides.businessId,
          overrides.vehicleId,
          uuid(),
          uuid(),
          platformUserId,
          nowIso(),
        );
    }

    beforeEach(() => {
      sqlite = openAndMigrate();
      bizA = uuid();
      bizB = uuid();
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizA, "İşletme A", nowIso());
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizB, "İşletme B", nowIso());
      ownerA = uuid();
      ownerB = uuid();
      sqlite
        .prepare(
          "INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)",
        )
        .run(bizA, ownerA, "Sahip A");
      sqlite
        .prepare(
          "INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)",
        )
        .run(bizB, ownerB, "Sahip B");
      vehA = uuid();
      vehB = uuid();
      sqlite
        .prepare(
          "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
        )
        .run(bizA, vehA, "34AUD001", ownerA);
      sqlite
        .prepare(
          "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
        )
        .run(bizB, vehB, "34AUD002", ownerB);
      platformUserId = uuid();
      sqlite
        .prepare(
          "INSERT INTO platform_users (id, username, password_hash, platform_role, active, credential_version) VALUES (?, ?, 'hash', 'support', 1, 1)",
        )
        .run(platformUserId, "destek-audit-2");
    });

    afterEach(() => {
      sqlite.close();
    });

    it("business_id dolu + başka işletmenin vehicle_id'si admin_audit_business_vehicle_fk ile reddedilir (vehicle_drivers ile aynı desen)", () => {
      expect(() =>
        insertAdminAuditForVehicle({ businessId: bizA, vehicleId: vehB }),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it("business_id dolu + aynı işletmenin vehicle_id'si kabul edilir (pozitif kontrol)", () => {
      expect(() =>
        insertAdminAuditForVehicle({ businessId: bizA, vehicleId: vehA }),
      ).not.toThrow();
    });
  });

  describe("admin_audit — business_id NULL + gerçek ama BAŞKA işletmeden ID reddi (düzeltme turu 3)", () => {
    // Audit bulgusu (orta önem, güvenlik merceği): business_id NULL iken
    // vehicle_id/on_behalf_of_person_id GERÇEK ama başka işletmeye ait bir
    // kayda sessizce bağlanabiliyordu. Kök neden: SQLite'ta birleşik FK'nin
    // (business_id, vehicle_id) / (business_id, on_behalf_of_person_id)
    // herhangi bir çocuk sütunu NULL ise kısıt tamamen atlanıyor
    // (https://www.sqlite.org/foreignkeys.html); turu 1'de eklenen tekil
    // sütunlu FK'ler yalnız "satır var mı" sorusunu cevaplıyor, hangi
    // işletmeye ait olduğunu değil (vehicles.id / people.id PRIMARY KEY,
    // işletmeden bağımsız global benzersiz). Gerçek geçici SQLite
    // dosyasına karşı doğrudan doğrulandı: düzeltme turu 3 öncesi
    // business_id=NULL + vehicle_id=<bizA'ya ait gerçek araç> INSERT'i
    // hatasız kabul ediliyordu.
    //
    // Kök neden düzeltmesi: `admin_audit_business_id_required_for_scoped_refs_check`
    // CHECK'i, vehicle_id veya on_behalf_of_person_id doluyken business_id'yi
    // de zorunlu kılıyor; böylece bu iki alan doluyken birleşik FK'ler asla
    // NULL business_id yüzünden atlanamıyor. business_id NULL kalabilen tek
    // durum ikisi de NULL olduğu, işletmeye bağlı olmayan işlemler (§3.2
    // "business_id/vehicle_id gerektiğinde", ör. ekip hesabı yönetimi).
    let sqlite: SqliteConnection;
    let bizA: string;
    let ownerA: string;
    let vehA: string;
    let platformUserId: string;

    function insertAdminAuditRow(overrides: {
      businessId: string | null;
      vehicleId: string | null;
      onBehalfOfKind: "owner" | "driver" | null;
      onBehalfOfPersonId: string | null;
    }) {
      return sqlite
        .prepare(
          `INSERT INTO admin_audit (
            id, business_id, vehicle_id, entity_type, entity_id, action,
            before_json, after_json, actor_kind, actor_session_id, actor_role,
            actor_credential_id, actor_platform_user_id,
            on_behalf_of_kind, on_behalf_of_person_id, occurred_at
          ) VALUES (?, ?, ?, 'vehicle', ?, 'update', NULL, '{}', 'platform_user', ?, 'support', NULL, ?, ?, ?, ?)`,
        )
        .run(
          uuid(),
          overrides.businessId,
          overrides.vehicleId,
          uuid(),
          uuid(),
          platformUserId,
          overrides.onBehalfOfKind,
          overrides.onBehalfOfPersonId,
          nowIso(),
        );
    }

    beforeEach(() => {
      sqlite = openAndMigrate();
      bizA = uuid();
      sqlite
        .prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)")
        .run(bizA, "İşletme A", nowIso());
      ownerA = uuid();
      sqlite
        .prepare(
          "INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)",
        )
        .run(bizA, ownerA, "Sahip A");
      vehA = uuid();
      sqlite
        .prepare(
          "INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, active, version) VALUES (?, ?, ?, ?, 1, 1)",
        )
        .run(bizA, vehA, "34AUD003", ownerA);
      platformUserId = uuid();
      sqlite
        .prepare(
          "INSERT INTO platform_users (id, username, password_hash, platform_role, active, credential_version) VALUES (?, ?, 'hash', 'support', 1, 1)",
        )
        .run(platformUserId, "destek-audit-3");
    });

    afterEach(() => {
      sqlite.close();
    });

    it("business_id NULL + gerçek (bizA'ya ait) vehicle_id reddedilir (audit bulgusunun tam senaryosu)", () => {
      expect(() =>
        insertAdminAuditRow({
          businessId: null,
          vehicleId: vehA,
          onBehalfOfKind: null,
          onBehalfOfPersonId: null,
        }),
      ).toThrow(/CHECK constraint failed/);
    });

    it("business_id NULL + gerçek (bizA'ya ait) on_behalf_of_person_id reddedilir (audit bulgusunun simetriği)", () => {
      expect(() =>
        insertAdminAuditRow({
          businessId: null,
          vehicleId: null,
          onBehalfOfKind: "owner",
          onBehalfOfPersonId: ownerA,
        }),
      ).toThrow(/CHECK constraint failed/);
    });

    it("business_id, vehicle_id VE on_behalf_of_person_id birlikte NULL kabul edilir (ekip hesabı yönetimi gibi işletmeye bağlı olmayan işlem — pozitif kontrol)", () => {
      expect(() =>
        insertAdminAuditRow({
          businessId: null,
          vehicleId: null,
          onBehalfOfKind: null,
          onBehalfOfPersonId: null,
        }),
      ).not.toThrow();
    });

    it("business_id dolu (bizA) + aynı işletmenin vehicle_id VE on_behalf_of_person_id'si birlikte kabul edilir (pozitif kontrol)", () => {
      expect(() =>
        insertAdminAuditRow({
          businessId: bizA,
          vehicleId: vehA,
          onBehalfOfKind: "owner",
          onBehalfOfPersonId: ownerA,
        }),
      ).not.toThrow();
    });
  });
});
