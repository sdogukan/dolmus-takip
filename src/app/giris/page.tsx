import type { Metadata } from "next";
import { LoginForm } from "./login-form";

/**
 * /giris — araç girişi (DESIGN.md §1 "Giriş gerektirmeyen sayfalar",
 * §2.1). T1.2 ADIM 2/2, S1.2.
 *
 * Bu sayfa KASITLI olarak zaten geçerli bir oturumu olan ziyaretçiyi
 * otomatik yönlendirmez: DESIGN §1'in "Ana adres, oturum yoksa araç
 * girişine; geçerli oturum varsa ilgili ana ekrana yönlenir" cümlesi
 * yalnız kök adrese ('/') aittir (bkz. `../page.tsx`) — /giris için
 * AYRICA bir yönlendirme kuralı YOKTUR. Bu, dokümanla ÇELİŞEN bir eksiklik
 * DEĞİL, kapsamın dışında bırakılan bir UX iyileştirmesidir (bu paketin
 * open_issues'ında not edilmiştir).
 */
export const metadata: Metadata = {
  title: "Giriş — Dolmuş Takip",
  description: "Plaka ve şifreyle araç girişi.",
};

export default function GirisPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col justify-center px-4 py-10">
      <LoginForm />
    </main>
  );
}
