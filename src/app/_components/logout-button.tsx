"use client";

/**
 * "Çıkış" düğmesi (istemci bileşeni) — T1.2 ADIM 2/2, S1.2/S1.4,
 * görev tanımı (2): "'Çıkış' düğmesi (istemci bileşeni: POST /api/v1/
 * auth/logout, X-CSRF-Token ile; sonra clearAllClientState ve /giris'e
 * yönlendirme)."
 *
 * `csrfToken` sunucu bileşeninden (`../sofor/page.tsx`/`../sahip/page.tsx`
 * → `../../server/auth/page-session.ts` `readPageSession()` sonucundaki
 * `context.csrfToken`) PROP olarak gelir — bu bir SIR değildir (aynı
 * değer zaten `GET /api/v1/session`in yanıtında istemciye VERİLİR, bkz.
 * `../../server/auth/guard.ts` `requireWrite` üst notu ve T1.4 kararı:
 * yalnız oturum sırrının KENDİSİ [ham token] hiçbir yanıta/
 * loga YAZILMAZ; CSRF tokenı bilerek istemcinin OKUYABİLECEĞİ bir
 * anti-CSRF nonce'tur).
 *
 * Yönlendirme `next/navigation` `useRouter().push()` iledir (`../_components/
 * login-form.tsx`'in tersine `window.location.assign` DEĞİL): hedef
 * (`/giris` veya `/yonetim/giris`) oturuma bağlı bir server component
 * DEĞİLDİR (giriş sayfaları çerez okumaz, her zaman aynı formu gösterir),
 * bu yüzden "taze çerezle server component render'ı" endişesi burada
 * YOKTUR; `router.push` Next'in kendi önerdiği yoldur (`@next/next/
 * no-location-assign-relative-destination` kuralı).
 *
 * `redirectTo` — T1.3 ADIM 2/2, S1.3, görev tanımı (b): "Çıkış (mevcut
 * LogoutButton, çıkış sonrası /yonetim/giris)." Araç sayfaları (`../sofor/
 * page.tsx`/`../sahip/page.tsx`, bkz. `./vehicle-page-header.tsx`) bu
 * prop'u VERMEZ ve varsayılan `/giris`'i kullanmaya devam eder; ekip
 * sayfası (`../yonetim/page.tsx`, bkz. `./team-page-header.tsx`)
 * `/yonetim/giris` geçirir — düğmenin KENDİSİ (istek/CSRF/durum temizleme
 * mantığı) iki bağlamda da AYNIDIR, kod tekrarı YOK.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearAllClientState } from "../../lib/client-state";

export function LogoutButton({
  csrfToken,
  redirectTo = "/giris",
}: {
  csrfToken: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleClick(): Promise<void> {
    if (isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
      });
    } catch {
      // Ağ hatası olsa bile istemci durumu temizlenip girişe dönülür
      // (aşağıdaki `finally`) — sunucu tarafındaki oturum bu durumda
      // GEÇERLİ kalabilir, ama kullanıcı zaten giriş ekranına yönlendiği
      // ve yeniden giriş istendiği için bu, GÜVENLİ (kapsamı
      // GENİŞLETMEYEN) bir başarısızlık modudur.
    } finally {
      try {
        clearAllClientState(window.localStorage);
      } catch {
        // En iyi çaba — bkz. `../../lib/client-state.ts` üst notu.
      }
      router.push(redirectTo);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isSubmitting}
      className="min-h-[var(--control-min-height)] shrink-0 rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] transition-opacity disabled:opacity-70"
    >
      {isSubmitting ? "Çıkış yapılıyor…" : "Çıkış"}
    </button>
  );
}
