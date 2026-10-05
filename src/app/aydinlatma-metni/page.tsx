import type { Metadata } from "next";
import { PRIVACY_NOTICE } from "../../lib/messages";

/**
 * /aydinlatma-metni — KVKK aydınlatma metni. HERKESE AÇIK: oturum okumaz,
 * yönlendirmez (giriş yapmamış ziyaretçi de açabilmeli). Metnin tek kaynağı
 * `../../lib/messages.ts` `PRIVACY_NOTICE`; burada yalnız düz React metni
 * olarak basılır.
 */
export const metadata: Metadata = {
  title: "Aydınlatma metni — Dolmuş Takip",
  description: "Kişisel verilerin korunması hakkında aydınlatma metni.",
};

export default function AydinlatmaMetniPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[var(--form-max-width)] flex-col gap-6 px-4 sm:px-6 py-6 text-[var(--color-text)]">
      <h1 className="ds-title">{PRIVACY_NOTICE.title}</h1>
      <p className="text-base">{PRIVACY_NOTICE.intro}</p>
      {PRIVACY_NOTICE.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-2">
          <h2 className="ds-section-title">{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-base">
              {paragraph}
            </p>
          ))}
          {section.items && (
            <ul className="list-disc pl-6 text-base">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {section.closing?.map((paragraph) => (
            <p key={paragraph} className="text-base">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
