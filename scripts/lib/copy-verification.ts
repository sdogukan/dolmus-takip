/**
 * Tek dosyalık SQLite kopyasının doğrulaması — günlük yedek
 * (`scripts/db-backup.ts`) ve kontrollü restore (`scripts/db-restore.ts`)
 * AYNI kontrolleri buradan çalıştırır (T6.4, T6.5; OPS.md §4).
 *
 * Kopya her zaman KENDİ salt okunur bağlantısında açılır; açmak hash'lenen
 * baytları değiştiremez. Kuruş toplamları METİN olarak okunur (2^53 üstü tam
 * sayı better-sqlite3'te yuvarlanır). ESM/`.ts` import deseni
 * `scripts/db-init.ts` ile aynı (açık uzantı); import ağacı
 * `release-build.ts` `bundleDbInitIntoStandalone`'da eksiksiz kopyalanır.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import Database from "better-sqlite3";
import { assertMigrationsApplied } from "../../src/server/data/db.ts";
import {
  CALCULATION_VERSION,
  calculateWorkEntryAmounts,
  type WorkKind,
} from "../../src/lib/work-calculation.ts";
import type { BackupManifest } from "./backup-schedule.ts";

export type Fields = Record<string, string | number | boolean>;

/** Bir kopyanın kabul edilmeme nedeni; `reason` log satırına aynen yazılır. */
export class CopyRejectedError extends Error {
  readonly reason: string;
  readonly fields: Fields;
  constructor(reason: string, message: string, fields: Fields = {}) {
    super(message);
    this.name = "CopyRejectedError";
    this.reason = reason;
    this.fields = fields;
  }
}

type Connection = InstanceType<typeof Database>;

export function sha256OfFile(file: string): { sha256: string; size: number } {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  let size = 0;
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      size += read;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sha256: hash.digest("hex"), size };
}

export interface VerifiedCopy {
  sqliteVersion: string;
  schema: BackupManifest["schema"];
  lastRecord: BackupManifest["last_committed_record"];
  rowCounts: Record<string, number>;
  totals: Record<string, string>;
  uncheckedEntries: number;
}

export const sumText = (column: string): string => `CAST(COALESCE(SUM(${column}), 0) AS TEXT)`;

export function readRowCounts(copy: Connection): Record<string, number> {
  const tables = copy
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name <> '__drizzle_migrations' ORDER BY name",
    )
    .all() as { name: string }[];
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const row = copy
      .prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`)
      .get() as { count: number };
    counts[name] = row.count;
  }
  return counts;
}

export function verifyEntryAmounts(copy: Connection): {
  mismatches: number;
  unchecked: number;
} {
  const rows = copy
    .prepare(
      "SELECT work_kind, gross_cents, fuel_cents, other_expense_cents, share_bps, share_cents, remainder_cents, calculation_version FROM work_entries",
    )
    .safeIntegers(true)
    .iterate() as IterableIterator<{
    work_kind: string;
    gross_cents: bigint;
    fuel_cents: bigint;
    other_expense_cents: bigint;
    share_bps: bigint;
    share_cents: bigint;
    remainder_cents: bigint;
    calculation_version: bigint;
  }>;
  let mismatches = 0;
  let unchecked = 0;
  for (const row of rows) {
    if (row.calculation_version !== BigInt(CALCULATION_VERSION)) {
      unchecked += 1;
      continue;
    }
    if (row.work_kind !== "owner" && row.work_kind !== "driver") {
      mismatches += 1;
      continue;
    }
    try {
      const expected = calculateWorkEntryAmounts(
        row.work_kind as WorkKind,
        row.gross_cents,
        row.fuel_cents,
        row.other_expense_cents,
      );
      if (
        BigInt(expected.shareBps) !== row.share_bps ||
        BigInt(expected.shareCents) !== row.share_cents ||
        BigInt(expected.remainderCents) !== row.remainder_cents
      ) {
        mismatches += 1;
      }
    } catch {
      mismatches += 1;
    }
  }
  return { mismatches, unchecked };
}

/** DB'nin KENDİ satırlarından son commit edilmiş kayıt, revizyon, onay ve denetim izi. */
export function readLastCommittedRecord(copy: Connection): BackupManifest["last_committed_record"] {
  const revision = copy
    .prepare(
      "SELECT entry_id, version, created_at FROM work_entry_revisions ORDER BY created_at DESC, entry_id DESC, version DESC LIMIT 1",
    )
    .get() as BackupManifest["last_committed_record"]["work_entry_revision"] | undefined;
  const confirmation = copy
    .prepare(
      "SELECT entry_id, entry_version, confirmed_at FROM cash_confirmations ORDER BY confirmed_at DESC, id DESC LIMIT 1",
    )
    .get() as BackupManifest["last_committed_record"]["cash_confirmation"] | undefined;
  const audit = copy
    .prepare("SELECT id, occurred_at FROM admin_audit ORDER BY occurred_at DESC, id DESC LIMIT 1")
    .get() as BackupManifest["last_committed_record"]["admin_audit"] | undefined;
  return {
    work_entry_revision: revision ?? null,
    cash_confirmation: confirmation ?? null,
    admin_audit: audit ?? null,
  };
}

/**
 * Kopyanın KENDİ salt okunur bağlantısında tüm kontroller; herhangi biri
 * kalırsa `CopyRejectedError` fırlatır. `migrationsFolder` kopyanın uyması
 * gereken release'in `drizzle/` klasörüdür.
 */
export function verifyCopy(copyPath: string, migrationsFolder: string): VerifiedCopy {
  const copy = new Database(copyPath, { readonly: true, fileMustExist: true });
  try {
    const journalMode = copy.pragma("journal_mode", { simple: true });
    if (journalMode !== "delete") {
      throw new CopyRejectedError(
        "copy_not_self_contained",
        `Kopyanın journal_mode değeri "delete" değil: "${String(journalMode)}".`,
      );
    }

    const integrity = copy.pragma("integrity_check") as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0]!.integrity_check !== "ok") {
      throw new CopyRejectedError("integrity_check_failed", "Kopyada integrity_check başarısız.", {
        problems: integrity.length,
      });
    }

    const violations = copy.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      throw new CopyRejectedError(
        "foreign_key_check_failed",
        "Kopyada foreign_key_check ihlali var.",
        { violations: violations.length },
      );
    }

    try {
      assertMigrationsApplied(copy, migrationsFolder);
    } catch (error) {
      throw new CopyRejectedError(
        "schema_not_current",
        error instanceof Error ? error.message : String(error),
      );
    }

    const entries = verifyEntryAmounts(copy);
    if (entries.mismatches > 0) {
      throw new CopyRejectedError(
        "entry_amount_mismatch",
        "Kopyada payı/kalanı yeniden hesapla uyuşmayan iş kaydı var.",
        { mismatches: entries.mismatches },
      );
    }

    const migrations = copy
      .prepare(
        "SELECT COUNT(*) AS count, CAST(COALESCE(MAX(created_at), 0) AS TEXT) AS last_created_at FROM __drizzle_migrations",
      )
      .get() as { count: number; last_created_at: string };
    const lastMigration = copy
      .prepare("SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1")
      .get() as { hash: string };

    const totals = copy
      .prepare(
        `SELECT ${sumText("gross_cents")} AS gross, ${sumText("fuel_cents")} AS fuel, ` +
          `${sumText("other_expense_cents")} AS other, ${sumText("share_cents")} AS share, ` +
          `${sumText("remainder_cents")} AS remainder FROM work_entries`,
      )
      .get() as Record<"gross" | "fuel" | "other" | "share" | "remainder", string>;
    const received = copy
      .prepare(`SELECT ${sumText("received_cents")} AS received FROM cash_confirmations`)
      .get() as { received: string };

    return {
      sqliteVersion: (copy.prepare("SELECT sqlite_version() AS v").get() as { v: string }).v,
      schema: {
        applied_migrations: migrations.count,
        last_migration_created_at: migrations.last_created_at,
        last_migration_hash: lastMigration.hash,
      },
      lastRecord: readLastCommittedRecord(copy),
      rowCounts: readRowCounts(copy),
      totals: {
        gross_cents: totals.gross,
        fuel_cents: totals.fuel,
        other_expense_cents: totals.other,
        share_cents: totals.share,
        remainder_cents: totals.remainder,
        received_cents: received.received,
      },
      uncheckedEntries: entries.unchecked,
    };
  } finally {
    copy.close();
  }
}
