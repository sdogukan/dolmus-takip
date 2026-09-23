import { afterEach, describe, expect, it } from "vitest";
import { resetHashQueueForTests } from "./hash-queue";
import { hashVehiclePassword, passwordsAreDistinct, verifyVehiclePassword } from "./vehicle-password";

/**
 * `vehicle-password.ts` birim testleri — T2.2. Gerçek Argon2id çağrısı
 * kullanır (mock YOK — `hash`/`verify` `node-argon2`nin kendisidir, bu
 * dosyanın işi yalnız ARGON2ID_OPTIONS'ın DOĞRU parametrelerle ve hash
 * kuyruğu ÜZERİNDEN çalıştığını doğrulamaktır); `unit` Vitest projesinde
 * (DB'ye dokunmaz).
 */

afterEach(() => {
  resetHashQueueForTests();
});

describe("passwordsAreDistinct", () => {
  it("aynı iki parola için false döner", () => {
    expect(passwordsAreDistinct("ayni-sifre", "ayni-sifre")).toBe(false);
  });

  it("farklı iki parola için true döner", () => {
    expect(passwordsAreDistinct("sahip-1234", "sofor-1234")).toBe(true);
  });

  it("boş dize karşılaştırması da diğer kurallarla AYNI: eşitse false", () => {
    expect(passwordsAreDistinct("", "")).toBe(false);
  });
});

describe("hashVehiclePassword / verifyVehiclePassword", () => {
  it("üretilen özet Argon2id biçimindedir ve AYNI parolayla doğrular", async () => {
    const password = "gecici-sifre-1234";
    const digest = await hashVehiclePassword(password);
    expect(digest.startsWith("$argon2id$")).toBe(true);
    expect(await verifyVehiclePassword(digest, password)).toBe(true);
  });

  it("YANLIŞ parolayla doğrulama false döner", async () => {
    const digest = await hashVehiclePassword("dogru-sifre-1234");
    expect(await verifyVehiclePassword(digest, "yanlis-sifre-1234")).toBe(false);
  });

  it("iki ayrı hashleme AYNI parola için FARKLI özet üretir (rastgele tuz)", async () => {
    const password = "ayni-parola-1234";
    const first = await hashVehiclePassword(password);
    const second = await hashVehiclePassword(password);
    expect(first).not.toBe(second);
    expect(await verifyVehiclePassword(first, password)).toBe(true);
    expect(await verifyVehiclePassword(second, password)).toBe(true);
  });
});
