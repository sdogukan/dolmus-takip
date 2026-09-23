import { describe, expect, it } from "vitest";
import { isDraftStale } from "./draft-version";

describe("isDraftStale", () => {
  it("baseVersion sunucu sürümüyle aynıysa bayat SAYMAZ", () => {
    expect(isDraftStale({ baseVersion: 3, currentVersion: 3, pending: false })).toBe(false);
  });

  it("baseVersion sunucu sürümünden ESKİYSE bayat sayar (başka biri arada kaydetmiş)", () => {
    expect(isDraftStale({ baseVersion: 1, currentVersion: 2, pending: false })).toBe(true);
  });

  it("baseVersion sunucu sürümünden İLERİDEYSE de bayat sayar (savunma amaçlı — normalde oluşmaz)", () => {
    expect(isDraftStale({ baseVersion: 5, currentVersion: 4, pending: false })).toBe(true);
  });

  it("pending (sonucu belirsiz) taslağı sürüm uyuşmasa bile ASLA bayat saymaz", () => {
    expect(isDraftStale({ baseVersion: 1, currentVersion: 9, pending: true })).toBe(false);
  });
});
