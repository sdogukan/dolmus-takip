/**
 * Yük kabul raporunun biçimi ve Markdown görünümü — `scripts/load-run.ts`
 * (S6.6, T6.6). JSON rapor makine okur, Markdown aynı içeriği insana gösterir.
 *
 * Rapor hiçbir parola, çerez, CSRF token'ı veya kişi adı taşımaz: tip bunlara
 * alan ayırmaz; kullanıcılar yalnız sayı olarak görünür.
 */
import type {
  LatencySummary,
  ReconciliationResult,
  RequestClass,
  VerdictCheck,
} from "./load-metrics.ts";
import { REQUEST_CLASSES } from "./load-metrics.ts";

/**
 * Koşu öncesi ve koşu boyunca dışarıdan erişilebilirlik sondası: herkese açık
 * giriş sayfası. Health uçları dışarıya 404 döndüğünden (Caddy) üretici onları
 * çağırmaz. Bu sonda yalnız Caddy + uygulamanın sayfa sunduğunu gösterir;
 * veritabanının hazır olduğunu GÖSTERMEZ.
 */
export const REACHABILITY_PROBE_PATH = "/giris";

export type ScenarioName = "login-burst" | "active-mix" | "write-peak";
export const SCENARIO_NAMES: readonly ScenarioName[] = ["login-burst", "active-mix", "write-peak"];

export interface OutcomeCounts {
  requests: number;
  success: number;
  /** Beklenen 409'lar, koda göre. */
  expected409: Record<string, number>;
  /** Meşru kullanıcıya dönen 429'lar, koda göre (kapasite değil, engelleme). */
  rateLimited429: Record<string, number>;
  /** Sonucu bilinmeyen yazma denemeleri, koda göre. */
  unknownResult: Record<string, number>;
  /** Beklenmeyen yanıtlar, koda göre. */
  unexpected: Record<string, number>;
}

export interface WaveSummary {
  wave: number;
  phase: string;
  size: number;
  /** İlk gönderimden son yanıta kadar geçen süre: kuyruk + toparlanma. */
  drainMs: number;
}

export interface LoadReport {
  kind: "dolmus-takip-load-report";
  formatVersion: 1;
  runId: string;
  scenario: ScenarioName;
  generatedAt: string;
  target: { url: string; origin: string; loopback: boolean };
  release: {
    manifestFile: string;
    sourceCommit: string;
    artifactSha256: string;
    nodeVersion: string | null;
    sqliteVersion: string | null;
    builtAt: string | null;
  };
  dataset: {
    sourceCommit: string;
    sha256: string;
    history: { startDate: string; endDate: string; years: number };
    counts: Record<string, number | string>;
    schemaMatchesRelease: boolean;
    commitMatchesRelease: boolean;
  };
  config: {
    users: number;
    warmupSeconds: number;
    rampSeconds: number;
    sustainSeconds: number;
    arrival: string;
    timeoutMs: number;
    maxRetries: number;
    retryBackoffMs: number;
    maxInFlight: number;
    randomSeed: number;
    windowMonth: string | null;
  };
  timeline: { setupStartedAt: string; loadStartedAt: string; sustainStartedAt: string; loadEndedAt: string; finishedAt: string };
  rate: {
    intendedSustainOps: number;
    dispatchedSustainOps: number;
    droppedOps: Record<string, number>;
    intendedPerSecond: number;
    achievedPerSecond: number;
    /** Planlı an → işlemin gerçekten başladığı an (sürdürülen yük). */
    dispatchLag: LatencySummary;
  };
  latency: Record<"warmup" | "ramp" | "sustain", Record<RequestClass, LatencySummary>>;
  outcomes: { sustain: OutcomeCounts; all: OutcomeCounts };
  writes: {
    ops: number;
    applied: number;
    rejected: number;
    firstAttemptUnknown: number;
    resolvedByRetry: number;
    unresolved: number;
    retries: number;
    doubleSubmits: number;
    concurrentCorrections: number;
    fallbacks: number;
  };
  waves: WaveSummary[];
  probes: {
    readAfterWrite: number;
    mismatches: number;
    /** `GET REACHABILITY_PROBE_PATH` oturumsuz; 200 dışı her yanıt başarısız sayılır. */
    reachability: { requests: number; failures: number; latency: LatencySummary };
    findings: string[];
  };
  reconciliation: (Omit<ReconciliationResult, "findings"> & { findings: ReconciliationResult["findings"] }) | { status: "not_applicable" | "failed"; detail: string };
  loginWindow: {
    attempts: number;
    failedAttempts: number;
    firstAttemptAt: string | null;
    lastAttemptAt: string | null;
    ipFailedAttemptLimit: number;
    windowMinutes: number;
    nextLoginHeavyScenarioNotBefore: string | null;
  };
  targets: { kayitP95Ms: number; raporP95Ms: number; unexpectedRateLimit: number };
  verdict: { pass: boolean; checks: VerdictCheck[] };
  /** Kabul kanıtı sayılabilir mi (≥ 30 dk sürdürülen, dış hedef, 100 kullanıcı, yayınla aynı şema). */
  acceptance_eligible: boolean;
  /** `acceptance_eligible` false ise nedenleri. */
  acceptance_reasons: string[];
  runnerErrors: string[];
}

const ms = (value: number | null) => (value === null ? "—" : value.toFixed(1));
const codes = (record: Record<string, number>) =>
  Object.keys(record).length === 0
    ? "0"
    : Object.entries(record)
        .map(([code, n]) => `${code}: ${n}`)
        .join(", ");
const STATUS_LABEL = { pass: "GEÇTİ", fail: "KALDI", not_applicable: "uygulanmaz" } as const;

export function renderLoadReportMarkdown(r: LoadReport): string {
  const lines: string[] = [];
  const p = (line = "") => lines.push(line);
  p(`# Yük kabul raporu — ${r.scenario}`);
  p();
  p(`\`npm run load:run\` tarafından üretildi (${r.generatedAt}, koşu ${r.runId}). Elle düzenlenmez.`);
  p();
  p(`**Sonuç: ${r.verdict.pass ? "GEÇTİ" : "KALDI"}** · **Kabul kanıtı: ${r.acceptance_eligible ? "uygun" : "UYGUN DEĞİL"}**`);
  for (const reason of r.acceptance_reasons) p(`- ${reason}`);
  p();
  p("## Sürüm ve veri");
  p();
  p("| Kalem | Değer |");
  p("| --- | --- |");
  p(`| Hedef | ${r.target.url} (Origin ${r.target.origin})${r.target.loopback ? " — geri döngü" : ""} |`);
  p(`| Yayın commit'i (manifest) | \`${r.release.sourceCommit}\` |`);
  p(`| Yayın arşivi sha256 | \`${r.release.artifactSha256}\` |`);
  p(`| Manifest | ${r.release.manifestFile} (Node ${r.release.nodeVersion ?? "—"}, SQLite ${r.release.sqliteVersion ?? "—"}) |`);
  p(`| Veri seti commit'i | \`${r.dataset.sourceCommit}\`${r.dataset.commitMatchesRelease ? "" : " — yayın commit'inden farklı"} |`);
  p(`| Veri seti migration'ları yayınla aynı | ${r.dataset.schemaMatchesRelease ? "evet" : "HAYIR"} |`);
  p(`| Veri seti sha256 (kurulumda) | \`${r.dataset.sha256}\` |`);
  p(`| Geçmiş | ${r.dataset.history.startDate} … ${r.dataset.history.endDate} (${r.dataset.history.years} yıl) |`);
  for (const [key, value] of Object.entries(r.dataset.counts)) p(`| ${key} | ${value} |`);
  p();
  p("## Yük");
  p();
  p("| Kalem | Değer |");
  p("| --- | --- |");
  p(`| Kullanıcı | ${r.config.users} |`);
  p(`| Isınma / artış / sürdürülen | ${r.config.warmupSeconds} / ${r.config.rampSeconds} / ${r.config.sustainSeconds} sn |`);
  p(`| Varış modeli | ${r.config.arrival} |`);
  p(`| Zaman aralığı | ${r.timeline.loadStartedAt} → ${r.timeline.loadEndedAt} (sürdürülen ${r.timeline.sustainStartedAt}'ten) |`);
  p(`| Yazma penceresi | ${r.config.windowMonth ?? "—"} |`);
  p(`| İstemci zaman aşımı | ${r.config.timeoutMs} ms, en çok ${r.config.maxRetries} yeniden deneme |`);
  p(`| Planlanan / gönderilen (sürdürülen) | ${r.rate.intendedSustainOps} / ${r.rate.dispatchedSustainOps} |`);
  p(`| Planlanan / gerçekleşen hız | ${r.rate.intendedPerSecond.toFixed(2)} / ${r.rate.achievedPerSecond.toFixed(2)} işlem/sn |`);
  p(`| Gönderim gecikmesi p95 / en yüksek | ${ms(r.rate.dispatchLag.p95Ms)} / ${ms(r.rate.dispatchLag.maxMs)} ms |`);
  p(`| Düşürülen işlem (eşzamanlı sınır) | ${codes(r.rate.droppedOps)} |`);
  p();
  p("## Gecikme (ms, gerçek gönderimden tam yanıta)");
  p();
  p("| Aşama | Sınıf | n | p50 | p95 | p99 | en yüksek |");
  p("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const phase of ["warmup", "ramp", "sustain"] as const) {
    for (const cls of REQUEST_CLASSES) {
      const s = r.latency[phase][cls];
      if (s.count === 0) continue;
      p(`| ${phase} | ${cls} | ${s.count} | ${ms(s.p50Ms)} | ${ms(s.p95Ms)} | ${ms(s.p99Ms)} | ${ms(s.maxMs)} |`);
    }
  }
  p();
  p("## Yanıt sınıfları (sürdürülen yük / tüm koşu)");
  p();
  p("| Sınıf | Sürdürülen | Tüm koşu |");
  p("| --- | --- | --- |");
  const { sustain, all } = r.outcomes;
  p(`| İstek | ${sustain.requests} | ${all.requests} |`);
  p(`| Başarılı | ${sustain.success} | ${all.success} |`);
  p(`| Beklenen 409 | ${codes(sustain.expected409)} | ${codes(all.expected409)} |`);
  p(`| 429 — meşru kullanıcı engeli | ${codes(sustain.rateLimited429)} | ${codes(all.rateLimited429)} |`);
  p(`| Sonucu bilinmeyen yazma denemesi | ${codes(sustain.unknownResult)} | ${codes(all.unknownResult)} |`);
  p(`| Beklenmeyen | ${codes(sustain.unexpected)} | ${codes(all.unexpected)} |`);
  p();
  const w = r.writes;
  p(
    `Yazma işlemi ${w.ops}: uygulandı ${w.applied}, reddedildi ${w.rejected}, ilk denemede bilinmeyen ${w.firstAttemptUnknown} ` +
      `(yeniden denemeyle çözülen ${w.resolvedByRetry}, çözülemeyen ${w.unresolved}), yeniden deneme ${w.retries}, ` +
      `çift gönderim ${w.doubleSubmits}, eşzamanlı düzeltme ${w.concurrentCorrections}, yedek işlem ${w.fallbacks}.`,
  );
  p();
  if (r.waves.length > 0) {
    p("## Dalgalar (kuyruk ve toparlanma)");
    p();
    p("| Dalga | Aşama | İstek | İlk gönderim → son yanıt (ms) |");
    p("| ---: | --- | ---: | ---: |");
    for (const wave of r.waves) p(`| ${wave.wave} | ${wave.phase} | ${wave.size} | ${wave.drainMs.toFixed(1)} |`);
    p();
  }
  p("## Bütünlük");
  p();
  if ("status" in r.reconciliation) {
    p(`Defter mutabakatı: ${r.reconciliation.status} — ${r.reconciliation.detail}`);
  } else {
    const c = r.reconciliation;
    p("| Kalem | Değer |");
    p("| --- | ---: |");
    p(`| Defterdeki kayıt | ${c.expectedEntries} |`);
    p(`| Penceredeki kayıt (API) | ${c.observedEntries} |`);
    p(`| Eşleşen | ${c.matched} |`);
    p(`| Kayıp | ${c.lost} |`);
    p(`| Çift | ${c.duplicate} |`);
    p(`| Tutarsız | ${c.inconsistent} |`);
    p(`| Bilinmeyen sonuç: uygulanmış / uygulanmamış | ${c.unresolvedApplied} / ${c.unresolvedNotApplied} |`);
    for (const f of c.findings) p(`- ${f.kind}: ${f.entryId ?? "—"} (${f.fingerprint ?? "parmak izi yok"}) — ${f.detail}`);
  }
  p();
  p(
    `Yazma sonrası okuma sondası ${r.probes.readAfterWrite}, uyuşmazlık ${r.probes.mismatches}. ` +
      `Erişilebilirlik sondası (GET ${REACHABILITY_PROBE_PATH}, oturumsuz; veritabanı hazırlığını göstermez) ` +
      `${r.probes.reachability.requests} istek, ${r.probes.reachability.failures} başarısız, p95 ${ms(r.probes.reachability.latency.p95Ms)} ms.`,
  );
  for (const finding of r.probes.findings) p(`- ${finding}`);
  p();
  p("## Giriş penceresi");
  p();
  const lw = r.loginWindow;
  p(
    `Giriş denemesi ${lw.attempts} (başarısız ${lw.failedAttempts}), ${lw.firstAttemptAt ?? "—"} → ${lw.lastAttemptAt ?? "—"}. ` +
      `Tüm trafik tek IP'den gelir; iki giriş rotası IP başına ${lw.ipFailedAttemptLimit} başarısız deneme / ${lw.windowMinutes} dk ` +
      `kovasını paylaşır. Girişi yoğun bir sonraki senaryo en erken ${lw.nextLoginHeavyScenarioNotBefore ?? "—"}.`,
  );
  p();
  p("## Hedefler");
  p();
  p("| Kontrol | Hedef | Gerçek | Durum |");
  p("| --- | --- | --- | --- |");
  for (const c of r.verdict.checks) p(`| ${c.id} | ${c.target} | ${c.actual} | ${STATUS_LABEL[c.status]} |`);
  p();
  if (r.runnerErrors.length > 0) {
    p("## Koşucu hataları");
    p();
    for (const e of r.runnerErrors) p(`- ${e}`);
    p();
  }
  return lines.join("\n");
}
