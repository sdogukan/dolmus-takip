import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  QUALITY_GATE_DIR,
  QUALITY_GATE_RECORD_VERSION,
  QUALITY_GATE_STEPS,
  type GitSnapshot,
  type QualityGateRecord,
  type QualityGateStep,
  qualityGateStepIds,
  readRecord,
  recordBlocker,
  recordPathFor,
  runQualityGate,
  validateRecord,
  writeRecord,
} from "../../scripts/lib/quality-gate.ts";

/**
 * `scripts/lib/quality-gate.ts` birim testleri — kapı kaydı (2026-09-25).
 *
 * `release:build` kapıyı yalnız bu doğrulayıcı "geçerli" dediğinde atlar;
 * bu yüzden her geçersizlik nedeni (başka tree, farklı adım listesi, başka
 * Node sürümü, bozuk JSON) ayrı bir testtir ve hiçbiri fırlatmamalıdır.
 */

const TREE = "a".repeat(40);
const OTHER_TREE = "b".repeat(40);
const COMMIT = "c".repeat(40);
const STEPS = ["typecheck", "lint", "test:unit", "test:integration"];
const NODE = "v24.21.0";
const EXPECTED = { tree: TREE, steps: STEPS, nodeVersion: NODE };

function record(overrides: Partial<Record<keyof QualityGateRecord, unknown>> = {}): string {
  return JSON.stringify({
    version: QUALITY_GATE_RECORD_VERSION,
    tree: TREE,
    commit: COMMIT,
    node_version: NODE,
    steps: STEPS,
    passed_at: "2026-09-25T10:00:00.000Z",
    ...overrides,
  });
}

function invalidReason(text: string, expected = EXPECTED): string {
  const check = validateRecord(text, expected);
  expect(check.valid).toBe(false);
  return check.valid ? "" : check.reason;
}

describe("QUALITY_GATE_STEPS", () => {
  test("kapı, release:build'in eskiden kendi içinde çalıştırdığı dört adımdır, bu sırayla", () => {
    expect(qualityGateStepIds()).toEqual(STEPS);
    for (const step of QUALITY_GATE_STEPS) {
      expect([step.cmd, ...step.args]).toEqual(["npm", "run", step.id]);
    }
  });
});

describe("validateRecord", () => {
  test("şimdi hesaplanan tree/adım listesi/Node sürümüyle birebir eşleşen kayıt geçerlidir", () => {
    const check = validateRecord(record(), EXPECTED);
    expect(check).toEqual({
      valid: true,
      record: {
        version: QUALITY_GATE_RECORD_VERSION,
        tree: TREE,
        commit: COMMIT,
        node_version: NODE,
        steps: STEPS,
        passed_at: "2026-09-25T10:00:00.000Z",
      },
    });
  });

  test("başka bir ağacın kaydı geçersizdir", () => {
    expect(invalidReason(record({ tree: OTHER_TREE }))).toMatch(/tree/);
  });

  test.each([
    ["eksik adım", ["typecheck", "lint", "test:unit"]],
    ["fazla adım", [...STEPS, "test:release"]],
    ["farklı sıra", ["lint", "typecheck", "test:unit", "test:integration"]],
    ["dizi değil", "typecheck,lint,test:unit,test:integration"],
  ])("farklı adım listesiyle yazılmış kayıt geçersizdir (%s)", (_label, steps) => {
    expect(invalidReason(record({ steps }))).toMatch(/adım listesi/);
  });

  test("başka Node sürümüyle yazılmış kayıt geçersizdir", () => {
    expect(invalidReason(record({ node_version: "v22.20.0" }))).toMatch(/Node/);
  });

  test.each([
    ["boş metin", ""],
    ["yarım yazılmış JSON", record().slice(0, 40)],
    ["JSON olmayan metin", "geçti"],
  ])("ayrıştırılamayan kayıt fırlatmadan geçersiz döner (%s)", (_label, text) => {
    expect(invalidReason(text)).toMatch(/ayrıştırılamadı/);
  });

  test.each([
    ["null", "null"],
    ["dizi", "[]"],
    ["sayı", "1"],
  ])("nesne olmayan JSON geçersizdir (%s)", (_label, text) => {
    expect(invalidReason(text)).toMatch(/nesnesi değil/);
  });

  test("desteklenmeyen kayıt sürümü geçersizdir", () => {
    expect(invalidReason(record({ version: 2 }))).toMatch(/sürümü/);
  });

  test.each([
    ["commit yok", { commit: undefined }, /commit/],
    ["commit hex değil", { commit: "HEAD" }, /commit/],
    ["passed_at yok", { passed_at: undefined }, /passed_at/],
    ["passed_at tarih değil", { passed_at: "dün" }, /passed_at/],
  ])("izlenebilirlik alanı bozuk kayıt geçersizdir (%s)", (_label, overrides, reason) => {
    expect(invalidReason(record(overrides))).toMatch(reason);
  });
});

describe("kayıt dosyası", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "quality-gate-test-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("recordPathFor yalnız git nesne kimliği kabul eder (yol dışına çıkılamaz)", () => {
    expect(recordPathFor(root, TREE)).toBe(path.join(root, QUALITY_GATE_DIR, `${TREE}.json`));
    for (const tree of ["../x", `${TREE}/../y`, "", TREE.toUpperCase(), "a".repeat(39)]) {
      expect(() => recordPathFor(root, tree)).toThrowError(/tree/);
    }
  });

  test("kayıt yoksa readRecord fırlatmadan geçersiz döner", () => {
    expect(readRecord(root, EXPECTED)).toEqual({ valid: false, reason: "bu ağaç için kayıt yok" });
  });

  test("bozuk kayıt dosyası readRecord'da fırlatmadan geçersiz döner", () => {
    fs.mkdirSync(path.join(root, QUALITY_GATE_DIR));
    fs.writeFileSync(recordPathFor(root, TREE), "{\"version\": 1, \"tree\"");
    const check = readRecord(root, EXPECTED);
    expect(check.valid).toBe(false);
  });

  test("dosya adı değil içerik doğrulanır: başka ağacın kaydı bu ağacın adıyla kopyalansa da geçersizdir", () => {
    fs.mkdirSync(path.join(root, QUALITY_GATE_DIR));
    fs.writeFileSync(recordPathFor(root, TREE), record({ tree: OTHER_TREE }));
    const check = readRecord(root, EXPECTED);
    expect(check.valid).toBe(false);
  });

  test("writeRecord dizini oluşturur, readRecord'un kabul ettiği kaydı yazar ve geçici dosya bırakmaz", () => {
    const written = JSON.parse(record()) as QualityGateRecord;
    const recordPath = writeRecord(root, written);

    expect(recordPath).toBe(recordPathFor(root, TREE));
    expect(fs.readdirSync(path.join(root, QUALITY_GATE_DIR))).toEqual([`${TREE}.json`]);
    expect(readRecord(root, EXPECTED)).toEqual({ valid: true, record: written });
  });

  test("writeRecord var olan kaydın üzerine yazar", () => {
    writeRecord(root, JSON.parse(record({ node_version: "v22.20.0" })) as QualityGateRecord);
    writeRecord(root, JSON.parse(record()) as QualityGateRecord);
    expect(readRecord(root, EXPECTED).valid).toBe(true);
  });
});

describe("recordBlocker", () => {
  const clean: GitSnapshot = { head: COMMIT, tree: TREE, dirty: "" };

  test("ağaç baştan sona temiz ve HEAD aynıysa engel yoktur", () => {
    expect(recordBlocker(clean, { ...clean })).toBeNull();
  });

  test("kapı kirli ağaçta başladıysa kayıt yazılmaz", () => {
    expect(recordBlocker({ ...clean, dirty: " M README.md" }, clean)).toMatch(/başlarken kirli/);
  });

  test("ağaç kapı sırasında kirlendiyse kayıt yazılmaz", () => {
    expect(recordBlocker(clean, { ...clean, dirty: "?? yeni.ts" })).toMatch(/sırasında değişti/);
  });

  test("kapı sırasında commit edildiyse (HEAD kıpırdadıysa) kayıt yazılmaz", () => {
    expect(recordBlocker(clean, { head: "d".repeat(40), tree: OTHER_TREE, dirty: "" })).toMatch(/HEAD/);
    // `--allow-empty` gibi: yeni commit, aynı ağaç — yine de kapı eski HEAD'i sınadı.
    expect(recordBlocker(clean, { ...clean, head: "d".repeat(40) })).toMatch(/HEAD/);
  });
});

describe("runQualityGate (geçici git deposunda, sahte adımlarla)", () => {
  let repo: string;

  function git(...args: string[]): string {
    const result = spawnSync(
      "git",
      ["-c", "user.email=quality-gate-test@example.invalid", "-c", "user.name=Quality Gate Test", ...args],
      { cwd: repo, encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} başarısız:\n${result.stderr}`);
    }
    return result.stdout.trim();
  }

  function nodeStep(id: string, code: string): QualityGateStep {
    return { id, cmd: process.execPath, args: ["-e", code] };
  }

  /** Çalıştığını `ran/<id>` dosyasıyla (gitignore'lu) iz bırakan adım. */
  function markerStep(id: string, exitCode = 0): QualityGateStep {
    const marker = JSON.stringify(path.join("ran", id.replace(":", "-")));
    return nodeStep(
      id,
      `require("fs").mkdirSync("ran",{recursive:true});require("fs").writeFileSync(${marker},"");process.exit(${exitCode});`,
    );
  }

  function expectedFor(steps: QualityGateStep[]) {
    return { tree: git("rev-parse", "HEAD^{tree}"), steps: qualityGateStepIds(steps), nodeVersion: process.version };
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "quality-gate-run-test-"));
    git("init", "-q");
    fs.writeFileSync(path.join(repo, ".gitignore"), "/.quality-gate/\n/ran/\n");
    fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
    git("add", "-A");
    git("commit", "-q", "-m", "ilk");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test("tüm adımlar geçerse ve ağaç temizse bu ağaç için geçerli kayıt yazılır", () => {
    const steps = [markerStep("typecheck"), markerStep("test:unit")];
    const outcome = runQualityGate({ root: repo, logPrefix: "[test]", steps });

    expect(outcome).toEqual({ ok: true, recordPath: recordPathFor(repo, expectedFor(steps).tree) });
    const check = readRecord(repo, expectedFor(steps));
    expect(check.valid).toBe(true);
    expect(check.valid && check.record.commit).toBe(git("rev-parse", "HEAD"));
    expect(fs.readdirSync(path.join(repo, "ran")).sort()).toEqual(["test-unit", "typecheck"]);
  });

  test("bir adım başarısız olursa sonraki adımlar çalışmaz ve kayıt yazılmaz", () => {
    const steps = [markerStep("typecheck"), markerStep("test:unit", 3), markerStep("test:integration")];
    const outcome = runQualityGate({ root: repo, logPrefix: "[test]", steps });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toMatch(/Kalite kapısı "test:unit" adımında başarısız oldu \(exit 3\)/);
    expect(fs.readdirSync(path.join(repo, "ran")).sort()).toEqual(["test-unit", "typecheck"]);
    expect(fs.existsSync(path.join(repo, QUALITY_GATE_DIR))).toBe(false);
  });

  test("son adım başarısız olsa da kayıt yazılmaz (yarım kapı kayıt üretmez)", () => {
    const steps = [markerStep("typecheck"), markerStep("test:integration", 1)];
    expect(runQualityGate({ root: repo, logPrefix: "[test]", steps }).ok).toBe(false);
    expect(fs.existsSync(path.join(repo, QUALITY_GATE_DIR))).toBe(false);
  });

  test("çalıştırılamayan adım başarısızlıktır ve kayıt yazılmaz", () => {
    const steps: QualityGateStep[] = [{ id: "lint", cmd: path.join(repo, "olmayan-komut"), args: [] }];
    const outcome = runQualityGate({ root: repo, logPrefix: "[test]", steps });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toMatch(/Kalite kapısı "lint" adımı çalıştırılamadı/);
    expect(fs.existsSync(path.join(repo, QUALITY_GATE_DIR))).toBe(false);
  });

  test("kirli ağaçta adımlar yine çalışır ama kayıt yazılmaz", () => {
    fs.writeFileSync(path.join(repo, "a.txt"), "değişti\n");
    const steps = [markerStep("typecheck")];
    const outcome = runQualityGate({ root: repo, logPrefix: "[test]", steps });

    expect(outcome).toEqual({ ok: true, noRecordReason: "çalışma ağacı kapı başlarken kirliydi" });
    expect(fs.existsSync(path.join(repo, "ran", "typecheck"))).toBe(true);
    expect(fs.existsSync(path.join(repo, QUALITY_GATE_DIR))).toBe(false);
  });

  test("kapı sırasında commit edilirse kayıt yazılmaz", () => {
    const steps = [
      nodeStep(
        "test:unit",
        'const {execFileSync}=require("child_process");' +
          'execFileSync("git",["-c","user.email=q@example.invalid","-c","user.name=Q","commit","-q","--allow-empty","-m","kapı sırasında"]);',
      ),
    ];
    const outcome = runQualityGate({ root: repo, logPrefix: "[test]", steps });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.noRecordReason).toMatch(/HEAD kapı sırasında değişti/);
    expect(fs.existsSync(path.join(repo, QUALITY_GATE_DIR))).toBe(false);
  });
});
