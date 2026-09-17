/**
 * vehicleLogin(db, rawBody, options) — T1.2 ADIM 1/2, S1.2.
 *
 * Görev tanımı (1, birebir): "girdi { plate, password } (zod,
 * scopeSafeObject; role/personId vb. yasak). Plaka normalizasyonu
 * src/lib/plate.ts + biçim doğrulama → 422 alan hatası. Aktif işletme +
 * aktif araç şartı. İki rol credential'ı (owner, driver) Argon2id ile
 * doğrulanır; rol İSTEMCİDEN ALINMAZ, hangi hash eşleşirse o rol. ARCH §6
 * 'Kullanıcı/plaka tahmini': bilinmeyen plaka, pasif araç/işletme ve
 * yanlış parola AYNI genel yanıtı verir (401 INVALID_CREDENTIALS, mesaj
 * 'Plaka veya şifre yanlış.'); erken rol ifşası yok; bilinmeyen/pasif
 * plakada kontrollü dummy hash yolu (sabit bir Argon2id hash'ine karşı
 * doğrulama) ile süre farkı azaltılır. Başarıda createVehicleSession
 * (credentialId) ..."
 *
 * Bu dosya HTTP'den (Request/Response, cookie, Set-Cookie, X-Forwarded-
 * For) TAMAMEN BAĞIMSIZDIR — `../session/create-vehicle-session.ts`'in
 * izlediği AYNI ayrım (bkz. o dosyanın üst notu): usecase yalnız DB +
 * kimlik doğrulama + hız sınırı + hash kuyruğu ORKESTRASYONUNU yapar;
 * cookie üretimi, eski oturum çerezinin iptali ve `X-Forwarded-For`'dan
 * IP çözümü `../../app/api/v1/auth/vehicle-login/route.ts`'in (HTTP
 * katmanı) işidir (görev tanımının kendi ayracı — item (4) route
 * handler'ı AYRI ele alır, bkz. o dosyanın üst notu).
 *
 * ## Sıra (bilinçli, güvenlik gerekçeli)
 *
 * 1. Şema/biçim doğrulama (422) — DB'ye veya hash kuyruğuna HİÇ
 *    dokunmadan, en ucuz kontroller önce.
 * 2. Hız sınırı denetimi (429 RATE_LIMITED) — `../../auth/rate-limit.ts`
 *    `checkVehicleLoginRateLimit`; DB sorgusu veya Argon2 doğrulaması
 *    HENÜZ ÇALIŞTIRILMADAN, zaten aşılmış bir sınır varsa erken çıkış
 *    (ARCH §6 "Hash yükü"nün önündeki ucuz/bellek-içi ilk kapı).
 * 3. Araç + işletme aktiflik sorgusu ve (aktifse) credential satırları.
 * 4. Argon2 doğrulaması — HER ZAMAN `../../auth/hash-queue.ts`
 *    `runInHashQueue` ÜZERİNDEN (429 HASH_QUEUE_FULL ihtimali burada
 *    doğar); bilinmeyen/pasif durumda SABİT dummy özete karşı, aktif
 *    durumda GERÇEK owner/driver özetlerine karşı — ikisi de EN FAZLA 2
 *    çağrı (F10).
 * 5. Sonuç: eşleşme yoksa hız sınırı sayacı BİR ARTIRILIR (yalnız
 *    başarısız denemeler) ve genel 401 `invalid_credentials` döner;
 *    eşleşme varsa `createVehicleSession` çağrılır, sayaç ARTIRILMAZ.
 */
import { verify } from "argon2";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { validatePlate } from "../../../lib/plate";
import { VEHICLE_LOGIN_FIELD_MESSAGES } from "../../../lib/messages";
import { HashQueueFullError, runInHashQueue } from "../../auth/hash-queue";
import {
  checkVehicleLoginRateLimit,
  recordFailedVehicleLoginAttempt,
  type VehicleLoginRateLimitKeys,
} from "../../auth/rate-limit";
import { systemClock, type Clock } from "../../auth/session";
import { scopeSafeObject } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { businesses, vehicleCredentials, vehicles } from "../../data/schema";
import {
  createVehicleSession,
  type CreateVehicleSessionResult,
} from "../session/create-vehicle-session";

// ---------------------------------------------------------------------------
// Girdi şeması — "role/personId vb. yasak" `scopeSafeObject` KENDİSİ
// (bkz. `../../auth/scope.ts`) `role`/`personId`/`businessId`/`ownerId`
// alanlarından biri ŞEMADA TANIMLANMAYA ÇALIŞILIRSA fırlar; burada bu
// alanlar zaten hiç YOKTUR. `z.object`'in varsayılan `.strip()` davranışı
// (görev tanımının imzasının dayandığı `scopeSafeObject` üzerinden) gövdede
// AYRICA gönderilen fazladan `role`/`personId` gibi alanları da SESSİZCE
// atar — "gövdede role/personId gönderilse yok sayılır ve yetki değişmez"
// (bu paketin doğrulama listesi) TAM OLARAK bu ikinci katmanla sağlanır.
// ---------------------------------------------------------------------------
const vehicleLoginBodySchema = scopeSafeObject({
  plate: z.string(),
  password: z.string(),
});

function fieldErrorsFromZodIssues(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (key === "plate" && fields.plate === undefined) {
      fields.plate = VEHICLE_LOGIN_FIELD_MESSAGES.plateEmpty;
    }
    if (key === "password" && fields.password === undefined) {
      fields.password = VEHICLE_LOGIN_FIELD_MESSAGES.passwordEmpty;
    }
  }
  // Savunma amaçlı: gövde bir obje bile değilse (ör. dizi/null/string)
  // zod kök düzeyde bir issue üretir (path boş); bu durumda HER İKİ alanı
  // da eksik say — uydurma "geçerli" bir alan durumu ÜRETİLMEZ.
  if (Object.keys(fields).length === 0) {
    fields.plate = VEHICLE_LOGIN_FIELD_MESSAGES.plateEmpty;
    fields.password = VEHICLE_LOGIN_FIELD_MESSAGES.passwordEmpty;
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Dummy hash — ARCH §6 "Kullanıcı/plaka tahmini" (dosya üstü not).
// `node scripts/generate-dummy-hash` gibi bir CLI'a gerek yoktur; bu
// değer BİR KEZ (seed'in kullandığı AYNI Argon2id parametreleriyle,
// m=19456/t=2/p=1 — DECISIONS.md K9) üretilip buraya SABİTLENMİŞTİR.
// `argon2.verify(digest, password)` parametreleri `digest`'in KENDİSİNDEN
// okur (node-argon2 kaynağı — `verify(digest, password, options?)`); bu
// yüzden GERÇEK bir owner/driver doğrulamasıyla AYNI CPU maliyetini
// taşır. Hiçbir düz metin şifre bu özetle EŞLEŞMEZ (özet, rastgele/
// atılmış bir düz metinden üretilmiştir) — yalnız SÜRE profili içindir.
// Test görünürlüğü için EXPORT edilir — `tests/integration/vehicle-login-
// route.test.ts` gerçek `argon2.verify` çağrısını GEÇİŞLİ (passthrough:
// sonucu DEĞİŞTİRMEZ, yalnız argümanları KAYDEDER) bir casusla izleyip
// bilinmeyen/pasif plaka denemesinde GERÇEKTEN bu sabite karşı (owner/
// driver'ın GERÇEK özetlerine değil) doğrulama yapıldığını kanıtlar.
export const DUMMY_ARGON2ID_HASH =
  "$argon2id$v=19$m=19456,p=1,t=2$IZucioL54ivovTekOuvEhA$q6c/zQkP7H06bG5SOlSDlksDMgIIw+xkAqvwwU3PL44";

async function verifyPasswordOrDummy(
  hash: string | undefined,
  password: string,
  clock: Clock,
): Promise<boolean> {
  const digest = hash ?? DUMMY_ARGON2ID_HASH;
  return runInHashQueue(() => verify(digest, password), clock);
}

// ---------------------------------------------------------------------------
// DB okumaları — yalnız SELECT (yazma yok); tek satırlık sorgular, kısa
// transaction gerektirmez (ARCHITECTURE §3.4 kuralı yalnız YAZMALAR
// içindir).
// ---------------------------------------------------------------------------

interface VehicleLookupRow {
  vehicleId: string;
  businessId: string;
  vehicleActive: boolean;
  businessActive: boolean;
}

async function lookupVehicleByPlate(
  db: AppDatabase,
  plateNormalized: string,
): Promise<VehicleLookupRow | undefined> {
  const rows = await db
    .select({
      vehicleId: vehicles.id,
      businessId: vehicles.businessId,
      vehicleActive: vehicles.active,
      businessActive: businesses.active,
    })
    .from(vehicles)
    .innerJoin(businesses, eq(vehicles.businessId, businesses.id))
    .where(eq(vehicles.plateNormalized, plateNormalized))
    .limit(1);
  return rows[0];
}

interface CredentialRow {
  id: string;
  role: "owner" | "driver";
  passwordHash: string;
}

async function lookupCredentials(
  db: AppDatabase,
  vehicleId: string,
): Promise<CredentialRow[]> {
  return db
    .select({
      id: vehicleCredentials.id,
      role: vehicleCredentials.role,
      passwordHash: vehicleCredentials.passwordHash,
    })
    .from(vehicleCredentials)
    .where(eq(vehicleCredentials.vehicleId, vehicleId));
}

// ---------------------------------------------------------------------------
// Sonuç tipleri.
// ---------------------------------------------------------------------------

export interface VehicleLoginOptions {
  /** `../../auth/rate-limit.ts` `resolveClientIp(request)` — HTTP
   * katmanında (route handler) çözülür, buraya HAZIR geçirilir. */
  ip: string;
  clock?: Clock;
}

export type VehicleLoginFailure =
  | { ok: false; kind: "validation"; fields: Record<string, string> }
  | { ok: false; kind: "invalid_credentials" }
  | { ok: false; kind: "rate_limited"; retryAfterSeconds: number }
  | { ok: false; kind: "hash_queue_full" };

export interface VehicleLoginSuccess {
  ok: true;
  role: "owner" | "driver";
  businessId: string;
  vehicleId: string;
  credentialId: string;
  /** Boşluksuz, büyük harf — `../../../lib/plate.ts`
   * `formatPlateForDisplay` HTTP katmanında görüntü biçimine çevirir. */
  plateNormalized: string;
  session: CreateVehicleSessionResult;
}

export type VehicleLoginResult = VehicleLoginSuccess | VehicleLoginFailure;

export async function vehicleLogin(
  db: AppDatabase,
  rawBody: unknown,
  options: VehicleLoginOptions,
): Promise<VehicleLoginResult> {
  const clock = options.clock ?? systemClock;

  const parsedBody = vehicleLoginBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return {
      ok: false,
      kind: "validation",
      fields: fieldErrorsFromZodIssues(parsedBody.error),
    };
  }

  const plateResult = validatePlate(parsedBody.data.plate);
  const { password } = parsedBody.data;

  const fieldErrors: Record<string, string> = {};
  if (!plateResult.valid) {
    fieldErrors.plate =
      plateResult.reason === "empty"
        ? VEHICLE_LOGIN_FIELD_MESSAGES.plateEmpty
        : VEHICLE_LOGIN_FIELD_MESSAGES.plateInvalidFormat;
  }
  if (password.length === 0) {
    fieldErrors.password = VEHICLE_LOGIN_FIELD_MESSAGES.passwordEmpty;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, kind: "validation", fields: fieldErrors };
  }

  const plateKey = plateResult.normalized;
  const rateLimitKeys: VehicleLoginRateLimitKeys = {
    plateKey,
    ipKey: options.ip,
  };

  const rateDecision = checkVehicleLoginRateLimit(rateLimitKeys, clock);
  if (rateDecision.limited) {
    return {
      ok: false,
      kind: "rate_limited",
      retryAfterSeconds: rateDecision.retryAfterSeconds,
    };
  }

  const vehicleRow = await lookupVehicleByPlate(db, plateKey);
  const isUsableVehicle =
    vehicleRow !== undefined && vehicleRow.vehicleActive && vehicleRow.businessActive;

  let matched: { role: "owner" | "driver"; credentialId: string } | null = null;

  try {
    if (!isUsableVehicle) {
      // Bilinmeyen plaka VEYA pasif araç/işletme — ARCH §6 "Kullanıcı/
      // plaka tahmini": kontrollü dummy hash yolu. Gerçek "iki rol
      // denemesi" (owner+driver) ile AYNI hash-yükü/zamanlama profilini
      // korumak için TAM OLARAK 2 dummy doğrulama çalıştırılır.
      await verifyPasswordOrDummy(undefined, password, clock);
      await verifyPasswordOrDummy(undefined, password, clock);
    } else {
      // TypeScript'e `isUsableVehicle` üzerinden `vehicleRow`'un dolu
      // olduğunu kanıtlamak için (yukarıdaki `&&` zincirinin kendisi bir
      // daraltma ÜRETMEZ — ayrı bir `undefined` denetimi).
      if (vehicleRow === undefined) {
        throw new Error("beklenmeyen durum: isUsableVehicle true ama vehicleRow yok");
      }
      const credentials = await lookupCredentials(db, vehicleRow.vehicleId);
      const ownerCredential = credentials.find((c) => c.role === "owner");
      const driverCredential = credentials.find((c) => c.role === "driver");

      const ownerMatches = await verifyPasswordOrDummy(
        ownerCredential?.passwordHash,
        password,
        clock,
      );
      if (ownerMatches && ownerCredential) {
        matched = { role: "owner", credentialId: ownerCredential.id };
      } else {
        const driverMatches = await verifyPasswordOrDummy(
          driverCredential?.passwordHash,
          password,
          clock,
        );
        if (driverMatches && driverCredential) {
          matched = { role: "driver", credentialId: driverCredential.id };
        }
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
    recordFailedVehicleLoginAttempt(rateLimitKeys, clock);
    return { ok: false, kind: "invalid_credentials" };
  }

  const session = await createVehicleSession(db, matched.credentialId, clock);
  const { businessId, vehicleId } = session.context;
  if (!businessId || !vehicleId) {
    // Savunma amaçlı bütünlük denetimi — `createVehicleSession` bir araç
    // credential'ı için HER ZAMAN dolu `businessId`/`vehicleId` üretir
    // (bkz. o dosyanın kendi implementasyonu); bu dal normal akışta HİÇ
    // tetiklenmemesi beklenen bir programlama-hatası koruyucusudur.
    throw new Error(
      "createVehicleSession araç bağlamı üretmedi (beklenmeyen durum).",
    );
  }

  return {
    ok: true,
    role: matched.role,
    businessId,
    vehicleId,
    credentialId: matched.credentialId,
    plateNormalized: plateKey,
    session,
  };
}
