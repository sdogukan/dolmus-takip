/**
 * Günlük kayıt düzenleme/okuma hataları — T3.5. `../drivers/errors.ts` ile AYNI
 * desen (status/code taşıyan sınıf; route `_http.ts` zarfa çevirir).
 */
import { COMMON_SCREEN_MESSAGES, ERROR_CODE_MESSAGES } from "../../../lib/messages";

/** Kayıt yok / kapsam dışı (başka araç, başka işletme) / şoför için görünmez.
 * Hepsi AYNI 404 — başka kapsamdaki kimliğin varlığı doğrulanmaz. */
export class WorkEntryNotFoundError extends Error {
  readonly status = 404 as const;
  readonly code = "WORK_ENTRY_NOT_FOUND" as const;

  constructor(message = ERROR_CODE_MESSAGES.WORK_ENTRY_NOT_FOUND ?? "Kayıt bulunamadı.") {
    super(message);
    this.name = "WorkEntryNotFoundError";
  }
}

export class WorkEntryVersionConflictError extends Error {
  readonly status = 409 as const;
  readonly code = "VERSION_CONFLICT" as const;

  constructor(message = COMMON_SCREEN_MESSAGES.concurrentEditConflict) {
    super(message);
    this.name = "WorkEntryVersionConflictError";
  }
}

/** Onaylanmış kayıt normal düzenlemeyle değişmez (düzelt-ve-onayla ayrı akıştır). */
export class WorkEntryConfirmedError extends Error {
  readonly status = 409 as const;
  readonly code = "ENTRY_CONFIRMED" as const;

  constructor(message = ERROR_CODE_MESSAGES.ENTRY_CONFIRMED ?? "Kayıt onaylanmış.") {
    super(message);
    this.name = "WorkEntryConfirmedError";
  }
}
