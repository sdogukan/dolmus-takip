import { redirect } from "next/navigation";
import { readPageSession } from "../server/auth/page-session";

/**
 * '/' — ana adres. T1.2 ADIM 2/2, S1.2, görev tanımı (2): "Ana sayfa '/':
 * oturum yoksa /giris, varsa rolüne göre yönlendirme (DESIGN §1); mevcut
 * ana sayfa içeriği kaldırılır."
 *
 * DESIGN.md §1 — "Ana adres, oturum yoksa araç girişine; geçerli oturum
 * varsa ilgili ana ekrana yönlenir." Ekip (platform) oturumunun "ilgili
 * ana ekranı" (/yonetim) T1.3'te açılacak; o güne kadar platform
 * oturumları da (mevcut olsalar bile) /giris'e yönlendirilir — bu, bu
 * paketin open_issues'ında not edilmiştir.
 */
export default async function RootPage() {
  const session = await readPageSession();
  if (!session.ok) {
    redirect("/giris");
  }
  const { context } = session;

  if (context.kind === "vehicle" && context.role === "owner") {
    redirect("/sahip");
  }
  if (context.kind === "vehicle" && context.role === "driver") {
    redirect("/sofor");
  }
  // Ekip (platform) oturumu — bkz. dosya üstü not.
  redirect("/giris");
}
