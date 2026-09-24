/**
 * Readiness kontrolü: DB açılabiliyor, migration'lar uygulanmış ve küçük bir
 * uygulama tablosu okunabiliyor mu?
 *
 * ARCHITECTURE.md §4 ve §8.2 — `../live/route.ts` DB'ye dokunmaz; bu uç
 * yalnız localhost'a açık (Caddy `/api/v1/health/*` yolunu dışarıya 404
 * verir) sistem sağlık denetiminin DB hazırlığını sorduğu ayrı uçtur.
 * `PRAGMA integrity_check` veya tam tarama YAPMAZ: tek, sınırlı bir okuma.
 *
 * Okuma HAM istemciden (`db.$client`) ve bağlı değer OLMADAN yapılır:
 * Drizzle sorgu hatası SQL'i ve parametreleri mesajında taşıdığından, log
 * satırına yalnız hata sınıfı adı ve (varsa) SQLite kodu yazılır.
 */
import { getAppDb } from "../../../../../server/data/app-db";
import {
  generateRequestId,
  jsonErrorResponse,
} from "../../../../../server/http/errors";
import { NextResponse } from "next/server";

function describeFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  return code ? `${name} (${code})` : name;
}

export function GET(): Response {
  const requestId = generateRequestId();
  try {
    const db = getAppDb();
    db.$client.prepare("SELECT 1 FROM businesses LIMIT 1").get();
    return NextResponse.json(
      { status: "ok" },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = jsonErrorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      "Sunucu şu anda hazır değil. Az sonra tekrar deneyin.",
      { requestId },
    );
    // Ayrıntı (yol/SQL/migration sayısı) istemciye DÖNMEZ; yalnız sunucu logu.
    console.error(
      `[health/ready] veritabanı hazır değil (request_id=${requestId}): ${describeFailure(error)}`,
    );
    return response;
  }
}
