/**
 * Araç plakasını görüntü biçiminde okuma — T1.2 ADIM 2/2, S1.2.
 *
 * DESIGN.md §2.2/§2.5 üst başlığı ("35 ABC 123 ...") için `/sofor` ve
 * `/sahip` server component'lerinin ortak ihtiyacıdır. `GET /api/v1/
 * session` (`../../app/api/v1/session/route.ts`) DA bu yardımcıyı çağırır
 * (düzeltme turu 1, denetim bulgusu — önceden AYNI sorgu+biçimlendirmeyi
 * kendi içinde tekrar ediyordu; tek kaynağa indirgendi, davranış aynı
 * kaldı) — iki farklı yerin aynı SELECT + `formatPlateForDisplay`
 * mantığını bağımsız kopyalar hâlinde taşıyıp birinin değişip diğerinin
 * unutulması riskini önler.
 */
import { eq } from "drizzle-orm";
import { formatPlateForDisplay } from "../../lib/plate";
import type { AppDatabase } from "../data/db";
import { vehicles } from "../data/schema";

export async function readVehiclePlateForDisplay(
  db: AppDatabase,
  vehicleId: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ plateNormalized: vehicles.plateNormalized })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .limit(1);
  const row = rows[0];
  return row ? formatPlateForDisplay(row.plateNormalized) : undefined;
}
