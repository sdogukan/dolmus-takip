import { describe, expect, it } from "vitest";
import { TEAM_USER_MESSAGES } from "./messages";
import {
  TEAM_SESSION_ENDED_HREF,
  buildCreateUserBody,
  buildInfoPatchBody,
  buildResetPasswordBody,
  buildUpdateUserBody,
  classifyTeamError,
  diffTeamUser,
  normalizeTeamFullName,
  normalizeTeamUsername,
  pickFieldErrors,
  teamBannerMessage,
  teamDetailDraftName,
  teamResetDraftName,
  teamRoleLabel,
  teamUserResetUrl,
  teamUserUrl,
  validateCreateForm,
  validateTeamFullName,
  validateTeamPassword,
  validateTeamUsername,
} from "./team-users-ui";

describe("kullanıcı adı", () => {
  it("kırpar ve küçük harfe çevirir", () => {
    expect(normalizeTeamUsername("  Destek.Ayse ")).toBe("destek.ayse");
  });

  it("3–32 karakter ve izinli karakterleri kabul eder", () => {
    expect(validateTeamUsername("abc")).toBeUndefined();
    expect(validateTeamUsername("a.b_c-9")).toBeUndefined();
    expect(validateTeamUsername("a".repeat(32))).toBeUndefined();
    expect(validateTeamUsername(" Destek.Ayse ")).toBeUndefined();
  });

  it("kısa, uzun, boşluklu ve Türkçe karakterli adı reddeder", () => {
    expect(validateTeamUsername("ab")).toBe(TEAM_USER_MESSAGES.usernameInvalid);
    expect(validateTeamUsername("a".repeat(33))).toBe(TEAM_USER_MESSAGES.usernameInvalid);
    expect(validateTeamUsername("ayse k")).toBe(TEAM_USER_MESSAGES.usernameInvalid);
    expect(validateTeamUsername("şoför")).toBe(TEAM_USER_MESSAGES.usernameInvalid);
    expect(validateTeamUsername("")).toBe(TEAM_USER_MESSAGES.usernameInvalid);
  });
});

describe("ad soyad", () => {
  it("iç boşlukları tek boşluğa indirir", () => {
    expect(normalizeTeamFullName("  Ayşe   K. ")).toBe("Ayşe K.");
  });

  it("1–120 karakteri kabul eder, boş ve uzunu reddeder", () => {
    expect(validateTeamFullName("A")).toBeUndefined();
    expect(validateTeamFullName("a".repeat(120))).toBeUndefined();
    expect(validateTeamFullName("   ")).toBe(TEAM_USER_MESSAGES.fullNameInvalid);
    expect(validateTeamFullName("a".repeat(121))).toBe(TEAM_USER_MESSAGES.fullNameInvalid);
  });
});

describe("şifre", () => {
  it("kırpılmaz: yalnız boşluktan oluşan şifre geçerlidir", () => {
    expect(validateTeamPassword("   ")).toBeUndefined();
  });

  it("boşu forma özgü metinle, 200 karakterden uzunu uzunluk metniyle reddeder", () => {
    expect(validateTeamPassword("")).toBe(TEAM_USER_MESSAGES.passwordEmpty);
    expect(validateTeamPassword("", TEAM_USER_MESSAGES.newPasswordEmpty)).toBe(TEAM_USER_MESSAGES.newPasswordEmpty);
    expect(validateTeamPassword("a".repeat(200))).toBeUndefined();
    expect(validateTeamPassword("a".repeat(201))).toBe(TEAM_USER_MESSAGES.passwordTooLong);
  });
});

describe("oluşturma formu", () => {
  const valid = { username: "Destek.Ayse", fullName: "Ayşe  K.", platformRole: "support" as const, password: "s3cret" };

  it("geçerli değerlerde hata üretmez", () => {
    expect(validateCreateForm(valid)).toEqual({});
  });

  it("her geçersiz alanı kendi anahtarıyla bildirir", () => {
    expect(validateCreateForm({ username: "a", fullName: "", platformRole: "admin", password: "" })).toEqual({
      username: TEAM_USER_MESSAGES.usernameInvalid,
      fullName: TEAM_USER_MESSAGES.fullNameInvalid,
      password: TEAM_USER_MESSAGES.passwordEmpty,
    });
  });

  it("gövde kanonik değerleri ve platformRole'ü taşır; aktör rolü/kimliği göndermez", () => {
    const body = buildCreateUserBody("req-1", valid);
    expect(body).toEqual({
      requestId: "req-1",
      username: "destek.ayse",
      fullName: "Ayşe K.",
      platformRole: "support",
      password: "s3cret",
    });
    expect(Object.keys(body)).not.toContain("role");
    expect(Object.keys(body)).not.toContain("userId");
  });
});

describe("güncelleme", () => {
  const user = { fullName: "Ayşe K.", platformRole: "support" as const };

  it("değişiklik yoksa boş fark döner", () => {
    expect(diffTeamUser(user, { fullName: " Ayşe   K. ", platformRole: "support" })).toEqual({});
  });

  it("yalnız değişen alanları döner", () => {
    expect(diffTeamUser(user, { fullName: "Ayşe K.", platformRole: "admin" })).toEqual({ platformRole: "admin" });
    expect(diffTeamUser(user, { fullName: "Ayşe Y.", platformRole: "support" })).toEqual({ fullName: "Ayşe Y." });
  });

  it("adı olmayan hesapta boş ad değişiklik sayılmaz", () => {
    expect(diffTeamUser({ fullName: null, platformRole: "admin" }, { fullName: "", platformRole: "admin" })).toEqual({});
  });

  it("gövde taslağın sürümünü ve yalnız verilen alanları taşır", () => {
    expect(buildUpdateUserBody("req-2", 3, { active: false })).toEqual({ requestId: "req-2", version: 3, active: false });
  });
});

describe("bilgi PATCH gövdesi (dondurulmuş taslak)", () => {
  it("yalnız dondurulmuş değişiklikleri, taslağın requestId ve sürümüyle taşır", () => {
    expect(buildInfoPatchBody({ requestId: "req-9", baseVersion: 4, changes: { platformRole: "admin" } })).toEqual({
      requestId: "req-9",
      version: 4,
      platformRole: "admin",
    });
  });

  it("adı olmayan hesapta yalnız yetki değişirse fullName anahtarı gitmez", () => {
    const changes = diffTeamUser({ fullName: null, platformRole: "support" }, { fullName: "", platformRole: "admin" });
    expect(Object.keys(buildInfoPatchBody({ requestId: "r", baseVersion: 1, changes }))).toEqual([
      "requestId",
      "version",
      "platformRole",
    ]);
  });

  it("gövde sunucudaki güncel kayda bağlı değildir: yeniden yüklemeden sonra da aynıdır", () => {
    const serverBefore = { fullName: "Eski", platformRole: "support" as const };
    const serverAfter = { fullName: "Yeni", platformRole: "admin" as const };
    const frozen = {
      requestId: "req-1",
      baseVersion: 2,
      changes: diffTeamUser(serverBefore, { fullName: "Yeni", platformRole: "admin" }),
    };
    const first = buildInfoPatchBody(frozen);
    // Kayıt işlendi; canlı fark artık boş — dondurulmuş gövde değişmez.
    expect(diffTeamUser(serverAfter, { fullName: "Yeni", platformRole: "admin" })).toEqual({});
    expect(buildInfoPatchBody(frozen)).toEqual(first);
    expect(first).toEqual({ requestId: "req-1", version: 2, fullName: "Yeni", platformRole: "admin" });
  });
});

describe("şifre sıfırlama ve adresler", () => {
  it("gövde yalnız requestId ve newPassword taşır", () => {
    expect(buildResetPasswordBody("req-3", "yeni")).toEqual({ requestId: "req-3", newPassword: "yeni" });
  });

  it("kimlik yalnız URL'de yer alır ve kaçışlanır", () => {
    expect(teamUserUrl("u-1")).toBe("/api/v1/admin/users/u-1");
    expect(teamUserUrl("a/b")).toBe("/api/v1/admin/users/a%2Fb");
    expect(teamUserResetUrl("u-1")).toBe("/api/v1/admin/users/u-1/reset-password");
  });

  it("taslak adları kullanıcıya özgüdür ve birbirinden ayrıdır", () => {
    expect(teamDetailDraftName("u-1")).not.toBe(teamResetDraftName("u-1"));
    expect(teamDetailDraftName("u-1")).not.toBe(teamDetailDraftName("u-2"));
  });

  it("oturum bitti adresi giriş sayfasına ?oturum=bitti ile gider", () => {
    expect(TEAM_SESSION_ENDED_HREF).toBe("/yonetim/giris?oturum=bitti");
  });
});

describe("hata sınıflandırma ve metinler", () => {
  it("durum kodlarını ekran sınıfına çevirir", () => {
    expect(classifyTeamError(401, "SESSION_EXPIRED")).toBe("session-ended");
    expect(classifyTeamError(403, "FORBIDDEN")).toBe("unauthorized");
    expect(classifyTeamError(409, "VERSION_CONFLICT")).toBe("conflict");
    expect(classifyTeamError(409, "REQUEST_ID_REUSED")).toBe("request-reused");
    expect(classifyTeamError(422, "VALIDATION_ERROR")).toBe("validation");
    expect(classifyTeamError(500)).toBe("connection");
    expect(classifyTeamError(503, "X")).toBe("connection");
    expect(classifyTeamError(404, "NOT_FOUND")).toBe("connection");
  });

  it("banner metinleri Türkçe ekran metnidir", () => {
    expect(teamBannerMessage({ status: 403, code: "FORBIDDEN" }, "x")).toBe("Bu işlem için erişimin yok.");
    expect(teamBannerMessage({ status: 401 }, "x")).toBe("Oturumun sona erdi. Yeniden giriş yap.");
    expect(teamBannerMessage({ status: 409, code: "VERSION_CONFLICT" }, "x")).toContain("Bu kayıt değişmiş");
    expect(teamBannerMessage({ status: 409, code: "REQUEST_ID_REUSED" }, "forma özgü")).toBe("forma özgü");
    expect(teamBannerMessage({ status: 500 }, "x")).toBe(TEAM_USER_MESSAGES.connection);
  });

  it("alan hatası olmayan 422: 'değişiklik yok' özel metin, diğerleri genel doğrulama metni", () => {
    expect(teamBannerMessage({ status: 422, code: "VALIDATION_ERROR", fields: { change: "Değişiklik yok." } }, "x")).toBe(
      TEAM_USER_MESSAGES.noChange,
    );
    expect(teamBannerMessage({ status: 422, code: "VALIDATION_ERROR" }, "x")).toContain("geçersiz");
  });

  it("sunucunun ham error.message'ı ekrana taşınmaz", () => {
    const text = teamBannerMessage({ status: 500, code: "INTERNAL", fields: { message: "SQLITE_ERROR at /srv" } }, "x");
    expect(text).not.toContain("SQLITE");
  });
});

describe("pickFieldErrors", () => {
  it("yalnız bilinen alanları alır (ör. yinelenen kullanıcı adı username'e düşer)", () => {
    const outcome = { status: 422, code: "VALIDATION_ERROR", fields: { username: "Bu kullanıcı adı zaten kullanılıyor.", extra: "y" } };
    expect(pickFieldErrors(outcome, ["username", "fullName"] as const)).toEqual({
      username: "Bu kullanıcı adı zaten kullanılıyor.",
    });
  });

  it("422 değilse, alan yoksa veya bilinen alan eşleşmezse undefined döner", () => {
    expect(pickFieldErrors({ status: 409, fields: { username: "x" } }, ["username"] as const)).toBeUndefined();
    expect(pickFieldErrors({ status: 422 }, ["username"] as const)).toBeUndefined();
    expect(pickFieldErrors({ status: 422, fields: { change: "Değişiklik yok." } }, ["username"] as const)).toBeUndefined();
    expect(pickFieldErrors({ status: 422, fields: { username: "" } }, ["username"] as const)).toBeUndefined();
  });
});

describe("rol etiketleri", () => {
  it("yönetim başlığındaki etiketlerle aynıdır", () => {
    expect(teamRoleLabel("admin")).toBe("Yönetici");
    expect(teamRoleLabel("support")).toBe("Destek");
  });
});
