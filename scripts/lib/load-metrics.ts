/**
 * Yük kabul aracının SAF yardımcıları — `scripts/load-run.ts` (S6.6, T6.6).
 *
 * Ağ, dosya ve saat erişimi yoktur; hepsi birim testlidir
 * (`tests/unit/load-metrics.test.ts`):
 * - `percentile` / `summarizeLatencies`: en yakın sıra (nearest-rank) yüzdelik.
 * - `classifyResponse`: bir HTTP denemesini başarı / beklenen 409 / 429 /
 *   bilinmeyen sonuç / beklenmeyen olarak ayırır.
 * - `buildSchedule`: ısınma → kademeli artış → sürdürülen yük için AÇIK model
 *   (gönderim zamanı yanıt beklemez) planlı gönderim anları.
 * - `reconcileLedger`: yazma defteri ile API'den okunan kayıtların mutabakatı
 *   (kayıp, çift, tutarsız).
 * - `evaluateVerdict` / `acceptanceEligibility`: hedeflere karşı geçti/kaldı ve
 *   kabul kanıtı sayılabilirlik.
 */
import { calculateWorkEntryAmounts, type WorkKind } from "../../src/lib/work-calculation.ts";

// ---------------------------------------------------------------------------
// Hedefler ve sınırlar
// ---------------------------------------------------------------------------

/** QA-PLAN §3 / ARCHITECTURE §9 — normal karışık yük başlangıç hedefleri. */
export const LOAD_TARGETS = {
  kayitP95Ms: 2000,
  raporP95Ms: 3000,
  /** Beklenmeyen hata oranı bu değerin ALTINDA olmalı (< %1). */
  unexpectedRateLimit: 0.01,
} as const;

/** Kabul kanıtı için en az sürdürülen yük (ARCHITECTURE §9: en az 30 dk). */
export const MIN_ACCEPTANCE_SUSTAIN_SECONDS = 30 * 60;

/** Her senaryo 100 kullanıcı/istek ile ölçülür (S6.6 AC3). */
export const ACCEPTANCE_USERS = 100;

/**
 * İstemci zaman aşımı bu değerden BÜYÜK olmalı: hash kuyruğu en fazla 10 sn
 * bekletir (`HASH_QUEUE_MAX_WAIT_MS`) + SQLite `busy_timeout` 2 sn. Daha kısa
 * bir zaman aşımı sunucuda sürmekte olan bir bekleyişi kayıp gibi gösterir.
 */
export const SERVER_MAX_WAIT_MS = 10_000 + 2_000;

// ---------------------------------------------------------------------------
// Yüzdelik
// ---------------------------------------------------------------------------

/** En yakın sıra yöntemi: `sorted` artan sıralı olmalı; boş dizide `null`. */
export function percentile(sorted: readonly number[], q: number): number | null {
  if (!(q > 0 && q <= 1)) throw new RangeError(`yüzdelik 0 < q ≤ 1 olmalı: ${q}`);
  if (sorted.length === 0) return null;
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export interface LatencySummary {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
}

export function summarizeLatencies(samples: readonly number[]): LatencySummary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted.length > 0 ? sorted[sorted.length - 1]! : null,
  };
}

// ---------------------------------------------------------------------------
// Yanıt sınıflandırma
// ---------------------------------------------------------------------------

export type RequestClass = "login" | "kayit" | "rapor" | "okuma" | "probe";
export const REQUEST_CLASSES: readonly RequestClass[] = ["login", "kayit", "rapor", "okuma", "probe"];

/** `write`: mali yazma (yeniden denemeyle çözülür); `login` ve `read` çözülmez. */
export type RequestKind = "read" | "write" | "login";

export type Outcome = "success" | "expected_409" | "rate_limited_429" | "unknown_result" | "unexpected";

/** Eşzamanlı düzeltme/onayda meşru olarak dönen 409 kodları. REQUEST_ID_REUSED burada YOKTUR. */
export const EXPECTED_409_CODES: readonly string[] = ["VERSION_CONFLICT", "ENTRY_CONFIRMED", "ENTRY_NOT_CONFIRMED"];

export interface AttemptResult {
  kind: RequestKind;
  status: number | null;
  code: string | null;
  failure: "timeout" | "network" | null;
}

export interface Classification {
  outcome: Outcome;
  /** Sayımda kullanılan kod: API hata kodu, `HTTP_<status>`, `TIMEOUT` veya `NETWORK_ERROR`. */
  code: string;
}

export function classifyResponse(attempt: AttemptResult): Classification {
  if (attempt.failure !== null || attempt.status === null) {
    const code = attempt.failure === "timeout" ? "TIMEOUT" : "NETWORK_ERROR";
    return { outcome: attempt.kind === "write" ? "unknown_result" : "unexpected", code };
  }
  const { status } = attempt;
  const code = attempt.code ?? `HTTP_${status}`;
  if (status >= 200 && status < 300) return { outcome: "success", code };
  if (status === 409 && EXPECTED_409_CODES.includes(code)) return { outcome: "expected_409", code };
  if (status === 429) return { outcome: "rate_limited_429", code };
  if (status >= 500 && attempt.kind === "write") return { outcome: "unknown_result", code };
  return { outcome: "unexpected", code };
}

// ---------------------------------------------------------------------------
// Gönderim planı
// ---------------------------------------------------------------------------

export type LoadPhase = "warmup" | "ramp" | "sustain";

export interface PhaseDurations {
  warmupSeconds: number;
  rampSeconds: number;
  sustainSeconds: number;
}

/**
 * `rate`: saniyede `sustainPerSecond` istek; ısınmada bunun `warmupFraction`
 * katı, kademeli artışta ikisi arasında doğrusal.
 * `waves`: her `waveIntervalSeconds`'te `waveSize` istek, `waveSpreadSeconds`
 * içine eşit yayılır; ısınmada dalga `warmupFraction` oranında küçüktür,
 * kademeli artışta doğrusal büyür.
 */
export type ArrivalShape =
  | { kind: "rate"; sustainPerSecond: number; warmupFraction: number }
  | { kind: "waves"; waveSize: number; waveIntervalSeconds: number; waveSpreadSeconds: number; warmupFraction: number };

export interface ScheduledOp {
  /** Koşu başlangıcından itibaren planlı gönderim anı (ms). */
  atMs: number;
  phase: LoadPhase;
  /** Dalga modelinde dalga sırası; oran modelinde `null`. */
  wave: number | null;
  /** Kullanıcı ataması için sıra: dalgada dalga içi sıra, oran modelinde genel sıra. */
  slot: number;
}

function assertDurations(d: PhaseDurations): void {
  for (const [name, value] of Object.entries(d)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} ≥ 0 olmalı: ${value}`);
  }
  if (d.sustainSeconds <= 0) throw new RangeError("sustainSeconds > 0 olmalı");
}

export function phaseAt(tMs: number, d: PhaseDurations): LoadPhase {
  if (tMs < d.warmupSeconds * 1000) return "warmup";
  if (tMs < (d.warmupSeconds + d.rampSeconds) * 1000) return "ramp";
  return "sustain";
}

/** Oran modelinde birikimli istek sayısı N(t)'nin tersi: N(t) = n olan t (sn). */
function timeForCount(n: number, r0: number, r1: number, d: PhaseDurations): number {
  const W = d.warmupSeconds;
  const R = d.rampSeconds;
  const warmupCount = r0 * W;
  if (n <= warmupCount && r0 > 0) return n / r0;
  const afterWarmup = n - warmupCount;
  const rampCount = ((r0 + r1) / 2) * R;
  if (afterWarmup <= rampCount && R > 0) {
    // r0·τ + (r1 − r0)·τ² / (2R) = afterWarmup
    const a = (r1 - r0) / (2 * R);
    const tau = a === 0 ? afterWarmup / r0 : (-r0 + Math.sqrt(r0 * r0 + 4 * a * afterWarmup)) / (2 * a);
    return W + tau;
  }
  return W + R + (afterWarmup - rampCount) / r1;
}

export function buildSchedule(durations: PhaseDurations, shape: ArrivalShape): ScheduledOp[] {
  assertDurations(durations);
  if (!(shape.warmupFraction >= 0 && shape.warmupFraction <= 1)) {
    throw new RangeError(`warmupFraction 0..1 olmalı: ${shape.warmupFraction}`);
  }
  const totalMs = (durations.warmupSeconds + durations.rampSeconds + durations.sustainSeconds) * 1000;
  const ops: ScheduledOp[] = [];

  if (shape.kind === "rate") {
    const r1 = shape.sustainPerSecond;
    if (!(r1 > 0) || !Number.isFinite(r1)) throw new RangeError(`sustainPerSecond > 0 olmalı: ${r1}`);
    const r0 = r1 * shape.warmupFraction;
    // k'inci istek N(t) = k − 0.5 anında: sıfır oranlı bir aralığa istek düşmez.
    for (let k = 1; ; k++) {
      const atMs = timeForCount(k - 0.5, r0, r1, durations) * 1000;
      if (atMs >= totalMs) break;
      ops.push({ atMs, phase: phaseAt(atMs, durations), wave: null, slot: k - 1 });
    }
    return ops;
  }

  const { waveSize, waveIntervalSeconds, waveSpreadSeconds } = shape;
  if (!Number.isInteger(waveSize) || waveSize < 1) throw new RangeError(`waveSize ≥ 1 tam sayı olmalı: ${waveSize}`);
  if (!(waveIntervalSeconds > 0)) throw new RangeError(`waveIntervalSeconds > 0 olmalı: ${waveIntervalSeconds}`);
  if (!(waveSpreadSeconds >= 0 && waveSpreadSeconds < waveIntervalSeconds)) {
    throw new RangeError("waveSpreadSeconds 0 ≤ yayılım < dalga aralığı olmalı");
  }
  const warmupSize = Math.ceil(waveSize * shape.warmupFraction);
  const rampStartMs = durations.warmupSeconds * 1000;
  const rampMs = durations.rampSeconds * 1000;
  for (let wave = 0; ; wave++) {
    const startMs = wave * waveIntervalSeconds * 1000;
    if (startMs >= totalMs) break;
    const phase = phaseAt(startMs, durations);
    const size =
      phase === "warmup"
        ? warmupSize
        : phase === "ramp"
          ? Math.max(warmupSize, Math.round(warmupSize + (waveSize - warmupSize) * ((startMs - rampStartMs) / rampMs)))
          : waveSize;
    for (let i = 0; i < size; i++) {
      const atMs = startMs + (size > 1 ? (i * waveSpreadSeconds * 1000) / size : 0);
      if (atMs >= totalMs) break;
      ops.push({ atMs, phase, wave, slot: i });
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Defter mutabakatı
// ---------------------------------------------------------------------------

/** Bir kaydın karşılaştırılan durumu; kuruşlar ondalık tam sayı metnidir. */
export interface EntryState {
  version: number;
  status: "pending" | "confirmed" | "not_required";
  personId: string;
  workDate: string;
  startsAt: string;
  endsAt: string;
  grossCents: string;
  fuelCents: string;
  otherExpenseCents: string;
  /** Güncel sürümün teslim onayı tutarı; onaysızsa `null`. */
  receivedCents: string | null;
}

/**
 * Defterdeki bir kayıt (bu koşunun oluşturduğu). `acknowledged` sunucunun
 * kesin olarak kabul ettiği son durumdur; `unresolved` sonucu bilinmeyen ve
 * yeniden denemeyle çözülemeyen işlemlerin olası sonuç durumlarıdır.
 */
export interface ExpectedEntry {
  fingerprint: string;
  vehicleId: string;
  workKind: WorkKind;
  entryId: string | null;
  acknowledged: EntryState | null;
  unresolved: EntryState[];
}

/** API'den (`GET /work-entries`) okunan kayıt. */
export interface ObservedEntry {
  id: string;
  vehicleId: string;
  workKind: WorkKind;
  fingerprint: string | null;
  state: EntryState;
  shareBps: number;
  shareCents: string;
  remainderCents: string;
  /** Onayın bağlı olduğu kayıt sürümü; onaysızsa `null`. */
  confirmationEntryVersion: number | null;
}

export type FindingKind = "lost" | "duplicate" | "inconsistent";

export interface ReconciliationFinding {
  kind: FindingKind;
  fingerprint: string | null;
  entryId: string | null;
  detail: string;
}

export interface ReconciliationResult {
  expectedEntries: number;
  observedEntries: number;
  matched: number;
  lost: number;
  duplicate: number;
  inconsistent: number;
  /** Sonucu bilinmeyen işlem sonradan uygulanmış bulundu (kayıp/çift değildir). */
  unresolvedApplied: number;
  /** Sonucu bilinmeyen işlem uygulanmamış bulundu. */
  unresolvedNotApplied: number;
  findings: ReconciliationFinding[];
}

const STATE_KEYS: readonly (keyof EntryState)[] = [
  "version",
  "status",
  "personId",
  "workDate",
  "startsAt",
  "endsAt",
  "grossCents",
  "fuelCents",
  "otherExpenseCents",
  "receivedCents",
];

export function statesEqual(a: EntryState, b: EntryState): boolean {
  return STATE_KEYS.every((key) => a[key] === b[key]);
}

function describeDiff(expected: EntryState, observed: EntryState): string {
  return STATE_KEYS.filter((key) => expected[key] !== observed[key])
    .map((key) => `${key}: beklenen ${String(expected[key])}, okunan ${String(observed[key])}`)
    .join("; ");
}

/** Kaydın kendi içinde tutarlılığı: hesap kuralı v1 ve onay ↔ durum bağı. */
export function internalInconsistency(o: ObservedEntry): string | null {
  const amounts = calculateWorkEntryAmounts(
    o.workKind,
    BigInt(o.state.grossCents),
    BigInt(o.state.fuelCents),
    BigInt(o.state.otherExpenseCents),
  );
  if (o.shareBps !== amounts.shareBps || o.shareCents !== String(amounts.shareCents)) {
    return `pay ${o.shareCents} (bps ${o.shareBps}), hesap ${amounts.shareCents} (bps ${amounts.shareBps})`;
  }
  if (o.remainderCents !== String(amounts.remainderCents)) {
    return `kalan ${o.remainderCents}, hesap ${amounts.remainderCents}`;
  }
  const confirmed = o.state.status === "confirmed";
  if (confirmed && (o.state.receivedCents === null || o.confirmationEntryVersion !== o.state.version)) {
    return `onaylı kayıt sürüm ${o.state.version}, onay sürümü ${String(o.confirmationEntryVersion)}`;
  }
  if (!confirmed && o.state.receivedCents !== null) return `durum ${o.state.status} ama onay var`;
  return null;
}

/**
 * Pencere boş başladığından (koşu öncesi doğrulanır) pencerede bu koşunun
 * parmak izini taşımayan her kayıt ve bir parmak izinin ikinci kopyası
 * çifttir. Kabul edilmiş bir kaydın yokluğu veya kabul edilmiş sürümün
 * gerisinde kalması kayıptır; kabul edilen/olası durumların hiçbirine
 * uymayan ya da kendi içinde hesabı tutmayan kayıt tutarsızdır.
 */
export function reconcileLedger(expected: readonly ExpectedEntry[], observed: readonly ObservedEntry[]): ReconciliationResult {
  const result: ReconciliationResult = {
    expectedEntries: expected.length,
    observedEntries: observed.length,
    matched: 0,
    lost: 0,
    duplicate: 0,
    inconsistent: 0,
    unresolvedApplied: 0,
    unresolvedNotApplied: 0,
    findings: [],
  };
  const add = (kind: FindingKind, fingerprint: string | null, entryId: string | null, detail: string) => {
    result[kind]++;
    result.findings.push({ kind, fingerprint, entryId, detail });
  };

  const byFingerprint = new Map<string, ObservedEntry[]>();
  const known = new Set(expected.map((e) => e.fingerprint));
  for (const o of observed) {
    if (o.fingerprint === null || !known.has(o.fingerprint)) {
      add("duplicate", o.fingerprint, o.id, "pencerede bu koşunun defterinde olmayan kayıt");
      continue;
    }
    const group = byFingerprint.get(o.fingerprint) ?? [];
    group.push(o);
    byFingerprint.set(o.fingerprint, group);
  }

  for (const e of expected) {
    const group = byFingerprint.get(e.fingerprint) ?? [];
    const match = e.entryId !== null ? group.find((o) => o.id === e.entryId) : group[0];
    for (const extra of group) {
      if (extra !== match) add("duplicate", e.fingerprint, extra.id, "aynı oluşturma isteğinden ikinci kayıt");
    }
    if (!match) {
      if (e.acknowledged !== null) add("lost", e.fingerprint, e.entryId, "kabul edilmiş kayıt sunucuda yok");
      else result.unresolvedNotApplied++;
      continue;
    }
    if (match.vehicleId !== e.vehicleId || match.workKind !== e.workKind) {
      add("inconsistent", e.fingerprint, match.id, `araç/tür ${match.vehicleId}/${match.workKind}, beklenen ${e.vehicleId}/${e.workKind}`);
      continue;
    }
    const internal = internalInconsistency(match);
    if (internal !== null) {
      add("inconsistent", e.fingerprint, match.id, internal);
      continue;
    }
    if (e.acknowledged !== null && statesEqual(e.acknowledged, match.state)) {
      result.matched++;
      continue;
    }
    if (e.unresolved.some((s) => statesEqual(s, match.state))) {
      result.matched++;
      result.unresolvedApplied++;
      continue;
    }
    if (e.acknowledged !== null && match.state.version < e.acknowledged.version) {
      add("lost", e.fingerprint, match.id, `kabul edilmiş sürüm ${e.acknowledged.version}, sunucuda ${match.state.version}`);
      continue;
    }
    const reference = e.acknowledged ?? e.unresolved[0];
    add("inconsistent", e.fingerprint, match.id, reference ? describeDiff(reference, match.state) : "beklenen durum yok");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Geçti / kaldı ve kabul uygunluğu
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "fail" | "not_applicable";

export interface VerdictCheck {
  id: string;
  target: string;
  actual: string;
  status: CheckStatus;
}

export interface VerdictInput {
  /** Sürdürülen yük aşamasındaki sınıf gecikmeleri. */
  classes: Record<RequestClass, LatencySummary>;
  /** Senaryonun ürettiği ve bu yüzden örneği OLMASI gereken sınıflar. */
  requiredClasses: readonly RequestClass[];
  /** Sürdürülen yükteki kullanıcı istekleri (probe hariç). */
  totalRequests: number;
  unexpected: number;
  /** Yeniden denemeyle de çözülemeyen bilinmeyen sonuçlar. */
  unresolvedUnknown: number;
  /** Meşru kullanıcıya dönen 429'lar (tüm kodlar). */
  rateLimited: number;
  /** `null`: senaryo yazmadı; `"failed"`: pencere API'den okunamadı. */
  reconciliation: Pick<ReconciliationResult, "lost" | "duplicate" | "inconsistent"> | "failed" | null;
  /** Yazma sonrası okuma sondasının ve eşzamanlılık denetiminin uyuşmazlıkları. */
  probeMismatches: number;
  /** Koşucunun kendi beklenmeyen istisnaları; sıfır değilse ölçüm eksiktir. */
  runnerErrors: number;
}

function latencyCheck(id: string, cls: RequestClass, targetMs: number, input: VerdictInput): VerdictCheck {
  const summary = input.classes[cls];
  const target = `${cls} p95 ≤ ${targetMs} ms`;
  if (summary.count === 0 || summary.p95Ms === null) {
    const required = input.requiredClasses.includes(cls);
    return { id, target, actual: "örnek yok", status: required ? "fail" : "not_applicable" };
  }
  return {
    id,
    target,
    actual: `${summary.p95Ms.toFixed(1)} ms (n=${summary.count})`,
    status: summary.p95Ms <= targetMs ? "pass" : "fail",
  };
}

export function evaluateVerdict(input: VerdictInput): { pass: boolean; checks: VerdictCheck[] } {
  const checks: VerdictCheck[] = [
    latencyCheck("kayit_p95", "kayit", LOAD_TARGETS.kayitP95Ms, input),
    latencyCheck("rapor_p95", "rapor", LOAD_TARGETS.raporP95Ms, input),
  ];

  const failures = input.unexpected + input.unresolvedUnknown;
  const rate = input.totalRequests > 0 ? failures / input.totalRequests : null;
  checks.push({
    id: "unexpected_rate",
    target: `beklenmeyen < %${LOAD_TARGETS.unexpectedRateLimit * 100}`,
    actual: rate === null ? "istek yok" : `%${(rate * 100).toFixed(3)} (${failures}/${input.totalRequests})`,
    status: rate !== null && rate < LOAD_TARGETS.unexpectedRateLimit ? "pass" : "fail",
  });
  checks.push({
    id: "legitimate_user_blocking",
    target: "meşru kullanıcıya 429 = 0",
    actual: String(input.rateLimited),
    status: input.rateLimited === 0 ? "pass" : "fail",
  });

  const rec = input.reconciliation;
  const zero = (id: string, target: string, value: number | null | "failed"): VerdictCheck => ({
    id,
    target,
    actual: value === null ? "yazma yok" : value === "failed" ? "mutabakat tamamlanamadı" : String(value),
    status: value === null ? "not_applicable" : value === 0 ? "pass" : "fail",
  });
  const pick = (key: "lost" | "duplicate") => (rec === null || rec === "failed" ? rec : rec[key]);
  const inconsistent =
    rec === "failed" ? rec : rec === null ? (input.probeMismatches > 0 ? input.probeMismatches : null) : rec.inconsistent + input.probeMismatches;
  checks.push(zero("financial_loss", "mali kayıp = 0", pick("lost")));
  checks.push(zero("financial_duplication", "çift işlem = 0", pick("duplicate")));
  checks.push(zero("inconsistency", "hesap/onay tutarsızlığı = 0", inconsistent));
  checks.push(zero("runner_errors", "koşucu hatası = 0", input.runnerErrors));

  return { pass: checks.every((c) => c.status !== "fail"), checks };
}

/** `URL.hostname` biçiminde (IPv6 köşeli parantezli) geri döngü hedefi mi? */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "::" || host === "0.0.0.0") return true;
  const v4 = host.startsWith("::ffff:") ? host.slice("::ffff:".length) : host;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(v4);
}

export interface EligibilityInput {
  sustainSeconds: number;
  targetUrl: string;
  users: number;
  /** Veri setinin migration listesi yayın manifestindekiyle aynı mı? */
  datasetMatchesRelease: boolean;
}

export function acceptanceEligibility(input: EligibilityInput): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.sustainSeconds < MIN_ACCEPTANCE_SUSTAIN_SECONDS) {
    reasons.push(`sürdürülen yük ${input.sustainSeconds} sn < ${MIN_ACCEPTANCE_SUSTAIN_SECONDS} sn`);
  }
  if (isLoopbackHost(new URL(input.targetUrl).hostname)) {
    reasons.push("hedef geri döngü adresi: yük üreticisi test edilen makinenin dışında olmalı");
  }
  if (input.users < ACCEPTANCE_USERS) reasons.push(`kullanıcı sayısı ${input.users} < ${ACCEPTANCE_USERS}`);
  if (!input.datasetMatchesRelease) reasons.push("veri setinin migration listesi yayın manifestiyle uyuşmuyor");
  return { eligible: reasons.length === 0, reasons };
}
