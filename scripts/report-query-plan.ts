/**
 * Rapor sorgu planı ve ölçüm komutu — `npm run perf:reports` (S5.5, F12).
 *
 * Beş yıllık sentetik veri kurar (geçici SQLite dosyası + gerçek migration'lar),
 * her rapor use case'inin çalıştırdığı SQL'in EXPLAIN QUERY PLAN çıktısını alır,
 * süreleri ölçer ve sonucu `docs/REPORT-QUERY-PLAN.md` dosyasına yazar. Rapor
 * commit edilir; komut `test:integration` ve `ci-steps.json` DIŞINDADIR (birkaç
 * yüz bin satır kurar, saniyeler sürer).
 *
 * F12 senaryosu AYNI Node sürecinde koşar: better-sqlite3 senkrondur, bir rapor
 * sorgusu event loop'u tutar; health isteği başka süreçten ölçülürse bu etki
 * görünmez. Gerçek `GET /api/v1/health/live` route'u süreç içi bir HTTP
 * sunucusundan sunulur, rapor sorguları art arda koşarken health gecikmesi
 * ölçülür; OPS'taki 3 saniyelik health timeout'u aşılırsa komut hata verir.
 *
 * Ortam (hepsi isteğe bağlı): `PERF_VEHICLES` (varsayılan 40), `PERF_RUNS` (15),
 * `PERF_F12_SECONDS` (6), `PERF_REPORT_PATH` (varsayılan docs/REPORT-QUERY-PLAN.md).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { GET as healthLive } from "../src/app/api/v1/health/live/route.ts";
import { resolveReportPeriod, type ReportPeriod } from "../src/lib/report-period.ts";
import type { VehicleScope } from "../src/server/auth/scope.ts";
import { createDb, openDatabaseConnection, type SqliteConnection } from "../src/server/data/db.ts";
import {
  personPageConditions,
  readOwnerSummaryForScope,
  readPeoplePeriodReportForScope,
  readPersonPeriodReportForScope,
  readVehiclePeriodReportForScope,
  personPeriodWhere,
  selectPeoplePeriodTotals,
  selectPersonEntryPage,
  selectPersonTotals,
  selectVehiclePeriodTotals,
} from "../src/server/usecases/reports/index.ts";
import { buildWorkEntryListQuery, listWorkEntriesForScope } from "../src/server/usecases/work-entries/queries.ts";
import { and } from "drizzle-orm";
import { explainQueryPlan, fullScanRows, type BuiltQuery, type PlanRow } from "./lib/query-plan.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = path.join(projectRoot, "drizzle");
const reportPath = process.env.PERF_REPORT_PATH ?? path.join(projectRoot, "docs", "REPORT-QUERY-PLAN.md");

const VEHICLES = Number(process.env.PERF_VEHICLES ?? 40);
const RUNS = Number(process.env.PERF_RUNS ?? 15);
const F12_SECONDS = Number(process.env.PERF_F12_SECONDS ?? 6);
const DRIVERS_PER_VEHICLE = 4;
const BUSINESSES = 2;
/** Sabit uç tarih: fixture her koşuda aynı satırları üretir. */
const FIXTURE_START = "2021-10-01";
const FIXTURE_END = "2026-09-30";
/** Fixture 2021-10-01'de başladığından 2021 kısmi yıldır; "en eski yıl" ölçümü ilk TAM yıldır. */
const OLDEST_FULL_YEAR_DATE = "2022-06-01";
const HEALTH_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const pad = (n: number, length = 2) => String(n).padStart(length, "0");
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

interface FixtureInfo {
  vehicles: number;
  businesses: number;
  people: number;
  days: number;
  workEntries: number;
  revisions: number;
  confirmations: number;
  correctedEntries: number;
  buildSeconds: number;
  scope: VehicleScope;
  personId: string;
}

function buildFixture(sqlite: SqliteConnection): FixtureInfo {
  const started = performance.now();
  const insertBusiness = sqlite.prepare("INSERT INTO businesses (id, name, active, created_at) VALUES (?, ?, 1, ?)");
  const insertPerson = sqlite.prepare("INSERT INTO people (business_id, id, full_name, active, version) VALUES (?, ?, ?, 1, 1)");
  const insertOwnerLink = sqlite.prepare("INSERT INTO business_owners (business_id, person_id) VALUES (?, ?)");
  const insertVehicle = sqlite.prepare(
    `INSERT INTO vehicles (business_id, id, plate_normalized, owner_person_id, brand_model, year, route_stop, note, active, version)
     VALUES (?, ?, ?, ?, 'Ford Transit', 2020, 'Merkez - Sahil', NULL, 1, 1)`,
  );
  const insertCredential = sqlite.prepare(
    `INSERT INTO vehicle_credentials (business_id, id, vehicle_id, role, password_hash, credential_version)
     VALUES (?, ?, ?, 'owner', 'fixture-hash-not-a-secret', 1)`,
  );
  const insertAssignment = sqlite.prepare(
    "INSERT INTO vehicle_drivers (business_id, vehicle_id, person_id, active, version) VALUES (?, ?, ?, 1, 1)",
  );
  const insertEntry = sqlite.prepare(
    `INSERT INTO work_entries (
       business_id, id, vehicle_id, person_id, work_kind, work_date, starts_at, ends_at, duration_minutes,
       gross_cents, fuel_cents, other_expense_cents, other_expense_note, share_bps, share_cents, remainder_cents,
       calculation_version, status, version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 570, ?, 150000, 30000, NULL, ?, ?, ?, 1, ?, ?)`,
  );
  const insertRevision = sqlite.prepare(
    `INSERT INTO work_entry_revisions (
       business_id, entry_id, version, action, snapshot_json, actor_kind, actor_session_id, actor_role, actor_credential_id, created_at
     ) VALUES (?, ?, ?, ?, '{}', 'vehicle_credential', 'fixture-session', 'owner', ?, ?)`,
  );
  const insertConfirmation = sqlite.prepare(
    `INSERT INTO cash_confirmations (
       business_id, id, entry_id, entry_version, received_cents, confirmed_at,
       actor_kind, actor_session_id, actor_role, actor_credential_id
     ) VALUES (?, ?, ?, ?, ?, ?, 'vehicle_credential', 'fixture-session', 'owner', ?)`,
  );

  const startMs = Date.parse(`${FIXTURE_START}T00:00:00Z`);
  const endMs = Date.parse(`${FIXTURE_END}T00:00:00Z`);
  const days = Math.round((endMs - startMs) / DAY_MS) + 1;
  const counts = { people: 0, workEntries: 0, revisions: 0, confirmations: 0, corrected: 0 };
  let firstScope: VehicleScope | undefined;
  let firstPersonId = "";

  sqlite.transaction(() => {
    const perBusiness = Math.ceil(VEHICLES / BUSINESSES);
    for (let b = 0; b < BUSINESSES; b++) {
      const businessId = `biz-${b}`;
      insertBusiness.run(businessId, `Fixture İşletme ${b}`, "2021-09-01T00:00:00.000Z");
      const ownerId = `person-${b}-owner`;
      insertPerson.run(businessId, ownerId, `Sahip ${b}`);
      insertOwnerLink.run(businessId, ownerId);
      counts.people++;
      for (let v = 0; v < perBusiness && b * perBusiness + v < VEHICLES; v++) {
        const n = b * perBusiness + v;
        const vehicleId = `veh-${n}`;
        const credentialId = `cred-${n}`;
        insertVehicle.run(businessId, vehicleId, `34FIX${pad(n, 3)}`, ownerId);
        insertCredential.run(businessId, credentialId, vehicleId);
        const drivers: string[] = [];
        for (let d = 0; d < DRIVERS_PER_VEHICLE; d++) {
          const personId = `person-${n}-d${d}`;
          insertPerson.run(businessId, personId, `Şoför ${n}-${d}`);
          insertAssignment.run(businessId, vehicleId, personId);
          drivers.push(personId);
          counts.people++;
        }
        if (n === 0) {
          firstScope = { kind: "vehicle", actor: "owner", businessId, vehicleId, credentialId };
          firstPersonId = drivers[0]!;
        }

        for (let day = 0; day < days; day++) {
          const date = isoDay(startMs + day * DAY_MS);
          const kinds: { kind: "owner" | "driver"; person: string }[] = [{ kind: "driver", person: drivers[day % DRIVERS_PER_VEHICLE]! }];
          if (day % 5 === 0) kinds.push({ kind: "driver", person: drivers[(day + 1) % DRIVERS_PER_VEHICLE]! });
          if (day % 4 === 0) kinds.push({ kind: "owner", person: ownerId });
          kinds.forEach(({ kind, person }, slot) => {
            const id = `e-${n}-${day}-${slot}`;
            const driverKind = kind === "driver";
            const confirmed = driverKind && (day + slot) % 4 !== 0;
            const status = !driverKind ? "not_required" : confirmed ? "confirmed" : "pending";
            const corrected = confirmed && day % 10 === 0;
            const version = corrected ? 2 : 1;
            const shareCents = driverKind ? 200000 : 0;
            insertEntry.run(
              businessId, id, vehicleId, person, kind, date, `${date}T05:00:00.000Z`, `${date}T14:30:00.000Z`,
              1000000, driverKind ? 2000 : 0, shareCents, 1000000 - 150000 - 30000 - shareCents, status, version,
            );
            counts.workEntries++;
            const at = `${date}T15:00:00.000Z`;
            insertRevision.run(businessId, id, 1, "create", credentialId, at);
            counts.revisions++;
            if (confirmed) {
              insertConfirmation.run(businessId, `c-${id}-1`, id, 1, 600000, at, credentialId);
              counts.confirmations++;
            }
            if (corrected) {
              insertRevision.run(businessId, id, 2, "correct_and_confirm", credentialId, at);
              insertConfirmation.run(businessId, `c-${id}-2`, id, 2, 620000, at, credentialId);
              counts.revisions++;
              counts.confirmations++;
              counts.corrected++;
            }
          });
        }
      }
    }
  })();

  const violations = sqlite.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) throw new Error(`fixture FK ihlali: ${JSON.stringify(violations.slice(0, 3))}`);
  sqlite.exec("ANALYZE");
  if (!firstScope) throw new Error("fixture: hedef araç kurulamadı.");
  return {
    vehicles: VEHICLES,
    businesses: BUSINESSES,
    people: counts.people,
    days,
    workEntries: counts.workEntries,
    revisions: counts.revisions,
    confirmations: counts.confirmations,
    correctedEntries: counts.corrected,
    buildSeconds: (performance.now() - started) / 1000,
    scope: firstScope,
    personId: firstPersonId,
  };
}

// ---------------------------------------------------------------------------
// Ölçüm
// ---------------------------------------------------------------------------

interface Timing {
  medianMs: number;
  maxMs: number;
}

function time(run: () => unknown): Timing {
  run();
  run();
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    run();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  return { medianMs: samples[Math.floor(samples.length / 2)]!, maxMs: samples[samples.length - 1]! };
}

interface Measurement {
  name: string;
  description: string;
  period: ReportPeriod;
  timing: Timing;
  statements: { label: string; sql: string; plan: PlanRow[] }[];
}

const fmt = (n: number) => n.toFixed(2);

function periodOf(kind: "month" | "year", date: string): ReportPeriod {
  const period = resolveReportPeriod(kind, date);
  if (!period) throw new Error(`geçersiz dönem: ${kind} ${date}`);
  return period;
}

function runMeasurements(sqlite: SqliteConnection, info: FixtureInfo): Measurement[] {
  const db = createDb(sqlite);
  const { scope, personId } = info;
  const current = periodOf("year", "2026-09-15");
  const oldest = periodOf("year", OLDEST_FULL_YEAR_DATE);
  const out: Measurement[] = [];
  const statement = (label: string, query: BuiltQuery) => ({ label, ...explainQueryPlan(sqlite, query) });

  for (const [tag, period] of [["yıl 2026", current], ["en eski tam yıl 2022", oldest]] as const) {
    out.push({
      name: `Sahip özeti (${tag})`,
      description: "readOwnerSummaryForScope — başlık + toplamlar tek okuma işleminde",
      period,
      timing: time(() => readOwnerSummaryForScope(db, scope, period)),
      statements: [statement("toplamlar", selectVehiclePeriodTotals(db, scope, period))],
    });
    out.push({
      name: `Kişi toplamları (${tag})`,
      description: "readPeoplePeriodReportForScope — kişi başına tek GROUP BY",
      period,
      timing: time(() => readPeoplePeriodReportForScope(db, scope, period)),
      statements: [statement("kişi toplamları", selectPeoplePeriodTotals(db, scope, period))],
    });
    out.push({
      name: `Kişi detayı (${tag})`,
      description: "readPersonPeriodReportForScope — kişi toplamı + ilk 50 kayıt tek okuma işleminde",
      period,
      timing: time(() => readPersonPeriodReportForScope(db, scope, period, personId, { limit: 50 })),
      statements: [
        statement("kişi toplamı", selectPersonTotals(db, personPeriodWhere(scope, period, personId))),
        statement("kayıt sayfası", selectPersonEntryPage(db, and(...personPageConditions(scope, period, personId)), 50)),
      ],
    });
    out.push({
      name: `Doğrulanmamış kayıt listesi, status=pending (${tag})`,
      description: "listWorkEntriesForScope — durum süzgeçli, en yeni gün önce, ilk 50",
      period,
      timing: time(() => listWorkEntriesForScope(db, scope, { period, status: "pending", limit: 50 })),
      statements: [statement("liste", buildWorkEntryListQuery(db, scope, { period, status: "pending", limit: 50 }))],
    });
  }
  const month = periodOf("month", "2026-09-15");
  out.push({
    name: "Gün gün liste, tüm durumlar (ay 2026-09)",
    description: "listWorkEntriesForScope — süzgeçsiz aylık liste",
    period: month,
    timing: time(() => listWorkEntriesForScope(db, scope, { period: month, limit: 50 })),
    statements: [statement("liste", buildWorkEntryListQuery(db, scope, { period: month, limit: 50 }))],
  });
  out.push({
    name: "Araç dönem raporu (yıl 2026)",
    description: "readVehiclePeriodReportForScope — tek SELECT",
    period: current,
    timing: time(() => readVehiclePeriodReportForScope(db, scope, current)),
    statements: [statement("toplamlar", selectVehiclePeriodTotals(db, scope, current))],
  });
  return out;
}

// ---------------------------------------------------------------------------
// F12: ağır rapor + eşzamanlı health, AYNI süreç
// ---------------------------------------------------------------------------

interface F12Result {
  seconds: number;
  reportRuns: number;
  healthRequests: number;
  healthP50Ms: number;
  healthP95Ms: number;
  healthMaxMs: number;
  idleMaxMs: number;
  longestReportMs: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function probeHealth(url: string, until: () => boolean): Promise<number[]> {
  const latencies: number[] = [];
  while (!until()) {
    const t = performance.now();
    const response = await fetch(url);
    await response.text();
    if (response.status !== 200) throw new Error(`health ${response.status} döndü`);
    latencies.push(performance.now() - t);
    await sleep(5);
  }
  return latencies;
}

async function runF12(sqlite: SqliteConnection, info: FixtureInfo): Promise<F12Result> {
  const db = createDb(sqlite);
  const { scope, personId } = info;
  const server = http.createServer((_req, res) => {
    const response = healthLive();
    void response.text().then((body) => {
      res.statusCode = response.status;
      res.setHeader("content-type", "application/json");
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("health sunucusu port almadı.");
  const url = `http://127.0.0.1:${address.port}/api/v1/health/live`;

  try {
    // Taban: rapor yokken health gecikmesi (ilk bağlantı kurulumunu ısınmayla dışarıda bırak).
    await probeHealth(url, (() => { let n = 0; return () => n++ >= 20; })());
    const idleUntil = performance.now() + 1000;
    const idle = await probeHealth(url, () => performance.now() >= idleUntil);

    // Yük: en eski yılın ağır sorguları art arda (her tur arasında event loop'a nefes).
    const oldest = periodOf("year", OLDEST_FULL_YEAR_DATE);
    let reportRuns = 0;
    let longestReportMs = 0;
    const loadUntil = performance.now() + F12_SECONDS * 1000;
    const done = () => performance.now() >= loadUntil;
    const load = (async () => {
      while (!done()) {
        for (const run of [
          () => readOwnerSummaryForScope(db, scope, oldest),
          () => readPeoplePeriodReportForScope(db, scope, oldest),
          () => readPersonPeriodReportForScope(db, scope, oldest, personId, { limit: 50 }),
          () => listWorkEntriesForScope(db, scope, { period: oldest, status: "pending", limit: 50 }),
        ]) {
          const t = performance.now();
          run();
          longestReportMs = Math.max(longestReportMs, performance.now() - t);
          reportRuns++;
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    })();
    const [loaded] = await Promise.all([probeHealth(url, done), load]);
    loaded.sort((a, b) => a - b);
    const pick = (q: number) => loaded[Math.min(loaded.length - 1, Math.floor(loaded.length * q))]!;
    return {
      seconds: F12_SECONDS,
      reportRuns,
      healthRequests: loaded.length,
      healthP50Ms: pick(0.5),
      healthP95Ms: pick(0.95),
      healthMaxMs: loaded[loaded.length - 1]!,
      idleMaxMs: Math.max(...idle),
      longestReportMs,
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------
// Rapor
// ---------------------------------------------------------------------------

function renderReport(info: FixtureInfo, sqliteVersion: string, measurements: Measurement[], f12: F12Result): string {
  const lines: string[] = [];
  const p = (line = "") => lines.push(line);
  p("# Rapor sorgu planı ve ölçüm raporu");
  p();
  p("`npm run perf:reports` tarafından üretilir (S5.5, F12). Elle düzenlenmez; komut yeniden koşulunca üzerine yazılır. Süreler makineye bağlıdır; planlar ve satır sayıları sabit fixture'dan gelir.");
  p();
  p("## Ortam");
  p();
  p(`- Node ${process.version}, SQLite ${sqliteVersion}, ${os.platform()} ${os.arch()}, ${os.cpus().length} çekirdek`);
  p(`- Her ölçüm: 2 ısınma + ${RUNS} koşu; tablo medyan ve en yüksek değeri gösterir (ms)`);
  p("- Fixture sonrası `ANALYZE` çalıştırılır (üretimdeki `PRAGMA optimize` benzeri istatistik durumu).");
  p();
  p("## Veri hacmi");
  p();
  p("| Kalem | Değer |");
  p("| --- | ---: |");
  p(`| Dönem | ${FIXTURE_START} … ${FIXTURE_END} (${info.days} gün, 5 yıl) |`);
  p(`| İşletme | ${info.businesses} |`);
  p(`| Araç | ${info.vehicles} |`);
  p(`| Kişi (sahip + şoför) | ${info.people} |`);
  p(`| work_entries | ${info.workEntries} |`);
  p(`| work_entry_revisions | ${info.revisions} |`);
  p(`| cash_confirmations | ${info.confirmations} |`);
  p(`| Düzeltilmiş (sürüm 2) kayıt | ${info.correctedEntries} |`);
  p(`| Fixture kurulum süresi | ${fmt(info.buildSeconds)} sn |`);
  p();
  p("Ölçümler ilk araçta (bir araç ≈ 5 yıllık kayıtları) ve onun şoförlerinde koşar; diğer araçların kayıtları kapsam süzgecinin dışarıda bırakması gereken gürültüdür.");
  p();
  p("## Zamanlamalar");
  p();
  p("| Sorgu | Dönem | Medyan (ms) | En yüksek (ms) |");
  p("| --- | --- | ---: | ---: |");
  for (const m of measurements) {
    p(`| ${m.name} | ${m.period.startDate} … ${m.period.nextStartDate} | ${fmt(m.timing.medianMs)} | ${fmt(m.timing.maxMs)} |`);
  }
  p();
  p("## Sorgu planları (EXPLAIN QUERY PLAN)");
  p();
  p("Plan, use case'in çalıştırdığı Drizzle kurucusunun `.toSQL()` çıktısından alınır. `SCAN work_entries` (kısıtsız) satırı olmamalıdır; entegrasyon testi (`report-query-plan.test.ts`) bunu küçük veriyle de kilitler.");
  p();
  for (const m of measurements) {
    p(`### ${m.name}`);
    p();
    p(m.description);
    p();
    for (const s of m.statements) {
      p(`**${s.label}**`);
      p();
      p("```");
      for (const row of s.plan) p(row.detail);
      p("```");
      p();
      const scans = fullScanRows(s.plan, "work_entries");
      if (scans.length > 0) p(`> UYARI: tam tarama satırı var: ${scans.map((r) => r.detail).join("; ")}`);
      p();
    }
  }
  p("## Sonuç: indeks / sorgu kararı");
  p();
  const worst = Math.max(...measurements.map((m) => m.timing.maxMs));
  p(`Ölçülen her sorgu \`idx_work_entries_*\` indekslerinden birini kısıtlı \`SEARCH\` ile kullanır, hiçbirinde \`work_entries\` tam taraması yoktur ve en yavaş tek koşu ${fmt(worst)} ms'dir. Darboğaz bulunmadığından indeks eklenmedi ve sorgu yeniden yazılmadı (mimari kural: EXPLAIN kanıtı olmadan indeks eklenmez). Kalan \`USE TEMP B-TREE\` satırları dönem içindeki tek aracın satırları üzerindedir (\`COUNT(DISTINCT work_date)\`, kişi \`GROUP BY\` ve \`ORDER BY\`); tam tablo değildir.`);
  p();
  p("## F12 — ağır rapor + eşzamanlı health (aynı süreç)");
  p();
  p(`Gerçek \`GET /api/v1/health/live\` route'u süreç içi HTTP sunucusundan sunulur; ${f12.seconds} sn boyunca en eski yılın ağır rapor sorguları art arda koşarken health her ~5 ms'de bir istenir. better-sqlite3 senkron olduğundan health gecikmesi en uzun tek rapor sorgusuna eşit veya biraz üstündedir.`);
  p();
  p("| Ölçüt | Değer |");
  p("| --- | ---: |");
  p(`| Rapor sorgusu koşusu | ${f12.reportRuns} |`);
  p(`| En uzun tek rapor sorgusu (ms) | ${fmt(f12.longestReportMs)} |`);
  p(`| Health isteği (yük altında) | ${f12.healthRequests} |`);
  p(`| Health p50 (ms) | ${fmt(f12.healthP50Ms)} |`);
  p(`| Health p95 (ms) | ${fmt(f12.healthP95Ms)} |`);
  p(`| Health en yüksek (ms) | ${fmt(f12.healthMaxMs)} |`);
  p(`| Health en yüksek, rapor yokken (ms) | ${fmt(f12.idleMaxMs)} |`);
  p(`| Health timeout (OPS) | ${HEALTH_TIMEOUT_MS} ms |`);
  p();
  p(`Sonuç: en yüksek health gecikmesi ${fmt(f12.healthMaxMs)} ms, ${HEALTH_TIMEOUT_MS} ms timeout'unun ${f12.healthMaxMs < HEALTH_TIMEOUT_MS ? "altında" : "ÜSTÜNDE"}.`);
  p();
  return lines.join("\n");
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolmus-report-plan-"));
  const sqlite = openDatabaseConnection(path.join(dir, "perf.sqlite"), { createIfMissing: true });
  try {
    migrate(createDb(sqlite), { migrationsFolder });
    console.log("[perf:reports] fixture kuruluyor…");
    const info = buildFixture(sqlite);
    console.log(`[perf:reports] ${info.workEntries} work_entries, ${fmt(info.buildSeconds)} sn`);
    const sqliteVersion = (sqlite.prepare("SELECT sqlite_version() AS v").get() as { v: string }).v;
    const measurements = runMeasurements(sqlite, info);
    const f12 = await runF12(sqlite, info);
    const report = renderReport(info, sqliteVersion, measurements, f12);
    fs.writeFileSync(reportPath, report);
    console.log(`[perf:reports] rapor yazıldı: ${reportPath}`);

    const scans = measurements.flatMap((m) => m.statements.flatMap((s) => fullScanRows(s.plan, "work_entries")));
    if (scans.length > 0) throw new Error(`work_entries tam taraması: ${scans.map((r) => r.detail).join("; ")}`);
    if (f12.healthMaxMs >= HEALTH_TIMEOUT_MS) {
      throw new Error(`F12: health gecikmesi ${fmt(f12.healthMaxMs)} ms ≥ ${HEALTH_TIMEOUT_MS} ms`);
    }
  } finally {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`[perf:reports] başarısız: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
