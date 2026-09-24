/**
 * Yayın çıktısı ve manifest — `npm run release:build` (T6.1 ADIM 1/2, S6.1).
 *
 * Kaynaklar (birebir): ARCHITECTURE.md §3.6 "Sürüm kapısı" — "Kullanılan
 * better-sqlite3 içindeki gerçek SQLite sürümü SELECT sqlite_version() ile
 * kayıt altına alınır ... Yalnız npm paket sürümüne bakmak yeterli
 * değildir." ARCHITECTURE.md §8.4 — "GitHub Actions, hedef Ubuntu/Linux CPU
 * mimarisi ve Node sürümüyle uyumlu üretim çıktısını hazırlar ... Tam paket
 * sürümleri lockfile'da sabitlenir." DECISIONS.md F4 — `output: "standalone"`
 * + `outputFileTracingIncludes` (better-sqlite3, argon2, artık drizzle-orm —
 * bkz. `../next.config.ts` üst notu). STORIES.md S6.1 AC4 — "Daha sonra
 * farklı içerikle aynı sürüm gibi değiştirilmez."
 *
 * ## Bu script NEDEN çalışma ağacını kirliyse HEMEN durur (AC4, `--allow-
 * dirty` bayrağı YOK)
 *
 * Manifest'in `source_commit` alanı "bu arşiv TAM OLARAK şu commit'in
 * içeriğidir" iddiasıdır. Çalışma ağacı kirliyken (commit edilmemiş
 * değişiklik varken) üretilen bir arşiv bu iddiayı YALANLAR: aynı commit
 * SHA'sıyla farklı gerçek içerik üretilebilir. Bu yüzden `git status
 * --porcelain` boş DEĞİLSE script açıkça `exit 1` ile durur; devre dışı
 * bırakma bayrağı BİLEREK sunulmaz (görev tanımı, testte de yok).
 *
 * ## Arşivin İÇERİĞİ (ve NEDEN `scripts/db-init.ts` yalnız başına
 * YETMEZ)
 *
 * `next build`'in `output: "standalone"` çıktısı (`.next/standalone`)
 * yalnız Next'in KENDİ route/middleware ağacının GERÇEKTEN import ettiği
 * dosyaları taşır. `scripts/db-init.ts` hiçbir Next route'u tarafından
 * import EDİLMEZ (yalnız bu script'in kendisi + hedef makinede elle
 * çalıştırılır) — bu yüzden onun `../src/server/data/db.ts` +
 * `./schema.ts` bağımlılıkları standalone'un TARANMIŞ ağacında hiç
 * bulunmaz; bu script onları AYRICA, standalone'un KENDİ `node_modules`
 * kökünün (better-sqlite3, drizzle-orm — ARTIK next.config.ts'te
 * `outputFileTracingIncludes` ile eklendi) yanına, AYNI göreli iç içelikte
 * (`scripts/db-init.ts`'in kendi `../drizzle`, `../src/server/data/db.ts`
 * göreli import'larıyla EŞLEŞECEK şekilde) kopyalar — gerçek bir `node
 * .next/standalone/scripts/db-init.ts` denemesiyle KANITLANDI (bkz. bu
 * paketin geliştirme notları).
 *
 * Next'in KENDİ ürettiği `.next/standalone/package.json` (trimlenmiş,
 * yalnız ad/sürüm/scripts/dependencies) STORIES.md S6.1 AC4'ün istediği
 * "package.json sürüm bilgisi"ni zaten karşılar; ayrıca kopyalanmaz.
 *
 * ## Kalite kapısı NEDEN bu script'in KENDİSİNDE var (S6.1 düzeltme turu
 * 3, blocker — yalnız `ci.yml`/`ci-steps.json` adım SIRASINA güvenmek
 * yetmez)
 *
 * STORIES.md S6.1 AC3 birebir: "Derleme, tip kontrolü ve o sürüme kadar
 * eklenmiş iş kuralı/yetki/veri testleri geçmeden yayınlanabilir çıktı
 * üretilmez." Bu koşul yalnız "CI'da adımlar bu sırada tanımlı" anlamına
 * gelmez — script KENDİSİ doğrudan (`npm run release:build`, README'nin
 * de belgelediği gibi "yerelde de çalıştırılabilir") çağrıldığında da
 * geçerlidir. Denetimde KANITLANDI: kasıtlı başarısız bir birim testi
 * COMMIT edilmiş (ağaç TEMİZ) bir klonda, `npm run typecheck`/`lint`/
 * `test:unit`/`test:integration` HİÇ çağrılmadan `next build` (yalnız
 * derleme+tip kontrolü) tek başına geçtiği için `release:build` exit 0
 * ile başarılı arşiv+manifest üretiyordu; ardından `release:verify` de
 * (yalnız hash/health kontrolü yaptığından) BAŞARILI dönüyordu — yani
 * testleri geçmemiş bir commit'ten "sağlıklı görünen" dağıtılabilir bir
 * çıktı elde edilebiliyordu. Bu yüzden `runQualityGate()` (aşağıda),
 * `assertCleanWorkingTree()`'den HEMEN sonra, standalone derlemesinden
 * ÖNCE, typecheck/lint/test:unit/test:integration'ı bu script'in KENDİSİ
 * çalıştırır ve herhangi biri başarısız olursa `buildStandalone()`'a HİÇ
 * girmeden `exit 1` ile durur — script'i çağıran şeyin (CI, ci:local,
 * elle) TÜRÜNE bakılmaksızın.
 *
 * Kalite kapısı `npm run test:integration`'ı OLDUĞU GİBİ çağırır. Bu
 * script'in kendi uçtan uca meta-testi (`tests/release/release-build.test.ts`,
 * geçici bir klonda `npm run release:build` çağırır) ayrı `release` Vitest
 * projesindedir (`npm run test:release`) ve `test:integration`'a dahil
 * DEĞİLDİR. Dahil olsaydı kapı, klondaki iç içe `release:build` üzerinden
 * kendini sonsuz derinlikte çağırırdı. Önceden bu, dosyayı `--exclude` ile
 * dışlayarak önleniyordu; dosya ayrı projeye taşınınca dışlamaya gerek
 * kalmadı. Meta-test CI'da (`scripts/ci-steps.json`) ayrı adım olarak
 * koşar.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  MINIMUM_SQLITE_VERSION,
} from "../src/server/data/db.ts";
import { assertNoSecretOrDataFiles, manifestPathFor, sha256Buffer, sha256File } from "./lib/release-shared.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const standaloneDir = path.join(projectRoot, ".next", "standalone");
const distDir = path.join(projectRoot, "dist");

class ReleaseBuildError extends Error {}

function fail(message: string): never {
  throw new ReleaseBuildError(message);
}

/** `cwd`/`stdio` varsayılanlarıyla `spawnSync`; başarısızsa (spawn HATASI —
 * "komut bulunamadı" gibi) hemen fırlatır. Süreç sıfırdan FARKLI bir kodla
 * dönerse çağıran taraf kendi mesajıyla `fail()` çağırır. */
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; captureOutput?: boolean } = {},
) {
  const { cwd = projectRoot, captureOutput = false } = opts;
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) {
    fail(`"${cmd}" çalıştırılamadı: ${result.error.message}`);
  }
  return result;
}

function assertCleanWorkingTree(): void {
  const status = run("git", ["status", "--porcelain"], {
    captureOutput: true,
  });
  if (status.status !== 0) {
    fail(`"git status --porcelain" başarısız (exit ${status.status}):\n${status.stderr}`);
  }
  const dirty = (status.stdout ?? "").trim();
  if (dirty.length > 0) {
    fail(
      "Çalışma ağacı kirli (git status --porcelain boş değil). S6.1 AC4 " +
        "gereği farklı içerikle aynı sürüm gibi görünecek bir çıktı " +
        "üretilmez. Önce değişiklikleri commit edin veya stash'leyin; bu " +
        "script bir \"--allow-dirty\" bayrağı SUNMAZ.\n\n" +
        dirty,
    );
  }
}

/**
 * S6.1 AC3 kapısı — bkz. dosya üstü not "Kalite kapısı NEDEN bu script'in
 * KENDİSİNDE var". `assertCleanWorkingTree()`'den SONRA (kirli ağaçta bu
 * adımlara hiç girmeden hızlı reddetmek için), `buildStandalone()`'dan
 * ÖNCE çağrılır. Her adım TAM çıktısını (`stdio: "inherit"`) gösterir;
 * başarısız olan İLK adımda durur (sonraki adımlar ÇALIŞTIRILMAZ).
 */
function runQualityGate(): void {
  console.log(
    "[release:build] Kalite kapısı (S6.1 AC3): typecheck → lint → " +
      "test:unit → test:integration.",
  );

  type GateStep = { id: string; cmd: string; args: string[] };
  const steps: GateStep[] = [
    { id: "typecheck", cmd: "npm", args: ["run", "typecheck"] },
    { id: "lint", cmd: "npm", args: ["run", "lint"] },
    { id: "test:unit", cmd: "npm", args: ["run", "test:unit"] },
    // Meta-test `release` projesinde olduğu için özyineleme yok — bkz.
    // dosya üstü not.
    { id: "test:integration", cmd: "npm", args: ["run", "test:integration"] },
  ];

  for (const step of steps) {
    console.log(`[release:build]   $ ${step.cmd} ${step.args.join(" ")}`);
    const result = run(step.cmd, step.args);
    if (result.status !== 0) {
      fail(
        `Kalite kapısı "${step.id}" adımında başarısız oldu (exit ` +
          `${result.status}). S6.1 AC3 gereği derleme, tip kontrolü ve ` +
          "iş kuralı/yetki/veri testleri geçmeden yayınlanabilir çıktı " +
          "üretilmez; önce bu adımı düzeltip commit edin.",
      );
    }
  }

  console.log("[release:build] Kalite kapısı geçti (typecheck/lint/unit/integration).");
}

function gitOutput(args: string[]): string {
  const result = run("git", args, { captureOutput: true });
  if (result.status !== 0) {
    fail(`"git ${args.join(" ")}" başarısız (exit ${result.status}):\n${result.stderr}`);
  }
  return (result.stdout ?? "").trim();
}

/** Standalone çıktısını temiz baştan üretir: ÖNCEKİ `.next` kalıntısı bu
 * derlemenin sonucuyla KARIŞMASIN diye önce silinir (görev tanımı: "temiz
 * `next build`"). */
function buildStandalone(): void {
  fs.rmSync(path.join(projectRoot, ".next"), { recursive: true, force: true });

  const build = run("npx", ["next", "build"]);
  if (build.status !== 0) {
    fail(`"next build" başarısız (exit ${build.status}).`);
  }

  const prepare = run(process.execPath, [
    path.join(projectRoot, "scripts", "prepare-standalone.ts"),
  ]);
  if (prepare.status !== 0) {
    fail(`"scripts/prepare-standalone.ts" başarısız (exit ${prepare.status}).`);
  }
}

/** `relPath` (proje köküne göre) dosyasını AYNI göreli yola standalone
 * içine kopyalar; üst dizinler yoksa oluşturur. */
function copyIntoStandalone(relPath: string): void {
  const src = path.join(projectRoot, relPath);
  const dest = path.join(standaloneDir, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function bundleDbInitIntoStandalone(): void {
  copyIntoStandalone("scripts/db-init.ts");
  copyIntoStandalone("scripts/package.json");
  copyIntoStandalone("src/server/data/db.ts");
  copyIntoStandalone("src/server/data/schema.ts");
  copyIntoStandalone("src/server/data/package.json");
  // İlk yönetici (`scripts/platform-admin.ts`) sunucuda arşivden çalışır;
  // göreli `.ts` import ağacı AYNI yollarla eksiksiz kopyalanır.
  copyIntoStandalone("scripts/platform-admin.ts");
  copyIntoStandalone("src/server/auth/session.ts");
  copyIntoStandalone("src/server/auth/package.json");
  copyIntoStandalone("src/server/usecases/session/revoke-session.ts");
  copyIntoStandalone("src/server/usecases/access/bump-platform-user-version.ts");
  copyIntoStandalone("src/server/usecases/access/run-access-change-transaction.ts");
  copyIntoStandalone("src/server/usecases/package.json");
  // Günlük yedek (`scripts/db-backup.ts`) de arşivden çalışır. `src/lib/
  // work-time.ts` (uzantısız `./messages` import'u) BİLEREK import ağacında
  // yoktur; düz `node` onu çözemez.
  copyIntoStandalone("scripts/db-backup.ts");
  copyIntoStandalone("scripts/lib/backup-schedule.ts");
  copyIntoStandalone("src/lib/work-calculation.ts");
  copyIntoStandalone("src/lib/package.json");
}

/** `node -e "..."` standalone'un KENDİ `node_modules` kökünden çalıştırılır
 * (bare `require`'ların cwd'den çözüldüğü Node davranışı — bkz. dosya üstü
 * not). Bu, kök projenin DEĞİL, GERÇEKTEN arşivlenecek native modülün
 * çalıştığını kanıtlar. */
function runInStandalone(expression: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["-e", expression], {
    cwd: standaloneDir,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function assertNativeModulesLoad(): void {
  const result = runInStandalone(
    "require('better-sqlite3'); require('argon2');",
  );
  if (result.status !== 0) {
    fail(
      "Standalone çıktısında better-sqlite3/argon2 require edilemedi " +
        `(exit ${result.status}):\n${result.stderr}`,
    );
  }
}

/** ARCHITECTURE §3.6 sürüm kapısı — GERÇEKTEN çalışan native modülün
 * `SELECT sqlite_version()` sonucu, yalnız npm paket numarası DEĞİL. */
function readAndAssertSqliteVersion(): string {
  const result = runInStandalone(
    "const Database = require('better-sqlite3');" +
      "const db = new Database(':memory:');" +
      "process.stdout.write(db.prepare('SELECT sqlite_version() AS v').get().v);" +
      "db.close();",
  );
  if (result.status !== 0) {
    fail(`Standalone SQLite sürümü okunamadı (exit ${result.status}):\n${result.stderr}`);
  }
  const version = result.stdout.trim();
  if (compareVersions(version, MINIMUM_SQLITE_VERSION) < 0) {
    fail(
      `Standalone SQLite sürümü çok eski: "${version}" < gerekli en düşük ` +
        `"${MINIMUM_SQLITE_VERSION}" (ARCHITECTURE.md §3.6).`,
    );
  }
  return version;
}

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

function readJournal(): Journal {
  const journalPath = path.join(standaloneDir, "drizzle", "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    fail(
      `Standalone içinde "${path.relative(projectRoot, journalPath)}" yok; ` +
        "drizzle/** migration klasörü eksik.",
    );
  }
  return JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;
}

interface MigrationHashEntry {
  idx: number;
  file: string;
  sha256: string;
}

function buildSchemaManifest(journal: Journal): {
  last_migration_idx: number;
  migration_sha256_list: MigrationHashEntry[];
} {
  if (journal.entries.length === 0) {
    fail("drizzle/meta/_journal.json içinde hiç migration girdisi yok.");
  }
  const sorted = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const migrationShaList: MigrationHashEntry[] = sorted.map((entry) => {
    const file = `${entry.tag}.sql`;
    const filePath = path.join(standaloneDir, "drizzle", file);
    if (!fs.existsSync(filePath)) {
      fail(`Journal'da tanımlı migration dosyası yok: "drizzle/${file}".`);
    }
    return { idx: entry.idx, file, sha256: sha256File(filePath) };
  });
  const lastMigrationIdx = sorted[sorted.length - 1]!.idx;
  return { last_migration_idx: lastMigrationIdx, migration_sha256_list: migrationShaList };
}

/**
 * Denetim bulgusu (S6.1 düzeltme turu 1, YÜKSEK önem): `dist/` çalışmalar
 * arası KALICIDIR (`.gitignore`'da `/dist/` — "rebuilt on demand" notu,
 * ama script BİZZAT SİLMİYORDU). `release-verify`, çağrıldığı glob'u
 * (`dist/*.tar.gz`, bkz. ci.yml/release.yml/ci-steps.json) yalnız
 * `process.argv[2]`'den okur; `dist/`'te BİRDEN FAZLA arşiv/manifest
 * çifti varsa (ör. `npm run ci:local` art arda iki kez, İKİ farklı
 * commit'te, aynı makinede çalıştırılırsa) kabuk glob'u ALFABETİK sıraya
 * göre genişletir ve `release:verify` SESSİZCE eski/bayat çifti
 * doğrulayabilir — AZ ÖNCE üretilen arşiv hiç doğrulanmaz. Kök neden
 * çözümü: her `release:build` çalıştığında ÖNCEKİ TÜM arşiv/manifest
 * çiftlerini (yalnız kendi üreteceği isimle eşleşeni DEĞİL) temizler; bu
 * yüzden `dist/` her zaman EN ÇOK bir (bu çalıştırmanın) çiftini içerir
 * ve glob'un genişleyebileceği tek dosya kalır.
 */
function cleanStaleDistArtifacts(): void {
  if (!fs.existsSync(distDir)) {
    return;
  }
  for (const name of fs.readdirSync(distDir)) {
    if (name.endsWith(".tar.gz") || name.endsWith(".manifest.json")) {
      fs.rmSync(path.join(distDir, name), { force: true });
      console.log(`[release:build] Eski dist/ dosyası temizlendi: ${name}`);
    }
  }
}

function main(): void {
  assertCleanWorkingTree();
  runQualityGate();
  cleanStaleDistArtifacts();

  const sourceCommit = gitOutput(["rev-parse", "HEAD"]);
  const shortSha = gitOutput(["rev-parse", "--short", "HEAD"]);
  const sourceRef = gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]);

  console.log(`[release:build] Kaynak commit: ${sourceCommit} (${sourceRef})`);

  buildStandalone();
  bundleDbInitIntoStandalone();

  assertNativeModulesLoad();
  console.log("[release:build] better-sqlite3/argon2 standalone içinde require edildi.");

  const sqliteVersion = readAndAssertSqliteVersion();
  console.log(`[release:build] SQLite sürümü: ${sqliteVersion} (>= ${MINIMUM_SQLITE_VERSION}).`);

  const journal = readJournal();
  const schemaManifest = buildSchemaManifest(journal);
  console.log(
    `[release:build] Migration: ${schemaManifest.migration_sha256_list.length} dosya, ` +
      `son idx=${schemaManifest.last_migration_idx}.`,
  );

  assertNoSecretOrDataFiles(standaloneDir);
  console.log("[release:build] Gizli/veri dosyası kontrolü geçti.");

  fs.mkdirSync(distDir, { recursive: true });
  const archiveName = `dolmus-takip-${shortSha}-${process.platform}-${process.arch}.tar.gz`;
  const archivePath = path.join(distDir, archiveName);
  fs.rmSync(archivePath, { force: true });

  // `-C <standaloneDir> .` — arşivin İÇ yolları `.next/standalone/` ön ekini
  // TAŞIMAZ (`server.js`, `node_modules/`, `drizzle/`, `scripts/`, `src/`
  // doğrudan arşiv köküyle başlar); hedef makinede açılan dizin doğrudan
  // `node server.js` ile çalıştırılabilir (mevcut E2E deseniyle AYNI
  // `server.js` göreli konumu).
  const tar = run("tar", ["-czf", archivePath, "-C", standaloneDir, "."]);
  if (tar.status !== 0) {
    fail(`tar arşivleme başarısız (exit ${tar.status}).`);
  }

  const artifactBuffer = fs.readFileSync(archivePath);
  const artifactSha256 = sha256Buffer(artifactBuffer);
  const artifactSizeBytes = artifactBuffer.length;

  const lockfileSha256 = sha256File(path.join(projectRoot, "package-lock.json"));
  const rootPackageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  ) as { name: string };
  const nextPackageJson = JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, "node_modules", "next", "package.json"),
      "utf8",
    ),
  ) as { version: string };

  const manifest = {
    name: rootPackageJson.name,
    source_commit: sourceCommit,
    source_ref: sourceRef,
    lockfile_sha256: lockfileSha256,
    node_version: process.version,
    next_version: nextPackageJson.version,
    platform: process.platform,
    arch: process.arch,
    sqlite_version: sqliteVersion,
    schema: schemaManifest,
    built_at: new Date().toISOString(),
    artifact_sha256: artifactSha256,
    artifact_size_bytes: artifactSizeBytes,
  };

  const manifestPath = manifestPathFor(archivePath);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`[release:build] Arşiv: ${path.relative(projectRoot, archivePath)}`);
  console.log(`[release:build] Manifest: ${path.relative(projectRoot, manifestPath)}`);
  console.log(`[release:build] artifact_sha256=${artifactSha256} (${artifactSizeBytes} bayt)`);
  console.log(
    `[release:build] Doğrulamak için: npm run release:verify -- ${path.relative(projectRoot, archivePath)}`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[release:build] Başarısız: ${message}`);
  process.exitCode = 1;
}
