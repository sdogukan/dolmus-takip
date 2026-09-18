import { describe, expect, it } from "vitest";
import { readClientState, saveClientState, type StorageLike } from "./client-state";
import { applyStoredDraftUpdate } from "./use-stored-draft";

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
    return [...this.store.keys()][index] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}

interface Draft {
  name: { value: string; pending: boolean };
  owner: { value: string };
}

const scope = { scopeKey: "scope-a" };
const fallback: Draft = { name: { value: "eski", pending: false }, owner: { value: "" } };

describe("applyStoredDraftUpdate", () => {
  it("fonksiyonel güncelleyici argümanı depolanmış güncel değerdir; bayat snapshot değil", () => {
    const storage = new InMemoryStorage();
    const staleSnapshot: Draft = { ...fallback };
    // Başka bir alt form, ilk formun isteği sürerken owner taslağını yazdı.
    saveClientState(storage, scope, "d", { ...fallback, owner: { value: "Ayşe" } });

    // İlk form isteği bitince yalnız kendi alanını günceller.
    applyStoredDraftUpdate(storage, scope, "d", fallback, (prev) => ({
      ...prev,
      name: { value: "yeni", pending: false },
    }));

    const stored = readClientState<Draft>(storage, scope, "d");
    expect(stored?.owner.value).toBe("Ayşe");
    expect(stored?.name.value).toBe("yeni");
    // Bayat snapshot'tan yayma olsaydı owner ezilirdi.
    expect({ ...staleSnapshot, name: { value: "yeni", pending: false } }.owner.value).toBe("");
  });

  it("depo boşsa güncelleyici fallback üzerinden çalışır", () => {
    const storage = new InMemoryStorage();
    const result = applyStoredDraftUpdate(storage, scope, "d", fallback, (prev) => ({
      ...prev,
      owner: { value: "Veli" },
    }));
    expect(result).toEqual({ ...fallback, owner: { value: "Veli" } });
    expect(readClientState<Draft>(storage, scope, "d")).toEqual(result);
  });

  it("depodaki kayıt bozuksa güncelleyici fallback üzerinden çalışır", () => {
    const storage = new InMemoryStorage();
    storage.setItem("dolmus_takip:client_state:scope-a:d", "{bozuk");
    const result = applyStoredDraftUpdate(storage, scope, "d", fallback, (prev) => prev);
    expect(result).toEqual(fallback);
  });

  it("doğrudan değer olduğu gibi yazılır (güncelleyici çağrılmaz)", () => {
    const storage = new InMemoryStorage();
    const next: Draft = { name: { value: "x", pending: true }, owner: { value: "" } };
    applyStoredDraftUpdate(storage, scope, "d", fallback, next);
    expect(readClientState<Draft>(storage, scope, "d")?.name).toEqual({ value: "x", pending: true });
  });

  it("farklı kapsamların taslakları birbirine karışmaz", () => {
    const storage = new InMemoryStorage();
    saveClientState(storage, { scopeKey: "scope-b" }, "d", { ...fallback, owner: { value: "B" } });
    applyStoredDraftUpdate(storage, scope, "d", fallback, (prev) => prev);
    expect(readClientState<Draft>(storage, { scopeKey: "scope-b" }, "d")?.owner.value).toBe("B");
  });
});
