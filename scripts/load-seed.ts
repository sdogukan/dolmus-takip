/**
 * Yük kabulü veri seti — `npm run load:seed` (S6.6, T6.6).
 *
 * YENİ bir SQLite dosyası açar, gerçek migration'ları uygular ve beş yıllık
 * temsili geçmiş kurar: işletmeler, araçlar (sahip + ortak şoför credential'ı),
 * şoförler (biri ayrılmış, pasif atama), dinlenme günleri, ikinci vardiya,
 * sahip çalışmaları, gece vardiyası, diğer gider notları, onaylı / onay
 * bekleyen / düzeltilip yeniden onaylanmış kayıtlar. Tutarlar gerçek hesap
 * kuralıyla (`computeWorkEntryFigures`) üretilir; revizyon ve teslim onayı
 * satırları uygulamanın yazdığı biçimdedir (oluşturma v1, onay v2, düzelt ve
 * onayla v3).
 *
 * Yük kimlik bilgileri GERÇEK Argon2id hash'leridir (`hashVehiclePassword`,
 * uygulamanın kendi parametreleri); parolalar rastgeledir ve yalnız 0600 izinli
 * kimlik bilgisi dosyasına yazılır — stdout'a, yan dosyaya veya git'e asla.
 *
 * Yük penceresi: geçmiş, `--load-window-month` ayının ilk gününden ÖNCE biter.
 * Yük üreticisi yalnız bu ay ve sonrasına yazar; pencerede defterde olmayan her
 * kayıt çift sayılır.
 *
 * Yan dosya (`<db>.counts.json`): araç/kişi/gün/kayıt/revizyon/onay sayıları
 * (DB'den sayılır), kaynak commit, migration hash listesi (`release:build`
 * manifestiyle aynı biçim), DB dosyasının sha256'sı.
 *
 * Güvenlik: `NODE_ENV=production` iken ve hedef yollardan herhangi biri
 * (DB, `-wal`, `-shm`, kimlik bilgisi, yan dosya) zaten varsa hiçbir şeye
 * dokunmadan reddeder; üretim DB'sinin üzerine yazamaz. Kimlik bilgisi dosyası
 * depo dışında olmalıdır. Hata olursa oluşturduğu dosyaları siler.
 *
 * Bu komut `ci-steps.json`, `test:unit` ve `test:integration` DIŞINDADIR;
 * `tests/integration/load-seed.test.ts` yalnız küçük ölçekli bir kurulumu
 * sınar.
 *
 * Kullanım:
 *   npm run load:seed -- --db <yeni.sqlite> --credentials <depo-dışı.json>
 *     [--vehicles 50] [--platform-users 4] [--load-window-month YYYY-MM]
 *     [--seed 1] [--counts <yan-dosya.json>]
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { hashVehiclePassword } from "../src/server/auth/vehicle-password.ts";
import {
  createDb,
  openDatabaseConnection,
  withImmediateTransaction,
  type SqliteConnection,
} from "../src/server/data/db.ts";
import { computeWorkEntryFigures, type WorkEntryFigures } from "../src/server/usecases/work-entries/figures.ts";
import { istanbulToday } from "../src/lib/work-time.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = path.join(projectRoot, "drizzle");

export const HISTORY_YEARS = 5;
const DRIVERS_PER_VEHICLE = 4;
const VEHICLES_PER_BUSINESS = 2;
const MAX_VEHICLES = 999;
/** Hash kuyruğu (4 eşzamanlı / 100 bekleyen) dolmasın diye parti büyüklüğü. */
const HASH_BATCH = 4;
/** Son bu kadar gün içindeki şoför kayıtlarının bir kısmı onay bekler. */
const RECENT_PENDING_DAYS = 14;
const SEED_ACTOR_SESSION = "load-seed";

export class LoadSeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoadSeedRefusedError";
  }
}

export interface LoadSeedOptions {
  dbPath: string;
  credentialsPath: string;
  countsPath: string;
  vehicles: number;
  platformUsers: number;
  /** `YYYY-MM`: yükün yazacağı ilk ay; geçmiş bu aydan önce biter. */
  loadWindowMonth: string;
  randomSeed: number;
  sourceCommit: string;
  sourceTreeDirty: boolean;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Korumalar
// ---------------------------------------------------------------------------

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Hiçbir dosyaya dokunmadan önce çağrılır; ihlalde `LoadSeedRefusedError`. */
export function assertLoadSeedAllowed(options: LoadSeedOptions): void {
  const env = options.env ?? process.env;
  if (env.NODE_ENV === "production") {
    throw new LoadSeedRefusedError("NODE_ENV=production: yük verisi üretim ortamında kurulmaz.");
  }
  const dbPath = path.resolve(options.dbPath);
  const credentialsPath = path.resolve(options.credentialsPath);
  const countsPath = path.resolve(options.countsPath);
  const targets = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, credentialsPath, countsPath];
  if (new Set(targets).size !== targets.length) {
    throw new LoadSeedRefusedError("DB, kimlik bilgisi ve yan dosya yolları birbirinden farklı olmalı.");
  }
  for (const target of targets) {
    if (fs.existsSync(target)) {
      throw new LoadSeedRefusedError(`Hedef zaten var, üzerine yazılmaz: ${target}`);
    }
  }
  if (isInside(projectRoot, credentialsPath)) {
    throw new LoadSeedRefusedError("Kimlik bilgisi dosyası depo dışında olmalı (gerçek parolalar içerir).");
  }
  if (!Number.isInteger(options.vehicles) || options.vehicles < 1 || options.vehicles > MAX_VEHICLES) {
    throw new LoadSeedRefusedError(`--vehicles 1..${MAX_VEHICLES} tam sayı olmalı.`);
  }
  if (!Number.isInteger(options.platformUsers) || options.platformUsers < 1 || options.platformUsers > 50) {
    throw new LoadSeedRefusedError("--platform-users 1..50 tam sayı olmalı.");
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(options.loadWindowMonth)) {
    throw new LoadSeedRefusedError("--load-window-month YYYY-MM olmalı.");
  }
  if (!Number.isSafeInteger(options.randomSeed)) throw new LoadSeedRefusedError("--seed tam sayı olmalı.");
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const pad = (n: number, length = 2) => String(n).padStart(length, "0");
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Geçmiş: pencere ayından tam `HISTORY_YEARS` yıl önce başlar, pencereden bir gün önce biter. */
export function historyRange(loadWindowMonth: string): { startDate: string; endDate: string; days: number } {
  const [year, month] = loadWindowMonth.split("-").map(Number) as [number, number];
  const windowStart = Date.UTC(year, month - 1, 1);
  const start = Date.UTC(year - HISTORY_YEARS, month - 1, 1);
  const endDate = isoDay(windowStart - DAY_MS);
  return { startDate: isoDay(start), endDate, days: Math.round((windowStart - start) / DAY_MS) };
}

/** mulberry32 — tekrarlanabilir veri için tohumlu üreteç (parolalar bundan ÜRETİLMEZ). */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const newPassword = () => crypto.randomBytes(18).toString("base64url");

export function resolveSourceRevision(root: string = projectRoot): { commit: string; dirty: boolean } {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error(`git rev-parse HEAD beklenmeyen çıktı: ${commit}`);
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" });
  return { commit, dirty: status.trim().length > 0 };
}

interface MigrationHashEntry {
  idx: number;
  file: string;
  sha256: string;
}

/** `release:build` manifestindeki `schema` ile aynı biçim. */
export function migrationHashList(): { last_migration_idx: number; migration_sha256_list: MigrationHashEntry[] } {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  const list = [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => {
      const file = `${entry.tag}.sql`;
      const sha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(migrationsFolder, file))).digest("hex");
      return { idx: entry.idx, file, sha256 };
    });
  return { last_migration_idx: list[list.length - 1]!.idx, migration_sha256_list: list };
}

// ---------------------------------------------------------------------------
// Veri planı
// ---------------------------------------------------------------------------

const FIRST_NAMES = ["Ahmet", "Mehmet", "Mustafa", "Hüseyin", "Hasan", "İbrahim", "Ali", "Osman", "Yusuf", "Murat", "Emre", "Kemal"];
const LAST_NAMES = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Öztürk", "Aydın", "Arslan", "Doğan", "Kılıç", "Aslan"];
const BRANDS = ["Ford Transit", "Fiat Ducato", "Mercedes Sprinter", "Iveco Daily"];
const ROUTES = ["Merkez - Sahil", "Otogar - Üniversite", "Çarşı - Hastane", "İstasyon - Organize Sanayi"];
const EXPENSE_NOTES = ["Yıkama", "Otopark", "Köprü geçişi", "Lastik tamiri", "Yağ değişimi"];

interface DriverPlan {
  personId: string;
  fullName: string;
  /** Ayrılan şoförün son çalıştığı gün (dahil); `null` hâlâ aktif. */
  lastDay: number | null;
}

interface VehiclePlan {
  index: number;
  businessId: string;
  vehicleId: string;
  plate: string;
  ownerPersonId: string;
  ownerCredentialId: string;
  driverCredentialId: string;
  drivers: DriverPlan[];
  ownerPassword: string;
  driverPassword: string;
}

interface PlatformUserPlan {
  id: string;
  username: string;
  role: "admin" | "support";
  password: string;
}

function personName(random: () => number): string {
  const first = FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)]!;
  const last = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)]!;
  return `${first} ${last}`;
}

function planVehicles(count: number, days: number, random: () => number): VehiclePlan[] {
  const plans: VehiclePlan[] = [];
  for (let v = 0; v < count; v++) {
    const b = Math.floor(v / VEHICLES_PER_BUSINESS);
    const drivers: DriverPlan[] = [];
    for (let d = 0; d < DRIVERS_PER_VEHICLE; d++) {
      drivers.push({
        personId: `lp-${pad(v, 3)}-d${d}`,
        fullName: personName(random),
        // Son şoför geçmişin ortasında ayrılır (pasif atama, eski kayıtları kalır).
        lastDay: d === DRIVERS_PER_VEHICLE - 1 ? Math.floor(days * 0.6) + (v % 30) : null,
      });
    }
    plans.push({
      index: v,
      businessId: `lb-${pad(b, 3)}`,
      vehicleId: `lv-${pad(v, 3)}`,
      plate: `34YUK${pad(v + 1, 3)}`,
      ownerPersonId: `lp-b${pad(b, 3)}-owner`,
      ownerCredentialId: `lc-${pad(v, 3)}-owner`,
      driverCredentialId: `lc-${pad(v, 3)}-driver`,
      drivers,
      ownerPassword: newPassword(),
      driverPassword: newPassword(),
    });
  }
  return plans;
}

function planPlatformUsers(count: number): PlatformUserPlan[] {
  return Array.from({ length: count }, (_, i) => {
    const role = i % 2 === 0 ? "admin" : "support";
    return { id: `lu-${pad(i, 2)}`, username: `load.${role}.${i + 1}`, role, password: newPassword() };
  });
}

// ---------------------------------------------------------------------------
// Yazma
// ---------------------------------------------------------------------------

type Statement = Database.Statement<unknown[]>;

interface Statements {
  business: Statement;
  person: Statement;
  owner: Statement;
  vehicle: Statement;
  credential: Statement;
  assignment: Statement;
  platformUser: Statement;
  entry: Statement;
  correctEntry: Statement;
  revision: Statement;
  confirmation: Statement;
}

function prepareStatements(sqlite: SqliteConnection): Statements {
  return {
    business: sqlite.prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)"),
    person: sqlite.prepare("INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)"),
    owner: sqlite.prepare("INSERT INTO business_owners (business_id, person_id) VALUES (?, ?)"),
    vehicle: sqlite.prepare(
      `INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, brand_model, year, route_stop, note, active, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, 1)`,
    ),
    credential: sqlite.prepare(
      `INSERT INTO vehicle_credentials (business_id, id, vehicle_id, role, password_hash, credential_version)
       VALUES (?, ?, ?, ?, ?, 1)`,
    ),
    assignment: sqlite.prepare(
      "INSERT INTO vehicle_drivers (business_id, vehicle_id, person_id, active, version) VALUES (?, ?, ?, ?, 1)",
    ),
    platformUser: sqlite.prepare(
      `INSERT INTO platform_users (id, username, password_hash, platform_role, active, credential_version, full_name, version)
       VALUES (?, ?, ?, ?, 1, 1, ?, 1)`,
    ),
    entry: sqlite.prepare(
      `INSERT INTO work_entries (
         business_id, id, vehicle_id, person_id, work_kind, work_date, starts_at, ends_at, duration_minutes,
         gross_cents, fuel_cents, other_expense_cents, other_expense_note, share_bps, share_cents, remainder_cents,
         calculation_version, status, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    correctEntry: sqlite.prepare(
      `UPDATE work_entries SET work_date = ?, starts_at = ?, ends_at = ?, duration_minutes = ?, gross_cents = ?,
         fuel_cents = ?, other_expense_cents = ?, other_expense_note = ?, share_bps = ?, share_cents = ?,
         remainder_cents = ?, calculation_version = ?, version = ?
       WHERE business_id = ? AND id = ?`,
    ),
    revision: sqlite.prepare(
      `INSERT INTO work_entry_revisions (
         business_id, entry_id, version, action, snapshot_json, actor_kind, actor_session_id, actor_role,
         actor_credential_id, actor_platform_user_id, on_behalf_of_kind, on_behalf_of_person_id, created_at
       ) VALUES (?, ?, ?, ?, ?, 'vehicle_credential', ?, ?, ?, NULL, NULL, NULL, ?)`,
    ),
    confirmation: sqlite.prepare(
      `INSERT INTO cash_confirmations (
         business_id, id, entry_id, entry_version, received_cents, confirmed_at, actor_kind, actor_session_id,
         actor_role, actor_credential_id, actor_platform_user_id, on_behalf_of_kind, on_behalf_of_person_id
       ) VALUES (?, ?, ?, ?, ?, ?, 'vehicle_credential', ?, 'owner', ?, NULL, NULL, NULL)`,
    ),
  };
}

interface EntryBody {
  date: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  grossCents: string;
  fuelCents: string;
  otherExpenseCents: string;
  otherExpenseNote: string | null;
}

function figuresFor(workKind: "owner" | "driver", body: EntryBody): WorkEntryFigures {
  const result = computeWorkEntryFigures(workKind, body);
  if (!result.ok) throw new Error(`load-seed: üretilen kayıt geçersiz: ${JSON.stringify(result.fields)}`);
  return result.figures;
}

function randomBody(date: string, random: () => number): EntryBody {
  const night = random() < 0.03;
  const startMinutes = night ? 18 * 60 : 6 * 60 + Math.floor(random() * 9) * 15;
  const durationMinutes = 8 * 60 + Math.floor(random() * 13) * 15;
  const endTotal = startMinutes + durationMinutes;
  const time = (m: number) => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
  const grossLira = 6000 + Math.floor(random() * 100) * 100;
  const fuelLira = Math.round((grossLira * (0.18 + random() * 0.1)) / 10) * 10;
  const hasOther = random() < 0.3;
  return {
    date,
    startTime: time(startMinutes),
    endTime: time(endTotal),
    endsNextDay: endTotal >= 1440,
    grossCents: String(grossLira * 100),
    fuelCents: String(fuelLira * 100),
    otherExpenseCents: hasOther ? String((50 + Math.floor(random() * 10) * 50) * 100) : "0",
    otherExpenseNote: hasOther ? EXPENSE_NOTES[Math.floor(random() * EXPENSE_NOTES.length)]! : null,
  };
}

const plusMinutes = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

function writeHistory(
  s: Statements,
  vehicles: VehiclePlan[],
  history: { startDate: string; days: number },
  random: () => number,
): void {
  const startMs = dayMs(history.startDate);
  let sequence = 0;
  for (const v of vehicles) {
    for (let day = 0; day < history.days; day++) {
      if (random() < 0.12) continue; // dinlenme günü
      const date = isoDay(startMs + day * DAY_MS);
      const active = v.drivers.filter((d) => d.lastDay === null || day <= d.lastDay);
      const workers: { kind: "owner" | "driver"; personId: string }[] = [
        { kind: "driver", personId: active[day % active.length]!.personId },
      ];
      if (random() < 0.2) workers.push({ kind: "driver", personId: active[(day + 1) % active.length]!.personId });
      if (random() < 0.15) workers.push({ kind: "owner", personId: v.ownerPersonId });

      for (const worker of workers) {
        const id = `le-${pad(v.index, 3)}-${pad(sequence++, 7)}`;
        const body = randomBody(date, random);
        const f = figuresFor(worker.kind, body);
        const isDriver = worker.kind === "driver";
        const recent = history.days - day <= RECENT_PENDING_DAYS;
        const confirmed = isDriver && random() < (recent ? 0.5 : 0.97);
        const corrected = confirmed && random() < 0.04;
        const createStatus = isDriver ? "pending" : "not_required";
        const finalVersion = corrected ? 3 : confirmed ? 2 : 1;
        const finalStatus = confirmed ? "confirmed" : createStatus;
        const creator = isDriver ? v.driverCredentialId : v.ownerCredentialId;
        const creatorRole = isDriver ? "driver" : "owner";

        s.entry.run(
          v.businessId, id, v.vehicleId, worker.personId, worker.kind, f.workDate, f.startsAt, f.endsAt,
          f.durationMinutes, f.grossCents, f.fuelCents, f.otherExpenseCents, f.otherExpenseNote, f.shareBps,
          f.shareCents, f.remainderCents, f.calculationVersion, finalStatus, finalVersion,
        );
        const createdAt = plusMinutes(f.endsAt, 30);
        const base = { id, vehicleId: v.vehicleId, personId: worker.personId, workKind: worker.kind };
        s.revision.run(
          v.businessId, id, 1, "create",
          JSON.stringify({ ...base, status: createStatus, version: 1, ...f }),
          SEED_ACTOR_SESSION, creatorRole, creator, createdAt,
        );
        if (!confirmed) continue;

        const shortfall = random() < 0.1 ? Math.floor(random() * 5) * 1000 : 0;
        const received = String(Math.max(0, f.remainderCents - shortfall));
        const confirmedAt = plusMinutes(f.endsAt, 120);
        // `confirmWorkEntry` anlık görüntüsüyle aynı alanlar (calculationVersion yok).
        const confirmSnapshot = {
          ...base, status: "confirmed", version: 2, workDate: f.workDate, startsAt: f.startsAt, endsAt: f.endsAt,
          durationMinutes: f.durationMinutes, grossCents: f.grossCents, fuelCents: f.fuelCents,
          otherExpenseCents: f.otherExpenseCents, otherExpenseNote: f.otherExpenseNote, shareBps: f.shareBps,
          shareCents: f.shareCents, remainderCents: f.remainderCents, receivedCents: received,
        };
        s.revision.run(
          v.businessId, id, 2, "confirm",
          JSON.stringify(confirmSnapshot),
          SEED_ACTOR_SESSION, "owner", v.ownerCredentialId, confirmedAt,
        );
        s.confirmation.run(v.businessId, `lk-${id}-2`, id, 2, Number(received), confirmedAt, SEED_ACTOR_SESSION, v.ownerCredentialId);
        if (!corrected) continue;

        const fixedGross = Number(body.grossCents) + (random() < 0.5 ? -1 : 1) * (1 + Math.floor(random() * 10)) * 10_000;
        const fixedBody = { ...body, grossCents: String(fixedGross) };
        const g = figuresFor(worker.kind, fixedBody);
        const fixedReceived = String(Math.max(0, g.remainderCents));
        const correctedAt = plusMinutes(f.endsAt, 24 * 60);
        s.correctEntry.run(
          g.workDate, g.startsAt, g.endsAt, g.durationMinutes, g.grossCents, g.fuelCents, g.otherExpenseCents,
          g.otherExpenseNote, g.shareBps, g.shareCents, g.remainderCents, g.calculationVersion, 3, v.businessId, id,
        );
        s.revision.run(
          v.businessId, id, 3, "correct_and_confirm",
          JSON.stringify({ ...base, status: "confirmed", version: 3, ...g, receivedCents: fixedReceived }),
          SEED_ACTOR_SESSION, "owner", v.ownerCredentialId, correctedAt,
        );
        s.confirmation.run(v.businessId, `lk-${id}-3`, id, 3, Number(fixedReceived), correctedAt, SEED_ACTOR_SESSION, v.ownerCredentialId);
      }
    }
  }
}

async function hashInBatches(passwords: string[]): Promise<string[]> {
  const hashes: string[] = [];
  for (let i = 0; i < passwords.length; i += HASH_BATCH) {
    hashes.push(...(await Promise.all(passwords.slice(i, i + HASH_BATCH).map((p) => hashVehiclePassword(p)))));
  }
  return hashes;
}

export interface DatasetCounts {
  businesses: number;
  vehicles: number;
  people: number;
  activeDriverAssignments: number;
  inactiveDriverAssignments: number;
  vehicleCredentials: number;
  platformUsers: number;
  calendarDays: number;
  workDays: number;
  workEntries: number;
  driverEntries: number;
  ownerEntries: number;
  pendingEntries: number;
  confirmedEntries: number;
  correctedEntries: number;
  revisions: number;
  confirmations: number;
  firstWorkDate: string;
  lastWorkDate: string;
}

function countDataset(sqlite: SqliteConnection, calendarDays: number): DatasetCounts {
  const one = (sql: string) => (sqlite.prepare(sql).get() as { n: number | string }).n;
  const num = (sql: string) => Number(one(sql));
  return {
    businesses: num("SELECT COUNT(*) AS n FROM businesses"),
    vehicles: num("SELECT COUNT(*) AS n FROM vehicles"),
    people: num("SELECT COUNT(*) AS n FROM people"),
    activeDriverAssignments: num("SELECT COUNT(*) AS n FROM vehicle_drivers WHERE active = 1"),
    inactiveDriverAssignments: num("SELECT COUNT(*) AS n FROM vehicle_drivers WHERE active = 0"),
    vehicleCredentials: num("SELECT COUNT(*) AS n FROM vehicle_credentials"),
    platformUsers: num("SELECT COUNT(*) AS n FROM platform_users"),
    calendarDays,
    workDays: num("SELECT COUNT(DISTINCT work_date) AS n FROM work_entries"),
    workEntries: num("SELECT COUNT(*) AS n FROM work_entries"),
    driverEntries: num("SELECT COUNT(*) AS n FROM work_entries WHERE work_kind = 'driver'"),
    ownerEntries: num("SELECT COUNT(*) AS n FROM work_entries WHERE work_kind = 'owner'"),
    pendingEntries: num("SELECT COUNT(*) AS n FROM work_entries WHERE status = 'pending'"),
    confirmedEntries: num("SELECT COUNT(*) AS n FROM work_entries WHERE status = 'confirmed'"),
    correctedEntries: num("SELECT COUNT(DISTINCT entry_id) AS n FROM work_entry_revisions WHERE action = 'correct_and_confirm'"),
    revisions: num("SELECT COUNT(*) AS n FROM work_entry_revisions"),
    confirmations: num("SELECT COUNT(*) AS n FROM cash_confirmations"),
    firstWorkDate: String(one("SELECT MIN(work_date) AS n FROM work_entries")),
    lastWorkDate: String(one("SELECT MAX(work_date) AS n FROM work_entries")),
  };
}

function writeExclusive(filePath: string, content: string, mode: number): void {
  const fd = fs.openSync(filePath, "wx", mode);
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(filePath, mode);
}

export interface LoadSeedSummary {
  counts: DatasetCounts;
  history: { startDate: string; endDate: string; days: number };
  buildSeconds: number;
}

export async function runLoadSeed(options: LoadSeedOptions): Promise<LoadSeedSummary> {
  assertLoadSeedAllowed(options);
  const log = options.log ?? ((line: string) => console.log(line));
  const dbPath = path.resolve(options.dbPath);
  const credentialsPath = path.resolve(options.credentialsPath);
  const countsPath = path.resolve(options.countsPath);
  const created: string[] = [];

  const started = performance.now();
  const history = historyRange(options.loadWindowMonth);
  const random = createRandom(options.randomSeed);
  const vehicles = planVehicles(options.vehicles, history.days, random);
  const platformUsers = planPlatformUsers(options.platformUsers);

  // Argon2id hash'leri transaction DIŞINDA ve kuyruk sınırını aşmadan üretilir.
  log(`[load:seed] ${vehicles.length * 2 + platformUsers.length} Argon2id hash üretiliyor…`);
  const vehicleHashes = await hashInBatches(vehicles.flatMap((v) => [v.ownerPassword, v.driverPassword]));
  const platformHashes = await hashInBatches(platformUsers.map((u) => u.password));

  let sqlite: SqliteConnection | undefined;
  try {
    created.push(dbPath, `${dbPath}-wal`, `${dbPath}-shm`);
    sqlite = openDatabaseConnection(dbPath, { createIfMissing: true });
    migrate(createDb(sqlite), { migrationsFolder });
    const s = prepareStatements(sqlite);
    const createdAt = `${history.startDate}T00:00:00.000Z`;
    log(`[load:seed] ${history.startDate} … ${history.endDate} geçmişi kuruluyor…`);
    withImmediateTransaction(sqlite, () => {
      for (const v of vehicles) {
        if (v.index % VEHICLES_PER_BUSINESS === 0) {
          s.business.run(v.businessId, `Yük İşletme ${v.businessId.slice(3)}`, createdAt);
          s.person.run(v.businessId, v.ownerPersonId, personName(random));
          s.owner.run(v.businessId, v.ownerPersonId);
        }
        s.vehicle.run(
          v.businessId, v.vehicleId, v.plate, v.ownerPersonId, BRANDS[v.index % BRANDS.length],
          2012 + (v.index % 12), ROUTES[v.index % ROUTES.length],
        );
        s.credential.run(v.businessId, v.ownerCredentialId, v.vehicleId, "owner", vehicleHashes[v.index * 2]);
        s.credential.run(v.businessId, v.driverCredentialId, v.vehicleId, "driver", vehicleHashes[v.index * 2 + 1]);
        for (const d of v.drivers) {
          s.person.run(v.businessId, d.personId, d.fullName);
          s.assignment.run(v.businessId, v.vehicleId, d.personId, d.lastDay === null ? 1 : 0);
        }
      }
      platformUsers.forEach((u, i) => {
        s.platformUser.run(u.id, u.username, platformHashes[i], u.role, `Yük Ekip ${i + 1}`);
      });
      writeHistory(s, vehicles, history, random);
    });

    const violations = sqlite.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) throw new Error(`load-seed: FK ihlali: ${JSON.stringify(violations.slice(0, 3))}`);
    sqlite.exec("ANALYZE");
    const counts = countDataset(sqlite, history.days);
    if (counts.lastWorkDate >= `${options.loadWindowMonth}-01`) {
      throw new Error(`load-seed: geçmiş yük penceresine taştı (${counts.lastWorkDate}).`);
    }
    const sqliteVersion = (sqlite.prepare("SELECT sqlite_version() AS v").get() as { v: string }).v;
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    sqlite.close();
    sqlite = undefined;

    const credentials = {
      kind: "dolmus-takip-load-credentials",
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      datasetSourceCommit: options.sourceCommit,
      vehicles: vehicles.map((v) => ({
        index: v.index,
        plate: v.plate,
        businessId: v.businessId,
        vehicleId: v.vehicleId,
        ownerPersonId: v.ownerPersonId,
        driverPersonIds: v.drivers.filter((d) => d.lastDay === null).map((d) => d.personId),
        ownerPassword: v.ownerPassword,
        driverPassword: v.driverPassword,
      })),
      platformUsers: platformUsers.map((u) => ({ username: u.username, role: u.role, password: u.password })),
    };
    writeExclusive(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, 0o600);
    created.push(credentialsPath);

    const sidecar = {
      kind: "dolmus-takip-load-dataset",
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      sourceCommit: options.sourceCommit,
      sourceTreeDirty: options.sourceTreeDirty,
      randomSeed: options.randomSeed,
      database: {
        fileName: path.basename(dbPath),
        sha256: crypto.createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex"),
        sqliteVersion,
        nodeVersion: process.version,
      },
      schema: migrationHashList(),
      history: { startDate: history.startDate, endDate: history.endDate, years: HISTORY_YEARS },
      loadWindow: { firstMonth: options.loadWindowMonth },
      counts,
    };
    writeExclusive(countsPath, `${JSON.stringify(sidecar, null, 2)}\n`, 0o644);
    created.push(countsPath);

    return { counts, history, buildSeconds: (performance.now() - started) / 1000 };
  } catch (error) {
    sqlite?.close();
    for (const file of created) fs.rmSync(file, { force: true });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE =
  "Kullanım: npm run load:seed -- --db <yeni.sqlite> --credentials <depo-dışı.json> " +
  "[--vehicles 50] [--platform-users 4] [--load-window-month YYYY-MM] [--seed 1] [--counts <yan-dosya.json>]";

export function parseLoadSeedArgs(argv: string[]): Record<string, string> {
  const allowed = new Set(["db", "credentials", "counts", "vehicles", "platform-users", "load-window-month", "seed"]);
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    const name = flag.startsWith("--") ? flag.slice(2) : "";
    if (!allowed.has(name) || value === undefined || value.startsWith("--")) {
      throw new LoadSeedRefusedError(`Geçersiz argüman: ${flag}\n${USAGE}`);
    }
    values[name] = value;
  }
  if (!values.db || !values.credentials) throw new LoadSeedRefusedError(USAGE);
  return values;
}

async function main(): Promise<void> {
  const args = parseLoadSeedArgs(process.argv.slice(2));
  const revision = resolveSourceRevision();
  const options: LoadSeedOptions = {
    dbPath: args.db!,
    credentialsPath: args.credentials!,
    countsPath: args.counts ?? `${path.resolve(args.db!)}.counts.json`,
    vehicles: Number(args.vehicles ?? 50),
    platformUsers: Number(args["platform-users"] ?? 4),
    loadWindowMonth: args["load-window-month"] ?? istanbulToday().slice(0, 7),
    randomSeed: Number(args.seed ?? 1),
    sourceCommit: revision.commit,
    sourceTreeDirty: revision.dirty,
  };
  const summary = await runLoadSeed(options);
  const c = summary.counts;
  console.log(
    `[load:seed] Tamam (${summary.buildSeconds.toFixed(1)} sn): ${c.vehicles} araç, ${c.people} kişi, ` +
      `${c.calendarDays} gün (${summary.history.startDate} … ${summary.history.endDate}), ${c.workEntries} kayıt, ` +
      `${c.revisions} revizyon, ${c.confirmations} onay.`,
  );
  console.log(`[load:seed] DB: ${path.resolve(options.dbPath)}`);
  console.log(`[load:seed] Sayım yan dosyası: ${path.resolve(options.countsPath)}`);
  console.log(`[load:seed] Kimlik bilgileri (0600): ${path.resolve(options.credentialsPath)}`);
  if (revision.dirty) console.log("[load:seed] UYARI: çalışma ağacında commit edilmemiş değişiklik var.");
}

const isDirectRun = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(`[load:seed] Başarısız: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
