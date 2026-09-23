/**
 * `/yonetim` aramasının (`../app/yonetim/admin-search.tsx`) SAF yardımcıları —
 * DB/ağ/React YOK. Liste adresi ve sayfa adresi (URL'deki `q`/`active`)
 * burada kurulur ki birim testleriyle doğrulanabilsin.
 */
import { getErrorMessage } from "./messages";

export type ActiveFilter = "all" | "active" | "inactive";

export const ADMIN_LIST_PAGE_SIZE = 20;

/** URL'den gelen serbest metni süzer; bilinmeyen değer `all` olur. */
export function parseActiveFilter(raw: string | undefined): ActiveFilter {
  return raw === "active" || raw === "inactive" ? raw : "all";
}

/**
 * Arama metni boşsa işletme listesi, doluysa araç araması (plaka biçimi,
 * işletme veya sahip adı). Boş `q`/`all` anahtarları adrese eklenmez.
 */
export function buildAdminListUrl(params: {
  q: string;
  active: ActiveFilter;
  cursor?: string | null;
}): string {
  const resource = params.q === "" ? "businesses" : "vehicles";
  const search = new URLSearchParams();
  if (params.q !== "") search.set("q", params.q);
  if (params.active !== "all") search.set("active", params.active);
  if (params.cursor) search.set("cursor", params.cursor);
  search.set("limit", String(ADMIN_LIST_PAGE_SIZE));
  return `/api/v1/admin/${resource}?${search.toString()}`;
}

/** Tarayıcı adres çubuğundaki `/yonetim` adresi (`q`/`active` yansıtılır). */
export function buildSearchPageHref(q: string, active: ActiveFilter): string {
  const search = new URLSearchParams();
  if (q !== "") search.set("q", q);
  if (active !== "all") search.set("active", active);
  const query = search.toString();
  return query === "" ? "/yonetim" : `/yonetim?${query}`;
}

/**
 * Liste okuma hatasının ekran metni: 401 oturum bitti, 403 yetkisiz, kalan
 * her şey (5xx/ağ/bilinmeyen) genel bağlantı metni. Sunucunun kendi
 * `error.message`'ı basılmaz.
 */
export function adminReadErrorMessage(status: number | null, code?: string): string {
  if (status === 401) return getErrorMessage("SESSION_EXPIRED") ?? CONNECTION_ERROR_MESSAGE;
  if (status === 403) return getErrorMessage("FORBIDDEN") ?? CONNECTION_ERROR_MESSAGE;
  if (status !== null && status < 500 && code) return getErrorMessage(code) ?? CONNECTION_ERROR_MESSAGE;
  return CONNECTION_ERROR_MESSAGE;
}

const CONNECTION_ERROR_MESSAGE = "Bağlantı kurulamadı. Tekrar dene.";
