/**
 * Standalone çıktı hazırlığı — `npm run test:e2e` ve (T6.1) üretim yayını
 * için ORTAK adım (T1.2 EK DÜZELTME, S1.2 görev tanımı (B)).
 *
 * Kaynak — Next'in KENDİ belgesi (bu depodaki `next@16.3.5` paketinin
 * kaynağı): `node_modules/next/dist/docs/01-app/03-api-reference/05-config/
 * 01-next-config-js/output.md` "Automatically Copying Traced Files":
 *
 *   "This minimal server does not copy the `public` or `.next/static`
 *   folders by default as these should ideally be handled by a CDN
 *   instead, although these folders can be copied to the
 *   `standalone/public` and `standalone/.next/static` folders manually,
 *   after which `server.js` file will serve these automatically."
 *   "cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/"
 *
 * Bu script BİREBİR o iki kopyayı (Node'un yerleşik `fs.cpSync` ile,
 * harici bir CDN/statik sunum katmanı bu projede henüz OLMADIĞINDAN)
 * yapar. `output: "standalone"` (`../next.config.ts`, DECISIONS.md F4)
 * `next build`'in ÇIKTISI olan `.next/standalone/server.js`'in bu iki
 * klasör OLMADAN statik dosya/`_next/static` isteklerine 404 döneceği
 * ("next start does not work with output: standalone" uyarısının işaret
 * ettiği eksik parça budur) — bu script o eksiği KAPATIR.
 *
 * Yeniden kullanılabilirlik: hem `npm run test:e2e` (bu ADIM, gerçek HTTP/
 * cookie/oturum ile E2E) hem T6.1'in üretim yayın betiği AYNI script'i
 * çağırır (görev tanımı: "T6.1 yayın çıktısı da aynı adımı kullanacak") —
 * kopyalama mantığı İKİ YERDE TEKRARLANMAZ.
 *
 * `public/` bu depoda henüz YOKTUR (proje kökünde `public` klasörü yok) —
 * bu, üretim topolojisinin (ARCHITECTURE §2, Caddy statik varlıkları ayrıca
 * sunmaz) ve bu projenin sistem fontu kullanıp harici görsel/asset
 * eklememesinin bir sonucudur; script bu klasörün YOKLUĞUNU hataya
 * ÇEVİRMEZ (var olması ZORUNLU değildir, resmi belge de "public" klasörünü
 * opsiyonel sayar), yalnız bilgilendirici bir log basar. `.next/static` ise
 * HER `next build` çıktısında vardır — bu ZORUNLUDUR; yoksa (ör. `next
 * build` hiç ÇALIŞTIRILMAMIŞSA) script AÇIKÇA hata fırlatır (bu depodaki
 * diğer "açık hata, sessiz yanlış davranış yok" desenleriyle AYNI ilke —
 * bkz. `./db-init.ts` üst notu, `../src/server/data/db.ts`
 * `assertMigrationsApplied`).
 *
 * Bu script doğrudan `node` ile (Next.js/Vitest bundler'ı OLMADAN) çalışır;
 * komşu `.ts` dosyalarına import YOKTUR, bu yüzden `../src/server/data/
 * db.ts`'in izlediği "açık `.ts` uzantısı" deseni burada GEÇERSİZDİR — yine
 * de bu klasörün `./package.json`'ı (`"type": "module"`) ESM yorumunu
 * garanti eder (`./db-init.ts` ile AYNI kurulum).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const standaloneDir = path.join(projectRoot, ".next", "standalone");
const staticSrc = path.join(projectRoot, ".next", "static");
const staticDest = path.join(standaloneDir, ".next", "static");
const publicSrc = path.join(projectRoot, "public");
const publicDest = path.join(standaloneDir, "public");

function assertExists(dirPath: string, whatFailedMessage: string): void {
  if (!fs.existsSync(dirPath)) {
    throw new Error(whatFailedMessage);
  }
}

function main(): void {
  assertExists(
    standaloneDir,
    `"${standaloneDir}" bulunamadı. Önce "npm run build" (next build, ` +
      '"output: standalone") çalıştırılmalı.',
  );
  assertExists(
    staticSrc,
    `"${staticSrc}" bulunamadı. Önce "npm run build" (next build) ` +
      "çalıştırılmalı — bu klasör HER üretim derlemesinde üretilir.",
  );

  // "cp -r .next/static .next/standalone/.next/" — `force: true` önceki
  // bir E2E/yayın koşusundan kalan eski varlıkları GÜNCEL derlemeyle
  // değiştirir (bayat statik dosya sunulmaz).
  fs.cpSync(staticSrc, staticDest, { recursive: true, force: true });
  console.log(
    `[prepare-standalone] Kopyalandı: "${staticSrc}" → "${staticDest}"`,
  );

  if (fs.existsSync(publicSrc)) {
    // "cp -r public .next/standalone/"
    fs.cpSync(publicSrc, publicDest, { recursive: true, force: true });
    console.log(
      `[prepare-standalone] Kopyalandı: "${publicSrc}" → "${publicDest}"`,
    );
  } else {
    console.log(
      `[prepare-standalone] "${publicSrc}" yok — atlandı (bu projede henüz public/ klasörü yok).`,
    );
  }
}

main();
