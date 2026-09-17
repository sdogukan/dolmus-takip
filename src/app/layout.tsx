import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dolmuş Takip",
  description: "Şoför ve mal sahibi için günlük hesap takibi.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // `src/proxy.ts` her istekte yeni bir CSP nonce'u üretir; Next bu nonce'u
  // yalnız dynamic render sırasında kendi framework/hydration script ve
  // style etiketlerine uygulayabilir (bkz. proxy.ts üstündeki not ve
  // node_modules/next/dist/docs/.../content-security-policy.md "Forcing
  // dynamic rendering" — `connection()` örneği). `connection()` prerender'ı
  // burada durdurup kök layout'tan itibaren tüm ağacı dynamic yapar;
  // nonce değerinin kendisi burada okunmaz, yalnız zorunlu istek bağı
  // kurulur.
  await connection();

  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
