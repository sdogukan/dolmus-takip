/**
 * Günlük kayıt gövdesi şeması (T3.2) — uç nokta ve DB yazımı T3.4'te.
 *
 * Şema `workKind`, `shareBps`, `shareCents`, `remainderCents`,
 * `calculationVersion` ALANLARINI BİLEREK TANIMLAMAZ: istemci bunları
 * gönderse bile zod `.strip()` ile atılır, sunucu değerleri kazanır. Kişi
 * seçimi (T3.3/T3.4) burada YOKTUR; `personId` adı `scopeSafeObject` ile
 * zaten yasaktır.
 *
 * Kuruş alanları API sözleşmesi gereği ondalık tam sayı METNİDİR
 * (`^(0|[1-9][0-9]*)$`) ve BigInt'e çevrilir — `Number`/`parseFloat` yok.
 */
import { z } from "zod";
import { WORK_ENTRY_MESSAGES as TEXT } from "../../../lib/messages";
import { parseApiCents } from "../../../lib/money";
import { scopeSafeObject } from "../../auth/scope";

/** `other_expense_note` üst sınırı (sütun sınırsız text): kırpıldıktan sonra 200 karakter. */
export const OTHER_EXPENSE_NOTE_MAX_LENGTH = 200;
/** Kırpmadan ÖNCE kaba sınır: aşırı büyük gövdeyi baştan keser. */
const OTHER_EXPENSE_NOTE_RAW_MAX_LENGTH = 1000;

const centsText = (required: string) =>
  z
    .string({ error: required })
    .min(1, TEXT.moneyRequired)
    .regex(/^(0|[1-9][0-9]*)$/u, TEXT.moneyFormat)
    .refine((value) => parseApiCents(value) !== null, TEXT.moneyTooLarge)
    .transform((value) => BigInt(value));

const optionalCentsText = z
  .string({ error: TEXT.moneyFormat })
  .regex(/^((0|[1-9][0-9]*))?$/u, TEXT.moneyFormat)
  .refine((value) => value === "" || parseApiCents(value) !== null, TEXT.moneyTooLarge)
  .optional();

const noteText = z
  .string({ error: TEXT.otherExpenseNoteTooLong })
  .max(OTHER_EXPENSE_NOTE_RAW_MAX_LENGTH, TEXT.otherExpenseNoteTooLong)
  .transform((value) => value.trim())
  .pipe(z.string().max(OTHER_EXPENSE_NOTE_MAX_LENGTH, TEXT.otherExpenseNoteTooLong))
  .nullish();

export const workEntryInputSchema = scopeSafeObject({
  date: z.string({ error: TEXT.dateInvalid }).max(10, TEXT.dateInvalid),
  startTime: z.string({ error: TEXT.startRequired }).max(5, TEXT.startRequired),
  endTime: z.string({ error: TEXT.endRequired }).max(5, TEXT.endRequired),
  endsNextDay: z.boolean().default(false),
  grossCents: centsText(TEXT.moneyRequired),
  fuelCents: centsText(TEXT.moneyRequired),
  otherExpenseCents: optionalCentsText,
  otherExpenseNote: noteText,
}).transform((value, ctx) => {
  const note = value.otherExpenseNote ? value.otherExpenseNote : null;
  const amountText = value.otherExpenseCents ?? "";
  // Tutar boş + not boş = kullanılmadı (0). Notlu boş tutar 0 SAYILMAZ.
  if (amountText === "" && note !== null) {
    ctx.issues.push({
      code: "custom",
      message: TEXT.moneyRequired,
      path: ["otherExpenseCents"],
      input: value.otherExpenseCents,
    });
    return z.NEVER;
  }
  return {
    date: value.date,
    startTime: value.startTime,
    endTime: value.endTime,
    endsNextDay: value.endsNextDay,
    grossCents: value.grossCents,
    fuelCents: value.fuelCents,
    otherExpenseCents: amountText === "" ? 0n : BigInt(amountText),
    otherExpenseNote: note,
  };
});

export type WorkEntryInput = z.output<typeof workEntryInputSchema>;
