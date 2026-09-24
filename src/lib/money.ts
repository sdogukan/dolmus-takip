/**
 * Para girdisi (T3.2) — SAF, kayan nokta YOK: tutar her yerde tam sayı
 * kuruştur ve ayrıştırma/biçimlendirme metin + BigInt ile yapılır.
 *
 * Türkçe giriş: "." yalnız 3 haneli gruplar için binlik ayracı, "," ondalık
 * ayracı. "1.5" / "10.50" sessizce 1,5 / 1050 okunmaz, açıklamalı hata verir;
 * 2 haneden fazla kuruş yuvarlanmaz, hata verir.
 *
 * Üst sınır `Number.MAX_SAFE_INTEGER` kuruştur: drizzle integer sütunları JS
 * number okur/yazar.
 */
import { WORK_ENTRY_MESSAGES as TEXT } from "./messages";

export const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

export type MoneyErrorCode =
  | "required"
  | "negative"
  | "format"
  | "thousands"
  | "precision"
  | "too_large";

export type ParseTlResult =
  | { ok: true; cents: bigint }
  | { ok: false; code: MoneyErrorCode; message: string };

const MONEY_ERROR_TEXT: Record<MoneyErrorCode, string> = {
  required: TEXT.moneyRequired,
  negative: TEXT.moneyNegative,
  format: TEXT.moneyFormat,
  thousands: TEXT.moneyThousands,
  precision: TEXT.moneyPrecision,
  too_large: TEXT.moneyTooLarge,
};

const ALLOWED_CHARS = /^[0-9.,]+$/u;
const PLAIN_INTEGER = /^[0-9]+$/u;
const GROUPED_INTEGER = /^[0-9]{1,3}(\.[0-9]{3})+$/u;
const FRACTION = /^[0-9]*$/u;
const API_CENTS = /^(0|[1-9][0-9]*)$/u;
const SIGNED_API_CENTS = /^-?(0|[1-9][0-9]*)$/u;

function fail(code: MoneyErrorCode): ParseTlResult {
  return { ok: false, code, message: MONEY_ERROR_TEXT[code] };
}

/** "10.000,00" → 1000000n. Boş metin 0 SAYILMAZ (`required`). */
export function parseTlAmount(text: string): ParseTlResult {
  const value = text.trim();
  if (value === "") return fail("required");
  if (value.startsWith("-")) return fail("negative");
  if (!ALLOWED_CHARS.test(value)) return fail("format");

  const parts = value.split(",");
  if (parts.length > 2) return fail("format");
  const integerText = parts[0]!;
  const fractionText = parts[1];

  if (integerText === "") return fail("format");
  if (integerText.includes(".")) {
    if (!GROUPED_INTEGER.test(integerText)) return fail("thousands");
  } else if (!PLAIN_INTEGER.test(integerText)) {
    return fail("format");
  }
  if (fractionText !== undefined) {
    if (fractionText === "" || !FRACTION.test(fractionText)) return fail("format");
    if (fractionText.length > 2) return fail("precision");
  }

  const lira = BigInt(integerText.replaceAll(".", ""));
  const kurus = BigInt((fractionText ?? "").padEnd(2, "0"));
  const cents = lira * 100n + kurus;
  if (cents > MAX_CENTS) return fail("too_large");
  return { ok: true, cents };
}

/** 620000 → "6.200,00 TL"; eksi değer "-1.000,00 TL". */
export function formatTlAmount(cents: number | bigint): string {
  const value = toBigIntCents(cents);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const lira = (abs / 100n).toString().replace(/\B(?=([0-9]{3})+(?![0-9]))/gu, ".");
  const kurus = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${lira},${kurus} TL`;
}

/** Kuruşu API'nin ondalık tam sayı metnine çevirir ("620000"). */
export function centsToApiString(cents: number | bigint): string {
  return toBigIntCents(cents).toString();
}

/**
 * API kuruş metnini (`^(0|[1-9][0-9]*)$`, ≤ MAX_SAFE_INTEGER) BigInt'e
 * çevirir; geçersizse `null`. `Number()`/`parseFloat` KULLANILMAZ.
 */
export function parseApiCents(text: string): bigint | null {
  if (!API_CENTS.test(text)) return null;
  const cents = BigInt(text);
  return cents <= MAX_CENTS ? cents : null;
}

/**
 * Eksi olabilen API kuruş metni ("-40000"): yalnız `remainderCents` gibi
 * gider hasılatı aşabilen alanlar için. "-0" ve büyüklüğü MAX_CENTS'i aşan
 * değer `null`.
 */
export function parseSignedApiCents(text: string): bigint | null {
  if (!SIGNED_API_CENTS.test(text) || text === "-0") return null;
  const cents = BigInt(text);
  const magnitude = cents < 0n ? -cents : cents;
  return magnitude <= MAX_CENTS ? cents : null;
}

/**
 * Dönem toplamı (`grossCents` … `remainderCents`): eksi olabilen ondalık tam
 * sayı metni, ÜST SINIR YOK — toplamlar tek kaydın `MAX_CENTS` sınırını
 * aşabilir ve sunucu bunları kesin metin olarak döndürür. Geçersizse ve "-0"
 * için `null`. `Number()` KULLANILMAZ.
 */
export function parseApiTotalCents(text: string): bigint | null {
  if (!SIGNED_API_CENTS.test(text) || text === "-0") return null;
  return BigInt(text);
}

function toBigIntCents(cents: number | bigint): bigint {
  if (typeof cents === "bigint") return cents;
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("Kuruş güvenli bir tam sayı olmalı.");
  }
  return BigInt(cents);
}
