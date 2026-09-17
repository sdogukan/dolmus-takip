/**
 * `release:build` ve `release:verify` ORTAK yardımcıları — T6.1 ADIM 1/2,
 * S6.1.
 *
 * Bu dosya İKİ script'in de tekrarlamaması gereken iki kontrolü barındırır:
 *
 * 1. `assertNoSecretOrDataFiles` — S6.1 kabul kriteri "Gizli giriş/SSH
 *    bilgileri ... çıktısına yazılmaz. Çalışma çıktısında gerçek müşteri
 *    veritabanı bulunmaz." `release-build.ts` bunu standalone çıktısını
 *    ARŞİVLEMEDEN ÖNCE, `release-verify.ts` da açılmış arşivin İÇİNDE
 *    AYRICA çalıştırır (görev tanımı: "içinde .env/*.sqlite/secret
 *    olmadığını doğrular") — iki ayrı kanıt noktası, TEK tarama mantığı.
 *    `node_modules/**` TARANMAZ (görev tanımı: "node_modules dışı geçici
 *    dosyalar" — bir bağımlılığın kendi test fixture'ı/örnek dosyası bizim
 *    uygulamamızın sırrı/verisi DEĞİLDİR; ayrıca native modül `.node`
 *    dosyaları ve yüzlerce paket adı yanlış-pozitif üretebilir).
 *
 * 2. `manifestPathFor` — arşiv/manifest dosya adı EŞLEŞMESİ tek yerde
 *    tanımlanır; `release-build.ts` yazarken, `release-verify.ts` okurken
 *    AYNI fonksiyonu çağırır (görev tanımı: "arşiv ... ve yanında
 *    `manifest.json`" — manifest arşivin KENDİSİNE gömülmez: `artifact_
 *    sha256` arşivin tam baytlarının hash'i olduğundan, manifest arşivin
 *    İÇİNDE olsaydı hash kendi kendine referans verir, asla sabit bir
 *    değere yakınsamazdı; bu yüzden manifest her zaman KOMŞU bir dosyadır).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ARCHIVE_SUFFIX = ".tar.gz";
const MANIFEST_SUFFIX = ".manifest.json";

/** `<ad>.tar.gz` → `<ad>.manifest.json`; ikisi hep aynı dizinde, aynı ad kökünde. */
export function manifestPathFor(archivePath: string): string {
  if (!archivePath.endsWith(ARCHIVE_SUFFIX)) {
    throw new Error(
      `Arşiv yolu "${ARCHIVE_SUFFIX}" ile bitmiyor: "${archivePath}".`,
    );
  }
  return (
    archivePath.slice(0, -ARCHIVE_SUFFIX.length) + MANIFEST_SUFFIX
  );
}

export function sha256File(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

export function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Yasak dosya/dizin adı desenleri — dosya adının KENDİSİNE uygulanır
 * (tam yol'a değil; `node_modules/better-sqlite3/lib/database.js` gibi
 * meşru dosyaları ".sqlite" alt dizesi YANLIŞ-POZİTİF yakalamasın diye).
 */
const FORBIDDEN_NAME_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /^\.env/i, reason: "gizli .env dosyası" },
  { pattern: /\.sqlite/i, reason: "SQLite veritabanı dosyası" },
  { pattern: /\.db$/i, reason: "veritabanı dosyası" },
  { pattern: /secret/i, reason: "\"secret\" adlı dosya/dizin" },
  { pattern: /^\.ds_store$/i, reason: "işletim sistemi geçici dosyası" },
  { pattern: /^thumbs\.db$/i, reason: "işletim sistemi geçici dosyası" },
  { pattern: /\.tmp$/i, reason: "geçici dosya" },
];

/**
 * Yalnız arşiv/açılmış-arşiv KÖKÜNDEKİ (`relPath === "data"`) bir dizini
 * yasaklar — ARCHITECTURE.md §8.1'deki çalışma zamanı DB dizini
 * (`.../data/app.sqlite`, yerelde `./data/dev.sqlite`) budur. `src/server/
 * data/**` (bu depodaki GERÇEK veri ERİŞİM kodu — `db.ts`/`schema.ts`,
 * `release-build.ts` tarafından KASITLI olarak arşive kopyalanır) İÇ İÇE
 * bir "data" dizinidir ve bir VERİ DOSYASI DEĞİLDİR; adı yüzünden yanlış-
 * pozitif yakalanmaması için kontrol köke (`relPath`) göre yapılır, dizin
 * ADININ HER GEÇTİĞİ yere göre DEĞİL.
 */
function isForbiddenDataDir(relPath: string): boolean {
  return relPath === "data";
}

/**
 * `rootDir`'i özyinelemeli tarar; `node_modules` alt ağaçlarına HİÇ
 * inmez. Bulunan İLK ihlalde değil, TÜMÜNÜ toplayıp tek bir hatada
 * bildirir (kısmi rapor, sessiz geçiş yok).
 */
export function assertNoSecretOrDataFiles(rootDir: string): void {
  const violations: string[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      const relPath = path.relative(rootDir, entryPath);

      if (entry.isDirectory()) {
        if (entry.name === "node_modules") {
          continue; // Bilerek atlanır (dosya üstü not).
        }
        if (isForbiddenDataDir(relPath)) {
          violations.push(`${relPath} (veri dizini "data/")`);
          continue; // İçine inmeye gerek yok, dizinin kendisi zaten ihlal.
        }
        // Denetim bulgusu (S6.1 düzeltme turu 1): FORBIDDEN_NAME_PATTERNS
        // yalnız dosyalara değil, dizin ADLARINA da uygulanır — içinde
        // zararsız adlı dosyalar barındıran ".env"/"secret" adlı bir
        // DİZİN, yalnız dosya bazlı taramadan sessizce geçebiliyordu
        // (kanıt: geçici dizinde "secret-config/innocuous.txt" ile
        // reprodüklendi, "NO VIOLATION DETECTED" döndü). Dizinin kendisi
        // ihlal olarak işaretlenir; içine yine de inilir (altında ayrıca
        // gerçek bir sır/veri dosyası da bulunabilir, TÜMÜ toplanır).
        for (const { pattern, reason } of FORBIDDEN_NAME_PATTERNS) {
          if (pattern.test(entry.name)) {
            violations.push(`${relPath} (${reason}, dizin)`);
            break;
          }
        }
        walk(entryPath);
        continue;
      }

      for (const { pattern, reason } of FORBIDDEN_NAME_PATTERNS) {
        if (pattern.test(entry.name)) {
          violations.push(`${relPath} (${reason})`);
          break;
        }
      }
    }
  }

  walk(rootDir);

  if (violations.length > 0) {
    throw new Error(
      "Yayın çıktısında gizli/veri dosyası bulundu (S6.1 AC6):\n" +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  }
}
