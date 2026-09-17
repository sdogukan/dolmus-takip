import { NextResponse } from "next/server";

/**
 * Liveness kontrolü: yalnız sürecin ayakta olduğunu doğrular.
 *
 * ARCHITECTURE.md §4 ve §8.2 — "/api/v1/health/live" yalnız localhost'a
 * açık, systemd sağlık denetimi tarafından çağrılan iç uçtur ve DB'ye
 * dokunmaz (donmuş event-loop'u da yakalayabilmesi için bağımsız ve
 * hafif kalmalıdır). Readiness (DB açık mı) kontrolü ayrı bir uçtur ve
 * bu pakette henüz yazılmaz.
 */
export function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
