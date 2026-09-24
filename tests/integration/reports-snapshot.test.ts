/**
 * S5.5 okuma tutarlılığı: bir rapor yanıtının toplamı ve ayrıntısı TEK kısa okumadan
 * (tek SELECT veya tek ertelenmiş okuma işlemi) gelir. Araya, İKİNCİ GERÇEK bağlantıdan
 * commit edilen bir düzelt-ve-onayla ya tamamen eski ya tamamen yeni görüntü bırakır;
 * yeni tutar + eski onay karışımı olamaz. Tek bağlantı araya giremeyeceğinden bu test
 * aynı WAL dosyasına bağlı iki bağlantı kullanır.
 */
import { describe, expect, it } from "vitest";
import { resolveReportPeriod } from "../../src/lib/report-period";
import type { VehicleScope } from "../../src/server/auth/scope";
import { createDb, openDatabaseConnection, type AppDatabase, type SqliteConnection } from "../../src/server/data/db";
import {
  readOwnerSummaryForScope,
  readPeoplePeriodReportForScope,
  readPersonPeriodReportForScope,
  readVehiclePeriodReportForScope,
} from "../../src/server/usecases/reports";
import { listWorkEntriesForScope } from "../../src/server/usecases/work-entries/queries";
import { DAY, driverBody, ownerBody, SEED_IDS, setupReportHarness } from "./report-harness";

const period = resolveReportPeriod("month", DAY)!;
const scope: VehicleScope = {
  kind: "vehicle",
  actor: "owner",
  businessId: SEED_IDS.businessA,
  vehicleId: SEED_IDS.vehicleA1,
  credentialId: SEED_IDS.credA1Owner,
};

/** Eski görüntü: brüt 10.000 TL, alınan 6.000 TL (600000). Düzeltme sonrası: brüt 20.000 TL, alınan 12.345,67 TL. */
const OLD = { gross: "1000000", received: "600000", remainder: "620000" };
const NEW = { gross: "2000000", received: "1234567", remainder: "1620000" };

/**
 * İkinci bağlantıdan, tek transaction'da düzelt-ve-onayla (sürüm + 1 kayıt, revizyon, onay)
 * + sahip yeniden adlandırma. Onay v1'i 2'ye taşıdığından güncel sürüm okunur.
 */
function commitCorrectAndConfirm(writer: SqliteConnection, entryId: string): void {
  writer.transaction(() => {
    const { version } = writer.prepare("SELECT version FROM work_entries WHERE id = ?").get(entryId) as { version: number };
    writer
      .prepare("UPDATE work_entries SET version = version + 1, gross_cents = 2000000, remainder_cents = 1620000 WHERE id = ? AND version = ?")
      .run(entryId, version);
    writer
      .prepare(
        `INSERT INTO work_entry_revisions (business_id, entry_id, version, action, snapshot_json, actor_kind, actor_session_id, actor_role, actor_credential_id, created_at)
         SELECT business_id, entry_id, version + 1, 'correct_and_confirm', snapshot_json, actor_kind, actor_session_id, actor_role, actor_credential_id, created_at
         FROM work_entry_revisions WHERE entry_id = ? AND version = ?`,
      )
      .run(entryId, version);
    writer
      .prepare(
        `INSERT INTO cash_confirmations (business_id, id, entry_id, entry_version, received_cents, confirmed_at, actor_kind, actor_session_id, actor_role, actor_credential_id)
         SELECT business_id, 'second-connection-confirmation', entry_id, entry_version + 1, 1234567, confirmed_at, actor_kind, actor_session_id, actor_role, actor_credential_id
         FROM cash_confirmations WHERE entry_id = ? AND entry_version = ?`,
      )
      .run(entryId, version);
    writer.prepare("UPDATE people SET full_name = 'Yeni Sahip Adı', version = version + 1 WHERE id = ?").run(SEED_IDS.ownerA);
  })();
}

describe("rapor okuması tek anlık görüntüdür", () => {
  const h = setupReportHarness("reports-snapshot");

  /** Şoför kaydı + 6.000 TL onay; iki bağlantı (okuyucu, yazıcı) döner. */
  async function setup() {
    const entryId = await h.create(h.driver, driverBody("d-1"));
    await h.create(h.owner, ownerBody("o-1"));
    expect((await h.confirm(h.owner, entryId, { requestId: "k-1", version: 1, receivedCents: OLD.received })).status).toBe(200);
    const reader = openDatabaseConnection(h.dbPath, {});
    const writer = openDatabaseConnection(h.dbPath, {});
    return { entryId, reader, writer, close: () => (reader.close(), writer.close()) };
  }

  /**
   * `db.select` çağrılarını sayar ve `atCall`. çağrıdan ÖNCE `hook`'u çalıştırır: okuma
   * işleminin iki SELECT'i arasına başka bağlantıdan commit sokmanın tek yolu.
   */
  function withHook(db: AppDatabase, atCall: number, hook: () => void) {
    let calls = 0;
    const proxy = new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property === "select") {
          return (...args: unknown[]) => {
            calls++;
            if (calls === atCall) hook();
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return { db: proxy as AppDatabase, calls: () => calls };
  }

  it("kontrol: işlem dışı iki okuma araya giren commit'i görür (test boş geçmez)", async () => {
    const { entryId, reader, writer, close } = await setup();
    try {
      const db = createDb(reader);
      expect(readVehiclePeriodReportForScope(db, scope, period)).toMatchObject({ grossCents: "2000000", confirmedReceivedCents: OLD.received });
      commitCorrectAndConfirm(writer, entryId);
      expect(readVehiclePeriodReportForScope(db, scope, period)).toMatchObject({
        grossCents: "3000000",
        remainderCents: "2440000",
        confirmedReceivedCents: NEW.received,
      });
    } finally {
      close();
    }
  });

  it("sahip özeti: başlık ile toplamlar arasına commit girse de tamamı eski görüntüdür", async () => {
    const { entryId, reader, writer, close } = await setup();
    try {
      let inTransactionAtSecondRead = false;
      const { db, calls } = withHook(createDb(reader), 2, () => {
        inTransactionAtSecondRead = reader.inTransaction;
        commitCorrectAndConfirm(writer, entryId);
      });
      const summary = readOwnerSummaryForScope(db, scope, period);
      expect(calls()).toBe(2);
      expect(inTransactionAtSecondRead).toBe(true);
      // Tam ESKİ görüntü: eski ad + eski brüt (10.000 + sahip 10.000) + eski onay.
      expect(summary.owner.fullName).toBe("Ali Kaya");
      expect(summary).toMatchObject({ grossCents: "2000000", remainderCents: "1440000", confirmedReceivedCents: OLD.received });
      expect(reader.inTransaction).toBe(false);

      // Sonraki yanıt tam YENİ görüntüdür.
      const next = readOwnerSummaryForScope(createDb(reader), scope, period);
      expect(next.owner.fullName).toBe("Yeni Sahip Adı");
      expect(next).toMatchObject({ grossCents: "3000000", remainderCents: "2440000", confirmedReceivedCents: NEW.received });
    } finally {
      close();
    }
  });

  it("kişi detayı: toplam ile kayıt sayfası arasına commit girse de ikisi de eski sürümdendir", async () => {
    const { entryId, reader, writer, close } = await setup();
    try {
      let inTransactionAtSecondRead = false;
      const { db, calls } = withHook(createDb(reader), 2, () => {
        inTransactionAtSecondRead = reader.inTransaction;
        commitCorrectAndConfirm(writer, entryId);
      });
      const report = readPersonPeriodReportForScope(db, scope, period, SEED_IDS.driverA1a, { limit: 50 })!;
      expect(calls()).toBe(2);
      expect(inTransactionAtSecondRead).toBe(true);
      expect(report.person.grossCents).toBe(OLD.gross);
      expect(report.person.remainderCents).toBe(OLD.remainder);
      expect(report.entries).toHaveLength(1);
      expect(report.entries[0]).toMatchObject({ id: entryId, grossCents: OLD.gross, remainderCents: OLD.remainder });
      expect(reader.inTransaction).toBe(false);

      const next = readPersonPeriodReportForScope(createDb(reader), scope, period, SEED_IDS.driverA1a, { limit: 50 })!;
      expect(next.person.grossCents).toBe(NEW.gross);
      expect(next.entries[0]).toMatchObject({ grossCents: NEW.gross, remainderCents: NEW.remainder });
    } finally {
      close();
    }
  });

  it("araç raporu, kişi listesi ve gün gün liste tek SELECT'tir; işlem açık bırakılmaz", async () => {
    const { reader, close } = await setup();
    try {
      const reads: [string, (db: AppDatabase) => unknown][] = [
        ["vehicle", (db) => readVehiclePeriodReportForScope(db, scope, period)],
        ["people", (db) => readPeoplePeriodReportForScope(db, scope, period)],
        ["list", (db) => listWorkEntriesForScope(db, scope, { period, limit: 50 })],
      ];
      for (const [name, read] of reads) {
        const { db, calls } = withHook(createDb(reader), Number.POSITIVE_INFINITY, () => {});
        read(db);
        expect(calls(), name).toBe(1);
        expect(reader.inTransaction, name).toBe(false);
      }
    } finally {
      close();
    }
  });

  it("araç raporu: alınan tutar yalnız güncel sürümün onayından gelir (düzeltme sonrası eski sürümün onayı sayılmaz)", async () => {
    const { entryId, reader, writer, close } = await setup();
    try {
      commitCorrectAndConfirm(writer, entryId);
      const report = readVehiclePeriodReportForScope(createDb(reader), scope, period);
      // Yeni tutar + eski onay ("3000000" brüt ile "600000" alınan) ASLA birlikte görünmez.
      expect(report.confirmedReceivedCents).toBe(NEW.received);
      expect(report.grossCents).toBe("3000000");
    } finally {
      close();
    }
  });
});
