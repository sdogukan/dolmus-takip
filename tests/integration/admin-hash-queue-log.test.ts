import { afterEach, describe, expect, it, vi } from "vitest";
import { mapKnownAdminMutationErrorToResponse } from "../../src/app/api/v1/admin/_http";
import {
  HashQueueFullError,
  resetHashQueueForTests,
  runInHashQueue,
  HASH_QUEUE_MAX_CONCURRENT,
} from "../../src/server/auth/hash-queue";

/**
 * Admin mutasyon hata eşlemesi: HashQueueFullError → 429 HASH_QUEUE_FULL
 * yanıtı DEĞİŞMEZ; yalnız tek, kişisel veri taşımayan bir log satırı eklenir.
 */
describe("mapKnownAdminMutationErrorToResponse — HASH_QUEUE_FULL logu", () => {
  afterEach(() => {
    resetHashQueueForTests();
    vi.restoreAllMocks();
  });

  it("429 döner ve request_id + kuyruk metriği içeren TEK bir log satırı yazar", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    void Array.from({ length: HASH_QUEUE_MAX_CONCURRENT }, () =>
      runInHashQueue(() => new Promise<void>(() => {})),
    );

    const response = mapKnownAdminMutationErrorToResponse(
      new HashQueueFullError(),
      "req-admin-1",
    );

    expect(response?.status).toBe(429);
    const body = await response!.json();
    expect(body.error.code).toBe("HASH_QUEUE_FULL");
    expect(body.request_id).toBe("req-admin-1");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = String(warnSpy.mock.calls[0]?.[0]);
    expect(line).toContain("HASH_QUEUE_FULL");
    expect(line).toContain("request_id=req-admin-1");
    expect(line).toContain(`hash_active=${HASH_QUEUE_MAX_CONCURRENT}`);
    expect(line).toContain("hash_pending=0");
    expect(line).toMatch(/hash_longest_wait_ms=0/);
  });

  it("başka hata sınıfları log yazmaz ve undefined döner", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      mapKnownAdminMutationErrorToResponse(new Error("x"), "req-admin-2"),
    ).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
