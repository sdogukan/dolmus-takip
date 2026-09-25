/**
 * Mutasyon gövdesi için kararlı (deterministic) SHA-256 özeti — T2.1.
 *
 * `../receipts/resolve-receipt.ts`in "aynı requestId + aynı requestHash →
 * replay; farklı hash → 409" karşılaştırması için kullanılır.
 * Çağıran YALNIZ makbuzun kapsadığı (kullanıcı tarafından değiştirilebilir)
 * alanları BURAYA verir — `requestId`'nin kendisi asla dahil edilmez (o
 * zaten makbuzun birincil anahtar bileşenidir).
 */
import crypto from "node:crypto";

export function hashRequestPayload(payload: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
