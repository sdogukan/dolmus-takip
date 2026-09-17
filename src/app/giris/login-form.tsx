"use client";

/**
 * Araç girişi formu (istemci bileşeni) — T1.2 ADIM 2/2, S1.2.
 *
 * DESIGN.md §2.1 wireframe'i BİREBİR: başlık "Dolmuş Takip", alt başlık
 * "Günlük hesabını kolayca kaydet", "Plaka" ve "Şifre" alanları
 * (Göster/Gizle), "Giriş yap" ana düğmesi, yardım metni "Giriş
 * yapamıyorsan hesabını açan ekipten yardım al." — hiçbiri "Mal sahibi /
 * şoför" rol seçtirmez (STORIES.md S1.2 AC2).
 *
 * Sunucu: `POST /api/v1/auth/vehicle-login` (T1.2 ADIM 1/2,
 * `../api/v1/auth/vehicle-login/route.ts`) — `requireAnonymousWrite`
 * kullandığından CSRF header İSTEMEZ (oturum henüz yok); yalnız
 * `Content-Type: application/json` ve aynı-kaynak (Origin/Sec-Fetch-Site,
 * tarayıcı fetch'i zaten kendiliğinden gönderir) yeterlidir.
 *
 * Davranış (görev tanımı, birebir):
 * - Beklerken düğme "Giriş yapılıyor…" ve devre dışı; `isSubmitting`
 *   bayrağı aynı zamanda PARALEL gönderimi engeller (`handleSubmit`
 *   başında erken çıkış).
 * - 401 → "Plaka veya şifre yanlış." (`../../lib/messages.ts`
 *   `getErrorMessage("INVALID_CREDENTIALS")`), form SİLİNMEZ (plaka VE
 *   şifre alanı State'te kalır — React state zaten hata sonrası
 *   sıfırlanmaz).
 * - 422 → alan altında alan hatası (`error.fields.plate`/`.password`).
 * - 429 → bekleme mesajı (RATE_LIMITED veya HASH_QUEUE_FULL, ikisi de
 *   429 döner — sunucunun `error.code`'una göre ayrı metin).
 * - Ağ hatası (fetch reddi — sunucuya hiç ULAŞILAMADI) →
 *   `VEHICLE_LOGIN_RESULT_MESSAGES.networkError` ("Bağlantı kurulamadı.
 *   Tekrar dene.").
 * - Diğer (ör. 503 SERVICE_UNAVAILABLE) → sunucunun kendi (zaten önceden
 *   CURATE EDİLMİŞ, hiçbir zaman ham/iç ayrıntı taşımayan —
 *   `../../server/http/errors.ts` sözleşmesi) `error.message`'ı
 *   olduğu gibi gösterilir; ikinci bir metin eşlemesi İCAT EDİLMEZ.
 * - Başarı (201) → `clearClientStateForOtherScopes(localStorage,
 *   {scopeKey})` (S1.4 AC2/ortak telefon), ardından role'e göre TAM sayfa
 *   yönlendirme (`window.location.assign`) — owner → /sahip, driver →
 *   /sofor. Bilinçli olarak `next/navigation` `router.push` DEĞİL: hedef
 *   sayfalar (`../sofor/page.tsx`, `../sahip/page.tsx`) server component
 *   olarak YENİ oturum çerezini `next/headers` `cookies()` ile okur; TAM
 *   navigasyon bu okumanın Next'in istemci yönlendirici önbelleğinden
 *   ETKİLENMEDEN, doğrudan taze bir istekle olmasını GARANTİ eder —
 *   giriş/çıkış gibi kimlik sınırlarını geçen bir yönlendirme için en
 *   sağlam seçenektir.
 * - Hata/başarı yalnız renkle anlatılmaz: form hatası `role="alert"`
 *   (örtük `aria-live="assertive"`) taşır; alan hataları `aria-invalid`/
 *   `aria-describedby` ile alanına bağlanır.
 */
import { useState, type FormEvent } from "react";
import {
  clearClientStateForOtherScopes,
  type ClientStateScope,
} from "../../lib/client-state";
import { getErrorMessage, VEHICLE_LOGIN_RESULT_MESSAGES } from "../../lib/messages";

interface FieldErrors {
  plate?: string;
  password?: string;
}

interface VehicleLoginSuccessBody {
  role: "owner" | "driver";
  scopeKey?: unknown;
}

interface VehicleLoginErrorBody {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
  };
}

function targetPathForRole(role: "owner" | "driver"): string {
  return role === "owner" ? "/sahip" : "/sofor";
}

export function LoginForm() {
  const [plate, setPlate] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Paralel gönderim yok — zaten süren bir istek varken ikinci bir
    // `fetch` BAŞLATILMAZ (görev tanımı: "paralel gönderim yok").
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    let response: Response;
    try {
      response = await fetch("/api/v1/auth/vehicle-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate, password }),
      });
    } catch {
      // `fetch` reddi — istek sunucuya hiç ULAŞMADI (çevrimdışı, DNS,
      // bağlantı reddi vb.). Sunucunun ürettiği bir `error.code` YOKTUR.
      setFormError(VEHICLE_LOGIN_RESULT_MESSAGES.networkError);
      setIsSubmitting(false);
      return;
    }

    let body: VehicleLoginSuccessBody & VehicleLoginErrorBody;
    try {
      body = (await response.json()) as VehicleLoginSuccessBody & VehicleLoginErrorBody;
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
          // En iyi çaba — DESIGN §2.10 ilkesi; giriş akışını ENGELLEMEZ
          // (bkz. `../../lib/client-state.ts` üst notu, aynı ilke).
        }
      }
      // Başarı kesinleşti (201) — form devre dışı KALIR (isSubmitting
      // sıfırlanmaz), sayfa zaten ayrılıyor.
      window.location.assign(targetPathForRole(body.role));
      return;
    }

    if (response.status === 422) {
      const fields = body.error?.fields ?? {};
      if (fields.plate || fields.password) {
        setFieldErrors({ plate: fields.plate, password: fields.password });
      } else {
        // Savunma amaçlı — sunucu 422 için HER ZAMAN en az bir alan
        // hatası döner (bkz. `../../server/usecases/auth/vehicle-login.ts`
        // `fieldErrorsFromZodIssues`); bu dal normalde tetiklenmez.
        setFormError(body.error?.message ?? VEHICLE_LOGIN_RESULT_MESSAGES.networkError);
      }
      setIsSubmitting(false);
      return;
    }

    const mappedMessage = body.error?.code ? getErrorMessage(body.error.code) : undefined;
    setFormError(
      mappedMessage ?? body.error?.message ?? VEHICLE_LOGIN_RESULT_MESSAGES.networkError,
    );
    setIsSubmitting(false);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">
          Dolmuş Takip
        </h1>
        <p className="mt-1 text-base text-[var(--color-text-secondary)]">
          Günlük hesabını kolayca kaydet
        </p>
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
            htmlFor="plate"
            className="block text-lg font-medium text-[var(--color-text)]"
          >
            Plaka
          </label>
          <input
            id="plate"
            name="plate"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="username"
            autoCorrect="off"
            spellCheck={false}
            value={plate}
            onChange={(event) => setPlate(event.target.value)}
            aria-invalid={fieldErrors.plate ? true : undefined}
            aria-describedby={fieldErrors.plate ? "plate-error" : undefined}
            className="mt-1 min-h-[var(--control-min-height)] w-full rounded-[var(--radius-control)] border border-[var(--color-input-border)] bg-[var(--color-surface)] px-3 text-[length:var(--font-size-body)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          {fieldErrors.plate && (
            <p id="plate-error" className="mt-1 text-base text-[var(--color-error)]">
              {fieldErrors.plate}
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

      <p className="text-center text-base text-[var(--color-text-secondary)]">
        Giriş yapamıyorsan hesabını açan ekipten yardım al.
      </p>
    </div>
  );
}
