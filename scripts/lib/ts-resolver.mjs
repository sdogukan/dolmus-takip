/**
 * `node --import ./scripts/lib/ts-resolver.mjs script.ts` için çözümleyici kancası.
 * `src/` altındaki use case'ler uzantısız göreli import kullanır (bundler çözümler);
 * Node'un yerel TS çalıştırması bunları çözemez. Kanca, bulunamayan göreli
 * belirteci `.ts` / `/index.ts` ekleyerek, `next/server` gibi uzantısız paket
 * alt yolunu `.js` ekleyerek yeniden dener; başka hiçbir şeyi değiştirmez.
 */
import { register } from "node:module";

const hooks = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    const suffixes = /^\\.\\.?\\//u.test(specifier) ? [".ts", "/index.ts"] : [".js"];
    for (const suffix of suffixes) {
      try {
        return await nextResolve(specifier + suffix, context);
      } catch {
        // sıradaki ekli dene
      }
    }
    throw error;
  }
}
`;

register(`data:text/javascript,${encodeURIComponent(hooks)}`);
