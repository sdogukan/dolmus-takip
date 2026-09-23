import { redirect } from "next/navigation";
import { PLATFORM_ROLE_LABELS } from "../../../lib/messages";
import { readPageSession } from "../../../server/auth/page-session";
import { readPlatformUsernameForDisplay } from "../../../server/auth/platform-username";
import { computeScopeKey } from "../../../server/auth/scope";
import { getAppDb } from "../../../server/data/app-db";

/**
 * /yonetim/ekip/** sayfalarının ORTAK oturum kapısı (server). Oturumsuz →
 * girişe, araç oturumu → kendi alanına; ekip oturumunun rolü her istekte
 * DB'den taze okunur (`resolveSession`), bu yüzden yeni indirilen bir yönetici
 * `isAdmin === false` görür. Yönetici olmayan ekip üyesine sayfa yetkisiz
 * metnini KENDİ render eder (veri okumaz).
 */
export async function readTeamPageContext() {
  const session = await readPageSession();
  if (!session.ok) {
    redirect("/yonetim/giris");
  }
  const { context } = session;
  if (context.kind === "vehicle") {
    redirect(context.role === "owner" ? "/sahip" : "/sofor");
  }
  if (context.kind !== "platform" || context.platformUserId === undefined) {
    redirect("/yonetim/giris");
  }
  const db = getAppDb();
  const username = await readPlatformUsernameForDisplay(db, context.platformUserId);
  const roleLabel =
    context.role === "admin" || context.role === "support"
      ? PLATFORM_ROLE_LABELS[context.role]
      : context.role;
  return {
    db,
    csrfToken: context.csrfToken,
    platformUserId: context.platformUserId,
    scopeKey: computeScopeKey(context),
    username: username ?? "—",
    roleLabel,
    isAdmin: context.role === "admin",
  };
}
