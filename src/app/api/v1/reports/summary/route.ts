/**
 * GET /api/v1/reports/summary — sahip özeti: araç başlığı + dönem toplamları.
 *
 * `/reports/vehicles` ile aynı koruma ve sorgu kuralları: `period=week|month|year`
 * (varsayılan month), `date=YYYY-MM-DD` (varsayılan İstanbul bugünü); yalnız URL'den
 * okunur, bilinmeyen parametre yok sayılır. İşletme/araç yalnız oturum kapsamından
 * gelir. Şoför oturumunda `report.read` izni yoktur (403).
 */
import { z } from "zod";
import { REPORT_PERIOD_KINDS, isValidReportDate, resolveReportPeriod } from "../../../../../lib/report-period";
import { istanbulToday } from "../../../../../lib/work-time";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../server/http/errors";
import { withProtectedRoute } from "../../../../../server/http/handler";
import { readOwnerSummaryForScope } from "../../../../../server/usecases/reports";
import { fieldErrorsFromZodIssues } from "../../admin/_http";
import { pickSearchParams } from "../../admin/_list-query";

const summaryQuerySchema = z.object({
  period: z.enum(REPORT_PERIOD_KINDS).optional(),
  date: z.string().refine(isValidReportDate).optional(),
});

const SUMMARY_FIELD_MESSAGES: Record<string, string> = {
  period: "Dönem week, month veya year olmalıdır.",
  date: "Tarih geçerli bir YYYY-MM-DD günü olmalıdır.",
};

export const GET = withProtectedRoute({
  permission: "report.read",
  target: "vehicle",
})((ctx) => {
  if (!ctx.scope) {
    throw new Error("GET /reports/summary: scope eksik (programlama hatası).");
  }
  const parsed = summaryQuerySchema.safeParse(pickSearchParams(ctx.request, ["period", "date"] as const));
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error, SUMMARY_FIELD_MESSAGES),
      requestId: ctx.requestId,
    });
  }
  const period = resolveReportPeriod(parsed.data.period ?? "month", parsed.data.date ?? istanbulToday());
  if (!period) throw new Error("GET /reports/summary: doğrulanmış tarih çözülemedi (programlama hatası).");

  const summary = readOwnerSummaryForScope(ctx.db, ctx.scope, period);
  return jsonSuccessResponse(200, { summary }, { requestId: ctx.requestId });
});
