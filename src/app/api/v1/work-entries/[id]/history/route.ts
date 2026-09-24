/**
 * GET /api/v1/work-entries/[id]/history — kayıt geçmişi (revizyonlar + onaylar).
 * Yalnız okuma; gövde ve sorgu parametreleri yok sayılır, kayıt kimliği YALNIZ
 * URL'de taşınır. Şoför oturumu `work_entry.history` izni olmadığından okumadan
 * ÖNCE 403 alır; başka araç/işletme ve bilinmeyen kimlik AYNI 404'ü alır.
 */
import { jsonSuccessResponse } from "../../../../../../server/http/errors";
import { withProtectedRoute } from "../../../../../../server/http/handler";
import { readWorkEntryHistoryForScope } from "../../../../../../server/usecases/work-entries";
import { workEntryNotFoundResponse } from "../../_http";

export const GET = withProtectedRoute({
  permission: "work_entry.history",
  target: "vehicle",
})((ctx) => {
  const entryId = ctx.params?.id;
  if (!ctx.scope || !entryId) {
    throw new Error("GET /work-entries/[id]/history: scope veya id eksik (programlama hatası).");
  }
  const history = readWorkEntryHistoryForScope(ctx.db, ctx.scope, entryId);
  if (!history) return workEntryNotFoundResponse(ctx.requestId);
  return jsonSuccessResponse(200, { history }, { requestId: ctx.requestId });
});
