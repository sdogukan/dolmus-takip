/**
 * GET /api/v1/reports/vehicles — araç dönem raporu.
 *
 * `period=week|month|year` (varsayılan month), `date=YYYY-MM-DD` (varsayılan
 * İstanbul bugünü); yalnız URL'den okunur, bilinmeyen parametre yok sayılır.
 * İşletme/araç yalnız oturum kapsamından gelir. Şoför oturumunda `report.read`
 * izni yoktur (403); ekip `X-Target-Vehicle` ile hedef aracı raporlar.
 */
import { z } from "zod";
import { REPORT_PERIOD_KINDS, isValidReportDate, resolveReportPeriod } from "../../../../../lib/report-period";
import { istanbulToday } from "../../../../../lib/work-time";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../server/http/errors";
import { withProtectedRoute } from "../../../../../server/http/handler";
import { readVehiclePeriodReportForScope } from "../../../../../server/usecases/reports";
import { fieldErrorsFromZodIssues } from "../../admin/_http";
import { pickSearchParams } from "../../admin/_list-query";

const reportQuerySchema = z.object({
  period: z.enum(REPORT_PERIOD_KINDS).optional(),
  date: z.string().refine(isValidReportDate).optional(),
});

const REPORT_FIELD_MESSAGES: Record<string, string> = {
  period: "Dönem week, month veya year olmalıdır.",
  date: "Tarih geçerli bir YYYY-MM-DD günü olmalıdır.",
};

export const GET = withProtectedRoute({
  permission: "report.read",
  target: "vehicle",
})((ctx) => {
  if (!ctx.scope) {
    throw new Error("GET /reports/vehicles: scope eksik (programlama hatası).");
  }
  const parsed = reportQuerySchema.safeParse(pickSearchParams(ctx.request, ["period", "date"] as const));
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error, REPORT_FIELD_MESSAGES),
      requestId: ctx.requestId,
    });
  }
  const period = resolveReportPeriod(parsed.data.period ?? "month", parsed.data.date ?? istanbulToday());
  if (!period) throw new Error("GET /reports/vehicles: doğrulanmış tarih çözülemedi (programlama hatası).");

  const report = readVehiclePeriodReportForScope(ctx.db, ctx.scope, period);
  return jsonSuccessResponse(200, { report }, { requestId: ctx.requestId });
});
