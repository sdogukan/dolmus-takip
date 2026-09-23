/**
 * Şoförlerim ekranının (`../app/_components/drivers-manager.tsx`) SAF
 * yardımcıları — T2.5. DB/ağ/React YOK: istek kurma, bayat taslak denetimi,
 * benzer ad ipucu ve hata metni seçimi burada yaşar ki birim testleriyle
 * doğrulanabilsin.
 *
 * Sunucu kuralı `../server/usecases/drivers/person-name.ts` ile AYNIDIR
 * (kırp + iç boşluğu tek boşluğa indir, 1..120); sunucu modülü `server/`
 * altında olduğundan istemciye taşınmaz, kural burada ayrıca ifade edilir —
 * asıl doğrulama her zaman sunucudadır.
 */
import { isDraftStale } from "./draft-version";
import { DRIVER_FIELD_MESSAGES, getErrorMessage } from "./messages";
import { formatPlateForDisplay } from "./plate";

export const DRIVER_NAME_MAX_LENGTH = 120;

/** `GET /api/v1/drivers` yönetim görünümü (`driver.manage` izni). */
export interface DriverRow {
  personId: string;
  fullName: string;
  personActive: boolean;
  personVersion: number;
  assignment: { active: boolean; version: number } | null;
}

export interface DriverCandidate {
  personId: string;
  fullName: string;
}

export interface DriversView {
  drivers: DriverRow[];
  candidates: DriverCandidate[];
}

export interface AffectedVehicleRow {
  vehicleId: string;
  plateNormalized: string;
  assignmentActive: boolean;
}

export function normalizeDriverName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Geçersizse alan mesajı, geçerliyse `undefined`. */
export function validateDriverName(raw: string): string | undefined {
  const normalized = normalizeDriverName(raw);
  return normalized.length >= 1 && normalized.length <= DRIVER_NAME_MAX_LENGTH
    ? undefined
    : DRIVER_FIELD_MESSAGES.fullName;
}

/**
 * Aktif liste: aracta AKTİF atama + AKTİF kişi. Diğer her satır (pasif atama
 * veya küresel pasif kişi) pasif listededir. Satırlar `personId` ile
 * tanımlanır — aynı adlı iki kişi iki ayrı satırdır.
 */
export function splitDrivers(drivers: DriverRow[]): { active: DriverRow[]; inactive: DriverRow[] } {
  const active: DriverRow[] = [];
  const inactive: DriverRow[] = [];
  for (const driver of drivers) {
    (driver.assignment?.active === true && driver.personActive ? active : inactive).push(driver);
  }
  return { active, inactive };
}

const TURKISH_FOLD: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  ö: "o",
  ş: "s",
  ü: "u",
};

function foldName(name: string): string[] {
  return normalizeDriverName(name)
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (char) => TURKISH_FOLD[char] ?? char)
    .split(" ")
    .filter(Boolean);
}

/**
 * Yazılan ada BENZER aday kişiler (Türkçe harf/büyük-küçük harf farkı yok
 * sayılır; her yazılan sözcük bir aday sözcüğünün başıyla eşleşmeli).
 * Yalnız İPUCUDUR — hiçbir kişi kendiliğinden birleştirilmez/bağlanmaz.
 */
export function findSimilarCandidates(
  typedName: string,
  candidates: DriverCandidate[],
): DriverCandidate[] {
  const typed = foldName(typedName);
  if (typed.join("").length < 2) return [];
  return candidates.filter((candidate) => {
    const tokens = foldName(candidate.fullName);
    return typed.every((word) =>
      tokens.some((token) => token.startsWith(word) || word.startsWith(token)),
    );
  });
}

/** Bir satır işlemi (aday bağlama / yeniden adlandırma / araç ataması /
 * küresel aktiflik) — taslakta `requestId` ile birlikte saklanır. */
export type DriverOpKind = "link" | "rename" | "assignment" | "person";

export interface DriverOpDraft {
  requestId: string;
  kind: DriverOpKind;
  personId: string;
  /** İşlemin DAYANDIĞI sürüm (`rename`/`person` → kişi, `assignment` →
   * atama); `link` için yok (atama satırı henüz yok). */
  baseVersion: number | null;
  fullName: string;
  active: boolean;
  /** Sonucu belirsiz — sunucuya ulaşıp ulaşmadığı bilinmiyor. */
  pending: boolean;
}

export interface AddDriverDraft {
  requestId: string;
  fullName: string;
  pending: boolean;
}

export interface DriversDraft {
  add: AddDriverDraft;
  op: DriverOpDraft | null;
}

export function driversDraftName(vehicleId: string): string {
  return `soforler-${vehicleId}`;
}

export function emptyAddDraft(newId: () => string): AddDriverDraft {
  return { requestId: newId(), fullName: "", pending: false };
}

export function emptyDriversDraft(newId: () => string): DriversDraft {
  return { add: emptyAddDraft(newId), op: null };
}

/**
 * Satır işleminin taslağı sunucudaki GÜNCEL duruma göre bayat mı — arada
 * başka bir sekme/ekip üyesi kaydı değiştirmişse (`isDraftStale` deseni).
 * `pending` taslak ASLA bayat sayılmaz: dondurulmuş gövde "Tekrar kontrol
 * et" için aynen gerekir.
 */
export function isOpStale(op: DriverOpDraft, view: DriversView): boolean {
  if (op.pending) return false;
  if (op.kind === "link") {
    return !view.candidates.some((candidate) => candidate.personId === op.personId);
  }
  const driver = view.drivers.find((row) => row.personId === op.personId);
  if (!driver) return true;
  const currentVersion =
    op.kind === "assignment" ? (driver.assignment?.version ?? null) : driver.personVersion;
  if (op.baseVersion === null || currentVersion === null) return op.baseVersion !== currentVersion;
  return isDraftStale({ baseVersion: op.baseVersion, currentVersion, pending: false });
}

export interface DriverRequest {
  method: "POST" | "PUT" | "PATCH";
  url: string;
  body: Record<string, unknown>;
}

/** Gövde YALNIZ `requestId` + içerik taşır; `personId` URL'dedir, `businessId`/
 * `vehicleId`/rol gövdeye ASLA konmaz (sunucu kapsamı oturumdan türetir). */
export function buildAddRequest(draft: AddDriverDraft): DriverRequest {
  return {
    method: "POST",
    url: "/api/v1/drivers",
    body: { requestId: draft.requestId, fullName: normalizeDriverName(draft.fullName) },
  };
}

export function buildOpRequest(op: DriverOpDraft, vehicleId: string): DriverRequest {
  const personId = encodeURIComponent(op.personId);
  switch (op.kind) {
    case "link":
      return {
        method: "PUT",
        url: `/api/v1/vehicles/${vehicleId}/drivers/${personId}`,
        body: { requestId: op.requestId, active: true },
      };
    case "assignment":
      return {
        method: "PUT",
        url: `/api/v1/vehicles/${vehicleId}/drivers/${personId}`,
        body: {
          requestId: op.requestId,
          active: op.active,
          ...(op.baseVersion !== null ? { version: op.baseVersion } : {}),
        },
      };
    case "rename":
      return {
        method: "PATCH",
        url: `/api/v1/drivers/${personId}`,
        body: {
          requestId: op.requestId,
          version: op.baseVersion,
          fullName: normalizeDriverName(op.fullName),
        },
      };
    case "person":
      return {
        method: "PATCH",
        url: `/api/v1/drivers/${personId}`,
        body: { requestId: op.requestId, version: op.baseVersion, active: op.active },
      };
  }
}

const CONNECTION_MESSAGE = "Bağlantı kurulamadı. Tekrar dene.";

/** Alan-dışı hata → ekran metni; sunucunun `error.message`'ı BASILMAZ. */
export function driverErrorMessage(status: number, code: string | undefined): string {
  if (status >= 500) return CONNECTION_MESSAGE;
  return (code ? getErrorMessage(code) : undefined) ?? CONNECTION_MESSAGE;
}

/** 5xx ve ağ hatasında sunucunun işlemi uygulayıp uygulamadığı bilinmez. */
export function isAmbiguousStatus(status: number): boolean {
  return status >= 500;
}

export function describeAffectedVehicle(vehicle: AffectedVehicleRow): string {
  const plate = formatPlateForDisplay(vehicle.plateNormalized);
  return vehicle.assignmentActive ? plate : `${plate} (pasif atama)`;
}
