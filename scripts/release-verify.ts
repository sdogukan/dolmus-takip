/**
 * Yayın çıktısı doğrulaması — `npm run release:verify -- <tar.gz yolu>`
 * (T6.1 ADIM 1/2, S6.1 AC5: "Üretim çıktısı temiz ve hedefle uyumlu ortamda
 * açılır; migration/başlatma komutları kayıtlıdır.").
 *
 * `scripts/release-build.ts`'in ürettiği arşivi TEMİZ bir ortamda (geçici
 * dizin + geçici DB + geçici port) uçtan uca dener:
 *
 * 1. Manifest'teki `artifact_sha256`/`artifact_size_bytes` arşivin GERÇEK
 *    baytlarıyla eşleşmiyorsa reddeder (AC4 — "bütünlük kontrolü").
 * 2. Manifest `platform`/`arch` bu makineyle eşleşmiyorsa AÇIKÇA reddeder
 *    (görev tanımı: "release:verify farklı platformda çalıştırılmayı
 *    reddeder" — Linux x86_64 için üretilmiş bir arşiv yerel Mac arm64'te
 *    ("native modülleri o mimaride ÇALIŞMAZ") sessizce "geçti" sayılamaz).
 * 3. Açılmış arşivde gizli/veri dosyası olmadığını AYRICA doğrular
 *    (`release-build.ts`'in kendi kontrolünden BAĞIMSIZ; arşivleme/açma
 *    sürecinin kendisi bir şey EKLEMEDİĞİNİ kanıtlar).
 * 4. Arşivin KENDİ `scripts/db-init.ts`'iyle geçici bir DB kurar (hedef
 *    makinedeki GERÇEK ilk kurulum adımı).
 *    Ardından arşivin KENDİ `scripts/platform-admin.ts create-first-admin`
 *    komutu AYNI geçici DB'de çalıştırılır (sunucudaki ilk yönetici adımı;
 *    import ağacında eksik dosya yalnız sunucuda patlamasın); ardından
 *    arşivin KENDİ `scripts/db-backup.ts run` + `status` komutları.
 * 5. Arşivin KENDİ `server.js`'ini geçici `PORT`/`HOSTNAME=127.0.0.1`/
 *    `APP_ORIGIN`/`DOLMUS_DB_PATH` ile başlatır, `/api/v1/health/live`'dan
 *    200 alır, süreci kapatır.
 *
 * Test parolası/gerçek SSH bilgisi YOKTUR; bu script sunucunun stdout/
 * stderr'ini yalnız HATA durumunda (teşhis için) yazdırır — uygulama
 * kodu zaten parola/hash/token loglamaz (ARCHITECTURE §6).
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoSecretOrDataFiles,
  manifestPathFor,
  sha256Buffer,
} from "./lib/release-shared.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

class ReleaseVerifyError extends Error {}

function fail(message: string): never {
  throw new ReleaseVerifyError(message);
}

interface Manifest {
  name: string;
  source_commit: string;
  source_ref: string;
  lockfile_sha256: string;
  node_version: string;
  next_version: string;
  platform: string;
  arch: string;
  sqlite_version: string;
  schema: { last_migration_idx: number; migration_sha256_list: unknown[] };
  built_at: string;
  artifact_sha256: string;
  artifact_size_bytes: number;
}

function readManifest(archivePath: string): Manifest {
  const manifestPath = manifestPathFor(archivePath);
  if (!fs.existsSync(manifestPath)) {
    fail(
      `Manifest bulunamadı: "${manifestPath}". Arşivin yanında ` +
        '"<ad>.manifest.json" olmalı (bkz. `scripts/release-build.ts`).',
    );
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
}

function assertMatchingPlatform(manifest: Manifest): void {
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    fail(
      `Bu manifest "${manifest.platform}-${manifest.arch}" hedefi için ` +
        `üretildi; bu makine "${process.platform}-${process.arch}". ` +
        "Native better-sqlite3/argon2 ikilikleri platforma özgüdür " +
        "(ARCHITECTURE.md §8.4) — farklı mimaride release:verify " +
        "çalıştırılamaz.",
    );
  }
}

function assertArtifactIntegrity(archivePath: string, manifest: Manifest): void {
  const buffer = fs.readFileSync(archivePath);
  const actualSha256 = sha256Buffer(buffer);
  if (actualSha256 !== manifest.artifact_sha256) {
    fail(
      "Arşiv hash'i manifest ile UYUŞMUYOR (S6.1 AC4 — bütünlük " +
        `kontrolü): manifest="${manifest.artifact_sha256}" ` +
        `gerçek="${actualSha256}".`,
    );
  }
  if (buffer.length !== manifest.artifact_size_bytes) {
    fail(
      "Arşiv boyutu manifest ile UYUŞMUYOR: " +
        `manifest=${manifest.artifact_size_bytes} gerçek=${buffer.length}.`,
    );
  }
}

function extractArchive(archivePath: string): string {
  const extractDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dolmus-release-verify-"),
  );
  const tar = spawnSync("tar", ["-xzf", archivePath, "-C", extractDir], {
    encoding: "utf8",
  });
  if (tar.status !== 0) {
    fail(`tar açma başarısız (exit ${tar.status}):\n${tar.stderr}`);
  }
  return extractDir;
}

function runDbInit(extractDir: string, dbPath: string): void {
  const result = spawnSync(process.execPath, ["scripts/db-init.ts"], {
    cwd: extractDir,
    encoding: "utf8",
    env: { ...process.env, DOLMUS_DB_PATH: dbPath },
  });
  if (result.status !== 0) {
    fail(
      `Arşivin "scripts/db-init.ts"i geçici DB'de başarısız oldu ` +
        `(exit ${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  console.log("[release:verify] Geçici DB db-init ile kuruldu.");
}

/** Arşivin `scripts/platform-admin.ts create-first-admin`ini yalnız geçici
 * DB'de çalıştırır (parola stdin'den; bu değer gerçek bir sırrı DEĞİL, geçici
 * DB ile birlikte silinen bir test değeridir). */
function runCreateFirstAdmin(extractDir: string, dbPath: string): void {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/platform-admin.ts",
      "create-first-admin",
      "--username",
      "release-verify-admin",
      "--password-stdin",
    ],
    {
      cwd: extractDir,
      encoding: "utf8",
      input: "release-verify-temp-password",
      env: { ...process.env, DOLMUS_DB_PATH: dbPath },
    },
  );
  if (result.status !== 0) {
    fail(
      `Arşivin "scripts/platform-admin.ts create-first-admin" komutu geçici ` +
        `DB'de başarısız oldu (exit ${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  console.log("[release:verify] Geçici DB'de create-first-admin çalıştı.");
}

/** Sabit, korumalı pencere (02:55–04:00 Europe/Istanbul) DIŞINDA bir an:
 * doğrulama günün hangi saatinde koşarsa koşsun kopyanın pencere kuralına
 * takılıp yalancı hata vermemesi için (`DOLMUS_BACKUP_NOW`, bkz. db-backup.ts). */
const BACKUP_VERIFY_NOW = "2026-01-15T12:00:00.000Z";

/** Arşivin `scripts/db-backup.ts run` ve `status` komutlarını geçici DB'de
 * çalıştırır; import ağacında eksik dosya yalnız sunucuda patlamasın. */
function runBackupCommands(extractDir: string, dbPath: string, backupDir: string): void {
  fs.mkdirSync(backupDir, { recursive: true });
  const env = {
    ...process.env,
    DOLMUS_DB_PATH: dbPath,
    DOLMUS_BACKUP_DIR: backupDir,
    DOLMUS_BACKUP_NOW: BACKUP_VERIFY_NOW,
  };
  for (const command of ["run", "status"]) {
    const result = spawnSync(process.execPath, ["scripts/db-backup.ts", command], {
      cwd: extractDir,
      encoding: "utf8",
      env,
    });
    if (result.status !== 0) {
      fail(
        `Arşivin "scripts/db-backup.ts ${command}" komutu geçici DB'de başarısız oldu ` +
          `(exit ${result.status}):\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
  const published = fs.readdirSync(backupDir).filter((name) => name.endsWith(".manifest.json"));
  if (published.length !== 1) {
    fail(`Yedek dizininde tam olarak 1 manifest bekleniyordu, ${published.length} bulundu.`);
  }
  console.log("[release:verify] Geçici DB'de db-backup run/status çalıştı.");
}

/** Boş bir TCP port bulur (0 numaralı porta bağlanıp OS'in verdiği gerçek
 * portu okur) — sabit bir port numarası varsayılmaz, eşzamanlı koşularla
 * çakışmaz. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Boş port belirlenemedi."));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealthLive(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) {
        return;
      }
      lastError = new Error(`Beklenmeyen HTTP durumu: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`"${url}" ${timeoutMs}ms içinde 200 dönmedi. Son hata: ${reason}`);
}

async function startServerAndCheckHealth(
  extractDir: string,
  dbPath: string,
): Promise<void> {
  const port = await findFreePort();
  const appOrigin = `http://127.0.0.1:${port}`;

  const server = spawn(process.execPath, ["server.js"], {
    cwd: extractDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      APP_ORIGIN: appOrigin,
      DOLMUS_DB_PATH: dbPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverOutput = "";
  server.stdout?.on("data", (chunk: Buffer) => {
    serverOutput += chunk.toString("utf8");
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    serverOutput += chunk.toString("utf8");
  });

  const earlyExit = new Promise<never>((_resolve, reject) => {
    server.once("exit", (code) => {
      reject(
        new Error(
          `Standalone sunucu health kontrolünden ÖNCE çıktı (kod ${code}):\n${serverOutput}`,
        ),
      );
    });
  });

  try {
    await Promise.race([
      waitForHealthLive(`${appOrigin}/api/v1/health/live`, 20_000),
      earlyExit,
    ]);
    console.log(`[release:verify] ${appOrigin}/api/v1/health/live → 200.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Standalone sunucu health/live kontrolünü geçemedi: ${message}`);
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        server.once("exit", () => resolve());
        setTimeout(() => {
          if (server.exitCode === null && server.signalCode === null) {
            server.kill("SIGKILL");
          }
          resolve();
        }, 5000);
      });
    }
  }
}

async function main(): Promise<void> {
  const archiveArg = process.argv[2];
  if (!archiveArg) {
    fail(
      "Kullanım: npm run release:verify -- <arşiv.tar.gz yolu>\n" +
        "(Arşiv `npm run release:build` ile üretilir; manifest aynı " +
        "dizinde \"<ad>.manifest.json\" olarak beklenir.)",
    );
  }
  // Denetim bulgusu (S6.1 düzeltme turu 1, YÜKSEK önem): çağıran taraf
  // (ci.yml/release.yml/ci-steps.json) `dist/*.tar.gz` GLOB'unu kullanır;
  // kabuk bunu BİRDEN FAZLA gerçek dosya adına genişletebilir (`dist/`
  // çalışmalar arası kalıcıdır). Yalnız `process.argv[2]`'yi okuyup
  // GERİYE KALAN argümanları SESSİZCE yok saymak, kabuğun alfabetik
  // sıraya göre seçtiği İLK (muhtemelen ESKİ/bayat) arşivi "BAŞARILI"
  // diye doğrulayıp asıl az önce üretilen arşivi HİÇ doğrulamadan
  // atlayabilir. `cleanStaleDistArtifacts` (release-build.ts) artık
  // `dist/`'i her çalıştırmada tek çifte indiriyor; buna KARŞIN, bu
  // kontrol İKİNCİ, BAĞIMSIZ bir savunma katmanıdır — glob yine de
  // birden fazla eşleşme üretirse (ör. release-build ATLANIP dist/'e
  // elle dosya bırakılmışsa) sessizce yanlış arşivi doğrulamak yerine
  // AÇIKÇA hata verir.
  if (process.argv.length > 3) {
    fail(
      "Birden fazla arşiv yolu verildi (muhtemelen \"dist/*.tar.gz\" " +
        "glob'u BİRDEN FAZLA dosyaya genişledi):\n" +
        process.argv
          .slice(2)
          .map((p) => `  - ${p}`)
          .join("\n") +
        "\n\nBu script HANGİ arşivin doğrulanacağını KENDİLİĞİNDEN " +
        "seçmez (sessizce eski/bayat bir arşivi doğrulamak S6.1 AC4'ü " +
        "boşa çıkarır). \"dist/\" içindeki eski *.tar.gz/*.manifest.json " +
        "çiftlerini silin (yeni \"npm run release:build\" bunu zaten " +
        "yapar) veya doğrulanacak TEK arşivi doğrudan (glob'suz) verin.",
    );
  }
  const archivePath = path.resolve(process.cwd(), archiveArg);
  if (!fs.existsSync(archivePath)) {
    fail(`Arşiv bulunamadı: "${archivePath}".`);
  }

  const manifest = readManifest(archivePath);
  assertMatchingPlatform(manifest);
  assertArtifactIntegrity(archivePath, manifest);
  console.log("[release:verify] Arşiv hash/boyut manifestle eşleşiyor.");

  const extractDir = extractArchive(archivePath);
  const dbTempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dolmus-release-verify-db-"),
  );
  const dbPath = path.join(dbTempDir, "app.sqlite");

  try {
    assertNoSecretOrDataFiles(extractDir);
    console.log("[release:verify] Açılmış arşivde gizli/veri dosyası yok.");

    runDbInit(extractDir, dbPath);
    runCreateFirstAdmin(extractDir, dbPath);
    runBackupCommands(extractDir, dbPath, path.join(dbTempDir, "backup-ready"));
    await startServerAndCheckHealth(extractDir, dbPath);

    console.log(
      `[release:verify] Doğrulama BAŞARILI (source_commit=${manifest.source_commit}, ` +
        `sqlite_version=${manifest.sqlite_version}, platform=${manifest.platform}-${manifest.arch}).`,
    );
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.rmSync(dbTempDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[release:verify] Başarısız: ${message}`);
  process.exitCode = 1;
});
