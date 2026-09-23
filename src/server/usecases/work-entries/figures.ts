/**
 * Sunucu tarafı yeniden hesap (T3.2): süre, pay ve kalan gövdeden DEĞİL,
 * doğrulanmış girdiden burada türetilir. `workKind` çağıranın (T3.3/T3.4)
 * doğruladığı kayıt türüdür; oturum rolünden ya da gövdeden okunmaz.
 */
import { WORK_ENTRY_MESSAGES as TEXT } from "../../../lib/messages";
import {
  AmountOutOfRangeError,
  calculateWorkEntryAmounts,
  type WorkKind,
} from "../../../lib/work-calculation";
import { evaluateWorkTime } from "../../../lib/work-time";
import { workEntryInputSchema } from "./input";

export interface WorkEntryFigures {
  workDate: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  grossCents: number;
  fuelCents: number;
  otherExpenseCents: number;
  otherExpenseNote: string | null;
  shareBps: 0 | 2000;
  shareCents: number;
  remainderCents: number;
  calculationVersion: number;
}

export type WorkEntryFiguresResult =
  | { ok: true; figures: WorkEntryFigures }
  | { ok: false; fields: Record<string, string> };

export function computeWorkEntryFigures(
  workKind: WorkKind,
  body: unknown,
): WorkEntryFiguresResult {
  const parsed = workEntryInputSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      fields[key] ??= issue.message;
    }
    if (Object.keys(fields).length === 0) fields[""] = "Geçersiz gövde.";
    return { ok: false, fields };
  }
  const input = parsed.data;

  const time = evaluateWorkTime({
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    endsNextDay: input.endsNextDay,
  });
  if (!time.ok) return { ok: false, fields: { ...time.errors } };

  try {
    const amounts = calculateWorkEntryAmounts(
      workKind,
      input.grossCents,
      input.fuelCents,
      input.otherExpenseCents,
    );
    return {
      ok: true,
      figures: {
        workDate: time.workDate,
        startsAt: time.startsAt,
        endsAt: time.endsAt,
        durationMinutes: time.durationMinutes,
        grossCents: Number(input.grossCents),
        fuelCents: Number(input.fuelCents),
        otherExpenseCents: Number(input.otherExpenseCents),
        otherExpenseNote: input.otherExpenseNote,
        ...amounts,
      },
    };
  } catch (error) {
    if (error instanceof AmountOutOfRangeError) {
      return { ok: false, fields: { otherExpenseCents: TEXT.amountsTooLarge } };
    }
    throw error;
  }
}
