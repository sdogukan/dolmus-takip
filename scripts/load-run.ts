/**
 * Yük kabul koşucusu — `npm run load:run` (S6.6, T6.6).
 *
 * Test edilen makinenin DIŞINDAKİ bir makineden, yalnız Node `fetch` ile ve
 * gerçek bir kullanıcının yaptığı gibi çalışır (`./lib/load-client.ts`): hız
 * sınırı, CSRF ve origin korumaları atlatılmaz, `X-Forwarded-For` gönderilmez,
 * hiçbir test uç noktası veya ortam anahtarı kullanılmaz.
 *
 * Senaryolar (her biri ayrı koşulur; sonuçlar birbirinin yerine geçmez):
 * - `login-burst`: her dalgada 100 kullanıcı kısa aralıkta giriş yapar
 *   (araç sahibi/şoför + ekip hesapları) ve oturumu okur.
 * - `active-mix`: 100 aktif kullanıcı düşünme süreli karışık akış: şoför kayıt
 *   girer ve listeler; sahip rapor okur, teslim onaylar, düzeltip onaylar.
 * - `write-peak`: her dalgada 100 yazma aynı anda: kayıt, onay, düzelt ve
 *   onayla; bir kısmı çift gönderim (aynı requestId + aynı gövde) ve eşzamanlı
 *   düzeltme (aynı sürüm, iki farklı istek → biri 409 VERSION_CONFLICT).
 *
 * Her senaryo ısınma → kademeli artış → sürdürülen yük aşamalarıyla, AÇIK
 * modelde (planlı gönderim yanıt beklemez) çalışır; planlanan ve gerçekleşen
 * hız ile gönderim gecikmesi rapora yazılır. Hedeflere (kayıt p95 ≤ 2 sn,
 * rapor p95 ≤ 3 sn, beklenmeyen < %1) yalnız sürdürülen yükteki işlemler
 * karşılaştırılır.
 *
 * Yazmalar deftere işlenir; sonucu bilinmeyen yazma aynı requestId ve ilk
 * gönderimdeki bayt-bayt aynı gövdeyle yeniden denenir. Koşu sonunda yazma
 * penceresindeki (seed'in boş bıraktığı ay) tüm kayıtlar API'den okunup
 * defterle karşılaştırılır: kayıp, çift, tutarsız.
 *
 * Rapor (JSON + Markdown) sürüm kimliğini `release:build` manifestinden okur
 * (`source_commit`, `artifact_sha256`); commit'i üreticinin çalışma ağacından
 * ÇIKARMAZ. Rapora parola, çerez veya token yazılmaz.
 *
 * Bu komut `ci-steps.json`, `test:unit` ve `test:integration` DIŞINDADIR.
 *
 * Çıkış kodu: 0 geçti, 2 hedef tutmadı (rapor yazıldı), 1 koşu hatası.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { evaluateWorkTime } from "../src/lib/work-time.ts";
import { calculateWorkEntryAmounts } from "../src/lib/work-calculation.ts";
import {
  LoadSession,
  sendRequest,
  sendWriteWithRetry,
  type ClientOptions,
  type HttpSample,
  type RequestResult,
  type WriteResult,
} from "./lib/load-client.ts";
import {
  LOAD_TARGETS,
  REQUEST_CLASSES,
  SERVER_MAX_WAIT_MS,
  acceptanceEligibility,
  buildSchedule,
  evaluateVerdict,
  internalInconsistency,
  isLoopbackHost,
  reconcileLedger,
  statesEqual,
  summarizeLatencies,
  type ArrivalShape,
  type EntryState,
  type ExpectedEntry,
  type LatencySummary,
  type LoadPhase,
  type ObservedEntry,
  type ReconciliationResult,
  type RequestClass,
  type ScheduledOp,
} from "./lib/load-metrics.ts";
import {
  REACHABILITY_PROBE_PATH,
  SCENARIO_NAMES,
  renderLoadReportMarkdown,
  type LoadReport,
  type OutcomeCounts,
  type ScenarioName,
  type WaveSummary,
} from "./lib/load-report.ts";

// ---------------------------------------------------------------------------
// Yapılandırma
// ---------------------------------------------------------------------------

export interface LoadRunConfig {
  scenario: ScenarioName;
  targetUrl: string;
  origin: string;
  credentialsPath: string;
  datasetPath: string;
  releaseManifestPath: string;
  outDir: string;
  warmupSeconds: number;
  rampSeconds: number;
  sustainSeconds: number;
  users: number;
  timeoutMs: number;
  thinkSeconds: number;
  waveIntervalSeconds: number;
  waveSpreadSeconds: number;
  warmupFraction: number;
  maxInFlight: number;
  maxRetries: number;
  retryBackoffMs: number;
  probeFraction: number;
  doubleSubmitFraction: number;
  conflictFraction: number;
  probeIntervalSeconds: number;
  windowMonth: string | null;
  randomSeed: number;
}

export class LoadRunUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoadRunUsageError";
  }
}

const USAGE = `Kullanım: npm run load:run -- --scenario <${SCENARIO_NAMES.join("|")}> --target <https://…>
  --credentials <kimlik.json> --dataset <db.counts.json> --release-manifest <dist/…manifest.json> --out <dizin>
  [--origin <APP_ORIGIN>] [--warmup 300] [--ramp 300] [--sustain 1800] [--users 100] [--timeout-ms 20000]
  [--think-seconds 30] [--wave-interval <sn>] [--wave-spread <sn>] [--warmup-fraction 0.1] [--max-in-flight 2000]
  [--max-retries 5] [--retry-backoff-ms 1000] [--probe-fraction 0.1] [--double-submit-fraction 0.05]
  [--conflict-fraction 0.05] [--probe-interval 10] [--window-month YYYY-MM] [--seed 1]`;

const WAVE_DEFAULTS: Record<ScenarioName, { interval: number; spread: number }> = {
  "login-burst": { interval: 60, spread: 10 },
  "active-mix": { interval: 60, spread: 10 },
  "write-peak": { interval: 30, spread: 1 },
};

export function parseLoadRunArgs(argv: string[]): LoadRunConfig {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    if (!flag.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new LoadRunUsageError(`Geçersiz argüman: ${flag}\n${USAGE}`);
    }
    values.set(flag.slice(2), value);
  }
  const known = new Set([
    "scenario", "target", "origin", "credentials", "dataset", "release-manifest", "out", "warmup", "ramp", "sustain",
    "users", "timeout-ms", "think-seconds", "wave-interval", "wave-spread", "warmup-fraction", "max-in-flight",
    "max-retries", "retry-backoff-ms", "probe-fraction", "double-submit-fraction", "conflict-fraction",
    "probe-interval", "window-month", "seed",
  ]);
  for (const key of values.keys()) if (!known.has(key)) throw new LoadRunUsageError(`Bilinmeyen argüman: --${key}\n${USAGE}`);

  const required = (key: string) => {
    const value = values.get(key);
    if (value === undefined) throw new LoadRunUsageError(`--${key} zorunlu.\n${USAGE}`);
    return value;
  };
  const number = (key: string, fallback: number, check: (n: number) => boolean, rule: string) => {
    const raw = values.get(key);
    const n = raw === undefined ? fallback : Number(raw);
    if (!Number.isFinite(n) || !check(n)) throw new LoadRunUsageError(`--${key} ${rule} olmalı: ${raw}`);
    return n;
  };
  const nonNegative = (n: number) => n >= 0;
  const positiveInt = (n: number) => Number.isInteger(n) && n > 0;
  const fraction = (n: number) => n >= 0 && n <= 1;

  const scenario = required("scenario") as ScenarioName;
  if (!SCENARIO_NAMES.includes(scenario)) throw new LoadRunUsageError(`--scenario ${SCENARIO_NAMES.join(" | ")} olmalı.`);
  let target: URL;
  try {
    target = new URL(required("target"));
  } catch {
    throw new LoadRunUsageError("--target geçerli bir URL olmalı.");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") throw new LoadRunUsageError("--target http(s) olmalı.");
  const originRaw = values.get("origin") ?? target.origin;
  let origin: string;
  try {
    origin = new URL(originRaw).origin;
  } catch {
    throw new LoadRunUsageError("--origin geçerli bir origin olmalı.");
  }
  const windowMonth = values.get("window-month") ?? null;
  if (windowMonth !== null && !/^\d{4}-(0[1-9]|1[0-2])$/u.test(windowMonth)) {
    throw new LoadRunUsageError("--window-month YYYY-MM olmalı.");
  }

  const config: LoadRunConfig = {
    scenario,
    targetUrl: target.origin,
    origin,
    credentialsPath: required("credentials"),
    datasetPath: required("dataset"),
    releaseManifestPath: required("release-manifest"),
    outDir: required("out"),
    warmupSeconds: number("warmup", 300, nonNegative, "≥ 0"),
    rampSeconds: number("ramp", 300, nonNegative, "≥ 0"),
    sustainSeconds: number("sustain", 1800, (n) => n > 0, "> 0"),
    users: number("users", 100, positiveInt, "pozitif tam sayı"),
    timeoutMs: number("timeout-ms", 20_000, (n) => n > SERVER_MAX_WAIT_MS, `> ${SERVER_MAX_WAIT_MS} (hash kuyruğu 10 sn + busy_timeout 2 sn)`),
    thinkSeconds: number("think-seconds", 30, (n) => n > 0, "> 0"),
    waveIntervalSeconds: number("wave-interval", WAVE_DEFAULTS[scenario].interval, (n) => n > 0, "> 0"),
    waveSpreadSeconds: number("wave-spread", WAVE_DEFAULTS[scenario].spread, nonNegative, "≥ 0"),
    warmupFraction: number("warmup-fraction", 0.1, fraction, "0..1"),
    maxInFlight: number("max-in-flight", 2000, positiveInt, "pozitif tam sayı"),
    maxRetries: number("max-retries", 5, (n) => Number.isInteger(n) && n >= 0, "≥ 0 tam sayı"),
    retryBackoffMs: number("retry-backoff-ms", 1000, nonNegative, "≥ 0"),
    probeFraction: number("probe-fraction", 0.1, fraction, "0..1"),
    doubleSubmitFraction: number("double-submit-fraction", 0.05, fraction, "0..1"),
    conflictFraction: number("conflict-fraction", 0.05, fraction, "0..1"),
    probeIntervalSeconds: number("probe-interval", 10, (n) => n > 0, "> 0"),
    windowMonth,
    randomSeed: number("seed", 1, Number.isSafeInteger, "tam sayı"),
  };
  if (config.waveSpreadSeconds >= config.waveIntervalSeconds) {
    throw new LoadRunUsageError("--wave-spread, --wave-interval değerinden küçük olmalı.");
  }
  return config;
}

// ---------------------------------------------------------------------------
// Erişilebilirlik sondası
// ---------------------------------------------------------------------------

/**
 * `GET /giris` — her çağrıda YENİ, boş bir oturumla (çerez ve CSRF başlığı
 * yok), `probe` sınıfında: kullanıcı gecikme ve yanıt istatistiklerine
 * karışmaz. Sayfa HTML döndüğünden yalnız durum koduna bakılır.
 */
export function probeReachability(client: ClientOptions): Promise<RequestResult> {
  return sendRequest(client, new LoadSession(), {
    method: "GET", path: REACHABILITY_PROBE_PATH, route: `GET ${REACHABILITY_PROBE_PATH}`, cls: "probe", kind: "read",
  });
}

/** Hazırlık: 200 değilse yük başlatılmaz; 503 Caddy'nin bakım yanıtıdır. */
export async function assertTargetReachable(client: ClientOptions): Promise<void> {
  const res = await probeReachability(client);
  if (res.status === 200) return;
  const probe = `GET ${REACHABILITY_PROBE_PATH} → ${res.status ?? res.classification.code}`;
  if (res.status === 503) throw new Error(`Hedef bakımda: ${probe} (bakım işareti açık); yük başlatılmadı.`);
  throw new Error(`Hedefe erişilemiyor: ${probe}; yük başlatılmadı.`);
}

// ---------------------------------------------------------------------------
// Girdi dosyaları
// ---------------------------------------------------------------------------

interface CredentialsFile {
  vehicles: {
    index: number;
    plate: string;
    vehicleId: string;
    ownerPersonId: string;
    driverPersonIds: string[];
    ownerPassword: string;
    driverPassword: string;
  }[];
  platformUsers: { username: string; role: string; password: string }[];
}

interface MigrationHashEntry {
  idx: number;
  file: string;
  sha256: string;
}

interface DatasetSidecar {
  kind: string;
  sourceCommit: string;
  database: { sha256: string };
  schema: { migration_sha256_list: MigrationHashEntry[] };
  history: { startDate: string; endDate: string; years: number };
  loadWindow: { firstMonth: string };
  counts: Record<string, number | string>;
}

interface ReleaseManifest {
  source_commit: string;
  artifact_sha256: string;
  node_version?: string;
  sqlite_version?: string;
  built_at?: string;
  schema?: { migration_sha256_list?: MigrationHashEntry[] };
}

function readJson<T>(filePath: string, label: string): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    throw new LoadRunUsageError(`${label} okunamadı (${filePath}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readCredentials(filePath: string): CredentialsFile {
  const mode = fs.statSync(filePath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new LoadRunUsageError(`Kimlik bilgisi dosyası yalnız sahibine açık olmalı (0600); şu an ${mode.toString(8)}.`);
  }
  let file: CredentialsFile;
  try {
    file = JSON.parse(fs.readFileSync(filePath, "utf8")) as CredentialsFile;
  } catch {
    // JSON.parse mesajı dosyadan kesit içerir (parola olabilir): içerik yazılmaz.
    throw new LoadRunUsageError(`Kimlik bilgisi dosyası JSON olarak okunamadı: ${filePath}`);
  }
  if (!Array.isArray(file.vehicles) || !Array.isArray(file.platformUsers)) {
    throw new LoadRunUsageError("Kimlik bilgisi dosyası `load:seed` biçiminde değil.");
  }
  return file;
}

function readManifest(filePath: string): ReleaseManifest {
  const manifest = readJson<ReleaseManifest>(filePath, "Yayın manifesti");
  if (!/^[0-9a-f]{40}$/u.test(manifest.source_commit ?? "") || !/^[0-9a-f]{64}$/u.test(manifest.artifact_sha256 ?? "")) {
    throw new LoadRunUsageError("Yayın manifestinde source_commit / artifact_sha256 yok (release:build çıktısı bekleniyor).");
  }
  return manifest;
}

function sameMigrations(a: MigrationHashEntry[] | undefined, b: MigrationHashEntry[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((x, i) => x.idx === b[i]!.idx && x.file === b[i]!.file && x.sha256 === b[i]!.sha256);
}

// ---------------------------------------------------------------------------
// Kullanıcılar ve defter
// ---------------------------------------------------------------------------

interface VehicleState {
  index: number;
  vehicleId: string;
  ownerPersonId: string;
  driverPersonIds: string[];
  owner: User | null;
  entries: EntryRecord[];
}

interface User {
  kind: "vehicle" | "platform";
  role: "owner" | "driver" | "admin" | "support";
  loginPath: string;
  /** Parolayı içerir; yalnız giriş isteğinin gövdesi olarak gönderilir. */
  loginBody: string;
  vehicle: VehicleState | null;
  session: LoadSession;
  loggedIn: boolean;
}

interface EntryBody {
  workType: "owner" | "driver";
  workerPersonId?: string;
  date: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  grossCents: string;
  fuelCents: string;
  otherExpenseCents: string;
  otherExpenseNote: string;
}

interface EntryRecord {
  expected: ExpectedEntry;
  body: EntryBody;
  busy: boolean;
  /** Durumu artık kesin bilinmiyor (bilinmeyen sonuç, beklenmeyen ret); yeni işlem yapılmaz. */
  blocked: boolean;
  corrections: number;
}

/** mulberry32 — senaryo seçimleri tekrarlanabilir olsun. */
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

function buildUsers(scenario: ScenarioName, credentials: CredentialsFile, count: number): { users: User[]; vehicles: VehicleState[] } {
  const users: User[] = [];
  const vehicles: VehicleState[] = [];
  const add = (user: User) => {
    if (users.length < count) users.push(user);
  };
  if (scenario === "login-burst") {
    for (const u of credentials.platformUsers) {
      add({
        kind: "platform",
        role: u.role === "admin" ? "admin" : "support",
        loginPath: "/api/v1/auth/platform-login",
        loginBody: JSON.stringify({ username: u.username, password: u.password }),
        vehicle: null,
        session: new LoadSession(),
        loggedIn: false,
      });
    }
  }
  for (const v of credentials.vehicles) {
    if (users.length >= count) break;
    const vehicle: VehicleState = {
      index: v.index,
      vehicleId: v.vehicleId,
      ownerPersonId: v.ownerPersonId,
      driverPersonIds: v.driverPersonIds,
      owner: null,
      entries: [],
    };
    vehicles.push(vehicle);
    for (const role of ["owner", "driver"] as const) {
      const user: User = {
        kind: "vehicle",
        role,
        loginPath: "/api/v1/auth/vehicle-login",
        loginBody: JSON.stringify({ plate: v.plate, password: role === "owner" ? v.ownerPassword : v.driverPassword }),
        vehicle,
        session: new LoadSession(),
        loggedIn: false,
      };
      if (role === "owner") vehicle.owner = user;
      add(user);
    }
  }
  if (users.length < count) {
    throw new LoadRunUsageError(`Kimlik bilgisi dosyasında ${count} kullanıcı yok (${users.length}); load:seed --vehicles artırın.`);
  }
  return { users, vehicles };
}

// ---------------------------------------------------------------------------
// Ölçüm toplayıcı
// ---------------------------------------------------------------------------

type SamplePhase = LoadPhase | "setup" | "reconcile" | "monitor";

interface Recorded {
  phase: SamplePhase;
  sample: HttpSample;
}

function emptyOutcomes(): OutcomeCounts {
  return { requests: 0, success: 0, expected409: {}, rateLimited429: {}, unknownResult: {}, unexpected: {} };
}

function tally(counts: OutcomeCounts, sample: HttpSample): void {
  counts.requests++;
  const { outcome, code } = sample.classification;
  const bump = (record: Record<string, number>) => {
    record[code] = (record[code] ?? 0) + 1;
  };
  if (outcome === "success") counts.success++;
  else if (outcome === "expected_409") bump(counts.expected409);
  else if (outcome === "rate_limited_429") bump(counts.rateLimited429);
  else if (outcome === "unknown_result") bump(counts.unknownResult);
  else bump(counts.unexpected);
}

// ---------------------------------------------------------------------------
// Koşu
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const pad = (n: number) => String(n).padStart(2, "0");
const RECONCILE_PAGE = 100;
const MAX_WINDOW_PROBE_MONTHS = 24;
const MAX_REPORTED_FINDINGS = 50;
const LOGIN_CONCURRENCY = 4;
const IP_FAILED_LOGIN_LIMIT = 120;
const LOGIN_WINDOW_MINUTES = 15;

function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

interface WorkEntryApiView {
  id: string;
  version: number;
  status: EntryState["status"];
  workKind: "owner" | "driver";
  workDate: string;
  startsAt: string;
  endsAt: string;
  grossCents: string;
  fuelCents: string;
  otherExpenseCents: string;
  shareCents: string;
  remainderCents: string;
  otherExpenseNote: string | null;
  shareBps: number;
  person: { id: string };
  confirmation: { receivedCents: string; entryVersion: number } | null;
}

function toObserved(view: WorkEntryApiView, vehicleId: string): ObservedEntry {
  return {
    id: view.id,
    vehicleId,
    workKind: view.workKind,
    fingerprint: view.otherExpenseNote,
    state: {
      version: view.version,
      status: view.status,
      personId: view.person.id,
      workDate: view.workDate,
      startsAt: view.startsAt,
      endsAt: view.endsAt,
      grossCents: view.grossCents,
      fuelCents: view.fuelCents,
      otherExpenseCents: view.otherExpenseCents,
      receivedCents: view.confirmation ? view.confirmation.receivedCents : null,
    },
    shareBps: view.shareBps,
    shareCents: view.shareCents,
    remainderCents: view.remainderCents,
    confirmationEntryVersion: view.confirmation ? view.confirmation.entryVersion : null,
  };
}

/** Gövdeden, sunucunun kaydetmesi gereken durum (hesap kuralı ve İstanbul saati dahil). */
function stateFromBody(body: EntryBody, personId: string, version: number, status: EntryState["status"], receivedCents: string | null): EntryState {
  const time = evaluateWorkTime({ date: body.date, startTime: body.startTime, endTime: body.endTime, endsNextDay: body.endsNextDay });
  if (!time.ok) throw new Error(`load-run: üretilen saatler geçersiz: ${JSON.stringify(time.errors)}`);
  return {
    version,
    status,
    personId,
    workDate: body.date,
    startsAt: time.startsAt,
    endsAt: time.endsAt,
    grossCents: body.grossCents,
    fuelCents: body.fuelCents,
    otherExpenseCents: body.otherExpenseCents,
    receivedCents,
  };
}

function remainderOf(body: EntryBody): string {
  const amounts = calculateWorkEntryAmounts(body.workType, BigInt(body.grossCents), BigInt(body.fuelCents), BigInt(body.otherExpenseCents));
  return String(Math.max(0, amounts.remainderCents));
}

export async function runLoad(config: LoadRunConfig): Promise<{ report: LoadReport; jsonPath: string; markdownPath: string }> {
  const credentials = readCredentials(config.credentialsPath);
  const dataset = readJson<DatasetSidecar>(config.datasetPath, "Veri seti yan dosyası");
  if (dataset.kind !== "dolmus-takip-load-dataset") throw new LoadRunUsageError("Veri seti yan dosyası load:seed çıktısı değil.");
  const manifest = readManifest(config.releaseManifestPath);
  fs.mkdirSync(config.outDir, { recursive: true });

  const runId = `${new Date().toISOString().replace(/[-:]/gu, "").slice(0, 15)}-${crypto.randomBytes(3).toString("hex")}`;
  const random = createRandom(config.randomSeed);
  const writes = config.scenario !== "login-burst";
  const { users, vehicles } = buildUsers(config.scenario, credentials, config.users);
  const recorded: Recorded[] = [];
  const runnerErrors: string[] = [];
  const probeFindings: string[] = [];
  let probeCount = 0;
  let probeMismatches = 0;
  const loginAttempts: { at: number; ok: boolean }[] = [];
  const writeStats = {
    ops: 0, applied: 0, rejected: 0, firstAttemptUnknown: 0, resolvedByRetry: 0, unresolved: 0, retries: 0,
    doubleSubmits: 0, concurrentCorrections: 0, fallbacks: 0,
  };
  const writeOpPhases = { unresolvedInSustain: 0 };
  let requestSeq = 0;

  const clientFor = (phase: SamplePhase): ClientOptions => ({
    baseUrl: config.targetUrl,
    origin: config.origin,
    timeoutMs: config.timeoutMs,
    onSample: (sample) => recorded.push({ phase, sample }),
  });
  const retryPolicy = { maxRetries: config.maxRetries, backoffMs: config.retryBackoffMs };
  const note = (message: string) => {
    if (probeFindings.length < MAX_REPORTED_FINDINGS) probeFindings.push(message);
  };

  // --- Oturum -----------------------------------------------------------------

  async function login(user: User, phase: SamplePhase): Promise<boolean> {
    const client = clientFor(phase);
    const at = Date.now();
    const res = await sendRequest(client, user.session, {
      method: "POST", path: user.loginPath, route: `POST ${user.loginPath}`, cls: "login", kind: "login", bodyText: user.loginBody,
    });
    loginAttempts.push({ at, ok: res.status === 201 });
    if (res.status !== 201) {
      user.loggedIn = false;
      return false;
    }
    const session = await sendRequest(client, user.session, {
      method: "GET", path: "/api/v1/session", route: "GET /api/v1/session", cls: "okuma", kind: "read",
    });
    const token = (session.body as { csrfToken?: unknown } | null)?.csrfToken;
    user.loggedIn = session.status === 200 && typeof token === "string";
    user.session.csrfToken = user.loggedIn ? (token as string) : null;
    return user.loggedIn;
  }

  async function ensureSession(user: User, phase: SamplePhase): Promise<boolean> {
    return user.loggedIn || (await login(user, phase));
  }

  /** 401 dönen oturum bir sonraki işlemde yeniden giriş yapar (kullanıcının yapacağı gibi). */
  function noteAuth(user: User, res: RequestResult): void {
    if (res.status === 401) user.loggedIn = false;
  }

  // --- Okumalar ---------------------------------------------------------------

  let windowMonth: string | null = null;
  const historyStart = Date.parse(`${dataset.history.startDate}T00:00:00Z`);
  const historyEnd = Date.parse(`${dataset.history.endDate}T00:00:00Z`);
  const historicDate = () => {
    // Son yıla ağırlıklı: kullanıcılar çoğunlukla yakın dönemi okur.
    const span = historyEnd - historyStart;
    const offset = random() < 0.7 ? span - random() * Math.min(span, 365 * 86_400_000) : random() * span;
    return new Date(historyStart + Math.floor(offset / 86_400_000) * 86_400_000).toISOString().slice(0, 10);
  };

  async function readReport(user: User, phase: SamplePhase): Promise<void> {
    const v = user.vehicle!;
    const period = (["week", "month", "year"] as const)[Math.floor(random() * 3)]!;
    const date = random() < 0.2 && windowMonth ? `${windowMonth}-01` : historicDate();
    const choice = random();
    const personId = v.driverPersonIds[Math.floor(random() * v.driverPersonIds.length)]!;
    const [route, pathname] =
      choice < 0.35
        ? ["GET /api/v1/reports/summary", "/api/v1/reports/summary"]
        : choice < 0.55
          ? ["GET /api/v1/reports/vehicles", "/api/v1/reports/vehicles"]
          : choice < 0.8
            ? ["GET /api/v1/reports/people", "/api/v1/reports/people"]
            : ["GET /api/v1/reports/people/:personId", `/api/v1/reports/people/${encodeURIComponent(personId)}`];
    const query = `period=${period}&date=${date}${route.endsWith(":personId") ? "&limit=50" : ""}`;
    const res = await sendRequest(clientFor(phase), user.session, { method: "GET", path: `${pathname}?${query}`, route, cls: "rapor", kind: "read" });
    noteAuth(user, res);
  }

  async function listEntries(user: User, phase: SamplePhase): Promise<void> {
    const v = user.vehicle!;
    const date = random() < 0.5 && windowMonth ? `${windowMonth}-01` : historicDate();
    const worker = user.role === "driver" ? `&workerPersonId=${encodeURIComponent(v.driverPersonIds[Math.floor(random() * v.driverPersonIds.length)]!)}` : "";
    const res = await sendRequest(clientFor(phase), user.session, {
      method: "GET", path: `/api/v1/work-entries?period=month&date=${date}&limit=50${worker}`, route: "GET /api/v1/work-entries", cls: "okuma", kind: "read",
    });
    noteAuth(user, res);
  }

  // --- Yazmalar ---------------------------------------------------------------

  function newRequestId(): string {
    return `lr-${runId}-${String(requestSeq++).padStart(7, "0")}`;
  }

  function randomEntryBody(workType: "owner" | "driver", personId: string | undefined, fingerprint: string): EntryBody {
    const day = 1 + Math.floor(random() * daysInMonth(windowMonth!));
    const startMinutes = 6 * 60 + Math.floor(random() * 9) * 15;
    const endMinutes = startMinutes + 8 * 60 + Math.floor(random() * 13) * 15;
    const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    const grossLira = 6000 + Math.floor(random() * 100) * 100;
    return {
      workType,
      ...(personId ? { workerPersonId: personId } : {}),
      date: `${windowMonth}-${pad(day)}`,
      startTime: hhmm(startMinutes),
      endTime: hhmm(endMinutes),
      endsNextDay: false,
      grossCents: String(grossLira * 100),
      fuelCents: String(Math.round(grossLira * 0.22) * 100),
      otherExpenseCents: "0",
      otherExpenseNote: fingerprint,
    };
  }

  /** Aynı gövdeyi (aynı requestId) bir veya iki kez eşzamanlı gönderir. */
  async function submit(user: User, phase: SamplePhase, route: string, pathname: string, bodyText: string, twice: boolean): Promise<WriteResult[]> {
    const client = clientFor(phase);
    const send = () => sendWriteWithRetry(client, user.session, { path: pathname, route, cls: "kayit", bodyText }, retryPolicy);
    const results = await Promise.all(twice ? [send(), send()] : [send()]);
    if (twice) writeStats.doubleSubmits++;
    return results;
  }

  function account(results: WriteResult[], phase: SamplePhase): "applied" | "rejected" | "unresolved" {
    for (const r of results) {
      writeStats.retries += r.attempts - 1;
      if (r.firstUnknown) {
        writeStats.firstAttemptUnknown++;
        if (r.resolution !== "unresolved") writeStats.resolvedByRetry++;
      }
    }
    writeStats.ops++;
    const resolution = results.some((r) => r.resolution === "applied")
      ? "applied"
      : results.some((r) => r.resolution === "unresolved")
        ? "unresolved"
        : "rejected";
    if (resolution === "applied") writeStats.applied++;
    else if (resolution === "rejected") writeStats.rejected++;
    else {
      writeStats.unresolved++;
      if (phase === "sustain") writeOpPhases.unresolvedInSustain++;
    }
    return resolution;
  }

  async function probe(record: EntryRecord, vehicle: VehicleState, phase: SamplePhase): Promise<void> {
    if (random() >= config.probeFraction || !record.expected.entryId || !record.expected.acknowledged || !vehicle.owner) return;
    probeCount++;
    const res = await sendRequest(clientFor(phase), vehicle.owner.session, {
      method: "GET",
      path: `/api/v1/work-entries/${encodeURIComponent(record.expected.entryId)}`,
      route: "GET /api/v1/work-entries/:id",
      cls: "probe",
      kind: "read",
    });
    const view = (res.body as { workEntry?: WorkEntryApiView } | null)?.workEntry;
    if (res.status !== 200 || !view) {
      probeMismatches++;
      note(`okuma sondası ${record.expected.entryId}: HTTP ${res.status ?? res.classification.code}`);
      return;
    }
    const observed = toObserved(view, vehicle.vehicleId);
    const internal = internalInconsistency(observed);
    if (internal !== null || !statesEqual(record.expected.acknowledged, observed.state)) {
      probeMismatches++;
      note(`okuma sondası ${record.expected.entryId}: ${internal ?? "kabul edilen durumla aynı değil"}`);
    }
  }

  async function createEntry(user: User, workType: "owner" | "driver", phase: SamplePhase): Promise<void> {
    const v = user.vehicle!;
    const requestId = newRequestId();
    const fingerprint = `load:${requestId}`;
    const personId = workType === "driver" ? v.driverPersonIds[Math.floor(random() * v.driverPersonIds.length)]! : v.ownerPersonId;
    const body = randomEntryBody(workType, workType === "driver" ? personId : undefined, fingerprint);
    const bodyText = JSON.stringify({ requestId, ...body });
    const twice = config.scenario === "write-peak" && random() < config.doubleSubmitFraction;
    const results = await submit(user, phase, "POST /api/v1/work-entries", "/api/v1/work-entries", bodyText, twice);
    results.forEach((r) => noteAuth(user, r.final));
    const resolution = account(results, phase);
    const createState = stateFromBody(body, personId, 1, workType === "driver" ? "pending" : "not_required", null);
    if (resolution === "rejected") return; // pencerede bu parmak izi olmamalı: olursa çift sayılır
    const record: EntryRecord = {
      expected: { fingerprint, vehicleId: v.vehicleId, workKind: workType, entryId: null, acknowledged: null, unresolved: [] },
      body,
      busy: true,
      blocked: false,
      corrections: 0,
    };
    v.entries.push(record);
    if (resolution === "unresolved") {
      record.expected.unresolved.push(createState);
      record.blocked = true;
      record.busy = false;
      return;
    }
    const ids = new Set(
      results
        .filter((r) => r.resolution === "applied")
        .map((r) => (r.final.body as { workEntry?: { id?: string } } | null)?.workEntry?.id),
    );
    const [entryId] = [...ids];
    if (ids.size !== 1 || typeof entryId !== "string") {
      probeMismatches++;
      note(`aynı requestId ile çift gönderim farklı kayıtlar döndürdü: ${[...ids].join(", ")}`);
      record.blocked = true;
    }
    record.expected.entryId = typeof entryId === "string" ? entryId : null;
    record.expected.acknowledged = createState;
    await probe(record, v, phase);
    record.busy = false;
  }

  function pickEntry(v: VehicleState, status: EntryState["status"]): EntryRecord | undefined {
    const candidates = v.entries.filter(
      (e) => !e.busy && !e.blocked && e.expected.acknowledged?.status === status && e.expected.entryId && e.corrections < 2,
    );
    return candidates.length > 0 ? candidates[Math.floor(random() * candidates.length)] : undefined;
  }

  /** Tek bir onay veya düzelt-ve-onayla; `rival` verilirse aynı sürümden eşzamanlı ikinci düzeltme. */
  async function mutateEntry(user: User, record: EntryRecord, kind: "confirm" | "correct", phase: SamplePhase, rival: boolean): Promise<void> {
    const v = user.vehicle!;
    const acked = record.expected.acknowledged!;
    const entryId = record.expected.entryId!;
    record.busy = true;
    const variant = (step: number) => {
      const body: EntryBody = kind === "correct" ? { ...record.body, grossCents: String(Number(record.body.grossCents) + step * 10_000) } : record.body;
      const receivedCents = remainderOf(body);
      const requestId = newRequestId();
      const payload =
        kind === "confirm"
          ? { requestId, version: acked.version, receivedCents }
          : { requestId, version: acked.version, ...body, receivedCents };
      return { body, bodyText: JSON.stringify(payload), state: stateFromBody(body, acked.personId, acked.version + 1, "confirmed", receivedCents) };
    };
    const route = kind === "confirm" ? "POST /api/v1/work-entries/:id/confirm" : "POST /api/v1/work-entries/:id/correct-and-confirm";
    const pathname = `/api/v1/work-entries/${encodeURIComponent(entryId)}/${kind === "confirm" ? "confirm" : "correct-and-confirm"}`;

    const attempts = rival ? [variant(1), variant(2)] : [variant(1)];
    const twice = !rival && config.scenario === "write-peak" && random() < config.doubleSubmitFraction;
    if (rival) writeStats.concurrentCorrections++;
    const settled = await Promise.all(
      attempts.map(async (a) => ({ a, results: await submit(user, phase, route, pathname, a.bodyText, twice) })),
    );

    let applied: (typeof attempts)[number] | null = null;
    let appliedCount = 0;
    for (const { a, results } of settled) {
      results.forEach((r) => noteAuth(user, r.final));
      const resolution = account(results, phase);
      if (resolution === "applied") {
        appliedCount++;
        applied = a;
      } else if (resolution === "unresolved") {
        record.expected.unresolved.push(a.state);
        record.blocked = true;
      } else {
        const expectedConflict = rival && results.every((r) => r.final.classification.outcome === "expected_409");
        if (!expectedConflict) record.blocked = true;
      }
    }
    if (appliedCount > 1) {
      probeMismatches++;
      note(`${entryId}: aynı sürümden iki eşzamanlı düzeltme de kabul edildi`);
      record.blocked = true;
    }
    if (applied) {
      record.expected.acknowledged = applied.state;
      record.body = applied.body;
      if (kind === "correct") record.corrections++;
      if (!record.blocked) await probe(record, v, phase);
    }
    record.busy = false;
  }

  /** Sahip yazması: onay (veya düzeltme); uygun kayıt yoksa diğeri, o da yoksa sahip kaydı oluşturur. */
  async function ownerWrite(user: User, phase: SamplePhase, preferCorrect: boolean): Promise<void> {
    const v = user.vehicle!;
    const rival = config.scenario === "write-peak" && random() < config.conflictFraction;
    const correct = preferCorrect || rival;
    const first = pickEntry(v, correct ? "confirmed" : "pending");
    if (first) return mutateEntry(user, first, correct ? "correct" : "confirm", phase, rival);
    writeStats.fallbacks++;
    const other = pickEntry(v, correct ? "pending" : "confirmed");
    if (other) return mutateEntry(user, other, correct ? "confirm" : "correct", phase, false);
    return createEntry(user, "owner", phase);
  }

  // --- Senaryo işlemleri --------------------------------------------------------

  async function runOp(user: User, phase: SamplePhase): Promise<void> {
    if (config.scenario === "login-burst") {
      await login(user, phase);
      return;
    }
    if (!(await ensureSession(user, phase))) return;
    const r = random();
    if (config.scenario === "write-peak") {
      if (user.role === "driver") return createEntry(user, "driver", phase);
      return ownerWrite(user, phase, false);
    }
    if (user.role === "driver") return r < 0.5 ? createEntry(user, "driver", phase) : listEntries(user, phase);
    if (r < 0.45) return readReport(user, phase);
    if (r < 0.75) return ownerWrite(user, phase, false);
    if (r < 0.85) return ownerWrite(user, phase, true);
    return listEntries(user, phase);
  }

  // --- Hazırlık ---------------------------------------------------------------

  const setupStartedAt = new Date().toISOString();
  await assertTargetReachable(clientFor("setup"));

  if (writes) {
    for (let i = 0; i < users.length; i += LOGIN_CONCURRENCY) {
      await Promise.all(users.slice(i, i + LOGIN_CONCURRENCY).map((u) => login(u, "setup")));
    }
    const failed = users.filter((u) => !u.loggedIn).length;
    if (failed > 0) throw new Error(`${failed} kullanıcı hazırlıkta giriş yapamadı; yük başlatılmadı.`);
    windowMonth = await chooseWindow();
  }

  async function chooseWindow(): Promise<string> {
    const first = config.windowMonth ?? dataset.loadWindow.firstMonth;
    const limit = config.windowMonth ? 1 : MAX_WINDOW_PROBE_MONTHS;
    for (let i = 0; i < limit; i++) {
      const month = addMonths(first, i);
      let empty = true;
      for (const v of vehicles) {
        const res = await sendRequest(clientFor("setup"), v.owner!.session, {
          method: "GET", path: `/api/v1/work-entries?period=month&date=${month}-01&limit=1`, route: "GET /api/v1/work-entries", cls: "probe", kind: "read",
        });
        const list = (res.body as { workEntries?: unknown[] } | null)?.workEntries;
        if (res.status !== 200 || !Array.isArray(list)) throw new Error(`Pencere denetimi başarısız: HTTP ${res.status ?? res.classification.code}`);
        if (list.length > 0) {
          empty = false;
          break;
        }
      }
      if (empty) return month;
    }
    throw new Error(`Boş yazma penceresi bulunamadı (${first}'ten ${limit} ay); yeni bir load:seed gerekir.`);
  }

  // --- Yük --------------------------------------------------------------------

  const durations = { warmupSeconds: config.warmupSeconds, rampSeconds: config.rampSeconds, sustainSeconds: config.sustainSeconds };
  const shape: ArrivalShape =
    config.scenario === "active-mix"
      ? { kind: "rate", sustainPerSecond: config.users / config.thinkSeconds, warmupFraction: config.warmupFraction }
      : {
          kind: "waves",
          waveSize: config.users,
          waveIntervalSeconds: config.waveIntervalSeconds,
          waveSpreadSeconds: config.waveSpreadSeconds,
          warmupFraction: config.warmupFraction,
        };
  const schedule = buildSchedule(durations, shape);
  const dropped: Record<string, number> = {};
  const dispatchLag: number[] = [];
  const waveTimes = new Map<number, { phase: LoadPhase; size: number; first: number; last: number }>();
  const inFlight = new Set<Promise<void>>();

  const reachabilityLatencies: number[] = [];
  let reachabilityFailures = 0;
  let monitoring = true;
  const monitor = (async () => {
    while (monitoring) {
      const res = await probeReachability(clientFor("monitor"));
      reachabilityLatencies.push(res.latencyMs);
      if (res.status !== 200) reachabilityFailures++;
      const until = performance.now() + config.probeIntervalSeconds * 1000;
      while (monitoring && performance.now() < until) await sleep(Math.min(250, until - performance.now()));
    }
  })();

  const loadStart = performance.now();
  const loadStartedAt = new Date().toISOString();
  console.log(`[load:run] ${config.scenario}: ${schedule.length} işlem planlandı, pencere ${windowMonth ?? "—"}.`);
  let userCursor = 0;
  for (const op of schedule) {
    const due = loadStart + op.atMs;
    const wait = due - performance.now();
    if (wait > 1) await sleep(wait);
    if (inFlight.size >= config.maxInFlight) {
      dropped[op.phase] = (dropped[op.phase] ?? 0) + 1;
      continue;
    }
    const user = op.wave !== null ? users[op.slot % users.length]! : users[userCursor++ % users.length]!;
    const started = performance.now();
    if (op.phase === "sustain") dispatchLag.push(started - due);
    const task = runOp(user, op.phase)
      .catch((error: unknown) => {
        runnerErrors.push(`${op.phase} işlem: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        inFlight.delete(task);
        if (op.wave !== null) trackWave(op, started, performance.now());
      });
    inFlight.add(task);
  }
  const loadEndedAt = new Date().toISOString();
  await Promise.all([...inFlight]);
  monitoring = false;
  await monitor;

  function trackWave(op: ScheduledOp, started: number, finished: number): void {
    const wave = waveTimes.get(op.wave!) ?? { phase: op.phase, size: 0, first: started, last: finished };
    wave.size++;
    wave.first = Math.min(wave.first, started);
    wave.last = Math.max(wave.last, finished);
    waveTimes.set(op.wave!, wave);
  }

  // --- Mutabakat ----------------------------------------------------------------

  let reconciliation: LoadReport["reconciliation"];
  let verdictReconciliation: ReconciliationResult | "failed" | null = null;
  if (!writes) {
    reconciliation = { status: "not_applicable", detail: "bu senaryo mali kayıt yazmaz" };
  } else {
    try {
      const observed: ObservedEntry[] = [];
      for (const v of vehicles) {
        const owner = v.owner!;
        if (!(await ensureSession(owner, "reconcile"))) throw new Error(`${v.vehicleId} sahibi giriş yapamadı`);
        let cursor: string | null = null;
        do {
          const query: string = `period=month&date=${windowMonth}-01&limit=${RECONCILE_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
          const res = await sendRequest(clientFor("reconcile"), owner.session, {
            method: "GET", path: `/api/v1/work-entries?${query}`, route: "GET /api/v1/work-entries", cls: "probe", kind: "read",
          });
          const page = res.body as { workEntries?: WorkEntryApiView[]; nextCursor?: string | null } | null;
          if (res.status !== 200 || !page || !Array.isArray(page.workEntries)) {
            throw new Error(`${v.vehicleId} penceresi okunamadı: HTTP ${res.status ?? res.classification.code}`);
          }
          observed.push(...page.workEntries.map((view) => toObserved(view, v.vehicleId)));
          cursor = page.nextCursor ?? null;
        } while (cursor);
      }
      const result = reconcileLedger(
        vehicles.flatMap((v) => v.entries.map((e) => e.expected)),
        observed,
      );
      verdictReconciliation = result;
      reconciliation = { ...result, findings: result.findings.slice(0, MAX_REPORTED_FINDINGS) };
    } catch (error) {
      verdictReconciliation = "failed";
      reconciliation = { status: "failed", detail: error instanceof Error ? error.message : String(error) };
    }
  }

  // --- Rapor ------------------------------------------------------------------

  const finishedAt = new Date().toISOString();
  const byPhase = (phase: LoadPhase) =>
    Object.fromEntries(
      REQUEST_CLASSES.map((cls) => [
        cls,
        summarizeLatencies(recorded.filter((r) => r.phase === phase && r.sample.cls === cls).map((r) => r.sample.latencyMs)),
      ]),
    ) as Record<RequestClass, LatencySummary>;
  const latency = { warmup: byPhase("warmup"), ramp: byPhase("ramp"), sustain: byPhase("sustain") };

  const sustainOutcomes = emptyOutcomes();
  const allOutcomes = emptyOutcomes();
  for (const r of recorded) {
    if (r.sample.cls === "probe") continue;
    tally(allOutcomes, r.sample);
    if (r.phase === "sustain") tally(sustainOutcomes, r.sample);
  }
  const count = (record: Record<string, number>) => Object.values(record).reduce((a, b) => a + b, 0);

  const verdict = evaluateVerdict({
    classes: latency.sustain,
    requiredClasses: config.scenario === "active-mix" ? ["kayit", "rapor"] : config.scenario === "write-peak" ? ["kayit"] : [],
    totalRequests: sustainOutcomes.requests,
    unexpected: count(sustainOutcomes.unexpected),
    unresolvedUnknown: writeOpPhases.unresolvedInSustain,
    rateLimited: count(sustainOutcomes.rateLimited429),
    reconciliation: verdictReconciliation,
    probeMismatches,
    runnerErrors: runnerErrors.length,
  });

  const schemaMatchesRelease = sameMigrations(dataset.schema?.migration_sha256_list, manifest.schema?.migration_sha256_list);
  const acceptance = acceptanceEligibility({
    sustainSeconds: config.sustainSeconds,
    targetUrl: config.targetUrl,
    users: config.users,
    datasetMatchesRelease: schemaMatchesRelease,
  });

  const intendedSustainOps = schedule.filter((op) => op.phase === "sustain").length;
  const dispatchedSustainOps = intendedSustainOps - (dropped.sustain ?? 0);
  const lastLogin = loginAttempts.length > 0 ? Math.max(...loginAttempts.map((a) => a.at)) : null;
  const waves: WaveSummary[] = [...waveTimes.entries()]
    .sort(([a], [b]) => a - b)
    .map(([wave, w]) => ({ wave, phase: w.phase, size: w.size, drainMs: w.last - w.first }));

  const report: LoadReport = {
    kind: "dolmus-takip-load-report",
    formatVersion: 1,
    runId,
    scenario: config.scenario,
    generatedAt: finishedAt,
    target: { url: config.targetUrl, origin: config.origin, loopback: isLoopbackHost(new URL(config.targetUrl).hostname) },
    release: {
      manifestFile: path.basename(config.releaseManifestPath),
      sourceCommit: manifest.source_commit,
      artifactSha256: manifest.artifact_sha256,
      nodeVersion: manifest.node_version ?? null,
      sqliteVersion: manifest.sqlite_version ?? null,
      builtAt: manifest.built_at ?? null,
    },
    dataset: {
      sourceCommit: dataset.sourceCommit,
      sha256: dataset.database.sha256,
      history: dataset.history,
      counts: dataset.counts,
      schemaMatchesRelease,
      commitMatchesRelease: dataset.sourceCommit === manifest.source_commit,
    },
    config: {
      users: config.users,
      warmupSeconds: config.warmupSeconds,
      rampSeconds: config.rampSeconds,
      sustainSeconds: config.sustainSeconds,
      arrival:
        shape.kind === "rate"
          ? `açık model, ${shape.sustainPerSecond.toFixed(2)} işlem/sn (düşünme ${config.thinkSeconds} sn)`
          : `dalga: ${shape.waveSize} işlem / ${shape.waveIntervalSeconds} sn, ${shape.waveSpreadSeconds} sn içine yayılır`,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      retryBackoffMs: config.retryBackoffMs,
      maxInFlight: config.maxInFlight,
      randomSeed: config.randomSeed,
      windowMonth,
    },
    timeline: {
      setupStartedAt,
      loadStartedAt,
      sustainStartedAt: new Date(Date.parse(loadStartedAt) + (config.warmupSeconds + config.rampSeconds) * 1000).toISOString(),
      loadEndedAt,
      finishedAt,
    },
    rate: {
      intendedSustainOps,
      dispatchedSustainOps,
      droppedOps: dropped,
      intendedPerSecond: intendedSustainOps / config.sustainSeconds,
      achievedPerSecond: dispatchedSustainOps / config.sustainSeconds,
      dispatchLag: summarizeLatencies(dispatchLag),
    },
    latency,
    outcomes: { sustain: sustainOutcomes, all: allOutcomes },
    writes: writeStats,
    waves,
    probes: {
      readAfterWrite: probeCount,
      mismatches: probeMismatches,
      reachability: { requests: reachabilityLatencies.length, failures: reachabilityFailures, latency: summarizeLatencies(reachabilityLatencies) },
      findings: probeFindings,
    },
    reconciliation,
    loginWindow: {
      attempts: loginAttempts.length,
      failedAttempts: loginAttempts.filter((a) => !a.ok).length,
      firstAttemptAt: loginAttempts.length > 0 ? new Date(Math.min(...loginAttempts.map((a) => a.at))).toISOString() : null,
      lastAttemptAt: lastLogin === null ? null : new Date(lastLogin).toISOString(),
      ipFailedAttemptLimit: IP_FAILED_LOGIN_LIMIT,
      windowMinutes: LOGIN_WINDOW_MINUTES,
      nextLoginHeavyScenarioNotBefore: lastLogin === null ? null : new Date(lastLogin + LOGIN_WINDOW_MINUTES * 60_000).toISOString(),
    },
    targets: { ...LOAD_TARGETS },
    verdict,
    acceptance_eligible: acceptance.eligible,
    acceptance_reasons: acceptance.reasons,
    runnerErrors: runnerErrors.slice(0, MAX_REPORTED_FINDINGS),
  };

  const base = path.join(config.outDir, `load-${config.scenario}-${runId}`);
  const jsonPath = `${base}.json`;
  const markdownPath = `${base}.md`;
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  fs.writeFileSync(markdownPath, renderLoadReportMarkdown(report), { flag: "wx" });
  return { report, jsonPath, markdownPath };
}

async function main(): Promise<number> {
  const config = parseLoadRunArgs(process.argv.slice(2));
  const { report, jsonPath, markdownPath } = await runLoad(config);
  for (const check of report.verdict.checks) {
    console.log(`[load:run] ${check.id}: ${check.status} (${check.actual}; hedef ${check.target})`);
  }
  console.log(`[load:run] Sonuç: ${report.verdict.pass ? "GEÇTİ" : "KALDI"}; kabul kanıtı: ${report.acceptance_eligible ? "uygun" : `uygun değil (${report.acceptance_reasons.join("; ")})`}`);
  console.log(`[load:run] Rapor: ${jsonPath}`);
  console.log(`[load:run] Rapor: ${markdownPath}`);
  return report.verdict.pass ? 0 : 2;
}

const isDirectRun = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(`[load:run] Başarısız: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
