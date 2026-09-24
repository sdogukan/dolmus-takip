import { describe, expect, it } from "vitest";
import { anonymousFullName, isValidFullName, normalizeFullName } from "./person-name";

describe("anonymousFullName", () => {
  it("yalnız kimliğin ilk 6 karakterinden, büyük harfle türetilir", () => {
    expect(anonymousFullName("3f9a1c2e-0000-4000-8000-000000000000")).toBe("Anonim kişi 3F9A1C");
  });

  it("aynı kimlik her zaman aynı adı, farklı kimlik farklı adı verir", () => {
    const id = "a1b2c3d4-1111-4111-8111-111111111111";
    expect(anonymousFullName(id)).toBe(anonymousFullName(id));
    expect(anonymousFullName("a1b2c4d4-1111-4111-8111-111111111111")).not.toBe(anonymousFullName(id));
  });

  it("normalize edilmiş haliyle aynıdır ve ad doğrulamasından geçer", () => {
    const name = anonymousFullName("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(normalizeFullName(name)).toBe(name);
    expect(isValidFullName(name)).toBe(true);
  });
});
