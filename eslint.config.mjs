// @ts-check
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

/**
 * ESLint 10 flat config.
 *
 * Next 16.3.5'in `eslint-config-next` paketi artık doğrudan flat config
 * dizisi export ediyor (bkz. `node_modules/eslint-config-next/dist/
 * core-web-vitals.d.ts`: `declare const config: Linter.Config[]`); eski
 * `.eslintrc` biçimini flat'e çeviren `@eslint/eslintrc`/`FlatCompat`
 * katmanına gerek yoktur ve K9'daki sabit paket listesine yeni bağımlılık
 * eklenmez.
 *
 * @type {import('eslint').Linter.Config[]}
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  {
    // `eslint-config-next`'in `core-web-vitals.js` içindeki
    // `settings.react.version: "detect"` değeri, `eslint-plugin-react`
    // 7.37.5'in (bu paketin en güncel npm sürümü — `npm view
    // eslint-plugin-react version` ile doğrulandı) React sürümünü
    // otomatik algılamak için `context.getFilename()` çağırmasına yol
    // açıyor. ESLint 10.10.0 bu (uzun süredir kullanımdan kaldırılmış)
    // metodu tamamen kaldırdı (`node_modules/eslint/lib` içinde
    // `getFilename` araması sıfır sonuç verir) — bu yüzden `react/
    // display-name` gibi kuralları tetikleyen HER dosyada
    // "contextOrFilename.getFilename is not a function" ile çöküyordu
    // (next.config.ts, drizzle.config.ts, src/**/*.ts(x) dahil — React
    // bileşeni olmayan dosyalarda bile, çünkü çökme dosya içeriğinden
    // önce, sürüm algılama aşamasında oluşuyor).
    //
    // Kök neden düzeltmesi: "detect" yerine K9'da zaten sabitlenmiş
    // React sürümünü (`package.json` — react 19.3.0) açıkça vermek.
    // `eslint-plugin-react`'in kendi `getReactVersionFromContext`
    // mantığı (`node_modules/eslint-config-next/node_modules/
    // eslint-plugin-react/lib/util/version.js`) yalnız `settings.react.
    // version === 'detect'` iken dosya sistemi taramasına (ve çöken
    // `context.getFilename()` çağrısına) düşüyor; açık bir semver string
    // verildiğinde o kod yolu hiç çalışmıyor. Bu; kuralı kapatmak veya
    // eklentiyi/ESLint'i indirmek değil, aracın kendi belgelediği
    // yapılandırma değeridir.
    settings: {
      react: {
        version: "19.3.0",
      },
    },
  },
  {
    // `eslint-config-next/core-web-vitals`in EN GENİŞ bloğu
    // (`**/*.{js,jsx,mjs,ts,tsx,mts,cts}`) tüm bu uzantılar için kendi
    // Babel tabanlı `eslint-config-next/parser`'ını atar; yalnız `**/*.ts`/
    // `**/*.tsx` için AYRICA daha dar bir blokla `typescript-eslint/
    // parser`'a geçer (`node_modules/eslint-config-next/dist/
    // core-web-vitals.js`). `.mjs/.cjs/.js/.jsx/.mts/.cts` o dar eşleşmeye
    // girmediğinden Babel ayrıştırıcıda kalıyor. O ayrıştırıcının ürettiği
    // scope objesi ESLint 10.10.0'ın `SourceCode.finalize()` içinde artık
    // zorunlu çağırdığı `scopeManager.addGlobals(...)` metodunu içermiyor
    // (`node_modules/eslint/lib/languages/js/source-code/source-code.js`)
    // — bu yüzden `eslint.config.mjs`, `postcss.config.mjs`,
    // `vitest.config.mts`, `scripts/db-init.mts` gibi TÜM bu uzantılardaki
    // dosyalar "scopeManager.addGlobals is not a function" ile çöküyordu
    // (yalnız `.mts`/`.cts` değil — tek tek dosya bazlı `eslint <dosya>`
    // denemeleriyle doğrulandı).
    //
    // Kök neden düzeltmesi: aynı geniş kapsamı (`typescript-eslint`
    // paketinin kendi `globs.jsts` deseni — `**/*.{mjs,js,cjs,jsx,mts,ts,
    // cts,tsx}`) K9'da zaten sabitlenmiş `typescript-eslint/parser`'a
    // bağlamak; bu parser düz JS/JSX'i de ayrıştırabilir, tip bilgisi
    // gerektiren bir kural kullanılmıyor. Ayrı bir bağımlılık eklenmedi.
    files: [tseslint.globs.jsts],
    languageOptions: {
      parser: tseslint.parser,
    },
  },
  {
    ignores: [
      ".next/**",
      "out/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "data/**",
    ],
  },
];

export default eslintConfig;
