/**
 * Kalite kapısı (S6.1 AC3) ve ağaç anahtarlı kapı kaydı — `release:build`
 * ile `npm run quality-gate`'in ORTAK modülü (2026-09-25).
 *
 * Kapı adımları (typecheck → lint → test:unit → test:integration) YALNIZ
 * burada tanımlıdır. Tüm adımlar exit 0 verdiğinde, çalışma ağacı kapı
 * başlarken ve bittiğinde temizse ve HEAD kapı sırasında kıpırdamadıysa
 * `.quality-gate/<tree>.json` yazılır: "bu commit İÇERİĞİ (git tree hash'i,
 * lockfile dahil) bu Node sürümüyle bu adım listesinden geçti".
 * `release:build` geçerli bir kayıt bulursa kapıyı yeniden çalıştırmaz;
 * bulamazsa kapıyı eskisi gibi tam çalıştırır.
 *
 * Anahtar commit SHA'sı DEĞİL tree hash'idir: kapının sonucu commit
 * meta verisine değil içeriğe bağlıdır. Doğrulama kayıttaki ya da dosya
 * adındaki değerlere DEĞİL, çağıranın ŞİMDİ git'ten ve çalışma zamanından
 * hesapladığı değerlere (tree, `QUALITY_GATE_STEPS` kimlikleri,
 * `process.version`) göre yapılır; adım listesi değişince eski kayıtlar
 * kendiliğinden geçersizleşir. Okunamayan/bozuk kayıt "geçersiz" sayılır
 * (tam kapı), hiçbir zaman çökme sebebi değildir.
 *
 * Kayıt bir KAZA korumasıdır, kurcalamaya karşı koruma DEĞİLDİR: checkout'a
 * yazabilen biri kaydı da taklit edebilir — tıpkı `release-build.ts`'i
 * düzenleyebileceği gibi. İmzalamanın dayanacağı bir anahtar olmadığı için
 * imza eklenmedi.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface QualityGateStep {
  id: string;
  cmd: string;
  args: string[];
}

export const QUALITY_GATE_STEPS: readonly QualityGateStep[] = [
  { id: "typecheck", cmd: "npm", args: ["run", "typecheck"] },
  { id: "lint", cmd: "npm", args: ["run", "lint"] },
  { id: "test:unit", cmd: "npm", args: ["run", "test:unit"] },
  // `release:build`'in meta-testi ayrı `release` projesinde olduğu için
  // özyineleme yok — bkz. `../release-build.ts` üst notu.
  { id: "test:integration", cmd: "npm", args: ["run", "test:integration"] },
];

export const QUALITY_GATE_RECORD_VERSION = 1;
export const QUALITY_GATE_DIR = ".quality-gate";

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export interface QualityGateRecord {
  version: number;
  tree: string;
  commit: string;
  node_version: string;
  steps: string[];
  passed_at: string;
}

/** Kaydın geçerli sayılması için ŞİMDİ hesaplanmış değerler. */
export interface ExpectedRecord {
  tree: string;
  steps: readonly string[];
  nodeVersion: string;
}

export type RecordCheck =
  | { valid: true; record: QualityGateRecord }
  | { valid: false; reason: string };

export interface GitSnapshot {
  head: string;
  tree: string;
  /** `git status --porcelain` çıktısı; boş = temiz. */
  dirty: string;
}

export function qualityGateStepIds(steps: readonly QualityGateStep[] = QUALITY_GATE_STEPS): string[] {
  return steps.map((step) => step.id);
}

export function recordPathFor(root: string, tree: string): string {
  if (!OBJECT_ID.test(tree)) {
    throw new Error(`Geçersiz git tree kimliği: "${tree}".`);
  }
  return path.join(root, QUALITY_GATE_DIR, `${tree}.json`);
}

/** Saf doğrulayıcı: hiçbir durumda fırlatmaz. */
export function validateRecord(text: string, expected: ExpectedRecord): RecordCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { valid: false, reason: "kayıt JSON olarak ayrıştırılamadı" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { valid: false, reason: "kayıt bir JSON nesnesi değil" };
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== QUALITY_GATE_RECORD_VERSION) {
    return { valid: false, reason: `kayıt sürümü ${JSON.stringify(record.version)} desteklenmiyor` };
  }
  if (record.tree !== expected.tree) {
    return { valid: false, reason: `kayıttaki tree ${JSON.stringify(record.tree)} bu ağaç (${expected.tree}) değil` };
  }
  const steps = record.steps;
  if (
    !Array.isArray(steps) ||
    steps.length !== expected.steps.length ||
    steps.some((id, index) => id !== expected.steps[index])
  ) {
    return {
      valid: false,
      reason: `kayıttaki adım listesi ${JSON.stringify(steps)} güncel kapı (${JSON.stringify(expected.steps)}) değil`,
    };
  }
  if (record.node_version !== expected.nodeVersion) {
    return {
      valid: false,
      reason: `kayıt Node ${JSON.stringify(record.node_version)} ile yazılmış, şu an ${expected.nodeVersion}`,
    };
  }
  if (typeof record.commit !== "string" || !OBJECT_ID.test(record.commit)) {
    return { valid: false, reason: "kayıtta geçerli bir commit alanı yok" };
  }
  if (typeof record.passed_at !== "string" || Number.isNaN(Date.parse(record.passed_at))) {
    return { valid: false, reason: "kayıtta geçerli bir passed_at alanı yok" };
  }
  return {
    valid: true,
    record: {
      version: record.version,
      tree: record.tree,
      commit: record.commit,
      node_version: record.node_version,
      steps: [...(steps as string[])],
      passed_at: record.passed_at,
    },
  };
}

/** `root/.quality-gate/<expected.tree>.json`'ı okur ve doğrular; dosya yoksa
 * veya okunamazsa geçersiz döner, fırlatmaz. */
export function readRecord(root: string, expected: ExpectedRecord): RecordCheck {
  const recordPath = recordPathFor(root, expected.tree);
  let text: string;
  try {
    text = fs.readFileSync(recordPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      valid: false,
      reason: code === "ENOENT" ? "bu ağaç için kayıt yok" : `kayıt okunamadı (${code ?? String(error)})`,
    };
  }
  return validateRecord(text, expected);
}

/** Geçici dosya + `rename`: eşzamanlı bir okuyucu yarım JSON görmez. */
export function writeRecord(root: string, record: QualityGateRecord): string {
  const recordPath = recordPathFor(root, record.tree);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  const tempPath = `${recordPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`);
    fs.renameSync(tempPath, recordPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  return recordPath;
}

/** Kayıt yazılamayacaksa nedenini, yazılabilirse `null` döner (saf). */
export function recordBlocker(before: GitSnapshot, after: GitSnapshot): string | null {
  if (before.dirty.length > 0) {
    return "çalışma ağacı kapı başlarken kirliydi";
  }
  if (after.dirty.length > 0) {
    return "çalışma ağacı kapı sırasında değişti";
  }
  if (after.head !== before.head || after.tree !== before.tree) {
    return `HEAD kapı sırasında değişti (${before.head} → ${after.head})`;
  }
  return null;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) {
    throw new Error(`"git" çalıştırılamadı: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`"git ${args.join(" ")}" başarısız (exit ${result.status}):\n${result.stderr}`);
  }
  return result.stdout;
}

export function readGitSnapshot(cwd: string): GitSnapshot {
  return {
    head: git(cwd, ["rev-parse", "HEAD"]).trim(),
    tree: git(cwd, ["rev-parse", "HEAD^{tree}"]).trim(),
    dirty: git(cwd, ["status", "--porcelain"]).trim(),
  };
}

export type QualityGateOutcome =
  | { ok: true; recordPath: string; noRecordReason?: undefined }
  | { ok: true; recordPath?: undefined; noRecordReason: string }
  | { ok: false; message: string };

/**
 * Adımları sırayla, tam çıktılarıyla (`stdio: "inherit"`) çalıştırır; ilk
 * başarısız adımda durur (sonrakiler ÇALIŞTIRILMAZ) ve kayıt YAZMAZ. Hepsi
 * geçerse ve `recordBlocker` engel görmezse kaydı yazar. `steps` yalnız
 * testler için değiştirilir.
 */
export function runQualityGate(opts: {
  root: string;
  logPrefix: string;
  steps?: readonly QualityGateStep[];
}): QualityGateOutcome {
  const { root, logPrefix, steps = QUALITY_GATE_STEPS } = opts;
  const stepIds = qualityGateStepIds(steps);
  const before = readGitSnapshot(root);

  console.log(`${logPrefix} Kalite kapısı (S6.1 AC3): ${stepIds.join(" → ")}.`);
  for (const step of steps) {
    console.log(`${logPrefix}   $ ${step.cmd} ${step.args.join(" ")}`);
    const result = spawnSync(step.cmd, step.args, { cwd: root, stdio: "inherit" });
    if (result.error) {
      return {
        ok: false,
        message: `Kalite kapısı "${step.id}" adımı çalıştırılamadı: ${result.error.message}`,
      };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        message:
          `Kalite kapısı "${step.id}" adımında başarısız oldu (exit ` +
          `${result.status}). S6.1 AC3 gereği derleme, tip kontrolü ve ` +
          "iş kuralı/yetki/veri testleri geçmeden yayınlanabilir çıktı " +
          "üretilmez; önce bu adımı düzeltip commit edin.",
      };
    }
  }
  console.log(`${logPrefix} Kalite kapısı geçti (${stepIds.join("/")}).`);

  const blocker = recordBlocker(before, readGitSnapshot(root));
  if (blocker !== null) {
    return { ok: true, noRecordReason: blocker };
  }
  const recordPath = writeRecord(root, {
    version: QUALITY_GATE_RECORD_VERSION,
    tree: before.tree,
    commit: before.head,
    node_version: process.version,
    steps: stepIds,
    passed_at: new Date().toISOString(),
  });
  return { ok: true, recordPath };
}
