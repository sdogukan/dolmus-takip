/**
 * CI'nın yerel eşdeğeri — `npm run ci:local` (T6.1 ADIM 2/2, S6.1).
 *
 * Görev tanımı (birebir): "package.json `ci:local` script'i CI'nın
 * adımlarını aynı sırada yerelde koşturur (typecheck → lint → unit →
 * integration → e2e → release:build → release:verify); scripts/
 * ci-local.ts ile (her adımın çıkış kodunu raporlar, ilk hatada durur)."
 * (Ayrı bir "build" adımı BİLEREK YOKTUR — bkz. `ci-steps.json`
 * `$comment`, S6.1 düzeltme turu 1: `e2e` adımının kendi komutu zaten tam
 * bir `next build` çalıştırır; bağımsız bir "npm run build" adımının
 * çıktısını hiçbir şey tüketmiyordu.)
 *
 * ## TEK kaynak: `scripts/ci-steps.json`
 *
 * Bu script adım listesini KENDİ İÇİNDE tekrarlamaz; `scripts/
 * ci-steps.json`'ı okur ve orada tanımlı sırayla çalıştırır. Aynı dosya
 * `tests/unit/ci-workflows.test.ts` tarafından `.github/workflows/ci.yml`
 * içindeki `npm run …` adım sırasıyla karşılaştırılır — adım eklenir/
 * sırası değişirse TEK bu JSON güncellenir, bu script ve test otomatik
 * izler (görev tanımı: "ci.yml adım listesinin ci:local ile aynı sırada
 * olduğunu doğrula").
 *
 * ## Komutlar NEDEN `shell: true` ile çalıştırılır
 *
 * `release:verify -- dist/*.tar.gz` adımındaki `*.tar.gz` bir glob'dur;
 * `.github/workflows/ci.yml`'deki `run:` adımı bunu GitHub Actions'ın
 * varsayılan `bash` kabuğu üzerinden genişletir. Aynı davranışı burada da
 * (Node'un `spawnSync` doğrudan çağrısı glob GENİŞLETMEZ) elde etmek için
 * her adım `spawnSync(command, { shell: true, ... })` ile, ci-steps.json
 * içindeki komut METNİYLE birebir (CI'daki `run:` satırıyla AYNI metin)
 * çalıştırılır.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

interface CiStep {
  id: string;
  label: string;
  run: string;
}

interface CiStepsFile {
  steps: CiStep[];
}

function readSteps(): CiStep[] {
  const stepsPath = path.join(__dirname, "ci-steps.json");
  const parsed = JSON.parse(fs.readFileSync(stepsPath, "utf8")) as CiStepsFile;
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error(`"${stepsPath}" içinde geçerli bir "steps" listesi yok.`);
  }
  return parsed.steps;
}

interface StepResult {
  id: string;
  label: string;
  run: string;
  exitCode: number | null;
  durationMs: number;
}

function runStep(step: CiStep): StepResult {
  console.log(`\n[ci:local] ▶ ${step.id} — ${step.label}\n[ci:local]   $ ${step.run}`);
  const startedAt = Date.now();
  const result = spawnSync(step.run, {
    cwd: projectRoot,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  const durationMs = Date.now() - startedAt;
  const exitCode = result.status;
  if (result.error) {
    console.error(`[ci:local] ✗ ${step.id} çalıştırılamadı: ${result.error.message}`);
  }
  return { id: step.id, label: step.label, run: step.run, exitCode, durationMs };
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function printSummary(results: StepResult[]): void {
  console.log("\n[ci:local] ---- Özet ----");
  for (const result of results) {
    const status = result.exitCode === 0 ? "OK  " : `HATA(${result.exitCode})`;
    console.log(`[ci:local] ${status} ${result.id.padEnd(18)} ${formatDuration(result.durationMs)}`);
  }
}

function main(): void {
  const steps = readSteps();
  const results: StepResult[] = [];

  for (const step of steps) {
    const result = runStep(step);
    results.push(result);
    if (result.exitCode !== 0) {
      printSummary(results);
      console.error(
        `\n[ci:local] "${step.id}" adımı başarısız (exit ${result.exitCode}); ` +
          `sonraki ${steps.length - results.length} adım ÇALIŞTIRILMADI.`,
      );
      process.exitCode = result.exitCode ?? 1;
      return;
    }
  }

  printSummary(results);
  console.log("\n[ci:local] Tüm adımlar başarılı.");
}

main();
