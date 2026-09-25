/**
 * Şoför payı ve kalan (kural v1) — SAF, kayan nokta YOK.
 *
 * - pay = floor((hasılat * bps + 5000) / 10000); hasılat ÜZERİNDEN, giderler
 *   düşülmeden. Şoför 2000 bps, sahip 0.
 * - kalan = hasılat − yakıt − diğer gider − pay; EKSİ olabilir, kırpılmaz.
 * - Oran YALNIZ çağıranın doğruladığı `workKind` argümanından gelir.
 * - Hesap BigInt ile yapılır; sonuç JS number'a (drizzle integer) sığmazsa
 *   `AmountOutOfRangeError` fırlatılır — sessiz kesme yok.
 */
export type WorkKind = "owner" | "driver";

export const CALCULATION_VERSION = 1;

export const SHARE_BPS_BY_WORK_KIND: Readonly<Record<WorkKind, 0 | 2000>> = {
  driver: 2000,
  owner: 0,
};

const BPS_DENOMINATOR = 10000n;
const ROUNDING_HALF = 5000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export class AmountOutOfRangeError extends RangeError {
  constructor() {
    super("Tutarlar güvenli tam sayı sınırını aşıyor.");
    this.name = "AmountOutOfRangeError";
  }
}

export interface WorkEntryAmounts {
  shareBps: 0 | 2000;
  shareCents: number;
  remainderCents: number;
  calculationVersion: number;
}

function toCents(value: number | bigint): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError("Kuruş güvenli bir tam sayı olmalı.");
  }
  const cents = BigInt(value);
  if (cents < 0n || cents > MAX_SAFE) throw new RangeError("Kuruş 0..MAX_SAFE_INTEGER olmalı.");
  return cents;
}

export function calculateWorkEntryAmounts(
  workKind: WorkKind,
  grossCents: number | bigint,
  fuelCents: number | bigint,
  otherExpenseCents: number | bigint,
): WorkEntryAmounts {
  const gross = toCents(grossCents);
  const fuel = toCents(fuelCents);
  const other = toCents(otherExpenseCents);
  const shareBps = SHARE_BPS_BY_WORK_KIND[workKind];

  const share = (gross * BigInt(shareBps) + ROUNDING_HALF) / BPS_DENOMINATOR;
  const deductions = fuel + other + share;
  if (deductions > MAX_SAFE) throw new AmountOutOfRangeError();
  const remainder = gross - deductions;

  return {
    shareBps,
    shareCents: Number(share),
    remainderCents: Number(remainder),
    calculationVersion: CALCULATION_VERSION,
  };
}
