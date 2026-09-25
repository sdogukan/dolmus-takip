import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * withProtectedRoute — kaynak kablolama regresyon testi, düzeltme turu 1.
 *
 * Denetim bulgusu (`mimari` merceği): "authorize() fonksiyonu belgelenen
 * adımda gerçekte hiç çağrılmıyor — withProtectedRoute aynı mantığı ayrıca
 * (hasPermission ile) yeniden yazmış." Bugünkü yetki matrisiyle
 * `authorize()` ve `hasPermission()` HER actor/permission çifti için AYNI
 * sonucu ürettiğinden (`Scope.actor` HER ZAMAN `context.role`'e eşittir —
 * bkz. `../auth/scope.ts` `scopeFromVehicleSession` /
 * `resolveStaffVehicleScopeFromHeader` / `resolveAdminScope`'un HER ÜÇÜ de
 * `actor: context.role` atar), bu iki kod yolunun GERÇEKTEN aynı
 * fonksiyonu mu çağırdığı, yoksa BİRİNİN SESSİZCE kendi mantığını mı
 * yeniden yazdığı, `tests/integration/protected-route.test.ts`'in
 * target:'none'/'vehicle'/'business' istek/yanıt testleriyle AYIRT
 * EDİLEMEZ — ikisi de bugün için AYNI 200/403 sonucunu üretir. Bu yüzden
 * tam olarak bu regresyonu (denetim bulgusunun kendisini) yakalayacak tek
 * doğrudan denetim, `handler.ts` kaynağının Scope çözüldüğünde GERÇEKTEN
 * `authorize(scope, ...)` çağırdığını doğrulamaktır.
 *
 * T3/T3.5 `authorize`'ın `target` parametresini anlamlandırdığında (K1'in
 * "aynı araçta seçtiği kişi"/"yalnız çalışma günü" koşulları),
 * `authorize` ve `hasPermission` çıktıları GERÇEKTEN FARKLILAŞACAĞINDAN bu
 * statik kaynak denetimi gerçek bir DAVRANIŞSAL teste dönüştürülüp
 * kaldırılabilir; o güne kadar bu, tek güvenilir regresyon koruması.
 */
const handlerSourcePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "handler.ts",
);
const handlerSource = fs.readFileSync(handlerSourcePath, "utf8");

describe("withProtectedRoute kaynağı — authorize() gerçekten kablolu (düzeltme turu 1)", () => {
  it("../auth/permissions'tan authorize'ı GERÇEKTEN import eder (yalnız hasPermission değil)", () => {
    expect(handlerSource).toMatch(
      /import\s*\{[^};]*\bauthorize\b[^};]*\}\s*from\s*"\.\.\/auth\/permissions"/,
    );
  });

  it("Scope çözüldüğü dalda GERÇEKTEN authorize(scopeOutcome.scope, ...) ÇAĞIRIR — yalnız import edilip KULLANILMAMIŞ olmaz", () => {
    expect(handlerSource).toMatch(/authorize\(\s*scopeOutcome\.scope\s*,/);
  });

  it("Scope yokken (target:'none') hasPermission(actor, ...) YEDEK olarak korunur — authorize bir Scope nesnesi ZORUNLU kılar", () => {
    expect(handlerSource).toMatch(/hasPermission\(\s*actor\s*,/);
  });
});
