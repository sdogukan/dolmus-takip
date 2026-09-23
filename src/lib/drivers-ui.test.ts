import { describe, expect, it } from "vitest";
import {
  buildAddRequest,
  buildOpRequest,
  describeAffectedVehicle,
  driverErrorMessage,
  emptyDriversDraft,
  findSimilarCandidates,
  isAmbiguousStatus,
  isOpStale,
  normalizeDriverName,
  splitDrivers,
  validateDriverName,
  type DriverOpDraft,
  type DriverRow,
  type DriversView,
} from "./drivers-ui";
import { DRIVER_FIELD_MESSAGES, DRIVER_SCREEN_MESSAGES } from "./messages";

function row(overrides: Partial<DriverRow> & { personId: string }): DriverRow {
  return {
    fullName: "Ad Soyad",
    personActive: true,
    personVersion: 1,
    assignment: { active: true, version: 1 },
    ...overrides,
  };
}

function op(overrides: Partial<DriverOpDraft>): DriverOpDraft {
  return {
    requestId: "rid-1",
    kind: "rename",
    personId: "p1",
    baseVersion: 1,
    fullName: "Yeni Ad",
    active: true,
    pending: false,
    ...overrides,
  };
}

describe("normalizeDriverName / validateDriverName", () => {
  it("baş/son boşluğu kırpar, iç boşluğu tek boşluğa indirir", () => {
    expect(normalizeDriverName("  Ahmet   Yılmaz ")).toBe("Ahmet Yılmaz");
  });

  it("boş ve yalnız boşluktan oluşan adı reddeder", () => {
    expect(validateDriverName("")).toBe(DRIVER_FIELD_MESSAGES.fullName);
    expect(validateDriverName("   ")).toBe(DRIVER_FIELD_MESSAGES.fullName);
  });

  it("120 karakteri kabul eder, 121'i reddeder", () => {
    expect(validateDriverName("a".repeat(120))).toBeUndefined();
    expect(validateDriverName("a".repeat(121))).toBe(DRIVER_FIELD_MESSAGES.fullName);
  });
});

describe("splitDrivers", () => {
  it("aktif atama + aktif kişi aktif listededir; pasif atama ve pasif kişi pasif listede", () => {
    const rows = [
      row({ personId: "a" }),
      row({ personId: "b", assignment: { active: false, version: 2 } }),
      row({ personId: "c", personActive: false }),
      row({ personId: "d", assignment: null }),
    ];
    const { active, inactive } = splitDrivers(rows);
    expect(active.map((r) => r.personId)).toEqual(["a"]);
    expect(inactive.map((r) => r.personId)).toEqual(["b", "c", "d"]);
  });

  it("aynı adlı iki kişiyi iki ayrı satır olarak korur", () => {
    const { active } = splitDrivers([
      row({ personId: "x1", fullName: "Mehmet Öz" }),
      row({ personId: "x2", fullName: "Mehmet Öz" }),
    ]);
    expect(active.map((r) => r.personId)).toEqual(["x1", "x2"]);
  });
});

describe("findSimilarCandidates", () => {
  const candidates = [
    { personId: "1", fullName: "Şükrü Çelik" },
    { personId: "2", fullName: "Ahmet Yılmaz" },
    { personId: "3", fullName: "Ayşe Demir" },
  ];

  it("Türkçe harf ve büyük/küçük harf farkını yok sayar", () => {
    expect(findSimilarCandidates("sukru celik", candidates).map((c) => c.personId)).toEqual(["1"]);
    expect(findSimilarCandidates("AHMET yilmaz", candidates).map((c) => c.personId)).toEqual(["2"]);
  });

  it("yazılan her sözcük bir aday sözcüğünün başıyla eşleşmeli", () => {
    expect(findSimilarCandidates("Ahm", candidates).map((c) => c.personId)).toEqual(["2"]);
    expect(findSimilarCandidates("Ahmet Demir", candidates)).toEqual([]);
  });

  it("tek harflik/boş girdide ipucu üretmez", () => {
    expect(findSimilarCandidates("A", candidates)).toEqual([]);
    expect(findSimilarCandidates("  ", candidates)).toEqual([]);
  });
});

describe("isOpStale", () => {
  const view: DriversView = {
    drivers: [row({ personId: "p1", personVersion: 3, assignment: { active: true, version: 5 } })],
    candidates: [{ personId: "c1", fullName: "Aday" }],
  };

  it("rename: kişi sürümü değiştiyse bayat, aynıysa değil", () => {
    expect(isOpStale(op({ kind: "rename", baseVersion: 3 }), view)).toBe(false);
    expect(isOpStale(op({ kind: "rename", baseVersion: 2 }), view)).toBe(true);
  });

  it("assignment: atama sürümüne göre karar verir", () => {
    expect(isOpStale(op({ kind: "assignment", baseVersion: 5 }), view)).toBe(false);
    expect(isOpStale(op({ kind: "assignment", baseVersion: 3 }), view)).toBe(true);
  });

  it("link: kişi artık aday değilse bayat", () => {
    expect(isOpStale(op({ kind: "link", personId: "c1", baseVersion: null }), view)).toBe(false);
    expect(isOpStale(op({ kind: "link", personId: "p1", baseVersion: null }), view)).toBe(true);
  });

  it("listede olmayan kişi bayat; pending işlem ASLA bayat sayılmaz", () => {
    expect(isOpStale(op({ personId: "yok" }), view)).toBe(true);
    expect(isOpStale(op({ personId: "yok", pending: true }), view)).toBe(false);
    expect(isOpStale(op({ kind: "rename", baseVersion: 1, pending: true }), view)).toBe(false);
  });
});

describe("istek kurma", () => {
  it("POST gövdesi yalnız requestId + normalize edilmiş ad taşır", () => {
    const draft = { ...emptyDriversDraft(() => "rid-add").add, fullName: "  Ali   Veli " };
    expect(buildAddRequest(draft)).toEqual({
      method: "POST",
      url: "/api/v1/drivers",
      body: { requestId: "rid-add", fullName: "Ali Veli" },
    });
  });

  it("link: PUT, sürümsüz, personId yalnız URL'de", () => {
    const request = buildOpRequest(op({ kind: "link", baseVersion: null }), "v-1");
    expect(request.method).toBe("PUT");
    expect(request.url).toBe("/api/v1/vehicles/v-1/drivers/p1");
    expect(request.body).toEqual({ requestId: "rid-1", active: true });
  });

  it("assignment: PUT, mevcut atama sürümüyle", () => {
    const request = buildOpRequest(op({ kind: "assignment", baseVersion: 4, active: false }), "v-1");
    expect(request.body).toEqual({ requestId: "rid-1", active: false, version: 4 });
  });

  it("rename ve person: PATCH kişi URL'sine, gövdede yalnız ilgili alan", () => {
    const rename = buildOpRequest(op({ kind: "rename", baseVersion: 3, fullName: " Yeni  Ad " }), "v-1");
    expect(rename).toEqual({
      method: "PATCH",
      url: "/api/v1/drivers/p1",
      body: { requestId: "rid-1", version: 3, fullName: "Yeni Ad" },
    });
    const person = buildOpRequest(op({ kind: "person", baseVersion: 3, active: false }), "v-1");
    expect(person.body).toEqual({ requestId: "rid-1", version: 3, active: false });
  });

  it("hiçbir gövde personId/businessId/vehicleId/role taşımaz", () => {
    for (const kind of ["link", "assignment", "rename", "person"] as const) {
      const { body } = buildOpRequest(op({ kind, baseVersion: 1 }), "v-1");
      for (const forbidden of ["personId", "businessId", "vehicleId", "role", "actor"]) {
        expect(body).not.toHaveProperty(forbidden);
      }
    }
  });

  it("URL segmenti kaçışlanır", () => {
    expect(buildOpRequest(op({ personId: "a/b" }), "v-1").url).toBe("/api/v1/drivers/a%2Fb");
  });
});

describe("hata metni", () => {
  it("bilinen kodlar ekran metnine çevrilir; sunucu mesajı kullanılmaz", () => {
    expect(driverErrorMessage(409, "VERSION_CONFLICT")).toBe("Bu kayıt değişmiş. Güncel halini açıp tekrar kontrol et.");
    expect(driverErrorMessage(403, "FORBIDDEN")).toBe("Bu işlem için erişimin yok.");
    expect(driverErrorMessage(404, "PERSON_NOT_FOUND")).toBe("Kişi bulunamadı.");
    expect(driverErrorMessage(403, "TARGET_INACTIVE_FOR_WRITE")).toBe(
      "İşletme veya araç artık pasif; bu işlem yapılamaz.",
    );
  });

  it("5xx ve bilinmeyen kod genel bağlantı metnine düşer", () => {
    expect(driverErrorMessage(500, "VERSION_CONFLICT")).toBe("Bağlantı kurulamadı. Tekrar dene.");
    expect(driverErrorMessage(400, "BILINMEYEN")).toBe("Bağlantı kurulamadı. Tekrar dene.");
    expect(driverErrorMessage(400, undefined)).toBe("Bağlantı kurulamadı. Tekrar dene.");
  });

  it("yalnız 5xx belirsiz sayılır", () => {
    expect(isAmbiguousStatus(503)).toBe(true);
    expect(isAmbiguousStatus(409)).toBe(false);
  });
});

describe("ekran metinleri ve etkilenen araç", () => {
  it("issue'daki birebir metinleri taşır", () => {
    expect(DRIVER_SCREEN_MESSAGES.renameNote).toBe("Bu kişinin eski kayıtları da yeni adıyla görünür.");
    expect(DRIVER_SCREEN_MESSAGES.emptyActiveList).toBe("Bu araç için şoför eklenmemiş.");
    expect(DRIVER_SCREEN_MESSAGES.sharedPasswordWarning).toBe(
      "Ortak şoför şifresi hâlâ geçerli. Erişimi tamamen kesmek için ekipten şifre sıfırlama isteyin.",
    );
  });

  it("etkilenen araç plakayı görüntü biçiminde yazar, pasif atamayı belirtir", () => {
    expect(describeAffectedVehicle({ vehicleId: "v", plateNormalized: "34AAA001", assignmentActive: true })).toBe(
      "34 AAA 001",
    );
    expect(describeAffectedVehicle({ vehicleId: "v", plateNormalized: "34AAA001", assignmentActive: false })).toBe(
      "34 AAA 001 (pasif atama)",
    );
  });
});
