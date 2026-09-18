/**
 * resolveReceipt(db, context, scope, params, clock?) — T1.5 ADIM 2/2, S1.5.
 *
 * Görev tanımının kendisi `findReceipt`/`recordReceipt`İ AYRI AYRI adlarla
 * ister (bkz. o iki dosyanın üst notu); ama ARCHITECTURE §3.4'ün "aynı
 * kapsam/anahtar/işlem/içerik eski sonuç kimliğini döndürür; içerik
 * farklıysa 409 verir" cümlesindeki HASH KARŞILAŞTIRMASI mantığının
 * (bulunduysa: hash eşleşiyor mu → replay; eşleşmiyor mu → 409) HER
 * mutasyon kullanım durumunda (T3.4, T3.5, T4.1–T4.3, ...) TEKRAR TEKRAR
 * elle yazılması — `findReceipt`'in `undefined`/satır ayrımını unutma veya
 * hash karşılaştırmasını unutma riski taşır (mimari merceği: DRY). Bu
 * yüzden bu YARDIMCI (görev tanımının İSTEMEDİĞİ ama YASAKLAMADIĞI, salt
 * `findReceipt`'İ SARAN bir KOMPOZİSYON — hiçbir yeni DB erişimi/kural
 * EKLEMEZ) sağlanır; `findReceipt`/`recordReceipt`'in KENDİSİ hâlâ
 * BAĞIMSIZ, görev tanımının verdiği İMZAYLA AYNEN vardır ve doğrudan
 * kullanılabilir.
 *
 * Dönüş: `{ replay: false }` — bu `(scope, requestId)` için kayıt YOK,
 * çağıran YENİ mutasyona devam edip `recordReceipt` ile sonucu yazmalıdır.
 * `{ replay: true; receipt }` — AYNI hash'le DAHA ÖNCE tamamlanmış işlemin
 * sonucu; çağıran YENİDEN mutasyon YAPMADAN `receipt.entityId/
 * resultVersion/responseCode`'u döner.
 *
 * FIRLATABİLİR: `findReceipt`'in fırlattığı HER ŞEY (401/403/409 sınıfı,
 * bkz. o dosyanın üst notu) BURADAN da AYNEN geçer; AYRICA hash
 * uyuşmazlığında da `RequestIdReusedError` (409) fırlatılır.
 */
import { systemClock, type Clock } from "../../auth/session";
import type { ReceiptScope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import type { RecheckScopeOptions } from "../../data/scoped";
import type { SessionContext } from "../session/types";
import { RequestIdReusedError } from "./errors";
import { findReceipt, type MutationReceiptRecord } from "./find-receipt";

export interface ResolveReceiptParams {
  requestId: string;
  operation: string;
  requestHash: string;
}

export type ResolveReceiptResult =
  | { replay: false }
  | { replay: true; receipt: MutationReceiptRecord };

export function resolveReceipt(
  db: AppDatabase,
  context: SessionContext,
  scope: ReceiptScope,
  params: ResolveReceiptParams,
  clock: Clock = systemClock,
  recheckOptions: RecheckScopeOptions = {},
): ResolveReceiptResult {
  const existing = findReceipt(
    db,
    context,
    scope,
    params.requestId,
    params.operation,
    clock,
    recheckOptions,
  );

  if (!existing) {
    return { replay: false };
  }

  if (existing.requestHash !== params.requestHash) {
    throw new RequestIdReusedError();
  }

  return { replay: true, receipt: existing };
}
