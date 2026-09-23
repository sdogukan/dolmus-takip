/**
 * Ekip hesabı okuma sorguları (liste + detay) — S2.6.
 *
 * Görünüm `passwordHash`/`credentialVersion` ASLA içermez (açık sütun
 * listesi — `select()` tüm satırı dönmez).
 */
import { asc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "../../data/db";
import { platformUsers } from "../../data/schema";
import { AdminUserNotFoundError } from "./errors";

export interface PlatformUserView {
  id: string;
  username: string;
  fullName: string | null;
  platformRole: "admin" | "support";
  active: boolean;
  version: number;
}

const viewColumns = {
  id: platformUsers.id,
  username: platformUsers.username,
  fullName: platformUsers.fullName,
  platformRole: platformUsers.platformRole,
  active: platformUsers.active,
  version: platformUsers.version,
};

/** Pasifler dahil TÜM ekip hesapları; kullanıcı adına göre büyük/küçük harf
 * duyarsız sıralı (CLI satırları karışık harfli olabilir). */
export function listPlatformUsers(db: AppDatabase): PlatformUserView[] {
  return db
    .select(viewColumns)
    .from(platformUsers)
    .orderBy(asc(sql`lower(${platformUsers.username})`), asc(platformUsers.id))
    .all();
}

export function getPlatformUserDetail(db: AppDatabase, userId: string): PlatformUserView {
  const row = db.select(viewColumns).from(platformUsers).where(eq(platformUsers.id, userId)).get();
  if (!row) {
    throw new AdminUserNotFoundError();
  }
  return row;
}
