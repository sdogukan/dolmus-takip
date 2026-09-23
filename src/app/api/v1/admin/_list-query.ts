/**
 * `/admin/*` liste uçlarının ortak sorgu-parametresi ayrıştırması (`q`,
 * `active`, `cursor`, `limit`). Bir `route.ts` DEĞİLDİR (`_http.ts` ile
 * aynı `_` önek deseni).
 */
import { z } from "zod";
import { decodeCursor } from "../../../../server/usecases/list-cursor";

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;

/** `?limit=` — yalnız tam sayı dizesi kabul edilir (`"5abc"`, `"1e1"` reddedilir). */
export const limitParamSchema = z
  .string()
  .regex(/^[0-9]{1,4}$/u)
  .transform(Number)
  .pipe(z.number().int().min(1).max(MAX_LIST_LIMIT));

export function cursorParamSchema(arity: number) {
  return z
    .string()
    .min(1)
    .max(400)
    .refine((value) => decodeCursor(value, arity) !== null);
}

export function listQuerySchema(cursorArity: number) {
  return z.object({
    q: z.string().trim().max(100).optional(),
    active: z.enum(["all", "active", "inactive"]).optional(),
    cursor: cursorParamSchema(cursorArity).optional(),
    limit: limitParamSchema.optional(),
  });
}

/** URL'deki bilinen anahtarları düz nesneye çevirir; olmayan anahtar
 * `undefined` kalır, boş dize olduğu gibi doğrulamaya girer. */
export function pickSearchParams<K extends string>(
  request: Request,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const params = new URL(request.url).searchParams;
  const picked: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null) picked[key] = value;
  }
  return picked;
}

export const LIST_QUERY_FIELD_MESSAGES: Record<string, string> = {
  q: "Arama metni en fazla 100 karakter olabilir.",
  active: "Aktiflik filtresi all, active veya inactive olmalıdır.",
  cursor: "Sayfalama imleci geçersiz.",
  limit: `Sayfa boyutu 1 ile ${MAX_LIST_LIMIT} arasında bir tam sayı olmalıdır.`,
};
