import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { assertNoSecretOrDataFiles, manifestPathFor } from "../../scripts/lib/release-shared.ts";

/**
 * `scripts/lib/release-shared.ts` ve `scripts/release-verify.ts` birim
 * testleri — S6.1 düzeltme turu 1 (denetim bulguları).
 *
 * Denetim bulgusu (medium+low, aynı kök neden): `assertNoSecretOrDataFiles`
 * içindeki `walk()`, `FORBIDDEN_NAME_PATTERNS`'i yalnız DOSYA adlarına
 * uyguluyordu; ".env"/"secret" ADLI bir DİZİN (içinde zararsız adlı
 * dosyalar barındırsa bile) hiç yakalanmıyordu. Bizzat doğrulandı: bu
 * dosya yazılmadan önce geçici bir dizinde "secret-config/innocuous.txt"
 * oluşturup `assertNoSecretOrDataFiles` çağrıldığında "NO VIOLATION
 * DETECTED" gözlendi.
 */
describe("assertNoSecretOrDataFiles (S6.1 AC6, düzeltme turu 1)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-shared-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("yasak ADI TAŞIYAN bir DİZİN (içindeki dosyalar zararsız adlı olsa bile) ihlal olarak yakalanır", () => {
    fs.mkdirSync(path.join(dir, "secret-config"));
    fs.writeFileSync(path.join(dir, "secret-config", "innocuous.txt"), "hello");

    expect(() => assertNoSecretOrDataFiles(dir)).toThrowError(/secret-config.*"secret".*dizin/s);
  });

  test("\".env\" ile başlayan bir DİZİN adı da yakalanır", () => {
    fs.mkdirSync(path.join(dir, ".env.local-backup"));
    fs.writeFileSync(path.join(dir, ".env.local-backup", "notes.txt"), "x");

    expect(() => assertNoSecretOrDataFiles(dir)).toThrowError(/\.env\.local-backup/);
  });

  test("yasaklı adlı bir dizinin İÇİNE de inilir; altındaki gerçek sır dosyası AYRICA raporlanır", () => {
    fs.mkdirSync(path.join(dir, "secret-config"));
    fs.writeFileSync(path.join(dir, "secret-config", ".env"), "SECRET=1");

    try {
      assertNoSecretOrDataFiles(dir);
      throw new Error("beklenen hata fırlatılmadı");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/secret-config \(.*dizin\)/);
      expect(message).toMatch(/secret-config\/\.env/);
    }
  });

  test("node_modules alt ağacı hâlâ hiç TARANMAZ (mevcut davranış korunur)", () => {
    fs.mkdirSync(path.join(dir, "node_modules", "some-pkg"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "some-pkg", ".env"), "SECRET=1");

    expect(() => assertNoSecretOrDataFiles(dir)).not.toThrow();
  });

  test("kökteki tam \"data\" dizini hâlâ ihlal (mevcut davranış korunur); iç içe \"data\" (ör. src/server/data) DEĞİL", () => {
    fs.mkdirSync(path.join(dir, "data"));
    fs.writeFileSync(path.join(dir, "data", "app.sqlite"), "x");
    expect(() => assertNoSecretOrDataFiles(dir)).toThrowError(/^Yayın çıktısında.*data.*veri dizini/s);

    fs.rmSync(path.join(dir, "data"), { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, "src", "server", "data"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "server", "data", "db.ts"), "export {};");
    expect(() => assertNoSecretOrDataFiles(dir)).not.toThrow();
  });

  test("temiz bir dizin ihlal ÜRETMEZ", () => {
    fs.writeFileSync(path.join(dir, "server.js"), "// ok");
    fs.mkdirSync(path.join(dir, "drizzle"));
    expect(() => assertNoSecretOrDataFiles(dir)).not.toThrow();
  });
});

describe("manifestPathFor", () => {
  test("\"<ad>.tar.gz\" → \"<ad>.manifest.json\"", () => {
    expect(manifestPathFor("/x/y/dolmus-takip-abc123-linux-x64.tar.gz")).toBe(
      "/x/y/dolmus-takip-abc123-linux-x64.manifest.json",
    );
  });

  test("\".tar.gz\" ile bitmeyen yol reddedilir", () => {
    expect(() => manifestPathFor("/x/y/dolmus-takip.zip")).toThrowError(/tar\.gz/);
  });
});

/**
 * Denetim bulgusu (HIGH, güvenlik lens'i): `release:verify` çağıran
 * tarafın (`ci.yml`/`ci-steps.json`) kullandığı "dist/*.tar.gz" GLOB'u
 * kabuk tarafından birden fazla dosyaya genişleyebilir; script yalnız
 * `process.argv[2]`'yi okuyup GERİ KALANI sessizce yok sayıyordu — bu,
 * kalıcı `dist/`'te (ci-local art arda koşularında) alfabetik olarak
 * önce gelen ESKİ arşivi "BAŞARILI" diye doğrulayabiliyordu. Şimdi script
 * fazladan argüman geldiğinde (glob birden fazla dosyaya genişlediğinde)
 * AÇIKÇA hata verir. Bu, gerçek dosyalara ihtiyaç duymadan (existence
 * kontrolünden ÖNCE tetiklendiği için) doğrudan `node
 * scripts/release-verify.ts <a> <b>` çağrısıyla sınanabilir.
 */
describe("release-verify.ts: birden fazla arşiv argümanı (glob genişlemesi) reddedilir", () => {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );

  test("iki argüman verildiğinde exit 1 ve açık Türkçe hata mesajı döner", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/release-verify.ts", "dist/eski-arsiv.tar.gz", "dist/yeni-arsiv.tar.gz"],
      { cwd: projectRoot, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/[Bb]irden fazla arşiv/);
    expect(result.stdout + result.stderr).toMatch(/eski-arsiv\.tar\.gz/);
    expect(result.stdout + result.stderr).toMatch(/yeni-arsiv\.tar\.gz/);
  });

  test("tek argümanla (var olmayan dosya) glob-fazlalığı hatası DEĞİL, \"arşiv bulunamadı\" hatası döner", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/release-verify.ts", "dist/yok-boyle-bir-dosya.tar.gz"],
      { cwd: projectRoot, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/[Aa]rşiv bulunamadı/);
    expect(result.stdout + result.stderr).not.toMatch(/[Bb]irden fazla arşiv/);
  });
});
