import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * `.github/workflows/*.yml` metinsel doğrulaması — T6.1 ADIM 2/2, S6.1.
 *
 * Görev tanımı (birebir): "YAML doğrulama: tests/unit içinde
 * .github/workflows/*.yml'i ayrıştırıp (yaml paketi ekleme ... basit
 * yaklaşım: workflow dosyalarının varlığı, `on:`/`jobs:`/`timeout-
 * minutes:`/`secrets` içermeme gibi metinsel kontrolleri test et) ve
 * ci.yml adım listesinin ci:local ile aynı sırada olduğunu doğrula (tek
 * kaynak: scripts/ci-steps.json ve ci.yml o listeden üretilmez ama test
 * iki listeyi karşılaştırır)."
 *
 * Bilerek `yaml`/`js-yaml` paketi EKLENMEDİ (K9 sabit bağımlılık listesi
 * genişletilmez); bu dosya iş akışı dosyalarını tam bir YAML ayrıştırıcı
 * gibi DEĞİL, satır/regex tabanlı basit metin kontrolleriyle inceler.
 * Bu, GitHub Actions'ın kendi YAML doğrulamasının (gerçek koşu sırasında)
 * yerini TUTMAZ — yalnız "dosya var mı, temel alanlar/kısıtlar orada mı,
 * iki adım listesi aynı sırada mı" sorularını commit-zamanında yakalar.
 */

const projectRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);

function readWorkflow(name: string): string {
  const filePath = path.join(projectRoot, ".github", "workflows", name);
  expect(fs.existsSync(filePath), `"${filePath}" yok`).toBe(true);
  return fs.readFileSync(filePath, "utf8");
}

/** `on:` bloğunun metnini (bir sonraki üst düzey anahtara kadar) döndürür. */
function extractTriggerBlock(yaml: string): string {
  const lines = yaml.split("\n");
  const startIdx = lines.findIndex((line) => /^on:/.test(line));
  expect(startIdx, '"on:" anahtarı bulunamadı').toBeGreaterThanOrEqual(0);
  const rest = lines.slice(startIdx + 1);
  const endOffset = rest.findIndex((line) => /^\S/.test(line));
  const block = endOffset === -1 ? rest : rest.slice(0, endOffset);
  return block.join("\n");
}

/** Bütün `run: <komut>` satırlarını sırayla döndürür (çok satırlı `run: |`
 * blokları bu iki iş akışında hiç kullanılmaz — yalnız tek satırlık
 * `run:` adımları vardır). */
function extractRunCommands(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*run:\s*(.+)$/gm)].map((match) => match[1]!.trim());
}

interface CiStep {
  id: string;
  label: string;
  run: string;
}

function readCiSteps(): CiStep[] {
  const stepsPath = path.join(projectRoot, "scripts", "ci-steps.json");
  const parsed = JSON.parse(fs.readFileSync(stepsPath, "utf8")) as { steps: CiStep[] };
  return parsed.steps;
}

/** `needle` dizisinin `haystack` içinde AYNI SIRADA (ama arada başka
 * öğeler olabilir) bir alt dizi olarak geçtiğini doğrular. */
function assertSubsequence(haystack: string[], needle: string[], context: string): void {
  let cursor = 0;
  for (const item of needle) {
    const foundAt = haystack.indexOf(item, cursor);
    expect(
      foundAt,
      `${context}: "${item}" bekleniyordu (şu ana kadar sırayla bulunanlar: ` +
        `${JSON.stringify(haystack.slice(0, cursor))}); tüm komutlar: ${JSON.stringify(haystack)}`,
    ).toBeGreaterThanOrEqual(cursor);
    cursor = foundAt + 1;
  }
}

describe(".github/workflows dosyaları (T6.1 ADIM 2/2, S6.1)", () => {
  // GitHub, `runner` bağlamını yalnız adım düzeyinde kabul eder; workflow/iş
  // düzeyindeki `env:` içinde kullanılırsa dosyayı "workflow file issue" ile
  // reddeder ve koşu 0 saniyede başarısız olur (actionlint: context "runner"
  // is not allowed here). Adımlar $RUNNER_TEMP kabuk değişkenini kullanır.
  test.each(["ci.yml", "release.yml"])(
    "%s: `${{ runner.* }}` ifadesi kullanılmaz (iş düzeyi env'de GitHub reddeder)",
    (name) => {
      const yaml = readWorkflow(name);
      expect(yaml).not.toMatch(/\$\{\{\s*runner\./);
      expect(yaml).toContain('echo "DOLMUS_DB_PATH=$RUNNER_TEMP/dolmus-ci.sqlite" >> "$GITHUB_ENV"');
    },
  );

  test("ci.yml var; push (tüm dallar) + pull_request tetikler, branches filtresi yok", () => {
    const ci = readWorkflow("ci.yml");
    const trigger = extractTriggerBlock(ci);
    expect(trigger).toMatch(/^\s+push:\s*$/m);
    expect(trigger).toMatch(/^\s+pull_request:\s*$/m);
    expect(trigger).not.toMatch(/branches:/);
  });

  test("ci.yml: jobs/timeout-minutes/concurrency/runs-on tanımlı, secret KULLANILMAZ", () => {
    const ci = readWorkflow("ci.yml");
    expect(ci).toMatch(/^jobs:/m);
    expect(ci).toMatch(/timeout-minutes:\s*30/);
    expect(ci).toMatch(/runs-on:\s*ubuntu-24\.04/);
    expect(ci).toMatch(/concurrency:/);
    expect(ci).toMatch(/cancel-in-progress:\s*true/);
    // Görev tanımı: "HİÇBİR secret kullanılmaz." `secrets.` bağlam
    // erişimi (ör. `${{ secrets.X }}`) hiç geçmemeli.
    expect(ci).not.toMatch(/secrets\./);
  });

  test("ci.yml: en az yetki — açık `permissions: contents: read` tanımlı", () => {
    const ci = readWorkflow("ci.yml");
    // Denetim bulgusu (düzeltme turu 2, medium): GITHUB_TOKEN varsayılan
    // depo/organizasyon iznine düşmesin diye workflow düzeyinde açık ve
    // en az yetkili `permissions:` bloğu ZORUNLU.
    expect(ci).toMatch(/^permissions:\s*$/m);
    expect(ci).toMatch(/^\s*contents:\s*read\s*$/m);
    // `write` içeren HİÇBİR izin satırı olmamalı (en az yetki).
    expect(ci).not.toMatch(/:\s*write\s*$/m);
  });

  test("ci.yml: artifact saklama süreleri sınırlı (release 14 gün, Playwright raporu yalnız başarısızlıkta 7 gün)", () => {
    const ci = readWorkflow("ci.yml");
    expect(ci).toMatch(/retention-days:\s*14/);
    expect(ci).toMatch(/retention-days:\s*7/);
    expect(ci).toMatch(/if:\s*failure\(\)/);
    expect(ci).toMatch(/name:\s*release-\$\{\{\s*github\.sha\s*\}\}/);
  });

  test("ci.yml: doğrulama adımları scripts/ci-steps.json ile AYNI SIRADA (npm ci / playwright install araya girebilir)", () => {
    const ci = readWorkflow("ci.yml");
    const runCommands = extractRunCommands(ci);
    const expectedOrder = readCiSteps().map((step) => step.run);
    assertSubsequence(runCommands, expectedOrder, "ci.yml adım sırası");
  });

  test("release.yml var; YALNIZ workflow_dispatch tetikler (push/pull_request YOK), `ref` girdisi var", () => {
    const release = readWorkflow("release.yml");
    const trigger = extractTriggerBlock(release);
    expect(trigger).toMatch(/workflow_dispatch:/);
    expect(trigger).not.toMatch(/^\s+push:\s*$/m);
    expect(trigger).not.toMatch(/^\s+pull_request:\s*$/m);
    expect(release).toMatch(/ref:/);
  });

  test("release.yml: jobs/timeout-minutes/runs-on tanımlı, secret KULLANILMAZ, deploy/SSH adımı YOK", () => {
    const release = readWorkflow("release.yml");
    expect(release).toMatch(/^jobs:/m);
    expect(release).toMatch(/timeout-minutes:\s*30/);
    expect(release).toMatch(/runs-on:\s*ubuntu-24\.04/);
    expect(release).not.toMatch(/secrets\./);
    // Görev tanımı: "DEPLOY ADIMI YOK" — gerçek SSH/dağıtım eylemi
    // çalıştıran bir ADIM (bir `run:`/`uses:` satırı) bulunmamalı. Yorum
    // metnindeki "SSH ile ... manuel yapılır" ifadesi (görev tanımının
    // birebir istediği açıklama) BİLEREK hariç tutulur; yalnız gerçek
    // çalıştırılabilir adımlar taranır.
    for (const command of extractRunCommands(release)) {
      expect(command).not.toMatch(/\bssh\b/i);
    }
    expect(release).not.toMatch(/uses:\s*appleboy\//i);
    expect(release).toMatch(/DEPLOY ADIMI YOK/);
  });

  test("release.yml: artifact saklama süresi 30 gün", () => {
    const release = readWorkflow("release.yml");
    expect(release).toMatch(/retention-days:\s*30/);
  });

  test("release.yml: en az yetki — açık `permissions: contents: read` tanımlı", () => {
    const release = readWorkflow("release.yml");
    expect(release).toMatch(/^permissions:\s*$/m);
    expect(release).toMatch(/^\s*contents:\s*read\s*$/m);
    expect(release).not.toMatch(/:\s*write\s*$/m);
  });

  test("release.yml: doğrulama adımları scripts/ci-steps.json ile AYNI SIRADA", () => {
    const release = readWorkflow("release.yml");
    const runCommands = extractRunCommands(release);
    const expectedOrder = readCiSteps().map((step) => step.run);
    assertSubsequence(runCommands, expectedOrder, "release.yml adım sırası");
  });

  test("scripts/ci-local.ts adım listesini KENDİ İÇİNDE tekrarlamaz; scripts/ci-steps.json'ı okur (tek kaynak)", () => {
    const ciLocalPath = path.join(projectRoot, "scripts", "ci-local.ts");
    const ciLocal = fs.readFileSync(ciLocalPath, "utf8");
    expect(ciLocal).toMatch(/ci-steps\.json/);
  });

  test("README.md: Actions dakika/artifact kotası notu var (docs/TECH-STACK.md §9)", () => {
    const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");
    expect(readme).toMatch(/dakika/i);
    expect(readme).toMatch(/artifact/i);
    expect(readme).toMatch(/kota/i);
  });
});
