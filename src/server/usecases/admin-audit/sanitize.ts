/**
 * `admin_audit.before_json/after_json` okuma katmanı temizleyicisi.
 *
 * Bugünkü yazıcılar gizli değer saklamaz; yine de okuma yolu, gelecekte
 * eklenecek yazıcılara karşı derinlemesine savunma olarak parola/özet/
 * token/cookie/secret/csrf anahtarlarını (büyük-küçük harf duyarsız, iç içe
 * dahil) yanıttan çıkarır.
 */
const SECRET_KEY_PATTERN = /password|hash|token|cookie|secret|csrf/iu;

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value !== null && typeof value === "object") {
    const clean: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!SECRET_KEY_PATTERN.test(key)) clean[key] = stripSecrets(inner);
    }
    return clean;
  }
  return value;
}

/** Saklanan JSON metnini ayrıştırıp gizli anahtarları çıkarır. `null`
 * girdi `null` döner (oluşturma satırlarında `before`). Bozuk veya nesne
 * olmayan JSON `{}` döner — ham metin asla yanıta sızmaz. */
export function sanitizeAuditPayload(json: string | null): Record<string, unknown> | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return stripSecrets(parsed) as Record<string, unknown>;
}
