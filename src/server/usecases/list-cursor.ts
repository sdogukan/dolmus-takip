/**
 * Keyset sayfalama imleci — sıralama anahtarı bileşenlerini opak bir dizeye
 * kodlar. Ofset imleci KULLANILMAZ: sayfalar arasında yeni satır gelirse
 * satır tekrarlanır/atlanır; imleç son görülen satırın anahtarını taşır.
 */
export class InvalidCursorError extends Error {
  constructor() {
    super("Geçersiz sayfalama imleci.");
    this.name = "InvalidCursorError";
  }
}

export function encodeCursor(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
}

/** Beklenen bileşen sayısına uymayan/bozuk imleç için `null` döner. */
export function decodeCursor(cursor: string, arity: number): string[] | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== arity ||
      !parsed.every((part) => typeof part === "string" && part.length > 0)
    ) {
      return null;
    }
    return parsed as string[];
  } catch {
    return null;
  }
}

export function requireCursor(cursor: string, arity: number): string[] {
  const parts = decodeCursor(cursor, arity);
  if (!parts) throw new InvalidCursorError();
  return parts;
}

export type ActiveFilter = "all" | "active" | "inactive";

/** Yönetim liste uçlarının ortak arama/sayfalama seçenekleri. Hepsi isteğe
 * bağlıdır; hiçbiri verilmezse tüm satırlar döner. */
export interface ListPageOptions {
  q?: string;
  active?: ActiveFilter;
  cursor?: string;
  limit?: number;
}

export interface ListPage<T> {
  items: T[];
  nextCursor: string | null;
}
