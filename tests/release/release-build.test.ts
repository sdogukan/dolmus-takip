import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  QUALITY_GATE_RECORD_VERSION,
  qualityGateStepIds,
  readRecord,
  recordPathFor,
  writeRecord,
  type ExpectedRecord,
} from "../../scripts/lib/quality-gate.ts";
import { compareVersions, MINIMUM_SQLITE_VERSION } from "../../src/server/data/db";

/**
 * Yayın çıktısı boru hattı entegrasyon testi — T6.1 ADIM 1/2, S6.1.
 *
 * Görev tanımı (birebir): "Entegrasyon testi tests/integration/
 * release-build.test.ts: geçici `git clone` (yerel repodan) içinde
 * release:build → arşiv + manifest üretilir, release:verify geçer;
 * kirli ağaçta (klonda bir dosyaya dokunup) release:build reddedilir;
 * manifest alanları dolu ve sqlite_version ≥ 3.51.3. Bu test uzun
 * sürebilir; vitest testTimeout'u bu dosya için açıkça artır (skip YOK)."
 *
 * ## Bu dosya NEDEN `tests/integration/` altında değil (2026-09-24)
 *
 * İki test birer tam `release:build` koşar. Rutin `test:integration`
 * içindeyken bu dosya tek başına ~20 dk sürüyor ve entegrasyon paketini
 * fiilen üç kez koşturuyordu. Artık ayrı `release` Vitest projesindedir:
 * `npm run test:release`. CI onu `quality-gate` adımından sonra ayrı adım
 * olarak koşar (`scripts/ci-steps.json`); hiçbir test atlanmaz.
 *
 * ## Klon NEDEN hazır bir kapı kaydıyla (fixture) başlar (2026-09-25)
 *
 * `release:build`, klonun `HEAD^{tree}`'si için geçerli bir `.quality-gate`
 * kaydı bulursa kapıyı yeniden çalıştırmaz (bkz. `scripts/release-build.ts`
 * üst notu). Bu dosya `release:build`/`release:verify` boru hattını test
 * eder, kalite kapısının kendisini DEĞİL: kapının adımları ve kayıt kuralları
 * `tests/unit/quality-gate.test.ts`'te, kayıt olmayan ağaçta tam kapı Test
 * 4'te sınanır. Bu yüzden `beforeAll` klonda kapıyı koşmaz ve proje kökündeki
 * kayda bakmaz; klonun KENDİ ağacı için `writeRecord` ile bir kayıt yazar
 * (alanlar `scripts/lib/quality-gate.ts`'ten). Kayıt yalnız bu tek
 * kullanımlık klonda durur (`/.quality-gate/` gitignore'lu, klon ağacı temiz
 * kalır) ve `afterAll` ile silinir; gerçek projenin `release:build`'ini
 * etkilemez. Kurulum kök kayıttan ve konteynerin çalışma ağacı
 * ayrıntılarından bağımsızdır; her ortamda aynı yolu izler. Sonuç:
 * - Test 1 kaydı kullanır ve kapının atlandığını söyleyen satırı doğrular.
 * - Test 3'ün ikinci commit'i `--allow-empty`'dir: farklı commit (farklı
 *   arşiv adı ve `source_commit`), aynı ağaç, aynı kayıt.
 * - Test 4'ün başarısız birim testi commit'i ağacı değiştirir; o ağaç için
 *   kayıt YOKTUR, kapı tam çalışır, `test:unit`'te durur ve kayıt yazmaz.
 *
 * ## Bu test NEDEN gerçek proje deposunu (`.git`) DEĞİL, kendi ürettiği
 * bir "kaynak depo"yu klonluyor (varsayım DEĞİL, kanıtlı zorunluluk)
 *
 * Görev tanımı "yerel repodan git clone" ister; ama gerçek proje deposunun
 * (`/…/dolmus-takip/.git`) O ANKİ `HEAD`'i, bu paketin kendi kod
 * değişiklikleriyle (bu test dosyası DAHİL) henüz COMMIT EDİLMEMİŞ
 * olabilir — CLAUDE.md ve görev kuralları bu oturumda GİT COMMIT
 * YAPILMASINI YASAKLAR. Gerçek `.git`'i doğrudan klonlamak o durumda test
 * ettiği KODUN KENDİSİNİ DEĞİL, bir ÖNCEKİ commit'in halini test eder —
 * bu, "release:build ÇALIŞMA AĞACINDAKİ gerçek kodu paketler" iddiasını
 * SESSİZCE YANLIŞ doğrulamış olur (tam da CLAUDE.md'nin yasakladığı
 * türden bir varsayım/kısayol).
 *
 * Bunun yerine test, ÇALIŞMA AĞACININ O ANKİ tam içeriğini (node_modules/
 * .git/.next/dist/data/*.sqlite* HARİÇ — `fs.cpSync` + `filter`) YENİ, tek
 * kullanımlık bir dizine kopyalar, orada YENİ bir `git init` + tek commit
 * yapar (bu, GERÇEK proje deposuna HİÇBİR şekilde dokunmaz — ayrı `.git`,
 * ayrı geçici dizin) ve GERÇEK bir `git clone` bu geçici depodan yapılır.
 * Bu, mevcut entegrasyon testlerinin "gerçek geçici SQLite dosyası"
 * ilkesiyle AYNI desendir (QA-PLAN.md §1) — mock/taklit YOK, yalnız test
 * fixture'ı GERÇEK bir git deposu ve GERÇEK bir `git clone`dur; kirli ağaç
 * senaryosu da bu klonun KENDİ İÇİNDE bir dosyaya dokunularak üretilir
 * (görev tanımı: "klonda bir dosyaya dokunup").
 *
 * `node_modules` (580 MB) her koşuda `npm ci` ile YENİDEN kurmak yerine
 * gerçek projeden kopyalanır (macOS/APFS'te `cp -R` neredeyse anlık —
 * clonefile; ağ ERİŞİMİ gerektirmez, sandbox'ta güvenilir). Aynı commit/
 * lockfile'dan geldiği için `package-lock.json` ile İÇERİK olarak
 * TUTARLIDIR; bu, hangi bağımlılıkların paketlendiğini SAHTELEŞTİRMEZ —
 * yalnız kurulum YÖNTEMİNİ hızlandırır (bkz. CLAUDE.md "pragmatik kısayol
 * önerme" kısıtı: burada test SONUCUNU etkileyen hiçbir davranış
 * DEĞİŞMİYOR, yalnız `npm ci`'nin ağ/zaman maliyeti atlanıyor).
 */

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// Görev tanımı: "Bu test uzun sürebilir; vitest testTimeout'u bu dosya
// için açıkça artır." Ölçüm (2026-09-25, DIJJI çalışma konteyneri, 4 CPU,
// Node v24.21.0):
// - `beforeAll` adımları ayrı ayrı zamanlandı (3 koşu, `test:release`
//   koşulmadan): kopya 0,07 s, `git init/add/commit` 0,22 s, `git clone`
//   0,11 s, `node_modules` kopyası (711 MB) 1,7 s, kayıt yazma + okuma
//   0,04 s; toplam ~2,2 s. SETUP_TIMEOUT_MS 2 dk: süreyi belirleyen
//   `node_modules` kopyası, disk önbelleği soğuk daha yavaş bir runner'da
//   katlarca uzayabilir; kapı artık `beforeAll`'da koşmadığı için 20 dk'lık
//   eski sınıra gerek yok.
// - Testler (görev ölçümü): Test 1 57,7 s, Test 2 1,7 s, Test 3 58,9 s,
//   Test 4 42,5 s. Test 4 kayıtsız ağaçta kapıyı tam koşar (typecheck, lint,
//   `test:unit`'te durur). BUILD_TEST_TIMEOUT_MS 5 dk: en uzun testin
//   (58,9 s) ~5 katı; daha yavaş bir runner için pay.
// CI iş bütçesine (`timeout-minutes: 30`) sığdığı ubuntu-24.04 runner'ında
// ölçülmedi; buradaki süreler yalnız bu konteynere aittir.
const SETUP_TIMEOUT_MS = 2 * 60 * 1000;
const BUILD_TEST_TIMEOUT_MS = 5 * 60 * 1000;
const SHA256_HEX = /^[0-9a-f]{64}$/;

let workDir: string;
let sourceRepoDir: string;
let cloneDir: string;
let cloneTree: string;

const GATE_STEP_LINES = qualityGateStepIds().map((id) => `$ npm run ${id}`);
const GATE_SKIP_LINE = "[release:build] Kalite kapısı yeniden çalıştırılmıyor";

function runOrThrow(
  cmd: string,
  args: string[],
  cwd: string,
  label: string,
): { stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `[release-build.test setup] ${label} başarısız (exit ${result.status}):\n` +
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

beforeAll(() => {
  workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dolmus-release-build-test-"),
  );
  sourceRepoDir = path.join(workDir, "source-repo");
  cloneDir = path.join(workDir, "clone-repo");
  fs.mkdirSync(sourceRepoDir, { recursive: true });

  // 1) Çalışma ağacının GERÇEK/o anki içeriğini geçici "kaynak depo"ya
  // kopyala (dosya üstü not — `.git` HARİÇ, jenerik/gizli/büyük içerik de
  // HARİÇ). `/data` ve `/dist` yalnız KÖKTE hariç tutulur (`src/server/
  // data/**` gibi iç içe, meşru kaynak kod dizinlerini YANLIŞ-POZİTİF
  // dışlamamak için — bkz. `../../scripts/lib/release-shared.ts`'teki
  // AYNI kök-göreli ayrım). Bu konteynerde `rsync` kurulu değil; Node'un
  // yerleşik `fs.cpSync` + `filter` ile AYNI dışlama kümesi (`--exclude`
  // ile birebir) uygulanır, sembolik bağlar hedefe olduğu gibi kopyalanır
  // (`verbatimSymlinks: true` — dereference EDİLMEZ).
  fs.cpSync(projectRoot, sourceRepoDir, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => {
      const relPath = path.relative(projectRoot, src);
      if (relPath === "") {
        return true; // Kaynak kökün kendisi her zaman kabul edilir.
      }
      const baseName = path.basename(relPath);
      if (baseName === ".git") return false;
      if (baseName === "node_modules") return false;
      if (baseName === ".next") return false;
      if (relPath === "dist") return false; // `--exclude=/dist` — yalnız kökte.
      if (baseName === "test-results") return false;
      if (baseName === "playwright-report") return false;
      if (baseName === "coverage") return false;
      if (relPath === "data") return false; // `--exclude=/data` — yalnız kökte.
      if (baseName.includes(".sqlite")) return false; // `--exclude=*.sqlite*`.
      if (baseName === ".env") return false;
      return true;
    },
  });

  // 2) Bu geçici dizinde YENİ, GERÇEK proje deposundan TAMAMEN BAĞIMSIZ
  // bir git deposu kur (dosya üstü not — gerçek `.git`'e HİÇ dokunulmaz).
  runOrThrow("git", ["init", "-q"], sourceRepoDir, "git init (geçici kaynak depo)");
  runOrThrow("git", ["add", "-A"], sourceRepoDir, "git add (geçici kaynak depo)");
  runOrThrow(
    "git",
    [
      "-c",
      "user.email=release-build-test@example.invalid",
      "-c",
      "user.name=Release Build Test",
      "commit",
      "-q",
      "-m",
      "release-build.test.ts geçici anlık görüntü",
    ],
    sourceRepoDir,
    "git commit (geçici kaynak depo)",
  );

  // 3) Görev tanımının istediği GERÇEK, yerel `git clone`.
  runOrThrow(
    "git",
    ["clone", "-q", sourceRepoDir, cloneDir],
    workDir,
    "git clone",
  );

  // 4) Bağımlılıkları GERÇEK projeden kopyala (dosya üstü not — `npm ci`
  // YERİNE; aynı lockfile/commit, ağ gerektirmez).
  runOrThrow(
    "cp",
    ["-R", path.join(projectRoot, "node_modules"), path.join(cloneDir, "node_modules")],
    workDir,
    "node_modules kopyalama",
  );

  // 5) Klonun KENDİ ağacı için kalite kapısı kaydı (dosya üstü not) — yalnız
  // klona yazılır. Doğrulama, `release:build` ile AYNI değerlerle (şimdiki
  // tree, adım listesi, Node).
  const expected: ExpectedRecord = {
    tree: runOrThrow("git", ["rev-parse", "HEAD^{tree}"], cloneDir, "git rev-parse (klon ağacı)").stdout.trim(),
    steps: qualityGateStepIds(),
    nodeVersion: process.version,
  };
  writeRecord(cloneDir, {
    version: QUALITY_GATE_RECORD_VERSION,
    tree: expected.tree,
    commit: runOrThrow("git", ["rev-parse", "HEAD"], cloneDir, "git rev-parse (klon HEAD)").stdout.trim(),
    node_version: process.version,
    steps: qualityGateStepIds(),
    passed_at: new Date().toISOString(),
  });
  const cloneCheck = readRecord(cloneDir, expected);
  if (!cloneCheck.valid) {
    throw new Error(`[release-build.test setup] klonda geçerli kalite kapısı kaydı yok: ${cloneCheck.reason}`);
  }
  cloneTree = expected.tree;
}, SETUP_TIMEOUT_MS);

afterAll(() => {
  if (workDir) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}, 120_000);

describe("release:build / release:verify boru hattı (T6.1, S6.1)", () => {
  test(
    "temiz ağaçta release:build arşiv+manifest üretir; release:verify geçer; manifest alanları dolu ve sqlite_version >= 3.51.3",
    () => {
      const build = spawnSync("npm", ["run", "release:build"], {
        cwd: cloneDir,
        encoding: "utf8",
      });
      expect(
        build.status,
        `release:build başarısız olmamalı:\n${build.stdout}\n${build.stderr}`,
      ).toBe(0);

      // --- Klonun ağacı için geçerli kayıt var: kapı yeniden çalışmaz. ---
      expect(build.stdout).toContain(GATE_SKIP_LINE);
      for (const line of GATE_STEP_LINES) {
        expect(build.stdout).not.toContain(line);
      }

      const distDir = path.join(cloneDir, "dist");
      const distFiles = fs.readdirSync(distDir);
      const archiveName = distFiles.find((f) => f.endsWith(".tar.gz"));
      const manifestName = distFiles.find((f) => f.endsWith(".manifest.json"));
      expect(archiveName, `dist içeriği: ${distFiles.join(", ")}`).toBeDefined();
      expect(manifestName, `dist içeriği: ${distFiles.join(", ")}`).toBeDefined();

      // Görev tanımı: "dist/dolmus-takip-<kisa-sha>-<platform>-<arch>.tar.gz"
      expect(archiveName).toMatch(
        /^dolmus-takip-[0-9a-f]{7,}-\w+-\w+\.tar\.gz$/,
      );

      const archivePath = path.join(distDir, archiveName!);
      const manifestPath = path.join(distDir, manifestName!);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        name: string;
        source_commit: string;
        source_ref: string;
        lockfile_sha256: string;
        node_version: string;
        next_version: string;
        platform: string;
        arch: string;
        sqlite_version: string;
        schema: {
          last_migration_idx: number;
          migration_sha256_list: { idx: number; file: string; sha256: string }[];
        };
        built_at: string;
        artifact_sha256: string;
        artifact_size_bytes: number;
      };

      // --- Manifest alanları "dolu" (S6.1 AC4) ---
      expect(manifest.name).toBe("dolmus-takip");
      expect(manifest.source_commit).toMatch(/^[0-9a-f]{40}$/);
      expect(manifest.source_ref.length).toBeGreaterThan(0);
      expect(manifest.lockfile_sha256).toMatch(SHA256_HEX);
      expect(manifest.node_version).toMatch(/^v\d+\.\d+\.\d+/);
      expect(manifest.next_version.length).toBeGreaterThan(0);
      expect(manifest.platform).toBe(process.platform);
      expect(manifest.arch).toBe(process.arch);
      expect(manifest.built_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );

      // --- ARCHITECTURE.md §3.6 sürüm kapısı: >= 3.51.3, yalnız npm paket
      // numarası DEĞİL, GERÇEK `SELECT sqlite_version()` sonucu ---
      expect(
        compareVersions(manifest.sqlite_version, MINIMUM_SQLITE_VERSION),
      ).toBeGreaterThanOrEqual(0);

      // --- Şema uyumluluğu: migration journal ile birebir ---
      const journal = JSON.parse(
        fs.readFileSync(path.join(projectRoot, "drizzle", "meta", "_journal.json"), "utf8"),
      ) as { entries: { idx: number }[] };
      expect(manifest.schema.last_migration_idx).toBe(journal.entries.at(-1)!.idx);
      expect(manifest.schema.migration_sha256_list).toHaveLength(journal.entries.length);
      for (const entry of manifest.schema.migration_sha256_list) {
        expect(entry.sha256).toMatch(SHA256_HEX);
      }

      // --- Bütünlük: manifest.artifact_sha256/size arşivin GERÇEK
      // baytlarıyla eşleşir (AC4 "bütünlük kontrolü") ---
      const artifactBuffer = fs.readFileSync(archivePath);
      const actualSha256 = crypto
        .createHash("sha256")
        .update(artifactBuffer)
        .digest("hex");
      expect(manifest.artifact_sha256).toBe(actualSha256);
      expect(manifest.artifact_size_bytes).toBe(artifactBuffer.length);

      // --- release:verify aynı arşivi temiz ortamda açıp health/live 200
      // alarak doğrular (AC5) ---
      const verify = spawnSync(
        "npm",
        ["run", "release:verify", "--", path.join("dist", archiveName!)],
        { cwd: cloneDir, encoding: "utf8" },
      );
      expect(
        verify.status,
        `release:verify başarısız olmamalı:\n${verify.stdout}\n${verify.stderr}`,
      ).toBe(0);
      expect(verify.stdout).toMatch(/health\/live.*200/);
      expect(verify.stdout).toContain("db-backup run/status çalıştı");
      expect(verify.stdout).toContain("Doğrulama BAŞARILI");
    },
    BUILD_TEST_TIMEOUT_MS,
  );

  test(
    "kirli ağaçta (klonda bir dosyaya dokunulmuş) release:build reddedilir; --allow-dirty bayrağı yok",
    () => {
      const touchedFile = path.join(cloneDir, "README.md");
      const original = fs.readFileSync(touchedFile, "utf8");
      try {
        fs.writeFileSync(
          touchedFile,
          `${original}\n<!-- release-build.test.ts kirli ağaç senaryosu -->\n`,
        );

        const build = spawnSync("npm", ["run", "release:build"], {
          cwd: cloneDir,
          encoding: "utf8",
        });
        expect(build.status).toBe(1);
        expect(build.stdout + build.stderr).toMatch(/kirli/i);

        // Görev tanımı: "testte --allow-dirty bayrağı YOK" — script bu
        // bayrağı hiç OKUMAZ; geçilse de kirli ağaç reddi AYNI şekilde
        // sürer (sessizce yok sayılıp geçilmediğini kanıtlar).
        const buildWithFlag = spawnSync(
          "npm",
          ["run", "release:build", "--", "--allow-dirty"],
          { cwd: cloneDir, encoding: "utf8" },
        );
        expect(buildWithFlag.status).toBe(1);
        expect(buildWithFlag.stdout + buildWithFlag.stderr).toMatch(/kirli/i);
      } finally {
        fs.writeFileSync(touchedFile, original);
      }
    },
    BUILD_TEST_TIMEOUT_MS,
  );

  test(
    "release:build ESKİ dist/ arşiv+manifest çiftini temizler; ci:local'ın art arda iki koşusunda release:verify BAYAT arşivi doğrulayamaz (S6.1 düzeltme turu 1, YÜKSEK önem)",
    () => {
      const distDir = path.join(cloneDir, "dist");
      const firstRunFiles = fs.readdirSync(distDir);
      const firstArchiveName = firstRunFiles.find((f) => f.endsWith(".tar.gz"));
      expect(firstArchiveName, `dist içeriği: ${firstRunFiles.join(", ")}`).toBeDefined();
      const firstManifest = JSON.parse(
        fs.readFileSync(
          path.join(distDir, firstRunFiles.find((f) => f.endsWith(".manifest.json"))!),
          "utf8",
        ),
      ) as { source_commit: string };

      // Yeni bir commit üret (görev tanımının "art arda iki farklı
      // commit'te ci:local koşusu" senaryosu). `--allow-empty`: farklı
      // commit SHA'sı (arşiv adı ve source_commit değişir), aynı ağaç —
      // kapı kaydı bu commit için de geçerlidir (dosya üstü not).
      runOrThrow(
        "git",
        [
          "-c",
          "user.email=release-build-test@example.invalid",
          "-c",
          "user.name=Release Build Test",
          "commit",
          "-q",
          "--allow-empty",
          "-m",
          "release-build.test.ts ikinci anlık görüntü",
        ],
        cloneDir,
        "git commit (ikinci commit)",
      );

      const secondBuild = spawnSync("npm", ["run", "release:build"], {
        cwd: cloneDir,
        encoding: "utf8",
      });
      expect(
        secondBuild.status,
        `ikinci release:build başarısız olmamalı:\n${secondBuild.stdout}\n${secondBuild.stderr}`,
      ).toBe(0);
      expect(secondBuild.stdout).toContain(GATE_SKIP_LINE);

      // --- Kök neden düzeltmesi: dist/ artık YALNIZ bu (ikinci) çalıştırmanın
      // arşiv+manifest çiftini içerir; İLK çalıştırmanın BAYAT dosyaları
      // SİLİNMİŞ olmalı (aksi halde "dist/*.tar.gz" glob'u iki eşleşme
      // üretir ve release:verify hangisini doğrulayacağını KENDİLİĞİNDEN
      // seçmek zorunda kalırdı). ---
      const secondRunFiles = fs.readdirSync(distDir);
      const archives = secondRunFiles.filter((f) => f.endsWith(".tar.gz"));
      const manifests = secondRunFiles.filter((f) => f.endsWith(".manifest.json"));
      expect(archives, `dist içeriği: ${secondRunFiles.join(", ")}`).toHaveLength(1);
      expect(manifests, `dist içeriği: ${secondRunFiles.join(", ")}`).toHaveLength(1);
      expect(archives[0]).not.toBe(firstArchiveName);

      const secondManifest = JSON.parse(
        fs.readFileSync(path.join(distDir, manifests[0]!), "utf8"),
      ) as { source_commit: string };
      expect(secondManifest.source_commit).not.toBe(firstManifest.source_commit);

      // --- İkinci savunma katmanı: "dist/*.tar.gz" glob'u (kabuk
      // tarafından) genişletilerek release:verify'a verilse bile (artık
      // TEK dosyaya genişlediği için) doğru/GÜNCEL arşivi doğrular. ---
      const verify = spawnSync(
        "npm",
        ["run", "release:verify", "--", path.join("dist", archives[0]!)],
        { cwd: cloneDir, encoding: "utf8" },
      );
      expect(
        verify.status,
        `release:verify başarısız olmamalı:\n${verify.stdout}\n${verify.stderr}`,
      ).toBe(0);
      expect(verify.stdout).toContain(`source_commit=${secondManifest.source_commit}`);
    },
    BUILD_TEST_TIMEOUT_MS,
  );

  test(
    "S6.1 AC3 / düzeltme turu 3 (blocker): TEMİZ ağaçta ama başarısız bir birim testiyle commit edilmiş sürümde release:build ARŞİV ÜRETMEDEN reddedilir",
    () => {
      // Denetim bulgusu birebir tekrarı: bağımsız bir klonda kasıtlı
      // BAŞARISIZ bir birim testi commit edilir (ağaç TEMİZ — dirty-tree
      // kapısı bu senaryoyu YAKALAMAZ, kanıtlamak istediğimiz TAM OLARAK
      // bu). Önceki (düzeltme turu 2) davranışta `release:build` yalnız
      // `git status --porcelain` + `next build` yapıyordu; `test:unit`
      // hiç çağrılmadığı için exit 0 ile arşiv üretiyordu.
      const failingTestPath = path.join(
        cloneDir,
        "tests",
        "unit",
        "__release-build-quality-gate-deliberate-failure.test.ts",
      );
      fs.writeFileSync(
        failingTestPath,
        [
          'import { expect, test } from "vitest";',
          "",
          "// KASITLI BAŞARISIZ TEST — yalnız bu geçici klonda var; gerçek",
          "// depoya HİÇ commit edilmez. release-build.test.ts'in kalite",
          "// kapısı senaryosunu üretmek için buraya yazılmıştır.",
          'test("KASITLI BAŞARISIZ (release:build kalite kapısı denemesi)", () => {',
          "  expect(1).toBe(2);",
          "});",
          "",
        ].join("\n"),
      );
      runOrThrow("git", ["add", "-A"], cloneDir, "git add (kasıtlı başarısız test)");
      runOrThrow(
        "git",
        [
          "-c",
          "user.email=release-build-test@example.invalid",
          "-c",
          "user.name=Release Build Test",
          "commit",
          "-q",
          "-m",
          "release-build.test.ts kasıtlı başarısız birim testi (TEMİZ ağaç)",
        ],
        cloneDir,
        "git commit (kasıtlı başarısız test)",
      );

      const failingTree = runOrThrow("git", ["rev-parse", "HEAD^{tree}"], cloneDir, "git rev-parse (başarısız test ağacı)")
        .stdout.trim();
      expect(failingTree).not.toBe(cloneTree);
      const failingRecordPath = recordPathFor(cloneDir, failingTree);
      expect(fs.existsSync(failingRecordPath)).toBe(false);

      const distDir = path.join(cloneDir, "dist");
      const distFilesBefore = fs.readdirSync(distDir).sort();

      const build = spawnSync("npm", ["run", "release:build"], {
        cwd: cloneDir,
        encoding: "utf8",
      });

      // --- Ana iddia: ağaç TEMİZ olsa bile (yalnız kirli-ağaç kapısı
      // yetmez), başarısız test release:build'i DURDURUR. ---
      expect(
        build.status,
        `release:build BAŞARISIZ testle exit 0 vermemeli:\n${build.stdout}\n${build.stderr}`,
      ).toBe(1);
      expect(build.stdout + build.stderr).toMatch(/[Kk]alite kapısı/);
      expect(build.stdout + build.stderr).toMatch(/test:unit/);
      // Bu ağaç için kayıt yoktu: kapı tam çalıştı ve başarısız kapı kayıt yazmadı.
      expect(build.stdout).not.toContain(GATE_SKIP_LINE);
      expect(fs.existsSync(failingRecordPath)).toBe(false);

      // --- Yarım/eski bir arşiv "başarılı" gibi bırakılmaz: dist/
      // İÇERİĞİ bu başarısız denemeyle DEĞİŞMEMİŞ olmalı (önceki testin
      // sağlam çift+manifesti hâlâ orada durur; kalite kapısı
      // `cleanStaleDistArtifacts()`'TEN ÖNCE çalışır). ---
      const distFilesAfter = fs.readdirSync(distDir).sort();
      expect(distFilesAfter).toEqual(distFilesBefore);
    },
    BUILD_TEST_TIMEOUT_MS,
  );
});
