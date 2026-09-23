import { describe, expect, it } from "vitest";
import { foldForSearch } from "./search-fold";

describe("foldForSearch", () => {
  it("Türkçe büyük/küçük harfleri aynı biçime katlar", () => {
    expect(foldForSearch("GÖRKEM")).toBe(foldForSearch("Görkem"));
    expect(foldForSearch("ŞİŞLİ")).toBe(foldForSearch("şişli"));
    expect(foldForSearch("ISPARTA")).toBe(foldForSearch("ısparta"));
    expect(foldForSearch("İzmir")).toBe(foldForSearch("izmir"));
  });

  it("ayrışık (NFD) ve bileşik (NFC) yazımı eşitler", () => {
    expect(foldForSearch("Görkem")).toBe(foldForSearch("Görkem"));
  });

  it("boş dizeyi korur", () => {
    expect(foldForSearch("")).toBe("");
  });
});
