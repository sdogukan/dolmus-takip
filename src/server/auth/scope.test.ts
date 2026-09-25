/**
 * scope.ts birim testleri (DB erişimi OLMAYAN saf kısımlar) — T1.5 ADIM
 * 1/2, S1.5. DB'ye ihtiyaç duyan `resolveStaffVehicleScopeFromHeader`/
 * `resolveAdminScope` gerçek geçici SQLite ile
 * `tests/integration/scope-resolution.test.ts`'te sınanır (finansal DB
 * testleri yalnız mock veya :memory: üzerinde kabul edilmez;
 * bu kural mali OLMASA da aynı "gerçek DB" ilkesi tutarlılık için burada
 * da izlenir).
 */
import { z } from "zod";
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import type { SessionContext } from "../usecases/session/types";
import {
  computeScopeKey,
  FORBIDDEN_CLIENT_SCOPE_FIELDS,
  ForbiddenClientScopeFieldError,
  InvalidSessionKindForScopeError,
  scopeFromVehicleSession,
  scopeSafeObject,
} from "./scope";

function vehicleContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    kind: "vehicle",
    role: "owner",
    businessId: "biz-1",
    vehicleId: "veh-1",
    credentialId: "cred-1",
    sessionId: "sess-1",
    csrfToken: "csrf-1",
    ...overrides,
  };
}

function platformContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    kind: "platform",
    role: "support",
    platformUserId: "platform-1",
    sessionId: "sess-2",
    csrfToken: "csrf-2",
    ...overrides,
  };
}

describe("scopeFromVehicleSession — T1.5 (araç oturumu → Scope, DB'siz saf dönüşüm)", () => {
  it("owner oturumu için Scope { businessId, vehicleId, actor:'owner', credentialId } üretir", () => {
    const scope = scopeFromVehicleSession(vehicleContext({ role: "owner" }));
    expect(scope).toEqual({
      kind: "vehicle",
      actor: "owner",
      businessId: "biz-1",
      vehicleId: "veh-1",
      credentialId: "cred-1",
    });
  });

  it("driver oturumu için actor:'driver' üretir", () => {
    const scope = scopeFromVehicleSession(vehicleContext({ role: "driver" }));
    expect(scope.actor).toBe("driver");
  });

  it("kind !== 'vehicle' iken (ör. platform oturumu) fırlatır — çağıranın kendi hatası", () => {
    expect(() => scopeFromVehicleSession(platformContext())).toThrow(
      InvalidSessionKindForScopeError,
    );
  });

  it("businessId/vehicleId/credentialId eksikse (invaryant ihlali) fırlatır", () => {
    expect(() =>
      scopeFromVehicleSession(vehicleContext({ businessId: undefined })),
    ).toThrow(InvalidSessionKindForScopeError);
    expect(() =>
      scopeFromVehicleSession(vehicleContext({ vehicleId: undefined })),
    ).toThrow(InvalidSessionKindForScopeError);
    expect(() =>
      scopeFromVehicleSession(vehicleContext({ credentialId: undefined })),
    ).toThrow(InvalidSessionKindForScopeError);
  });

  it("role admin/support ile (asla olmaması gereken bir vehicle-context) fırlatır", () => {
    expect(() =>
      scopeFromVehicleSession(vehicleContext({ role: "admin" })),
    ).toThrow(InvalidSessionKindForScopeError);
  });
});

describe("scopeSafeObject — istemciden gelen role/personId/businessId/ownerId ASLA kapsamı genişletmez (S1.5 AC2)", () => {
  it("FORBIDDEN_CLIENT_SCOPE_FIELDS tam olarak görev tanımının verdiği dört alandır", () => {
    expect([...FORBIDDEN_CLIENT_SCOPE_FIELDS].sort()).toEqual(
      ["businessId", "ownerId", "personId", "role"].sort(),
    );
  });

  it.each(FORBIDDEN_CLIENT_SCOPE_FIELDS)(
    "yasaklı alan '%s' şema tanımında kullanılırsa şema TANIMLANIRKEN fırlatır",
    (field) => {
      expect(() => scopeSafeObject({ [field]: z.string() })).toThrow(
        ForbiddenClientScopeFieldError,
      );
    },
  );

  it("yasaklı alan içermeyen bir şema normal şekilde çalışır", () => {
    const schema = scopeSafeObject({ note: z.string() });
    expect(schema.parse({ note: "merhaba" })).toEqual({ note: "merhaba" });
  });

  it("istemci şemada TANIMLI OLMAYAN fazladan bir alan (ör. businessId) eklerse ayrıştırılmış çıktıdan SESSİZCE düşer (zod .strip())", () => {
    const schema = scopeSafeObject({ note: z.string() });
    const maliciousInput = {
      note: "merhaba",
      businessId: "baska-isletme-id",
      role: "admin",
      personId: "baska-kisi-id",
      ownerId: "baska-sahip-id",
    };
    const parsed = schema.parse(maliciousInput);
    expect(parsed).toEqual({ note: "merhaba" });
    expect(parsed).not.toHaveProperty("businessId");
    expect(parsed).not.toHaveProperty("role");
    expect(parsed).not.toHaveProperty("personId");
    expect(parsed).not.toHaveProperty("ownerId");
  });
});

describe("computeScopeKey — T1.4 notu / görev tanımı (T1.5)", () => {
  function expectedKey(kind: string, id: string, vehicleId: string): string {
    return crypto
      .createHash("sha256")
      .update(`${kind}:${id}:${vehicleId}`)
      .digest("hex")
      .slice(0, 16);
  }

  it("araç oturumu için SHA-256(kind + ':' + credentialId + ':' + vehicleId).slice(0,16) döner", () => {
    const context = vehicleContext();
    expect(computeScopeKey(context)).toBe(
      expectedKey("vehicle", "cred-1", "veh-1"),
    );
    expect(computeScopeKey(context)).toHaveLength(16);
  });

  it("ekip (platform) oturumu için vehicleId boş dizeyle yer tutulur", () => {
    const context = platformContext();
    expect(computeScopeKey(context)).toBe(
      expectedKey("platform", "platform-1", ""),
    );
  });

  it("gizli bir değer (token/hash) İÇERMEZ — yalnız opak/tahmin edilemez kısa hash", () => {
    const key = computeScopeKey(vehicleContext());
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });

  it("aynı girdi İÇİN kararlıdır (deterministik); farklı credentialId FARKLI anahtar üretir", () => {
    const a = computeScopeKey(vehicleContext({ credentialId: "cred-a" }));
    const b = computeScopeKey(vehicleContext({ credentialId: "cred-a" }));
    const c = computeScopeKey(vehicleContext({ credentialId: "cred-b" }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("farklı vehicleId (aynı credential) FARKLI anahtar üretir — client-state karışmasını önler (S1.4 AC2)", () => {
    const a = computeScopeKey(vehicleContext({ vehicleId: "veh-a" }));
    const b = computeScopeKey(vehicleContext({ vehicleId: "veh-b" }));
    expect(a).not.toBe(b);
  });

  it("credentialId/platformUserId eksikse (invaryant ihlali) fırlatır", () => {
    expect(() =>
      computeScopeKey(vehicleContext({ credentialId: undefined })),
    ).toThrow(InvalidSessionKindForScopeError);
    expect(() =>
      computeScopeKey(platformContext({ platformUserId: undefined })),
    ).toThrow(InvalidSessionKindForScopeError);
  });

  // Denetim bulgusu (düzeltme turu 2): `tests/integration/session-scope-
  // summary.test.ts`'teki "iki farklı ekip hesabı FARKLI scopeKey üretir —
  // role tek başına yeterli DEĞİLDİR" testi, seed'de yalnız bir aktif
  // support hesabı bulunduğundan pratikte support/admin (platformUserId
  // VE role birlikte farklı) karşılaştırır; "role tek başına yeterli
  // DEĞİLDİR" iddiasının kendisi (platformUserId SABİTKEN role
  // değişse bile scopeKey DEĞİŞMEZ; platformUserId değişirse role AYNI
  // kalsa bile scopeKey DEĞİŞİR) yalnız burada, DB'siz saf girdilerle,
  // birebir kanıtlanır.
  it("İKİ FARKLI platformUserId, AYNI role ('support') İÇİN FARKLI anahtar üretir — role tek başına ayırt edici DEĞİLDİR", () => {
    const supportA = computeScopeKey(
      platformContext({ role: "support", platformUserId: "support-a" }),
    );
    const supportB = computeScopeKey(
      platformContext({ role: "support", platformUserId: "support-b" }),
    );
    expect(supportA).not.toBe(supportB);
  });

  it("AYNI platformUserId, FARKLI role (support vs admin) İÇİN AYNI anahtarı üretir — computeScopeKey role'ü HİÇ KULLANMAZ", () => {
    const asSupport = computeScopeKey(
      platformContext({ role: "support", platformUserId: "platform-x" }),
    );
    const asAdmin = computeScopeKey(
      platformContext({ role: "admin", platformUserId: "platform-x" }),
    );
    expect(asSupport).toBe(asAdmin);
  });
});
