/**
 * İşlem geçmişi ekranının (`../app/yonetim/islem-gecmisi/audit-history.tsx`)
 * SAF yardımcıları — DB/ağ/React YOK: işlem/alan etiketleri, aktör metni ve
 * önce/sonra satırları burada yaşar ki birim testleriyle doğrulanabilsin.
 * Tipler `GET /api/v1/admin/audit` yanıtının (`../server/usecases/admin-audit/
 * queries.ts` `AuditEntry`) istemci aynasıdır; sunucu modülü istemciye
 * taşınmadığından burada ayrıca ifade edilir.
 */
import { PLATFORM_ROLE_LABELS } from "./messages";
import { formatPlateForDisplay } from "./plate";

export type AuditActor =
  | { kind: "platform_user"; username: string; role: "support" | "admin" }
  | { kind: "vehicle_credential"; access: "owner" | "driver"; plateNormalized: string | null };

export interface AuditEntry {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string;
  business: { id: string; name: string } | null;
  vehicle: { id: string; plateNormalized: string } | null;
  actor: AuditActor;
  onBehalfOf: { kind: "owner" | "driver"; fullName: string } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const ACTION_LABELS: Record<string, string> = {
  "business.create": "İşletme oluşturuldu",
  "business.update": "İşletme bilgisi değişti",
  "business.owner_assign": "İşletmeye sahip atandı",
  "vehicle.create": "Araç oluşturuldu",
  "vehicle.update": "Araç bilgisi değişti",
  "vehicle.reset_password": "Araç şifresi sıfırlandı",
  "person.create": "Şoför eklendi",
  "person.rename": "Kişi adı değişti",
  "person.reactivate": "Kişi yeniden aktifleştirildi",
  "person.deactivate": "Kişi pasifleştirildi",
  "person.set_global_active": "Kişi aktifliği değişti",
  "person.update": "Kişi bilgisi değişti",
  "vehicle_driver.create": "Şoför araca atandı",
  "vehicle_driver.activate": "Şoför ataması aktifleştirildi",
  "vehicle_driver.deactivate": "Şoför ataması pasifleştirildi",
  "vehicle_driver.set": "Şoför ataması değişti",
  "platform_user.bootstrap": "İlk yönetici hesabı oluşturuldu",
  "platform_user.reset_password": "Ekip hesabı şifresi sıfırlandı",
};

/** Bilinmeyen işlem kodu gizlenmez: ham kod gösterilir (uydurma etiket yok). */
export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/**
 * Yalnız GERÇEK oluşturma işlemleri "önceki değer yok" metnini alır.
 * `platform_user.reset_password` da `before = null` taşır ama oluşturma
 * DEĞİLDİR — yeni kayıt iddiası yapılmaz.
 */
export function isCreationAction(action: string): boolean {
  return action.endsWith(".create") || action === "platform_user.bootstrap";
}

const ACCESS_LABELS = { owner: "Sahip", driver: "Şoför" } as const;

/**
 * Aktör metni. Ekip aktörü GERÇEK kullanıcı adıyla; araç credential'ı
 * "erişim rolü + plaka" ile (ortak şifre bir KİŞİYİ doğrulamaz, kişi adı
 * ASLA türetilmez).
 */
export function formatAuditActor(actor: AuditActor): string {
  if (actor.kind === "platform_user") {
    const roleLabel = PLATFORM_ROLE_LABELS[actor.role];
    return `${actor.username || "—"} (${roleLabel})`;
  }
  const access = `${ACCESS_LABELS[actor.access]} oturumu`;
  return actor.plateNormalized ? `${access} · ${formatPlateForDisplay(actor.plateNormalized)}` : access;
}

const FIELD_LABELS: Record<string, string> = {
  name: "Ad",
  fullName: "Ad soyad",
  ownerFullName: "Sahip",
  plateNormalized: "Plaka",
  brandModel: "Marka / model",
  year: "Yıl",
  routeStop: "Hat / durak",
  note: "Not",
  active: "Durum",
  access: "Erişim",
};

/** Teknik anahtarlar (sürüm sayaçları, kimlikler) ekranda gösterilmez;
 * parola/özet/token benzeri anahtarlar API dönse bile ASLA gösterilmez. */
const HIDDEN_KEY_PATTERN = /version$|password|hash|token|cookie|secret|csrf/iu;
const IDENTIFIER_KEY_PATTERN = /^id$|[a-z]Id$/u;

function isHiddenKey(key: string): boolean {
  return HIDDEN_KEY_PATTERN.test(key) || IDENTIFIER_KEY_PATTERN.test(key);
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (key === "active" && typeof value === "boolean") return value ? "Aktif" : "Pasif";
  if (key === "access") {
    if (value === "owner") return "Mal sahibi şifresi";
    if (value === "driver") return "Şoför şifresi";
  }
  if (key === "plateNormalized" && typeof value === "string") return formatPlateForDisplay(value);
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

export interface BeforeAfterRow {
  key: string;
  label: string;
  /** `null` → önceki değer yok (oluşturma satırı). */
  before: string | null;
  after: string;
}

export interface BeforeAfterView {
  rows: BeforeAfterRow[];
  /** Oluşturma işleminde `true`: ekran "önceki değer yok" metnini gösterir. */
  noPreviousValue: boolean;
}

/**
 * Önce/sonra satırları. Güncellemede yalnız DEĞİŞEN alanlar listelenir;
 * hiçbiri değişmediyse (ör. şifre sıfırlama) sonraki değerin görünür
 * alanları bilgi için listelenir. Oluşturmada önceki değer `null` kalır.
 */
export function buildBeforeAfterRows(
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): BeforeAfterView {
  const creation = isCreationAction(action);
  const afterValues = after ?? {};
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(afterValues)])].filter(
    (key) => !isHiddenKey(key),
  );

  const all = keys.map((key): BeforeAfterRow & { changed: boolean } => {
    const beforeText = before === null ? null : formatValue(key, before[key]);
    const afterText = formatValue(key, afterValues[key]);
    return {
      key,
      label: FIELD_LABELS[key] ?? key,
      before: beforeText,
      after: afterText,
      changed: beforeText !== afterText,
    };
  });

  const changed = all.filter((row) => row.changed);
  const chosen = before === null || changed.length === 0 ? all : changed;
  return {
    rows: chosen.map(({ key, label, before: b, after: a }) => ({ key, label, before: b, after: a })),
    noPreviousValue: creation && before === null,
  };
}

const TIME_ZONE = "Europe/Istanbul";

/** "21 Eyl 2026 14:05" — Türkiye saatiyle; geçersiz tarih ham metin döner. */
export function formatAuditTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("tr-TR", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")} ${get("hour")}:${get("minute")}`;
}

/** `GET /api/v1/admin/audit` istek adresi; boş filtre anahtarları eklenmez. */
export function buildAuditUrl(params: {
  businessId?: string;
  vehicleId?: string;
  cursor?: string | null;
  limit: number;
}): string {
  const search = new URLSearchParams();
  if (params.businessId) search.set("businessId", params.businessId);
  if (params.vehicleId) search.set("vehicleId", params.vehicleId);
  if (params.cursor) search.set("cursor", params.cursor);
  search.set("limit", String(params.limit));
  return `/api/v1/admin/audit?${search.toString()}`;
}
