/**
 * findReceipt(db, context, scope, requestId, operation, clock?) — T1.5
 * ADIM 2/2, S1.5.
 *
 * Görev tanımı (birebir): "findReceipt(scope, requestId, operation) ve
 * recordReceipt(...) transaction içinde; aynı request_id + aynı
 * request_hash → eski sonuç (entity_id, result_version, response_code);
 * farklı hash → 409 REQUEST_ID_REUSED; başka kapsamdan aynı request_id →
 * bulunamaz; erişimi iptal edilen aktör eski makbuz üzerinden veri
 * okuyamaz (yetki kontrolü makbuz okumada da yapılır)."
 *
 * Bu dosya YALNIZ "bulundu mu, hangi işlem için" sorusunu cevaplar —
 * `request_hash` karşılaştırması (aynı hash → replay, farklı hash → 409)
 * bu fonksiyonun PARAMETRESİ DEĞİLDİR (görev tanımının verdiği imza
 * `findReceipt(scope, requestId, operation)` üç parametrelidir, hash
 * YOKTUR); o karşılaştırma `./resolve-receipt.ts`'nin işidir — iki ayrı
 * sorumluluk (ARAMA vs. KARAR) bilerek AYRILMIŞTIR (bkz. o dosyanın üst
 * notu).
 *
 * — "başka kapsamdan aynı request_id → bulunamaz": `mutation_receipts`
 *   birincil anahtarı `(scope_key, request_id)`'dir (§3.2); sorgu HER
 *   ZAMAN `scope_key`'i de eşitlik koşuluna katar — başka bir Scope'un
 *   (farklı aktör/işletme/araç) ÜRETTİĞİ `scope_key` bu satırla HİÇ
 *   ESLEŞMEZ, `undefined` döner. `ScopeMissingVehicleIdError`/başka bir
 *   yetki hatasına GEREK YOKTUR: bu, "yetkisiz erişim" değil, basitçe "bu
 *   kapsamda öyle bir makbuz YOK" durumudur (404 değil — bu fonksiyon
 *   hiçbir HTTP durumu ÜRETMEZ, yalnız `undefined` döner; "ilk kez
 *   gönderiliyor" ile "başka kapsamdan reuse" AYNI sonuçtur — ikisi de
 *   çağıranın YENİ bir mutasyona devam etmesi gerektiği anlamına gelir).
 *
 * — "aynı request_id, FARKLI operation" (aynı scope_key+request_id
 *   birincil anahtarına sahip bir satır VAR ama `operation` alanı
 *   İSTENEN'den FARKLIYSA): görev tanımı bu durumu AYRI bir dalla
 *   yazmaz; ama ARCHITECTURE §3.4'ün "aynı kapsam/anahtar/İŞLEM/içerik
 *   eski sonucu döndürür; İÇERİK farklıysa 409 verir" cümlesi `operation`ı
 *   da eşleşmesi gereken bir bileşen sayar — bu yüzden bir `request_id`'nin
 *   BAŞKA bir işlem türü için TEKRAR kullanılması da AYNI 409
 *   `REQUEST_ID_REUSED` sınıfına girer (hash karşılaştırmasıyla AYNI
 *   MANTIK: "bu anahtar zaten farklı bir içerik/işlem için harcanmış").
 *   Bu, dokümanın BİREBİR yazmadığı ama §3.4'ün kendi terimine dayanan bir
 *   mühendislik yorumudur; docs/DECISIONS.md'de AYRICA kayıtlı DEĞİLDİR —
 *   bu paketin open_issues'ında işaretlenmiştir.
 *
 * — "erişimi iptal edilen aktör eski makbuz üzerinden veri okuyamaz":
 *   `../../data/scoped.ts` `recheckScopeInTransaction` AYNI denetimi (oturum
 *   geçerliliği + hedef aktiflik) burada da, satırı DÖNMEDEN ÖNCE, ÇALIŞTIRIR.
 *   Bu fonksiyon `withImmediateTransaction` İÇİNDE çağrılmalıdır (görev
 *   tanımı — "transaction içinde"); `recheckScopeInTransaction`'ın kendisi
 *   de senkron (better-sqlite3 native transaction kısıtı, bkz. o dosyanın
 *   üst notu) olduğundan bu fonksiyon da SENKRONDUR.
 */
import { and, eq } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/session";
import type { ReceiptScope } from "../../auth/scope";
import type { AppDatabase } from "../../data/db";
import { recheckScopeInTransaction, type RecheckScopeOptions } from "../../data/scoped";
import { mutationReceipts } from "../../data/schema";
import type { SessionContext } from "../session/types";
import { RequestIdReusedError } from "./errors";
import { computeReceiptScopeKey } from "./scope-key";

export interface MutationReceiptRecord {
  scopeKey: string;
  requestId: string;
  operation: string;
  requestHash: string;
  entityId: string | null;
  resultVersion: number | null;
  responseCode: number;
  createdAt: string;
}

/**
 * `undefined` — bu kapsamda bu `request_id` hiç kaydedilmemiş (çağıran YENİ
 * bir mutasyona devam eder). Aksi halde satır AYNI `operation` içindir
 * (aksi halde `RequestIdReusedError` FIRLATILIR — bkz. dosya üstü not).
 *
 * FIRLATABİLİR: `SessionExpiredError`/`SessionRevokedError` (401 sınıfı) —
 * `recheckScopeInTransaction`'dan; `ScopeTargetInactiveError` (403) —
 * yine ondan; `RequestIdReusedError` (409) — operation uyuşmazlığı.
 *
 * `recheckOptions` (T2.1 eklentisi) — `../../data/scoped.ts`
 * `RecheckScopeOptions`'ın AYNEN geçirilmesi: bir admin mutasyonu (ör.
 * işletme/araç REAKTİVASYONU) `skipBusinessActiveCheck`/
 * `skipVehicleActiveCheck` GEREKTİRİYORSA, bu istisna makbuz aramasında da
 * (idempotency kontrolünün KENDİSİ de aynı transaction'ın parçasıdır)
 * uygulanmalıdır — aksi halde reaktivasyon isteğinin İLK (replay
 * OLMAYAN) denemesi, henüz hiçbir makbuz aranmadan, bu fonksiyonun
 * VARSAYILAN sıkı denetiminde 403'e düşerdi. Varsayılan `{}` var olan HER
 * çağıranın (business/vehicle zaten aktifken yazan T1.x kullanım
 * durumları) davranışını DEĞİŞTİRMEZ.
 */
export function findReceipt(
  db: AppDatabase,
  context: SessionContext,
  scope: ReceiptScope,
  requestId: string,
  operation: string,
  clock: Clock = systemClock,
  recheckOptions: RecheckScopeOptions = {},
): MutationReceiptRecord | undefined {
  // "yetki kontrolü ... makbuz okumada da yapılır" — satırı DÖNMEDEN ÖNCE.
  recheckScopeInTransaction(db, context, scope, clock, recheckOptions);

  const scopeKey = computeReceiptScopeKey(scope);
  const row = db
    .select()
    .from(mutationReceipts)
    .where(
      and(
        eq(mutationReceipts.scopeKey, scopeKey),
        eq(mutationReceipts.requestId, requestId),
      ),
    )
    .get();

  if (!row) {
    return undefined;
  }

  if (row.operation !== operation) {
    throw new RequestIdReusedError(
      "Bu istek kimliği farklı bir işlem türü için zaten kullanılmış.",
    );
  }

  return row;
}
