/**
 * `npm run integrity:check -- <db>` (S6.6 veri bütünlüğü kabulü). Komut
 * gerçek süreç olarak (`node scripts/integrity-check.ts`) koşar; DB küçük
 * ölçekli `load:seed` kurulumudur (gerçek migration, beş yıllık geçmiş).
 * Sabitlenenler: temiz DB'de çıkış 0 ve bütün sayılar 0; enjekte edilen her
 * ihlalde çıkış 1 ve ihlali ADLANDIRAN sayı; dosyanın (checkpoint edilmemiş
 * WAL dahil) baytlarının değişmemesi; kullanım hataları.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLoadSeed } from "../../scripts/load-seed";
import { RECEIPT_REVISION_ACTIONS, WORK_ENTRY_INVARIANTS } from "../../scripts/integrity-check";
import { openDatabaseConnection } from "../../src/server/data/db";
import { WORK_ENTRY_CONFIRM_OPERATION } from "../../src/server/usecases/work-entries/confirm";
import { WORK_ENTRY_CORRECT_AND_CONFIRM_OPERATION } from "../../src/server/usecases/work-entries/correct-and-confirm";
import { WORK_ENTRY_CREATE_OPERATION } from "../../src/server/usecases/work-entries/create";
import { WORK_ENTRY_UPDATE_OPERATION } from "../../src/server/usecases/work-entries/update";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INVARIANT_NAMES = Object.keys(WORK_ENTRY_INVARIANTS);

type Connection = InstanceType<typeof Database>;

interface CheckRun {
  status: number | null;
  event: string;
  fields: Record<string, string>;
}

function runCheck(...args: string[]): CheckRun {
  const result = spawnSync(process.execPath, ["scripts/integrity-check.ts", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const lines = result.stdout.trim().split("\n");
  expect(lines, result.stderr).toHaveLength(1);
  const fields = Object.fromEntries(
    lines[0]!
      .split(" ")
      .filter((token) => token.includes("="))
      .map((token) => [token.slice(0, token.indexOf("=")), token.slice(token.indexOf("=") + 1)]),
  );
  return { status: result.status, event: fields.event ?? "", fields };
}

const sha256 = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

interface Targets {
  pending: { business_id: string; id: string };
  confirmed: { business_id: string; id: string };
  owner: { business_id: string; id: string };
  confirmationId: string;
}

const CONFIRMATION_COLUMNS =
  "business_id, id, entry_id, entry_version, received_cents, confirmed_at, actor_kind, actor_session_id, " +
  "actor_role, actor_credential_id, actor_platform_user_id, on_behalf_of_kind, on_behalf_of_person_id";

function danglingReceipt(sqlite: Connection): void {
  sqlite
    .prepare(
      "INSERT INTO mutation_receipts (scope_key, request_id, operation, request_hash, entity_id, result_version, response_code, created_at) " +
        "VALUES ('test-scope', 'test-request', ?, 'hash', ?, 2, 200, '2026-09-24T00:00:00.000Z')",
    )
    .run(WORK_ENTRY_CONFIRM_OPERATION, crypto.randomUUID());
}

describe("integrity:check", () => {
  let dir: string;
  let cleanPath: string;
  let targets: Targets;
  let copies = 0;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-integrity-"));
    cleanPath = path.join(dir, "clean.sqlite");
    await runLoadSeed({
      dbPath: cleanPath,
      credentialsPath: path.join(dir, "credentials.json"),
      countsPath: path.join(dir, "clean.sqlite.counts.json"),
      vehicles: 1,
      platformUsers: 1,
      loadWindowMonth: "2026-09",
      randomSeed: 11,
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      sourceTreeDirty: false,
      env: {},
      log: () => {},
    });
    expect(fs.existsSync(`${cleanPath}-wal`)).toBe(false);
    const sqlite = new Database(cleanPath, { readonly: true });
    try {
      const entry = (where: string) =>
        sqlite.prepare(`SELECT business_id, id FROM work_entries WHERE ${where} ORDER BY id LIMIT 1`).get() as Targets["pending"];
      const confirmed = entry("status = 'confirmed' AND version = 2");
      targets = {
        pending: entry("work_kind = 'driver' AND status = 'pending'"),
        confirmed,
        owner: entry("work_kind = 'owner'"),
        confirmationId: (
          sqlite.prepare("SELECT id FROM cash_confirmations WHERE entry_id = ? AND entry_version = 2").get(confirmed.id) as {
            id: string;
          }
        ).id,
      };
    } finally {
      sqlite.close();
    }
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Temiz DB'nin kopyası; `inject` yabancı anahtar denetimi KAPALI bağlantıda koşar. */
  function copyWith(inject: (sqlite: Connection) => void): string {
    const copy = path.join(dir, `copy-${++copies}.sqlite`);
    fs.copyFileSync(cleanPath, copy);
    const sqlite = new Database(copy);
    try {
      sqlite.pragma("foreign_keys = OFF");
      inject(sqlite);
    } finally {
      sqlite.close();
    }
    return copy;
  }

  it("makbuz işlem eşlemesi use case işlem adlarının tamamıdır", () => {
    expect(Object.keys(RECEIPT_REVISION_ACTIONS).sort()).toEqual(
      [
        WORK_ENTRY_CREATE_OPERATION,
        WORK_ENTRY_UPDATE_OPERATION,
        WORK_ENTRY_CONFIRM_OPERATION,
        WORK_ENTRY_CORRECT_AND_CONFIRM_OPERATION,
      ].sort(),
    );
  });

  it("temiz seed'li DB'de çıkış 0, bütün ihlal sayıları 0 ve dosya değişmez", () => {
    const before = sha256(cleanPath);
    const run = runCheck(cleanPath);

    expect(run.status).toBe(0);
    expect(run.event).toBe("integrity_passed");
    expect(run.fields).toMatchObject({
      failed_checks: "0",
      database_check: "ok",
      schema: "current",
      invariants: "checked",
      unchecked_entries: "0",
    });
    for (const name of INVARIANT_NAMES) expect(run.fields[name], name).toBe("0");
    expect(Number(run.fields.entries)).toBeGreaterThan(1000);
    expect(Number(run.fields.confirmations)).toBeGreaterThan(0);
    expect(sha256(cleanPath)).toBe(before);
  });

  const violations: {
    name: string;
    inject: (sqlite: Connection, t: Targets) => void;
    expected: Record<string, string>;
  }[] = [
    {
      name: "revizyon boşluğu",
      inject: (sqlite, t) =>
        sqlite
          .prepare("DELETE FROM work_entry_revisions WHERE business_id = ? AND entry_id = ? AND version = 1")
          .run(t.confirmed.business_id, t.confirmed.id),
      expected: { revision_gaps: "1" },
    },
    {
      name: "olmayan sürüme onay",
      inject: (sqlite, t) =>
        sqlite
          .prepare(
            `INSERT INTO cash_confirmations (${CONFIRMATION_COLUMNS}) SELECT business_id, 'test-missing', ?, 2, ` +
              "received_cents, confirmed_at, actor_kind, actor_session_id, actor_role, actor_credential_id, " +
              "actor_platform_user_id, on_behalf_of_kind, on_behalf_of_person_id FROM cash_confirmations WHERE id = ?",
          )
          .run(t.pending.id, t.confirmationId),
      expected: { confirmation_missing_revision: "1", database_check: "foreign_key_check_failed" },
    },
    {
      name: "bir sürüme iki onay",
      inject: (sqlite, t) => {
        sqlite.exec("DROP INDEX cash_confirmations_business_entry_version_uk");
        sqlite
          .prepare(
            `INSERT INTO cash_confirmations (${CONFIRMATION_COLUMNS}) SELECT business_id, 'test-duplicate', entry_id, ` +
              "entry_version, received_cents, confirmed_at, actor_kind, actor_session_id, actor_role, actor_credential_id, " +
              "actor_platform_user_id, on_behalf_of_kind, on_behalf_of_person_id FROM cash_confirmations WHERE id = ?",
          )
          .run(t.confirmationId);
      },
      expected: { duplicate_confirmations: "1" },
    },
    {
      name: "onaysız 'confirmed' durum",
      inject: (sqlite, t) => sqlite.prepare("UPDATE work_entries SET status = 'confirmed' WHERE id = ?").run(t.pending.id),
      expected: { confirmed_without_confirmation: "1" },
    },
    {
      name: "pay/kalan yeniden hesapla uyuşmuyor",
      inject: (sqlite, t) =>
        sqlite.prepare("UPDATE work_entries SET share_cents = share_cents + 1 WHERE id = ?").run(t.confirmed.id),
      expected: { database_check: "entry_amount_mismatch", database_mismatches: "1", invariants: "checked" },
    },
    {
      name: "hedefi olmayan makbuz",
      inject: (sqlite) => danglingReceipt(sqlite),
      expected: { dangling_receipts: "1" },
    },
    {
      name: "onaylı şoför kaydı yeniden 'pending'",
      inject: (sqlite, t) => sqlite.prepare("UPDATE work_entries SET status = 'pending' WHERE id = ?").run(t.confirmed.id),
      expected: { driver_status_rule: "1" },
    },
    {
      name: "sahip kaydı onay bekliyor",
      inject: (sqlite, t) => sqlite.prepare("UPDATE work_entries SET status = 'pending' WHERE id = ?").run(t.owner.id),
      expected: { owner_status_rule: "1" },
    },
    {
      name: "onayı şoför rolü yazmış",
      inject: (sqlite, t) =>
        sqlite.prepare("UPDATE cash_confirmations SET actor_role = 'driver' WHERE id = ?").run(t.confirmationId),
      expected: { confirmation_actor_rule: "1" },
    },
    {
      name: "onay, onaylamayan revizyona bağlı",
      inject: (sqlite, t) =>
        sqlite
          .prepare("UPDATE work_entry_revisions SET action = 'update' WHERE entry_id = ? AND version = 2")
          .run(t.confirmed.id),
      expected: { confirmation_revision_mismatch: "1" },
    },
  ];

  it.each(violations)("$name → çıkış 1 ve ihlal adlandırılır", ({ inject, expected }) => {
    const copy = copyWith((sqlite) => inject(sqlite, targets));
    const run = runCheck(copy);

    expect(run.status).toBe(1);
    expect(run.event).toBe("integrity_violations");
    expect(Number(run.fields.failed_checks)).toBeGreaterThan(0);
    expect(run.fields).toMatchObject(expected);
  });

  it("canlı WAL'daki commit edilmiş satırı görür; ne ana dosyaya ne WAL'a yazar", () => {
    const copy = copyWith(() => {});
    const writer = openDatabaseConnection(copy);
    try {
      writer.pragma("wal_autocheckpoint = 0");
      danglingReceipt(writer);
      const mainBefore = sha256(copy);
      const walBefore = sha256(`${copy}-wal`);

      const run = runCheck(copy);

      expect(run.status).toBe(1);
      expect(run.fields.dangling_receipts).toBe("1");
      expect(sha256(copy)).toBe(mainBefore);
      expect(sha256(`${copy}-wal`)).toBe(walBefore);
    } finally {
      writer.close();
    }
  });

  it("argümansız çağrı ve olmayan dosya: çıkış 1, dosya oluşturulmaz", () => {
    const usage = runCheck();
    expect(usage.status).toBe(1);
    expect(usage.fields).toMatchObject({ event: "integrity_failed", reason: "usage" });

    const missing = path.join(dir, "yok.sqlite");
    const run = runCheck(missing);
    expect(run.status).toBe(1);
    expect(run.fields).toMatchObject({ event: "integrity_failed", reason: "db_missing" });
    expect(fs.existsSync(missing)).toBe(false);
  });
});
