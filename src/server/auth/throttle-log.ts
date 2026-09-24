/**
 * 429 RATE_LIMITED / HASH_QUEUE_FULL için tek, aranabilir log satırı.
 *
 * Hız sınırı anahtarı plaka/IP'dir (kişisel veri): satıra plaka, IP, kullanıcı
 * adı veya parola YAZILMAZ; yalnız uç kapsamı, kod, `request_id` ve
 * HASH_QUEUE_FULL'da hash kuyruğu metriği yer alır.
 */
import { getHashQueueMetrics } from "./hash-queue";

export function logThrottled(
  scope: string,
  code: "RATE_LIMITED" | "HASH_QUEUE_FULL",
  requestId: string,
): void {
  let line = `[${scope}] ${code} (request_id=${requestId})`;
  if (code === "HASH_QUEUE_FULL") {
    const metrics = getHashQueueMetrics();
    line += ` hash_active=${metrics.activeCount} hash_pending=${metrics.pendingCount} hash_longest_wait_ms=${metrics.longestWaitMs}`;
  }
  console.warn(line);
}
