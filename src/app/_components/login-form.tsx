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
import { useRef, useState, type FormEvent } from "react";
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
  /** T1.6, S1.6, görev tanımı (2) — "enterkeyhint ... uygun." Ekran
   * klavyesinin gönder tuşu etiketini kimlik alanı için "sonraki alana
   * geç" (şifre) anlamına gelecek şekilde ayarlar; varsayılan "next". */
  enterKeyHint?: "next" | "go" | "done" | "search" | "send";
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

/**
 * T1.6, S1.6, görev tanımı (3) — "yalnız renkle anlatılmaz (metin +
 * simge/önek)." Basit, özgün (dış kütüphaneden KOPYALANMAMIŞ) bir uyarı
 * simgesi; metnin YANINDA (yerine değil) gösterilir, `aria-hidden`
 * taşır (durum zaten METİNLE + `role="alert"`/`role="status"` ile
 * bildirilir — simge yalnız GÖRSEL bir ek işarettir). Şekil düğümleri
 * (`circle`/`line`) DOM metin içeriği (`textContent`) ÜRETMEZ; bu yüzden
 * Playwright'ın `toHaveText()` gibi metin tabanlı doğrulamalarını
 * ETKİLEMEZ (bkz. `../../../tests/e2e/vehicle-login.spec.ts` "yanlış
 * şifre" testi — hâlâ TAM metin eşleşir).
 */
function AlertIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="mt-0.5 h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <circle cx="10" cy="10" r="8" />
      <line x1="10" y1="6.5" x2="10" y2="11" />
      <circle cx="10" cy="13.75" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
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
  // T1.6, S1.6, görev tanımı (3) — "boş/geçersiz alan hatası ... ilk
  // hatalı alana odak taşınır." Gerçek DOM düğümüne (React state'e değil)
  // ihtiyaç var; bu yüzden `useRef` — kimlik alanı ÖNCE (form/Tab
  // sırasında ilk), şifre SONRA.
  const identifierInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  /**
   * T1.6, S1.6, görev tanımı (4) — "ekran klavyesi önemli alanı kalıcı
   * kapatmaz (odaklanan alan scrollIntoView)." Ekran klavyesi açıldığında
   * bazı tarayıcılarda odaklanan alan sabit başlık/klavyenin ARKASINDA
   * kalabilir; `scrollIntoView` odaklanan alanı görünür ortaya taşır.
   * `try/catch`: `scrollIntoView`'ın `behavior`/`block` seçenekleri eski
   * bir tarayıcıda (veya test ortamında) desteklenmeyebilir — bu, giriş
   * akışını ENGELLEMEZ (en iyi çaba, DESIGN §2.10 ilkesiyle aynı).
   */
  function scrollFieldIntoView(element: HTMLElement): void {
    try {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      // En iyi çaba — bkz. yukarıdaki fonksiyon notu.
    }
  }

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
        // Görev tanımı (3) — "ilk hatalı alana odak taşınır." Form/Tab
        // sırasında ÖNCE gelen (kimlik alanı) hatalıysa önce ona, yoksa
        // şifreye odaklanılır.
        if (identifierError) {
          identifierInputRef.current?.focus();
          if (identifierInputRef.current) {
            scrollFieldIntoView(identifierInputRef.current);
          }
        } else {
          passwordInputRef.current?.focus();
          if (passwordInputRef.current) {
            scrollFieldIntoView(passwordInputRef.current);
          }
        }
      } else {
        // Savunma amaçlı — sunucu 422 için HER ZAMAN en az bir alan hatası
        // döner; bu dal normalde tetiklenmez.
        setFormError(body.error?.message ?? VEHICLE_LOGIN_RESULT_MESSAGES.networkError);
      }
      setIsSubmitting(false);
      return;
    }

    // T1.6, S1.6, görev tanımı (5) — "fetch reddi veya 5xx → 'Bağlantı
    // kurulamadı. Tekrar dene.' benzeri metin ... yığın izi/teknik ayrıntı
    // gösterilmez." 5xx durum kodları (ör. 503 SERVICE_UNAVAILABLE — bkz.
    // `../api/v1/auth/vehicle-login/route.ts`
    // `vehicleLoginTransientLockResponse`) sunucunun KENDİ hata mesajını
    // TAŞIYABİLİR; bu dal o mesajı KASITLI olarak GÖRMEZDEN GELİR ve
    // sabit, kanıtlı ağ-hatası metnini kullanır — kullanıcı için "sunucu
    // şu an hazır değil" ile "bağlantı kurulamadı" arasındaki ayrım
    // ANLAMSIZDIR (ikisi de "tekrar dene").
    if (response.status >= 500) {
      setFormError(VEHICLE_LOGIN_RESULT_MESSAGES.networkError);
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
        <h1 className="break-words text-2xl font-semibold text-[var(--color-text)]">
          {heading}
        </h1>
        {subheading && (
          <p className="mt-1 break-words text-base text-[var(--color-text-secondary)]">
            {subheading}
          </p>
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
            className="flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--color-error-surface)] px-3 py-2 text-base break-words text-[var(--color-error)]"
          >
            <AlertIcon />
            {formError}
          </p>
        )}
        {/* T1.6, S1.6, görev tanımı (3) — "başarı/bekleme aria-live=
         * polite." Görünmez (`sr-only`) durum bildirimi; buton metni
         * ZATEN görsel olarak "Giriş yapılıyor…" gösterir, bu yalnız
         * ekran okuyucuya AYNI durumu KİBARCA (kesintisiz, "polite")
         * duyurur — `role="alert"` (yukarıdaki hata, İVEDİ/"assertive")
         * İLE KARIŞTIRILMAZ. */}
        <p aria-live="polite" className="sr-only">
          {isSubmitting ? "Giriş yapılıyor…" : ""}
        </p>

        <div>
          <label
            htmlFor={identifierField.id}
            className="block break-words text-lg font-medium text-[var(--color-text)]"
          >
            {identifierField.label}
          </label>
          <input
            ref={identifierInputRef}
            id={identifierField.id}
            name={identifierField.name}
            type="text"
            inputMode={identifierField.inputMode}
            enterKeyHint={identifierField.enterKeyHint ?? "next"}
            autoCapitalize={identifierField.autoCapitalize}
            autoComplete={identifierField.autoComplete}
            autoCorrect={identifierField.autoCorrect}
            spellCheck={identifierField.spellCheck}
            value={identifierValue}
            onChange={(event) => setIdentifierValue(event.target.value)}
            onFocus={(event) => scrollFieldIntoView(event.currentTarget)}
            aria-invalid={fieldErrors.identifier ? true : undefined}
            aria-describedby={
              fieldErrors.identifier ? `${identifierField.id}-error` : undefined
            }
            className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          />
          {fieldErrors.identifier && (
            <p
              id={`${identifierField.id}-error`}
              className="mt-1 flex items-start gap-1.5 break-words text-base text-[var(--color-error)]"
            >
              <AlertIcon />
              {fieldErrors.identifier}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="password"
            className="block break-words text-lg font-medium text-[var(--color-text)]"
          >
            Şifre
          </label>
          <div className="mt-1 flex items-stretch gap-2">
            <input
              ref={passwordInputRef}
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              enterKeyHint="go"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onFocus={(event) => scrollFieldIntoView(event.currentTarget)}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? "password-error" : undefined}
              className="min-h-[var(--control-min-height)] w-full flex-1 rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-pressed={showPassword}
              className="min-h-[var(--control-min-height)] min-w-[3rem] shrink-0 rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-3 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              {showPassword ? "Gizle" : "Göster"}
            </button>
          </div>
          {fieldErrors.password && (
            <p
              id="password-error"
              className="mt-1 flex items-start gap-1.5 break-words text-base text-[var(--color-error)]"
            >
              <AlertIcon />
              {fieldErrors.password}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="min-h-[var(--primary-min-height)] w-full rounded-[var(--radius-control)] bg-[var(--color-primary)] text-lg font-semibold text-[var(--color-on-primary)] transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
        >
          {isSubmitting ? "Giriş yapılıyor…" : "Giriş yap"}
        </button>
      </form>

      {helpText && (
        <p className="break-words text-center text-base text-[var(--color-text-secondary)]">
          {helpText}
        </p>
      )}
    </div>
  );
}
