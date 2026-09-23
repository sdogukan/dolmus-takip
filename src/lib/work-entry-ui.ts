/**
 * Günlük kayıt formunun (`../app/_components/work-entry-form.tsx`) SAF
 * yardımcıları — T3.4 öncesi. `GET /api/v1/drivers` iki biçimde döner: şoför
 * oturumu `{ personId, fullName }` satırları, sahip/ekip (`driver.manage`)
 * yönetim görünümü. Yönetim görünümü pasif atamaları ve pasif kişileri de
 * içerir; seçilebilir liste burada AÇIKÇA süzülür. İstemci listesi yetki
 * VERMEZ: asıl doğrulama sunucudadır.
 */
import type { WorkKind } from "./work-calculation";

export interface SelectableDriver {
  personId: string;
  fullName: string;
}

/** Seçilebilir şoförler; yanıt beklenen biçimde değilse `null`. */
export function selectableFromDriversResponse(body: unknown): SelectableDriver[] | null {
  const list = (body as { drivers?: unknown } | null)?.drivers;
  if (!Array.isArray(list)) return null;
  const drivers: SelectableDriver[] = [];
  for (const item of list as Array<Record<string, unknown> | null>) {
    if (typeof item?.personId !== "string" || typeof item.fullName !== "string") return null;
    if ("assignment" in item) {
      // Yönetim görünümü satırı: yalnız AKTİF atama + AKTİF kişi seçilebilir.
      const assignment = item.assignment as { active?: unknown } | null;
      if (typeof item.personActive !== "boolean") return null;
      if (assignment !== null && typeof assignment?.active !== "boolean") return null;
      if (item.personActive !== true || assignment?.active !== true) continue;
    }
    drivers.push({ personId: item.personId, fullName: item.fullName });
  }
  return drivers;
}

/** Sahip/ekip ekranındaki iki seçenek; boş = henüz seçilmedi. */
export type WorkTypeChoice = WorkKind | "";
