/**
 * Kalite kapısı — `npm run quality-gate` (S6.1 AC3, 2026-09-25).
 *
 * typecheck → lint → test:unit → test:integration'ı `./lib/quality-gate.ts`
 * üzerinden sırayla çalıştırır; çıkış kodu kapının sonucudur. CI
 * (`ci-steps.json`, `ci.yml`, `release.yml`) ve `ci:local` bu dört adımı
 * ayrı ayrı değil bu tek komutla koşar.
 *
 * Tüm adımlar geçerse ve çalışma ağacı kapı başlarken ve bittiğinde temiz,
 * HEAD de aynıysa `.quality-gate/<tree>.json` kaydı yazılır; aynı içerik
 * için `release:build` kapıyı yeniden çalıştırmaz. Kirli ağaçta adımlar yine
 * de koşar, yalnız kayıt yazılmaz (kapı sırasında düzenlenen ya da commit
 * edilen içerik test edilmemiş sayılır).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runQualityGate } from "./lib/quality-gate.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const outcome = runQualityGate({ root: projectRoot, logPrefix: "[quality-gate]" });
  if (!outcome.ok) {
    console.error(`[quality-gate] Başarısız: ${outcome.message}`);
    process.exitCode = 1;
  } else if (outcome.recordPath !== undefined) {
    console.log(`[quality-gate] Kayıt yazıldı: ${path.relative(projectRoot, outcome.recordPath)}`);
  } else {
    console.log(`[quality-gate] Kayıt yazılmadı: ${outcome.noRecordReason}.`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[quality-gate] Başarısız: ${message}`);
  process.exitCode = 1;
}
