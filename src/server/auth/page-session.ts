/**
 * Server component oturum okuma yardımcısı — T1.2 ADIM 2/2, S1.2/S1.4/S1.5,
 * görev tanımı (2): "Server component'te oturum okuma: guard/
 * resolveSession'ı cookie ile çağıran küçük yardımcı (src/server/auth/
 * page-session.ts, next/headers cookies() burada kullanılabilir —
 * sayfalar için)."
 *
 * `./guard.ts`'in `requireSession`/`requireWrite`'ı KASITLI olarak düz Web
 * `Request` nesnesi ister (bkz. o dosyanın üst notu — Route Handler'ların
 * Next'in istek kapsamı OLMADAN doğrudan test edilebilmesi için). Next 16
 * app router SAYFALARI (server component) ise bir `Request` nesnesi ALMAZ;
 * çerez okuma yolu `next/headers` `cookies()`'tir (yalnız Next'in kendi
 * istek kapsamı/AsyncLocalStorage içinde çalışır — bu yüzden bu dosya
 * `guard.ts`'e taşınmadı, ayrı ve KÜÇÜK tutuldu, yalnız SAYFALARIN
 * kullanacağı bir üst-katman).
 *
 * Bu yardımcı `guard.ts`'in CSRF/origin/Content-Type/gövde denetimlerini
 * TEKRARLAMAZ — sayfalar (server component render'ı) hiçbir zaman bir
 * YAZMA isteği değildir (GET benzeri, salt-okunur bir render); bu denetim
 * yalnız `requireWrite`'ın kapsadığı POST/PATCH/... Route Handler'lar
 * içindir. Alttaki `resolveSession` (T1.4 ADIM 1/2) İSE TEK kaynaktır —
 * oturum geçerliliği/iptal/süre/aktiflik mantığı burada YENİDEN
 * YAZILMAZ, doğrudan çağrılır (aynı `../usecases/session/resolve-session.ts`,
 * `guard.ts`'in de kullandığı tek kaynak).
 */
import { cookies } from "next/headers";
import { getAppDb } from "../data/app-db";
import { SessionError } from "../usecases/session/errors";
import { resolveSession } from "../usecases/session/resolve-session";
import type { SessionContext } from "../usecases/session/types";
import { SESSION_COOKIE_NAME } from "./cookie";

export type PageSessionResult =
  | { ok: true; context: SessionContext }
  /**
   * "missing" — çerez hiç yok (never logged in / already logged out).
   * "invalid" — çerez var ama `resolveSession` reddetti (süre doldu,
   * iptal edildi, credential/işletme/araç pasif — bkz. `../usecases/
   * session/errors.ts` üst notu). Sayfa katmanı için ikisi de AYNI sonucu
   * doğurur (redirect "/giris"); ayrım yalnız ileride (T1.6, "Oturumun
   * sona erdi" mesajı gösterecek ekranlar) gerekebilir diye taşınır.
   */
  | { ok: false; reason: "missing" | "invalid" };

/**
 * Geçerli isteğin oturum çerezini okuyup çözer. DB henüz hazır değilse
 * (migration bekliyor/dosya yok/SQLITE_BUSY vb.) `getAppDb()`/
 * `resolveSession` kendi hatasını FIRLATIR — bu yardımcı onu YUTMAZ;
 * çağıran sayfa bu durumda Next'in kendi hata sınırına (`error.tsx`,
 * bu paketin kapsamı dışında) düşer. Route Handler'ların aksine sayfalar
 * için ayrı bir "503 SERVICE_UNAVAILABLE JSON zarfı" YOKTUR — bu, bu
 * paketin open_issues'ında not edilmiştir (T1.6/genel hata sınırı
 * kapsamına bırakılmıştır).
 */
export async function readPageSession(): Promise<PageSessionResult> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return { ok: false, reason: "missing" };
  }

  try {
    const db = getAppDb();
    const context = await resolveSession(db, token);
    return { ok: true, context };
  } catch (error) {
    if (error instanceof SessionError) {
      return { ok: false, reason: "invalid" };
    }
    throw error;
  }
}
