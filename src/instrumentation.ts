/**
 * Next.js `register()` kancası — T1.4 ADIM 1/2, S1.4.
 *
 * Kaynak: `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`
 * — "create `instrumentation.ts|js` file in the root directory of your
 * project (or inside the `src` folder if using one)... export a `register`
 * function... called once when a new Next.js server instance is
 * initiated, and must complete before the server is ready to handle
 * requests." Görev tanımı bu kancayı açıkça DB açılış/migration kapısı
 * için işaret eder (bkz. `./server/data/app-db.ts` üstündeki not).
 *
 * `register()` HER runtime'da (nodejs VE edge) çağrılır (aynı belge,
 * "Importing runtime-specific code"); better-sqlite3 yalnız Node.js
 * runtime'ında çalışabildiğinden `NEXT_RUNTIME` denetimiyle edge'de
 * atlanır.
 *
 * DÜZELTME (düzeltme turu 1): `resolveTrustedAppOrigin()` (bkz.
 * `./server/auth/app-origin.ts`) de burada EAGER çağrılır — eksik/geçersiz
 * `APP_ORIGIN` da DB migration eksikliği gibi bir "açık dağıtım hatası"dır;
 * sunucu yarı yapılandırılmış halde trafik almadan önce (ilk yazma isteğini
 * beklemeden) açıkça başarısız olmalıdır.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getAppDb } = await import("./server/data/app-db");
    // Migration bekliyorsa burada (sunucu ayağa kalkarken) açıkça
    // fırlar — "migration bekliyorsa açıklı hata, otomatik migration
    // yok" (görev tanımı). İlk isteği beklemeden erken başarısız olmak,
    // yarı hazır bir sunucunun trafik almasını engeller.
    getAppDb();

    const { resolveTrustedAppOrigin } = await import("./server/auth/app-origin");
    resolveTrustedAppOrigin();
  }
}
