/**
 * "Kim çalıştı, hangi türde?" gövde alanları (T3.3). `personId` adı
 * `scopeSafeObject` ile yasak olduğundan kişi alanı `workerPersonId`dir.
 * Kayıt türü (`workKind`), pay ve yetki bu şemadan DEĞİL, oturum + kişi
 * çözümlemesinden (`prepare-create.ts`) gelir; gövdedeki fazladan anahtarlar
 * zod `.strip()` ile atılır.
 */
import { z } from "zod";
import { WORK_ENTRY_MESSAGES as TEXT } from "../../../lib/messages";
import { scopeSafeObject } from "../../auth/scope";

/** Kişi kimliği için kaba üst sınır (kimlikler UUID'dir). */
export const WORKER_PERSON_ID_MAX_LENGTH = 64;

export const WORK_TYPES = ["owner", "driver"] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const workEntrySubjectSchema = scopeSafeObject({
  workType: z.enum(WORK_TYPES, { error: TEXT.workTypeInvalid }),
  /** `workType: "driver"` için zorunludur; `owner` türünde yok sayılır
   * (sahip kişi araçtan çözülür, istemciden okunmaz). */
  workerPersonId: z
    .string({ error: TEXT.personRequired })
    .max(WORKER_PERSON_ID_MAX_LENGTH, TEXT.personUnavailable)
    .optional(),
});

export type WorkEntrySubject = z.output<typeof workEntrySubjectSchema>;
