/**
 * GET /api/v1/reports/people/[personId] — bir kişinin dönem toplamları + kayıtları
 * (en yeni önce, keyset sayfalı). Kişi kimliği yalnız URL'de taşınır ve oturum
 * kapsamı İÇİNDE ek süzgeçtir; kapsamda/dönemde kaydı olmayan kimlik (bilinmeyen,
 * başka işletme, başka araç) AYNI 404'ü alır.
 */
import { z } from "zod";
import { REPORT_PERIOD_KINDS, isValidReportDate, resolveReportPeriod } from "../../../../../../lib/report-period";
import { istanbulToday } from "../../../../../../lib/work-time";
import { jsonErrorResponse, jsonSuccessResponse } from "../../../../../../server/http/errors";
import { withProtectedRoute } from "../../../../../../server/http/handler";
import { readPersonPeriodReportForScope } from "../../../../../../server/usecases/reports";
import { fieldErrorsFromZodIssues } from "../../../admin/_http";
import {
  cursorParamSchema,
  DEFAULT_LIST_LIMIT,
  LIST_QUERY_FIELD_MESSAGES,
  limitParamSchema,
  pickSearchParams,
} from "../../../admin/_list-query";

const detailQuerySchema = z.object({
  period: z.enum(REPORT_PERIOD_KINDS).optional(),
  date: z.string().refine(isValidReportDate).optional(),
  cursor: cursorParamSchema(2).optional(),
  limit: limitParamSchema.optional(),
});

const FIELD_MESSAGES: Record<string, string> = {
  period: "Dönem week, month veya year olmalıdır.",
  date: "Tarih geçerli bir YYYY-MM-DD günü olmalıdır.",
  cursor: LIST_QUERY_FIELD_MESSAGES.cursor!,
  limit: LIST_QUERY_FIELD_MESSAGES.limit!,
};

export const GET = withProtectedRoute({
  permission: "report.read",
  target: "vehicle",
})((ctx) => {
  const personId = ctx.params?.personId;
  if (!ctx.scope || !personId) {
    throw new Error("GET /reports/people/[personId]: scope veya personId eksik (programlama hatası).");
  }
  const parsed = detailQuerySchema.safeParse(
    pickSearchParams(ctx.request, ["period", "date", "cursor", "limit"] as const),
  );
  if (!parsed.success) {
    return jsonErrorResponse(422, "VALIDATION_ERROR", "Geçersiz veri.", {
      fields: fieldErrorsFromZodIssues(parsed.error, FIELD_MESSAGES),
      requestId: ctx.requestId,
    });
  }
  const period = resolveReportPeriod(parsed.data.period ?? "month", parsed.data.date ?? istanbulToday());
  if (!period) throw new Error("GET /reports/people/[personId]: doğrulanmış tarih çözülemedi (programlama hatası).");

  const report = readPersonPeriodReportForScope(ctx.db, ctx.scope, period, personId, {
    cursor: parsed.data.cursor,
    limit: parsed.data.limit ?? DEFAULT_LIST_LIMIT,
  });
  if (!report) {
    return jsonErrorResponse(404, "NOT_FOUND", "Kayıt bulunamadı.", { requestId: ctx.requestId });
  }
  return jsonSuccessResponse(200, { report }, { requestId: ctx.requestId });
});
