/**
 * permissions.ts birim testleri — T1.5 ADIM 1/2, S1.5.
 *
 * Görev tanımı: "Birim testleri: matrisin HER hücresi (4 aktör × tüm
 * izinler) tablo testiyle." Bu dosya `PERMISSION_MATRIX`'in ÜRETTİĞİ
 * sonuçla, görev tanımının verdiği yetki matrisinden BAĞIMSIZ
 * (kademeli türetime GÜVENMEDEN) elle yazılmış bir "beklenen tablo"yu
 * karşılaştırır — `permissions.ts`'in kendi `OWNER_PERMISSIONS = [
 * ...DRIVER_PERMISSIONS, ...]` gibi bir yazım hatasını (ör. yanlışlıkla
 * bir izni unutmak) bu bağımsız kopya YAKALAR.
 */
import { describe, expect, it } from "vitest";
import type { Actor } from "./scope";
import {
  authorize,
  hasPermission,
  PERMISSIONS,
  permissionsForActor,
  type Permission,
} from "./permissions";
import type { StaffScope, VehicleScope } from "./scope";

/**
 * Beklenen matris — yetki matrisi + T1.5 görev tanımından
 * BİREBİR, "true/false" tablo biçiminde. Her satır 17 iznin TAMAMINI
 * (PERMISSIONS'ın sırasıyla) taşır; eksik bırakılan bir izin de bir
 * yazım/kopyalama hatasını TypeScript'in kendisi (Record<Permission,
 * boolean> zorunluluğu) yakalar.
 */
const EXPECTED_MATRIX: Record<Actor, Record<Permission, boolean>> = {
  driver: {
    "work_entry.create_driver": true,
    "work_entry.create_owner": false,
    "work_entry.read": true,
    "work_entry.edit_unconfirmed": true,
    "work_entry.confirm": false,
    "work_entry.correct_confirmed": false,
    "work_entry.history": false,
    "report.read": false,
    "driver.read_active": true,
    "driver.manage": false,
    "person.set_global_active": false,
    "business.manage": false,
    "vehicle.manage": false,
    "vehicle.reset_password": false,
    "platform_user.manage": false,
    "audit.read": false,
    "person.anonymize": false,
    },
  owner: {
    "work_entry.create_driver": true,
    "work_entry.create_owner": true,
    "work_entry.read": true,
    "work_entry.edit_unconfirmed": true,
    "work_entry.confirm": true,
    "work_entry.correct_confirmed": true,
    "work_entry.history": true,
    "report.read": true,
    "driver.read_active": true,
    "driver.manage": true,
    "person.set_global_active": false,
    "business.manage": false,
    "vehicle.manage": false,
    "vehicle.reset_password": false,
    "platform_user.manage": false,
    "audit.read": false,
    "person.anonymize": false,
    },
  support: {
    "work_entry.create_driver": true,
    "work_entry.create_owner": true,
    "work_entry.read": true,
    "work_entry.edit_unconfirmed": true,
    "work_entry.confirm": true,
    "work_entry.correct_confirmed": true,
    "work_entry.history": true,
    "report.read": true,
    "driver.read_active": true,
    "driver.manage": true,
    "person.set_global_active": true,
    "business.manage": true,
    "vehicle.manage": true,
    "vehicle.reset_password": true,
    "platform_user.manage": false,
    "audit.read": true,
    "person.anonymize": false,
    },
  admin: {
    "work_entry.create_driver": true,
    "work_entry.create_owner": true,
    "work_entry.read": true,
    "work_entry.edit_unconfirmed": true,
    "work_entry.confirm": true,
    "work_entry.correct_confirmed": true,
    "work_entry.history": true,
    "report.read": true,
    "driver.read_active": true,
    "driver.manage": true,
    "person.set_global_active": true,
    "business.manage": true,
    "vehicle.manage": true,
    "vehicle.reset_password": true,
    "platform_user.manage": true,
    "audit.read": true,
    "person.anonymize": true,
    },
};

const ACTORS: Actor[] = ["driver", "owner", "support", "admin"];

describe("PERMISSION_MATRIX — 4 aktör × 17 izin, TAM tablo (düzeltme turu 3: vehicle.read_current kaldırıldı)", () => {
  it("PERMISSIONS listesi tam olarak 17 benzersiz izin içerir", () => {
    expect(PERMISSIONS.length).toBe(17);
    expect(new Set(PERMISSIONS).size).toBe(17);
  });

  it("person.anonymize (KVKK ad anonimleştirme) yalnız admin'dedir — destek dahil başka hiçbir aktörde yok", () => {
    for (const actor of ACTORS) {
      expect(hasPermission(actor, "person.anonymize"), actor).toBe(actor === "admin");
    }
  });

  for (const actor of ACTORS) {
    for (const permission of PERMISSIONS) {
      const expected = EXPECTED_MATRIX[actor][permission];
      it(`${actor} × ${permission} → ${expected}`, () => {
        expect(hasPermission(actor, permission)).toBe(expected);
      });
    }
  }

  it("permissionsForActor her aktör için TAM izin kümesini alfabetik sırayla döner", () => {
    for (const actor of ACTORS) {
      const expectedList = PERMISSIONS.filter(
        (permission) => EXPECTED_MATRIX[actor][permission],
      ).slice()
        .sort();
      expect(permissionsForActor(actor)).toEqual(expectedList);
    }
  });

  it("driver ⊂ owner ⊂ support ⊂ admin (kademeli kapsama — 'hepsi + ...')", () => {
    const driverSet = new Set(permissionsForActor("driver"));
    const ownerSet = new Set(permissionsForActor("owner"));
    const supportSet = new Set(permissionsForActor("support"));
    const adminSet = new Set(permissionsForActor("admin"));

    for (const permission of driverSet) expect(ownerSet.has(permission)).toBe(true);
    for (const permission of ownerSet) expect(supportSet.has(permission)).toBe(true);
    for (const permission of supportSet) expect(adminSet.has(permission)).toBe(true);
    expect(adminSet.size).toBe(PERMISSIONS.length);
  });
});

describe("authorize(scope, permission, target?) — T1.5", () => {
  const vehicleOwnerScope: VehicleScope = {
    kind: "vehicle",
    actor: "owner",
    businessId: "biz-1",
    vehicleId: "veh-1",
    credentialId: "cred-1",
  };
  const vehicleDriverScope: VehicleScope = {
    kind: "vehicle",
    actor: "driver",
    businessId: "biz-1",
    vehicleId: "veh-1",
    credentialId: "cred-2",
  };
  const staffSupportScope: StaffScope = {
    kind: "staff",
    actor: "support",
    businessId: "biz-1",
    vehicleId: "veh-1",
    platformUserId: "user-1",
    onBehalfOf: true,
  };
  const staffAdminScope: StaffScope = {
    kind: "staff",
    actor: "admin",
    businessId: "biz-1",
    platformUserId: "user-2",
    onBehalfOf: true,
  };

  it("izinli işlem için { ok: true } döner", () => {
    expect(authorize(vehicleOwnerScope, "work_entry.confirm")).toEqual({ ok: true });
    expect(authorize(vehicleDriverScope, "work_entry.create_driver")).toEqual({
      ok: true,
    });
    expect(authorize(staffSupportScope, "vehicle.manage")).toEqual({ ok: true });
    expect(authorize(staffAdminScope, "platform_user.manage")).toEqual({ ok: true });
  });

  it("izinsiz işlem için { ok: false, status: 403 } döner — 401/404 DEĞİL", () => {
    expect(authorize(vehicleDriverScope, "work_entry.confirm")).toEqual({
      ok: false,
      status: 403,
    });
    expect(authorize(vehicleOwnerScope, "platform_user.manage")).toEqual({
      ok: false,
      status: 403,
    });
    expect(authorize(staffSupportScope, "platform_user.manage")).toEqual({
      ok: false,
      status: 403,
    });
  });

  it("şoför sahip/ekip yönetimi ve para onayı yetkisi ALAMAZ (S1.5 AC3)", () => {
    expect(authorize(vehicleDriverScope, "driver.manage").ok).toBe(false);
    expect(authorize(vehicleDriverScope, "work_entry.confirm").ok).toBe(false);
    expect(authorize(vehicleDriverScope, "work_entry.correct_confirmed").ok).toBe(
      false,
    );
    expect(authorize(vehicleDriverScope, "business.manage").ok).toBe(false);
  });

  it("sıradan ekip (support) kullanıcı/platform yönetimi yetkisi ALAMAZ (S1.5 AC3)", () => {
    expect(authorize(staffSupportScope, "platform_user.manage").ok).toBe(false);
  });
});
