import { describe, expect, it } from "vitest";
import { WORK_ENTRY_MESSAGES as TEXT } from "../../../lib/messages";
import { ForbiddenClientScopeFieldError, scopeSafeObject } from "../../auth/scope";
import { workEntrySubjectSchema } from "./subject";

describe("workEntrySubjectSchema", () => {
  it("driver türü ve kişi kimliğini kabul eder", () => {
    const result = workEntrySubjectSchema.safeParse({ workType: "driver", workerPersonId: "p-1" });
    expect(result.success && result.data).toEqual({ workType: "driver", workerPersonId: "p-1" });
  });

  it("owner türünde kişi kimliği olmadan geçer", () => {
    expect(workEntrySubjectSchema.safeParse({ workType: "owner" }).success).toBe(true);
  });

  it("istemcinin gönderdiği kapsam/tür/pay alanlarını atar", () => {
    const result = workEntrySubjectSchema.safeParse({
      workType: "driver",
      workerPersonId: "p-1",
      personId: "x",
      businessId: "b",
      role: "owner",
      workKind: "owner",
      shareBps: 0,
    });
    expect(result.success && result.data).toEqual({ workType: "driver", workerPersonId: "p-1" });
  });

  it.each([
    ["eksik", undefined],
    ["bilinmeyen değer", "admin"],
    ["sayı", 1],
    ["boş metin", ""],
  ])("geçersiz workType (%s) reddedilir", (_label, value) => {
    const result = workEntrySubjectSchema.safeParse({ workType: value });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.message).toBe(TEXT.workTypeInvalid);
  });

  it("çok uzun ya da metin olmayan workerPersonId reddedilir", () => {
    expect(
      workEntrySubjectSchema.safeParse({ workType: "driver", workerPersonId: "a".repeat(65) }).success,
    ).toBe(false);
    expect(workEntrySubjectSchema.safeParse({ workType: "driver", workerPersonId: 5 }).success).toBe(false);
  });

  it("kişi alanı personId adını kullanmaz (scopeSafeObject kuralı)", () => {
    expect(Object.keys(workEntrySubjectSchema.shape)).not.toContain("personId");
    expect(() => scopeSafeObject({ personId: workEntrySubjectSchema })).toThrow(
      ForbiddenClientScopeFieldError,
    );
  });
});
