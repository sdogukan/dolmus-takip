import type { Metadata } from "next";
import { LoginForm } from "../../_components/login-form";
import {
  COMMON_SCREEN_MESSAGES,
  LOGIN_HELP_TEXT,
  PLATFORM_LOGIN_RESULT_MESSAGES,
} from "../../../lib/messages";

/**
 * /yonetim/giris — ekip girişi (DESIGN.md §1 "Giriş gerektirmeyen
 * sayfalar", §2.1 "Ekip varyantı"). T1.3 ADIM 2/2, S1.3, görev tanımı (a).
 *
 * DESIGN §2.1 "Ekip varyantı" — "Aynı yerleşimde 'Ekip girişi', 'Kullanıcı
 * adı' ve 'Şifre' bulunur. Kişisel ekip hesabı kullanılır; araç şifreleri
 * burada geçmez." "Aynı yerleşim" ortak `../../_components/login-form.tsx`
 * bileşeninin BİREBİR kendisiyle (16px kenar boşluğu, en fazla 480px form,
 * alan adları her zaman görünür, Göster/Gizle, "Giriş yapılıyor…", hata
 * `role="alert"`) sağlanır — kod tekrarı YOK.
 *
 * "Araç şifreleri burada geçmez" EKRANDA AYRICA bir metinle
 * BELİRTİLMEZ (görev tanımı a, birebir: "metinle de belirtilmez, sadece
 * çalışmaz") — bu yalnız o TEK cümleyle (araç şifrelerinin burada
 * GEÇMEDİĞİ) ilgilidir. S1.6 AC7 (birebir, düzeltme turu 1 denetim
 * bulgusu) "Giriş yapamıyorsan hesabını açan ekipten yardım al." metninin
 * görünür olmasını şart koşar; S1.6 AC1 hikâyenin kapsamını "Araç ve ekip
 * girişleri" olarak tanımlar ve AC7 bunu araç ekranıyla SINIRLAMAZ (S1.2
 * AC4'ün plakaya özgü kuralının AKSİNE). Önceki sürümün bu metni yalnız
 * araç girişinde göstermesi docs/DECISIONS.md'de kayıtlı bir karara
 * DAYANMIYORDU; bu yüzden metin de (tek kaynak `../../../lib/
 * messages.ts` `LOGIN_HELP_TEXT`'ten, ikinci bir kopya YAZILMADAN) burada
 * gösterilir. Görev tanımı bu varyant için bir alt başlık İSTEMEZ; bu
 * yüzden yalnız başlık ("Ekip girişi") gösterilir.
 *
 * Sunucu: `POST /api/v1/auth/platform-login` (T1.3 ADIM 1/2) —
 * `requireAnonymousWrite` kullanır (CSRF header İSTEMEZ, oturum henüz
 * yok).
 */
export const metadata: Metadata = {
  title: "Ekip girişi — Dolmuş Takip",
  description: "Kişisel ekip kullanıcı adı ve şifresiyle yönetim girişi.",
};

/**
 * `?oturum=bitti` — bir ekran kendi oturumunu bilerek kapattığında (ör. yönetici
 * kendi şifresini sıfırladı/hesabını pasifleştirdi) girişe bu işaretle gönderir;
 * "Oturumun sona erdi" notu formun üstünde gösterilir.
 */
export default async function YonetimGirisPage({
  searchParams,
}: {
  searchParams: Promise<{ oturum?: string | string[] }>;
}) {
  const { oturum } = await searchParams;
  const sessionEnded = (Array.isArray(oturum) ? oturum[0] : oturum) === "bitti";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col justify-center gap-4 px-4 py-10">
      {sessionEnded && (
        <p role="status" className="rounded-[var(--radius-control)] bg-[var(--color-warning-surface)] px-3 py-2 text-base text-[var(--color-warning)]">
          {COMMON_SCREEN_MESSAGES.sessionEnded}
        </p>
      )}
      <LoginForm
        heading="Ekip girişi"
        helpText={LOGIN_HELP_TEXT}
        endpoint="/api/v1/auth/platform-login"
        identifierField={{
          id: "username",
          name: "username",
          label: "Kullanıcı adı",
          autoComplete: "username",
          // T1.6, S1.6, görev tanımı (2, birebir) — "autocapitalize uygun
          // (plaka: characters; kullanıcı adı: none)." Kullanıcı adları
          // büyük/küçük harfe duyarlı olabilir; ekran klavyesi otomatik
          // büyük harfe çevirmez.
          autoCapitalize: "none",
          autoCorrect: "off",
          spellCheck: false,
        }}
        invalidCredentialsMessage={PLATFORM_LOGIN_RESULT_MESSAGES.invalidCredentials}
        rateLimitedMessage={PLATFORM_LOGIN_RESULT_MESSAGES.rateLimited}
        hashQueueFullMessage={PLATFORM_LOGIN_RESULT_MESSAGES.hashQueueFull}
        // DESIGN §1 "Ekip girişi | /yonetim/giris | Kişisel ekip kullanıcı
        // adı ve şifresi" ve görev tanımı (a) "başarıda /yonetim'e
        // yönlendirme" — admin/support ARASINDA FARK YOKTUR (araç
        // girişinin owner/driver ayrımının AKSİNE); rol etiketi
        // `/yonetim`'in KENDİ üst başlığında gösterilir (bkz. `../page.tsx`).
        defaultRedirectPath="/yonetim"
      />
    </main>
  );
}
