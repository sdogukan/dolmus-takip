import { describe, expect, it } from "vitest";
import { selectableFromDriversResponse } from "./work-entry-ui";

const managed = (overrides: Record<string, unknown>) => ({
  personId: "p",
  fullName: "Ad Soyad",
  personActive: true,
  personVersion: 1,
  assignment: { active: true, version: 1 },
  ...overrides,
});

describe("selectableFromDriversResponse", () => {
  it("şoför biçimi: satırları olduğu gibi döndürür", () => {
    expect(
      selectableFromDriversResponse({ drivers: [{ personId: "a", fullName: "Ali" }] }),
    ).toEqual([{ personId: "a", fullName: "Ali" }]);
  });

  it("yönetim görünümü: yalnız aktif atama + aktif kişi seçilebilir", () => {
    const body = {
      drivers: [
        managed({ personId: "ok", fullName: "Aktif" }),
        managed({ personId: "inactive-assignment", assignment: { active: false, version: 2 } }),
        managed({ personId: "inactive-person", personActive: false }),
        managed({ personId: "no-assignment", assignment: null }),
      ],
      candidates: [{ personId: "c", fullName: "Aday" }],
    };
    expect(selectableFromDriversResponse(body)).toEqual([{ personId: "ok", fullName: "Aktif" }]);
  });

  it("aynı adlı iki kişi iki ayrı satırdır; yalnız kimlik ve ad taşınır", () => {
    const result = selectableFromDriversResponse({
      drivers: [managed({ personId: "1", fullName: "Mehmet Öz" }), managed({ personId: "2", fullName: "Mehmet Öz" })],
    });
    expect(result).toEqual([
      { personId: "1", fullName: "Mehmet Öz" },
      { personId: "2", fullName: "Mehmet Öz" },
    ]);
  });

  it("boş liste geçerlidir (boş durum), bozuk yanıt null döner", () => {
    expect(selectableFromDriversResponse({ drivers: [] })).toEqual([]);
    expect(selectableFromDriversResponse(null)).toBeNull();
    expect(selectableFromDriversResponse({})).toBeNull();
    expect(selectableFromDriversResponse({ drivers: "x" })).toBeNull();
    expect(selectableFromDriversResponse({ drivers: [null] })).toBeNull();
    expect(selectableFromDriversResponse({ drivers: [{ personId: 1, fullName: "x" }] })).toBeNull();
    expect(selectableFromDriversResponse({ drivers: [{ personId: "a" }] })).toBeNull();
  });

  it("yönetim satırında bozuk aktiflik alanı listeyi reddeder (sessizce seçilebilir yapmaz)", () => {
    expect(selectableFromDriversResponse({ drivers: [managed({ personActive: "yes" })] })).toBeNull();
    expect(
      selectableFromDriversResponse({ drivers: [managed({ assignment: { active: "yes" } })] }),
    ).toBeNull();
  });
});
