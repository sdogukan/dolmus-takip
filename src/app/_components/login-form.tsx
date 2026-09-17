"use client";

/**
 * Ortak giriş formu (istemci bileşeni) — T1.3 ADIM 2/2, S1.3, görev
 * tanımı (a): "mevcut src/app/giris/login-form.tsx bileşenini varyant
 * prop'uyla YENİDEN KULLAN (kod tekrarı yok; gerekirse ortak bileşeni
 * src/app/_components altına taşı)."
 *
 * Bu dosya T1.2'nin araç girişi bileşenini (eski `../giris/login-form.tsx`)
 * BİREBİR davranışını KORUYARAK genelleştirir: tek kimlik alanı (plaka
 * VEYA kullanıcı adı) + şifre, DESIGN §2.1 "Yerleşim"/"Davranış"/"Sonuç"
 * kurallarının TAMAMI (16px kenar boşluğu ▸ üst düzey `giris`/`yonetim/
 * giris` sayfası taşır, en fazla 480px form ▸ aynı üst düzey, alan adı her
 * zaman görünür, Göster/Gizle yalnız girilen şifreyi etkiler, beklerken
 * "Giriş yapılıyor…" + devre dışı + paralel gönderim yok, hata formu
 * silmez, 401/422/429/ağ hatası ayrımı, hata `role="alert"`) DEĞİŞMEDEN
 * iki varyanta (araç `../giris/page.tsx`, ekip `../yonetim/giris/page.tsx`)
 * PROP'LARLA sunulur — varyanta özgü olan yalnız: başlık/alt başlık/yardım
 * metni, kimlik alanının etiketi/`autoComplete`/JSON gövde anahtarı, uç
 * (`endpoint`), "kullanıcı adı/plaka yanlış" mesajının TAM metni
 * (`invalidCredentialsMessage` — araç ve ekip için FARKLI, bkz.
 * `../../lib/messages.ts` `VEHICLE_LOGIN_RESULT_MESSAGES.invalidCredentials`
 * vs `PLATFORM_LOGIN_RESULT_MESSAGES.invalidCredentials`) ve başarı sonrası
 * hedef (`redirectPathByRole`/`defaultRedirectPath` — araçta role'e göre
 * /sahip|/sofor, ekipte HER ZAMAN /yonetim).
 *
 * Hedef bir FONKSİYON DEĞİL, düz veridir (`Record<string,string>` +
 * `string`) — bu bileşen "use client" olsa da, onu kuran `../giris/
 * page.tsx`/`../yonetim/giris/page.tsx` birer SERVER component'tir
 * (`export const metadata` server component GEREKTİRİR); React Server
 * Components sınırı bir server component'ten client component'e
 * FONKSİYON prop GEÇİRİLMESİNE izin VERMEZ ("Functions cannot be passed
 * directly to Client Components" — gerçek bir E2E koşusuyla KANITLANDI,
 * bkz. bu paketin denetim bulgusu); bu yüzden hedef, sunucunun döndürdüğü
 * `role` alanını anahtar olarak kullanan SERİLEŞTİRİLEBİLİR bir haritaya
 * indirgenmiştir.
 *
 * `clearClientStateForOtherScopes` (S1.4 AC2/F6) İKİ VARYANT için de AYNI
 * şekilde çalışır: `POST /api/v1/auth/platform-login` de (araç girişiyle
 * BİREBİR aynı sözleşmeyle, bkz. `../../server/usecases/auth/
 * platform-login.ts`) yanıtında opak `scopeKey` döner — bu fonksiyon
 * `scopeKey`'in İÇİNİ hiç açmaz, davranış varyanttan bağımsızdır.
 *
 * "Araç şifreleri burada geçmez" (görev tanımı a) — bu, EKRAN METNİYLE
 * belirtilmez (görev tanımı: "metinle de belirtilmez, sadece çalışmaz"):
 * bu bileşen hiçbir varyantta rol seçtirmez/ipucu vermez; ekip varyantı
 * yalnız `POST /api/v1/auth/platform-login`'e istek atar — bu uç
 * `platform_users` DIŞINDA hiçbir tabloyu sorgulamadığından (bkz. o
 * usecase'in üst notu) bir araç şifresi burada YAPISAL OLARAK asla
 * eşleşmez; ekranda bunu açıklayan AYRICA bir metin YOKTUR.
 */
import { useState, type FormEvent } from "react";
import {
  clearClientStateForOtherScopes,
  type ClientStateScope,
} from "../../lib/client-state";
import { VEHICLE_LOGIN_RESULT_MESSAGES } from "../../lib/messages";

export interface LoginFormIdentifierField {
  /** `<input id>`/`htmlFor` ve `aria-describedby` önekinin kaynağı. */
  id: string;
  /** JSON gövdesindeki anahtar (ör. "plate"/"username") — sunucunun 422
   * yanıtındaki `error.fields[name]` alan hatası da AYNI anahtarla okunur. */
  name: string;
  label: string;
  autoComplete: string;
  autoCapitalize?: "characters" | "none" | "words" | "sentences" | "off";
  autoCorrect?: "off";
  spellCheck?: boolean;
  inputMode?: "text";
}

export interface LoginFormProps {
  heading: string;
  subheading?: string;
  helpText?: string;
  /** Örn. "/api/v1/auth/vehicle-login" veya "/api/v1/auth/platform-login". */
  endpoint: string;
  identifierField: LoginFormIdentifierField;
  /** 401 INVALID_CREDENTIALS için gösterilecek TAM metin — varyanta özgü
   * (bkz. dosya üstü notu). */
  invalidCredentialsMessage: string;
  /** 429 RATE_LIMITED için gösterilecek TAM metin. */
  rateLimitedMessage: string;
  /** 429 HASH_QUEUE_FULL için gösterilecek TAM metin. */
  hashQueueFullMessage: string;
  /** Başarı yanıtındaki `role`'e göre hedef yol eşlemesi (ör. araç için
   * `{ owner: "/sahip" }`) — haritada olmayan roller `defaultRedirectPath`e
   * düşer (araçta "driver", ekipte HER ZAMAN — admin/support ikisi de). */
  redirectPathByRole?: Record<string, string>;
  defaultRedirectPath: string;
}

interface FieldErrors {
  identifier?: string;
  password?: string;
}

interface LoginSuccessBody {
  role: string;
  scopeKey?: unknown;
}

interface LoginErrorBody {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
  };
}

export function LoginForm({
  heading,
  subheading,
  helpText,
  endpoint,
  identifierField,
  invalidCredentialsMessage,
  rateLimitedMessage,
  hashQueueFullMessage,
  redirectPathByRole,
  defaultRedirectPath,
}: LoginFormProps) {
  const [identifierValue, setIdentifierValue] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Paralel gönderim yok — zaten süren bir istek varken ikinci bir
    // `fetch` BAŞLATILMAZ.
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [identifierField.name]: identifierValue,
          password,
        }),
      });
    } catch {
      // `fetch` reddi — istek sunucuya hiç ULAŞMADI.
      setFormError(VEHICLE_LOGIN_RESULT_MESSAGES.networkError);
      setIsSubmitting(false);
      return;
    }

    let body: LoginSuccessBody & LoginErrorBody;
    try {
      body = (await response.json()) as LoginSuccessBody & LoginErrorBody;
    } catch {
      setFormError(VEHICLE_LOGIN_RESULT_MESSAGES.networkError);
      setIsSubmitting(false);
      return;
    }

    if (response.ok) {
      const scopeKey = typeof body.scopeKey === "string" ? body.scopeKey : null;
      if (scopeKey) {
        const scope: ClientStateScope = { scopeKey };
        try {
          clearClientStateForOtherScopes(window.localStorage, scope);
        } catch {
          // En iyi çaba — DESIGN §2.10 ilkesi; giriş akışını ENGELLEMEZ.
        }
      }
      // Başarı kesinleşti — form devre dışı KALIR, sayfa zaten ayrılıyor.
      // `window.location.assign` (next/navigation `router.push` DEĞİL):
      // hedef sayfalar oturum çerezini `next/headers` `cookies()` ile
      // server component olarak okur; tam navigasyon bu okumanın taze bir
      // istekle olmasını garanti eder (bkz. `../giris/page.tsx`'in eski
      // üst notu, AYNI gerekçe).
      const targetPath = redirectPathByRole?.[body.role] ?? defaultRedirectPath;
      window.location.assign(targetPath);
      return;
    }

    if (response.status === 422) {
      const fields = body.error?.fields ?? {};
      const identifierError = fields[identifierField.name];
      if (identifierError || fields.password) {
        setFieldErrors({ identifier: identifierError, password: fields.password });
      } else {
        // Savunma amaçlı — sunucu 422 için HER ZAMAN en az bir alan hatası
        // döner; bu dal normalde tetiklenmez.
        setFormError(body.error?.message ?? VEHICLE_LOGIN_RESULT_MESSAGES.networkError);
      }
      setIsSubmitting(false);
      return;
    }

    const codeMessages: Record<string, string> = {
      INVALID_CREDENTIALS: invalidCredentialsMessage,
      RATE_LIMITED: rateLimitedMessage,
      HASH_QUEUE_FULL: hashQueueFullMessage,
    };
    const mappedMessage = body.error?.code ? codeMessages[body.error.code] : undefined;
    setFormError(
      mappedMessage ?? body.error?.message ?? VEHICLE_LOGIN_RESULT_MESSAGES.networkError,
    );
    setIsSubmitting(false);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">{heading}</h1>
        {subheading && (
          <p className="mt-1 text-base text-[var(--color-text-secondary)]">{subheading}</p>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        aria-busy={isSubmitting}
        className="flex flex-col gap-6"
      >
        {formError && (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base text-[var(--color-error)]"
          >
            {formError}
          </p>
        )}

        <div>
          <label
            htmlFor={identifierField.id}
            className="block text-lg font-medium text-[var(--color-text)]"
          >
            {identifierField.label}
          </label>
          <input
            id={identifierField.id}
            name={identifierField.name}
            type="text"
            inputMode={identifierField.inputMode}
            autoCapitalize={identifierField.autoCapitalize}
            autoComplete={identifierField.autoComplete}
            autoCorrect={identifierField.autoCorrect}
            spellCheck={identifierField.spellCheck}
            value={identifierValue}
            onChange={(event) => setIdentifierValue(event.target.value)}
            aria-invalid={fieldErrors.identifier ? true : undefined}
            aria-describedby={
              fieldErrors.identifier ? `${identifierField.id}-error` : undefined
            }
            className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          {fieldErrors.identifier && (
            <p
              id={`${identifierField.id}-error`}
              className="mt-1 text-base text-[var(--color-error)]"
            >
              {fieldErrors.identifier}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-lg font-medium text-[var(--color-text)]"
          >
            Şifre
          </label>
          <div className="mt-1 flex items-stretch gap-2">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? "password-error" : undefined}
              className="min-h-[var(--control-min-height)] w-full flex-1 rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-pressed={showPassword}
              className="min-h-[var(--control-min-height)] min-w-[3rem] shrink-0 rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-3 text-base font-medium text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              {showPassword ? "Gizle" : "Göster"}
            </button>
          </div>
          {fieldErrors.password && (
            <p id="password-error" className="mt-1 text-base text-[var(--color-error)]">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="min-h-[var(--primary-min-height)] w-full rounded-[var(--radius-control)] bg-[var(--color-primary)] text-lg font-semibold text-[var(--color-on-primary)] transition-opacity disabled:opacity-70"
        >
          {isSubmitting ? "Giriş yapılıyor…" : "Giriş yap"}
        </button>
      </form>

      {helpText && (
        <p className="text-center text-base text-[var(--color-text-secondary)]">{helpText}</p>
      )}
    </div>
  );
}
