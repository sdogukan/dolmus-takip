/**
 * platformLogin(db, rawBody, options) — T1.3 ADIM 1/2, S1.3.
 *
 * Görev tanımı (b, birebir): "{ username, password } (zod scopeSafeObject);
 * platform_users aktif + Argon2id doğrulama; kullanıcı adı varlığını ifşa
 * etmeyen genel hata 401 INVALID_CREDENTIALS ('Kullanıcı adı veya şifre
 * yanlış.'), bilinmeyen/pasif kullanıcıda dummy hash yolu (vehicle-login
 * ile aynı desen; ortak yardımcı kullan, kod tekrarı yapma); hız sınırı
 * rate-limit.ts ile (anahtar 'platform:'+normalize(username) 20/15 dk ve
 * IP 120/15 dk) ve hash kuyruğu; başarıda createPlatformSession + çerez +
 * yanıt { kind:'platform', role (admin|support), username, csrfToken,
 * scopeKey, permissions } (201). Araç credential'ı ekip girişini AÇMAZ
 * (farklı tablo; test)."
 *
 * Bu dosya `../../usecases/auth/vehicle-login.ts`'İN (T1.2) BİREBİR AYNI
 * ayracını izler — HTTP'den (Request/Response, cookie, Set-Cookie,
 * X-Forwarded-For) TAMAMEN BAĞIMSIZDIR; cookie üretimi, eski oturum
 * çerezinin iptali ve IP çözümü `../../app/api/v1/auth/platform-login/
 * route.ts`'in (HTTP katmanı) işidir.
 *
 * ## Sıra (vehicle-login.ts ile AYNI gerekçe, bkz. o dosyanın üst notu)
 *
 * 1. Şema/biçim doğrulama (422).
 * 2. Hız sınırı denetimi (429 RATE_LIMITED) — `../../auth/rate-limit.ts`
 *    `checkPlatformLoginRateLimit`.
 * 3. `platform_users` sorgusu (kullanıcı adına göre, aktiflik dahil).
 * 4. Argon2 doğrulaması — HER ZAMAN `../../auth/hash-queue.ts`
 *    `runInHashQueue` ÜZERİNDEN (429 HASH_QUEUE_FULL ihtimali burada
 *    doğar); `./vehicle-login.ts`'in EXPORT ettiği `verifyPasswordOrDummy`/
 *    `DUMMY_ARGON2ID_HASH` DOĞRUDAN kullanılır (kod tekrarı yok). Araç
 *    girişinin AKSİNE burada TEK credential (bir platform_users satırının
 *    tek password_hash'i) vardır — bu yüzden bilinen/bilinmeyen/pasif her
 *    yolda TAM OLARAK 1 hash işlemi çalışır (F10'un "≤ 2" sınırının
 *    içindedir).
 * 5. Sonuç: eşleşme yoksa hız sınırı sayacı BİR ARTIRILIR (yalnız
 *    başarısız denemeler) ve genel 401 `invalid_credentials` döner;
 *    eşleşme varsa `createPlatformSession` çağrılır, sayaç ARTIRILMAZ.
 *
 * "Araç credential'ı ekip girişini AÇMAZ" — bu fonksiyon yalnız
 * `platform_users` tablosunu sorgular; `vehicle_credentials` tablosuna HİÇ
 * dokunmaz, bu yüzden bir araç şifresi burada YAPISAL OLARAK asla eşleşmez
 * (ayrı tablo, ayrı hash) — bkz. `tests/integration/platform-login-route.test.ts`
 * "araç şifresiyle ekip girişi" testi.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { PLATFORM_LOGIN_FIELD_MESSAGES } from "../../../lib/messages";
import { HashQueueFullError } from "../../auth/hash-queue";
import {
  checkPlatformLoginRateLimit,
  recordFailedPlatformLoginAttempt,
  type PlatformLoginRateLimitKeys,
} from "../../auth/rate-limit";
import { scopeSafeObject } from "../../auth/scope";
import { systemClock, type Clock } from "../../auth/session";
import type { AppDatabase } from "../../data/db";
import { platformUsers } from "../../data/schema";
import {
  createPlatformSession,
  type CreatePlatformSessionResult,
} from "../session/create-platform-session";
import {
  PlatformCredentialVersionChangedError,
  PlatformSessionTargetInactiveError,
} from "../session/errors";
import { verifyPasswordOrDummy } from "./vehicle-login";

// ---------------------------------------------------------------------------
// Girdi şeması — `scopeSafeObject` role/personId/businessId/ownerId
// alanlarından biri TANIMLANMAYA çalışılırsa fırlar (bkz. `./vehicle-
// login.ts`'in AYNI notu); burada bu alanlar zaten hiç YOKTUR. Zod'un
// `.strip()` varsayılanı gövdede AYRICA gönderilen fazladan alanları
// (ör. bir saldırganın eklediği `role: "admin"`) SESSİZCE atar.
// ---------------------------------------------------------------------------
const platformLoginBodySchema = scopeSafeObject({
  username: z.string(),
  password: z.string(),
});

function fieldErrorsFromZodIssues(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (key === "username" && fields.username === undefined) {
      fields.username = PLATFORM_LOGIN_FIELD_MESSAGES.usernameEmpty;
    }
    if (key === "password" && fields.password === undefined) {
      fields.password = PLATFORM_LOGIN_FIELD_MESSAGES.passwordEmpty;
    }
  }
  // Savunma amaçlı: gövde bir obje bile değilse (ör. dizi/null/string)
  // zod kök düzeyde bir issue üretir (path boş); bu durumda HER İKİ alanı
  // da eksik say (bkz. `./vehicle-login.ts`'in AYNI deseni).
  if (Object.keys(fields).length === 0) {
    fields.username = PLATFORM_LOGIN_FIELD_MESSAGES.usernameEmpty;
    fields.password = PLATFORM_LOGIN_FIELD_MESSAGES.passwordEmpty;
  }
  return fields;
}

/**
 * Hız sınırı SAYACININ anahtarı için normalizasyon — DB sorgusunu
 * ETKİLEMEZ (`platform_users.username` TAM eşleşmeyle aranır; kullanıcı
 * adı DB'de normalize saklanmaz, bkz. `../../data/schema.ts`). Amaç yalnız
 * aynı hesabın büyük/küçük harf veya baştaki/sondaki boşluk varyasyonlarıyla
 * denenmesinin AYRI sayaçlara bölünüp sınırı ETKİSİZLEŞTİRMESİNİ önlemektir
 * — görev tanımı: "anahtar 'platform:'+normalize(username)".
 */
function normalizeUsernameForRateLimit(username: string): string {
  return username.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// DB okuması — yalnız SELECT (yazma yok); tek satırlık sorgu, kısa
// transaction gerektirmez (ARCHITECTURE §3.4 kuralı yalnız YAZMALAR
// içindir).
// ---------------------------------------------------------------------------

interface PlatformUserLookupRow {
  id: string;
  passwordHash: string;
  platformRole: "admin" | "support";
  active: boolean;
  credentialVersion: number;
}

async function lookupPlatformUserByUsername(
  db: AppDatabase,
  username: string,
): Promise<PlatformUserLookupRow | undefined> {
  const rows = await db
    .select({
      id: platformUsers.id,
      passwordHash: platformUsers.passwordHash,
      platformRole: platformUsers.platformRole,
      active: platformUsers.active,
      credentialVersion: platformUsers.credentialVersion,
    })
    .from(platformUsers)
    .where(eq(platformUsers.username, username))
    .limit(1);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Sonuç tipleri.
// ---------------------------------------------------------------------------

export interface PlatformLoginOptions {
  /** `../../auth/rate-limit.ts` `resolveClientIp(request)` — HTTP
   * katmanında (route handler) çözülür, buraya HAZIR geçirilir. */
  ip: string;
  clock?: Clock;
}

export type PlatformLoginFailure =
  | { ok: false; kind: "validation"; fields: Record<string, string> }
  | { ok: false; kind: "invalid_credentials" }
  | { ok: false; kind: "rate_limited"; retryAfterSeconds: number }
  | { ok: false; kind: "hash_queue_full" };

export interface PlatformLoginSuccess {
  ok: true;
  role: "admin" | "support";
  platformUserId: string;
  username: string;
  session: CreatePlatformSessionResult;
}

export type PlatformLoginResult = PlatformLoginSuccess | PlatformLoginFailure;

export async function platformLogin(
  db: AppDatabase,
  rawBody: unknown,
  options: PlatformLoginOptions,
): Promise<PlatformLoginResult> {
  const clock = options.clock ?? systemClock;

  const parsedBody = platformLoginBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return {
      ok: false,
      kind: "validation",
      fields: fieldErrorsFromZodIssues(parsedBody.error),
    };
  }

  const { username, password } = parsedBody.data;

  const fieldErrors: Record<string, string> = {};
  if (username.trim().length === 0) {
    fieldErrors.username = PLATFORM_LOGIN_FIELD_MESSAGES.usernameEmpty;
  }
  if (password.length === 0) {
    fieldErrors.password = PLATFORM_LOGIN_FIELD_MESSAGES.passwordEmpty;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, kind: "validation", fields: fieldErrors };
  }

  const rateLimitKeys: PlatformLoginRateLimitKeys = {
    usernameKey: `platform:${normalizeUsernameForRateLimit(username)}`,
    ipKey: options.ip,
  };

  const rateDecision = checkPlatformLoginRateLimit(rateLimitKeys, clock);
  if (rateDecision.limited) {
    return {
      ok: false,
      kind: "rate_limited",
      retryAfterSeconds: rateDecision.retryAfterSeconds,
    };
  }

  const userRow = await lookupPlatformUserByUsername(db, username);
  const isUsableUser = userRow !== undefined && userRow.active;

  let matched: {
    platformUserId: string;
    role: "admin" | "support";
    credentialVersion: number;
  } | null = null;

  try {
    if (!isUsableUser) {
      // Bilinmeyen kullanıcı adı VEYA pasif hesap — ARCH §6 "Kullanıcı/
      // plaka tahmini"nin ekip girişindeki karşılığı: kontrollü dummy hash
      // yolu (`./vehicle-login.ts`'İN AYNI sabiti/yardımcısı — kod tekrarı
      // yok). Araç girişinden FARKLI olarak burada TEK bir credential
      // (owner/driver ikilisi değil, tek password_hash) olduğundan yalnız
      // 1 dummy doğrulama yeterlidir (F10'un "≤ 2" sınırının içinde).
      await verifyPasswordOrDummy(undefined, password, clock);
    } else {
      // TypeScript'e `isUsableUser` üzerinden `userRow`'un dolu olduğunu
      // kanıtlamak için (bkz. `./vehicle-login.ts`'in AYNI deseni).
      if (userRow === undefined) {
        throw new Error(
          "beklenmeyen durum: isUsableUser true ama userRow yok",
        );
      }
      const matches = await verifyPasswordOrDummy(
        userRow.passwordHash,
        password,
        clock,
      );
      if (matches) {
        matched = {
          platformUserId: userRow.id,
          role: userRow.platformRole,
          credentialVersion: userRow.credentialVersion,
        };
      }
    }
  } catch (error) {
    if (error instanceof HashQueueFullError) {
      return { ok: false, kind: "hash_queue_full" };
    }
    throw error;
  }

  if (!matched) {
    // "yalnız başarısız denemeler sayılır" — bkz. `../../auth/
    // rate-limit.ts` üst notu.
    recordFailedPlatformLoginAttempt(rateLimitKeys, clock);
    return { ok: false, kind: "invalid_credentials" };
  }

  let session: CreatePlatformSessionResult;
  try {
    session = await createPlatformSession(
      db,
      matched.platformUserId,
      clock,
      matched.credentialVersion,
    );
  } catch (error) {
    if (
      error instanceof PlatformSessionTargetInactiveError ||
      error instanceof PlatformCredentialVersionChangedError
    ) {
      // Giriş/pasifleştirme YA DA giriş/parola sıfırlama yarışı: parola
      // Argon2 anında eşleşti ama hesap, oturum INSERT'i anında (atomik
      // yeniden denetim) artık pasif ya da parolası sıfırlanmış. Genel 401
      // (hangi durumun gerçekleştiği sızdırılmaz); YANLIŞ PAROLA olmadığı
      // için hız sınırı sayacı ARTIRILMAZ.
      return { ok: false, kind: "invalid_credentials" };
    }
    throw error;
  }

  return {
    ok: true,
    role: matched.role,
    platformUserId: matched.platformUserId,
    username,
    session,
  };
}
