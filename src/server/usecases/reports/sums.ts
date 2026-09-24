import { sql } from "drizzle-orm";

// SUM tam sayı metni olarak okunur: better-sqlite3 INTEGER'ı JS number'a çevirir
// ve 2^53 üstünde sessizce yuvarlar. int64 taşması SQLite'ta hata fırlatır (500).
export const sumText = (column: unknown) => sql<string>`CAST(COALESCE(SUM(${column}), 0) AS TEXT)`;
