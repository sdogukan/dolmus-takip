import type { Metadata } from "next";
import { LoginForm } from "../../_components/login-form";
import { PLATFORM_LOGIN_RESULT_MESSAGES } from "../../../lib/messages";

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
 * çalışmaz") — bu yüzden DESIGN §2.1'in araç varyantındaki "Giriş
 * yapamıyorsan..." yardım metni de KASITLI olarak buraya taşınmadı (o
 * metin müşterinin aracı açan ekibe başvurmasını anlatır; ekip hesabının
 * kendisi platform yöneticisi tarafından açılır, farklı bir yardım yolu
 * S2.6'da ayrıca ele alınacaktır — bu paketin open_issues'ında not
 * edilmiştir). Görev tanımı bu varyant için bir alt başlık İSTEMEZ; bu
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

export default function YonetimGirisPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col justify-center px-4 py-10">
      <LoginForm
        heading="Ekip girişi"
        endpoint="/api/v1/auth/platform-login"
        identifierField={{
          id: "username",
          name: "username",
          label: "Kullanıcı adı",
          autoComplete: "username",
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
