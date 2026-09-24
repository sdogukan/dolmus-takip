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

/** Sahip kaydı (`not_required`) teslim onayı almaz. */
export class WorkEntryConfirmationNotRequiredError extends Error {
  readonly status = 422 as const;
  readonly code = "CONFIRMATION_NOT_REQUIRED" as const;

  constructor(message = ERROR_CODE_MESSAGES.CONFIRMATION_NOT_REQUIRED ?? "Bu kayıt için teslim onayı gerekmiyor.") {
    super(message);
    this.name = "WorkEntryConfirmationNotRequiredError";
  }
}

/** Düzelt-ve-onayla yalnız ONAYLI kayıt içindir; bekleyen kayıt `confirm` ile onaylanır. */
export class WorkEntryNotConfirmedError extends Error {
  readonly status = 409 as const;
  readonly code = "ENTRY_NOT_CONFIRMED" as const;

  constructor(message = ERROR_CODE_MESSAGES.ENTRY_NOT_CONFIRMED ?? "Bu kayıt henüz onaylanmamış.") {
    super(message);
    this.name = "WorkEntryNotConfirmedError";
  }
}
