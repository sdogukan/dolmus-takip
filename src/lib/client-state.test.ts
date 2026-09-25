import { describe, expect, it } from "vitest";
import {
  CLIENT_STATE_TTL_MS,
  InvalidClientStateScopeError,
  clearAllClientState,
  clearClientStateForOtherScopes,
  clientStateKey,
  clientStateScopePrefix,
  readClientState,
  saveClientState,
  type ClientStateClock,
  type ClientStateScope,
  type StorageLike,
} from "./client-state";

/**
 * Birim testleri — T1.4 ADIM 2/2, S1.4, görev tanımı (c). "jsdom yok:
 * localStorage'ı küçük bir in-memory Storage ile enjekte et." Bu sınıf
 * `window.localStorage`'ın DAVRANIŞ olarak eşdeğeridir (senkron, dize
 * anahtar/değer) ama tarayıcı/jsdom'a HİÇ bağımlı değildir.
 */
class InMemoryStorage implements StorageLike {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  get length(): number {
    return this.store.size;
  }
}

function fixedClock(iso: string): ClientStateClock {
  return () => new Date(iso);
}

// `scopeKey` değerleri gerçek `computeScopeKey` çıktısıyla AYNI biçimde
// (16 hex karakter) OLMAK ZORUNDA DEĞİLDİR — bu modül onun içini açmaz,
// yalnız opak bir dize olarak kabul eder (bkz. dosya üstü notu).
const vehicleScope: ClientStateScope = { scopeKey: "scope-vehicle-1" };
const otherVehicleScope: ClientStateScope = { scopeKey: "scope-vehicle-2" };
const platformScope: ClientStateScope = { scopeKey: "scope-platform-1" };

describe("clientStateScopePrefix / clientStateKey", () => {
  it("scopeKey'i anahtar önekine koyar", () => {
    expect(clientStateScopePrefix(vehicleScope)).toBe(
      "dolmus_takip:client_state:scope-vehicle-1:",
    );
    expect(clientStateKey(vehicleScope, "draft")).toBe(
      "dolmus_takip:client_state:scope-vehicle-1:draft",
    );
  });

  it("boş/whitespace-only scopeKey fırlatır (sessizce yanlış anahtar üretmez)", () => {
    expect(() => clientStateScopePrefix({ scopeKey: "" })).toThrow(
      InvalidClientStateScopeError,
    );
    expect(() => clientStateScopePrefix({ scopeKey: "   " })).toThrow(
      InvalidClientStateScopeError,
    );
  });

  it("farklı araç kapsamları (aynı görünen ad) çakışmayan anahtarlar üretir", () => {
    expect(clientStateKey(vehicleScope, "draft")).not.toBe(
      clientStateKey(otherVehicleScope, "draft"),
    );
  });
});

describe("saveClientState / readClientState — TTL 24 saat (F6)", () => {
  it("kaydedilen değer TTL içinde AYNI kapsam+ad ile okunur", () => {
    const storage = new InMemoryStorage();
    saveClientState(storage, vehicleScope, "draft", { requestId: "r1" });
    expect(readClientState(storage, vehicleScope, "draft")).toEqual({
      requestId: "r1",
    });
  });

  it("hiç kayıt yoksa null döner", () => {
    const storage = new InMemoryStorage();
    expect(readClientState(storage, vehicleScope, "draft")).toBeNull();
  });

  it("TTL - 1ms'de hâlâ okunur; TTL VE SONRASINDA okunmaz (süresi geçeni okumama)", () => {
    const storage = new InMemoryStorage();
    const t0 = "2026-01-01T00:00:00.000Z";
    saveClientState(storage, vehicleScope, "draft", "değer", fixedClock(t0));

    expect(
      readClientState(
        storage,
        vehicleScope,
        "draft",
        fixedClock(new Date(new Date(t0).getTime() + CLIENT_STATE_TTL_MS - 1).toISOString()),
      ),
    ).toBe("değer");

    expect(
      readClientState(
        storage,
        vehicleScope,
        "draft",
        fixedClock(new Date(new Date(t0).getTime() + CLIENT_STATE_TTL_MS).toISOString()),
      ),
    ).toBeNull();
  });

  it("süresi geçmiş kayıt OKUNURKEN storage'dan da silinir", () => {
    const storage = new InMemoryStorage();
    const t0 = "2026-01-01T00:00:00.000Z";
    saveClientState(storage, vehicleScope, "draft", "değer", fixedClock(t0));
    const key = clientStateKey(vehicleScope, "draft");
    expect(storage.getItem(key)).not.toBeNull();

    readClientState(
      storage,
      vehicleScope,
      "draft",
      fixedClock(new Date(new Date(t0).getTime() + CLIENT_STATE_TTL_MS).toISOString()),
    );
    expect(storage.getItem(key)).toBeNull();
  });

  it("bozuk (JSON olmayan) kayıt için null döner, fırlatmaz", () => {
    const storage = new InMemoryStorage();
    storage.setItem(clientStateKey(vehicleScope, "draft"), "{ bozuk json");
    expect(readClientState(storage, vehicleScope, "draft")).toBeNull();
  });

  it("storage.setItem fırlatırsa (ör. kota/gizli mod) sessizce yutulur", () => {
    const throwingStorage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      key: () => null,
      length: 0,
    };
    expect(() =>
      saveClientState(throwingStorage, vehicleScope, "draft", "x"),
    ).not.toThrow();
  });

  it("farklı ad (name) aynı kapsamda ayrı taslaklar tutar", () => {
    const storage = new InMemoryStorage();
    saveClientState(storage, vehicleScope, "draft", "A");
    saveClientState(storage, vehicleScope, "requestId", "B");
    expect(readClientState(storage, vehicleScope, "draft")).toBe("A");
    expect(readClientState(storage, vehicleScope, "requestId")).toBe("B");
  });
});

describe("clearClientStateForOtherScopes — S1.4 AC2 (ortak telefon)", () => {
  it("MEVCUT kapsamın kendi verisini KORUR, DİĞER kapsamların verisini SİLER", () => {
    const storage = new InMemoryStorage();
    saveClientState(storage, vehicleScope, "draft", "sürücü-A-taslağı");
    saveClientState(storage, otherVehicleScope, "draft", "sürücü-B-taslağı");
    saveClientState(storage, platformScope, "draft", "ekip-taslağı");

    clearClientStateForOtherScopes(storage, vehicleScope);

    expect(readClientState(storage, vehicleScope, "draft")).toBe(
      "sürücü-A-taslağı",
    );
    expect(readClientState(storage, otherVehicleScope, "draft")).toBeNull();
    expect(readClientState(storage, platformScope, "draft")).toBeNull();
  });

  it("bu modülün YAZMADIĞI (KEY_PREFIX taşımayan) anahtarlara DOKUNMAZ", () => {
    const storage = new InMemoryStorage();
    storage.setItem("baska-uygulamanin-anahtari", "dokunulmaz");
    saveClientState(storage, otherVehicleScope, "draft", "silinecek");

    clearClientStateForOtherScopes(storage, vehicleScope);

    expect(storage.getItem("baska-uygulamanin-anahtari")).toBe("dokunulmaz");
  });

  it("currentScope null ise TÜM kapsamları siler", () => {
    const storage = new InMemoryStorage();
    saveClientState(storage, vehicleScope, "draft", "A");
    saveClientState(storage, platformScope, "draft", "B");

    clearClientStateForOtherScopes(storage, null);

    expect(readClientState(storage, vehicleScope, "draft")).toBeNull();
    expect(readClientState(storage, platformScope, "draft")).toBeNull();
  });
});

describe("clearAllClientState — çıkışta tümünü temizleme", () => {
  it("her kapsamın verisini siler", () => {
    const storage = new InMemoryStorage();
    saveClientState(storage, vehicleScope, "draft", "A");
    saveClientState(storage, platformScope, "draft", "B");

    clearAllClientState(storage);

    expect(readClientState(storage, vehicleScope, "draft")).toBeNull();
    expect(readClientState(storage, platformScope, "draft")).toBeNull();
  });
});
