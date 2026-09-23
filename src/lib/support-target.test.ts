import { describe, expect, it } from "vitest";
import { clientStateKey, saveClientState, type StorageLike } from "./client-state";
import { clearVehicleDrafts, vehicleDraftNames } from "./support-target";

class InMemoryStorage implements StorageLike {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
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

describe("clearVehicleDrafts", () => {
  it("yalnız hedef aracın dört taslağını siler", () => {
    const storage = new InMemoryStorage();
    const scope = { scopeKey: "ekip-kapsam" };
    for (const id of ["v1", "v2"]) {
      for (const name of vehicleDraftNames(id)) saveClientState(storage, scope, name, { id });
    }
    saveClientState(storage, { scopeKey: "baska-kapsam" }, vehicleDraftNames("v1")[0]!, { x: 1 });

    clearVehicleDrafts(storage, scope, "v1");

    for (const name of vehicleDraftNames("v1")) {
      expect(storage.getItem(clientStateKey(scope, name))).toBeNull();
    }
    for (const name of vehicleDraftNames("v2")) {
      expect(storage.getItem(clientStateKey(scope, name))).not.toBeNull();
    }
    expect(
      storage.getItem(clientStateKey({ scopeKey: "baska-kapsam" }, vehicleDraftNames("v1")[0]!)),
    ).not.toBeNull();
  });

  it("depo hata verirse fırlatmaz", () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error("kota");
      },
      key: () => null,
      length: 0,
    };
    expect(() => clearVehicleDrafts(storage, { scopeKey: "k" }, "v1")).not.toThrow();
  });

  it("taslak adları mevcut form adlarıyla aynıdır", () => {
    expect(vehicleDraftNames("abc")).toEqual(["arac-abc", "arac-sifre-abc", "soforler-abc", "kayit-abc"]);
  });
});
