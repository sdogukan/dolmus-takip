/**
 * recordReceipt(db, scope, params, clock?) — T1.5 ADIM 2/2, S1.5.
 *
 * Görev tanımı — "recordReceipt(...) transaction içinde". ARCHITECTURE.md
 * §3.4 adım 5 — "Güncel kayıt, revizyon, gerekiyorsa onay, destek izi ve
 * makbuz BİRLİKTE yazılır." Bu fonksiyon yalnız MAKBUZ satırını yazar;
 * kayıt/revizyon/onay yazımı (T3.4+) ÇAĞIRANIN işidir — hepsi AYNI
 * `withImmediateTransaction` bloğunda, bu çağrıyla birlikte, tek commit
 * olarak yürütülmelidir (bkz. `./find-receipt.ts` üst notu — bu ikisi
 * "transaction içinde" ifadesini PAYLAŞIR).
 *
 * `db.insert(...).values(...).run()` — SENKRON Drizzle üye metodu (`../../
 * data/scoped.ts`/`../access/*`'in de kullandığı desen; bkz. `../../data/
 * db.ts` `AppDatabase` üst notu — better-sqlite3'ün native transaction
 * sarmalayıcısı yalnız SENKRON fonksiyon kabul eder, `execute()`'un
 * döndürdüğü Promise'i DEĞİL).
 *
 * ÇAĞIRAN SORUMLULUĞU (test edilmiş varsayım, bkz. `record-receipt.test.ts`
 * "aynı (scope_key, request_id) ikinci kez recordReceipt çağrılırsa..."):
 * bu fonksiyon KENDİSİ `findReceipt` ÇAĞIRMAZ / bir "zaten var mı" ön
 * kontrolü YAPMAZ — çağıran AYNI transaction içinde ÖNCE `findReceipt`'in
 * `undefined` döndüğünü doğrulamış olmalıdır (§3.4 akışının kendisi bu
 * sırayı zaten dayatır: "aynı kapsam/anahtar/işlem/içerik eski sonuç
 * kimliğini döndürür" — yani ÖNCE aranır, YOKSA yazılır). Bu sıra
 * atlanıp aynı `(scope_key, request_id)` için ikinci kez çağrılırsa,
 * `mutation_receipts`'in KENDİ `(scope_key, request_id)` PRIMARY KEY
 * kısıtı (§3.2) INSERT'i SQLite düzeyinde reddeder (ham `SqliteError`,
 * `SQLITE_CONSTRAINT_PRIMARYKEY`) — bu, YANLIŞ KULLANIMI SESSİZCE
 * YUTMAZ, açık bir programlama hatası sinyali olarak KALIR.
 */
import { systemClock, type Clock } from "../../auth/session";
import type { ReceiptScope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { mutationReceipts } from "../../data/schema";
import { computeReceiptScopeKey } from "./scope-key";

export interface RecordReceiptParams {
  requestId: string;
  operation: string;
  requestHash: string;
  /** Mutasyonun ürettiği kayıt kimliği — oluşturma BAŞARISIZ olduysa
   * (ör. doğrulama hatası kalıcı bir varlık ÜRETMEDİYSE) `null`. */
  entityId: string | null;
  /** Aynı gerekçeyle `entityId` ile BİRLİKTE `null` olabilir. */
  resultVersion: number | null;
  responseCode: number;
}

export function recordReceipt(
  db: AppDatabase,
  scope: ReceiptScope,
  params: RecordReceiptParams,
  clock: Clock = systemClock,
): void {
  db
    .insert(mutationReceipts)
    .values({
      scopeKey: computeReceiptScopeKey(scope),
      requestId: params.requestId,
      operation: params.operation,
      requestHash: params.requestHash,
      entityId: params.entityId,
      resultVersion: params.resultVersion,
      responseCode: params.responseCode,
      createdAt: clock().toISOString(),
    })
    .run();
}
