"use client";

/**
 * `./client-state.ts` taslaklarını React durumuna bağlayan küçük yardımcı —
 * T2.1, S2.1 (`../app/yonetim/isletmeler/yeni/new-business-form.tsx` ve
 * `../app/yonetim/isletmeler/[id]/business-detail-form.tsx` KULLANIR).
 *
 * `useSyncExternalStore` kullanır — React'in KENDİ önerdiği "harici bir
 * sistemle (burada: localStorage) senkronizasyon" deseni (https://
 * react.dev/reference/react/useSyncExternalStore). Bir `useEffect` içinde
 * `setState` ÇAĞRILMAZ: bu repoda `eslint-config-next` `react-hooks/
 * set-state-in-effect` kuralı bunu HATA sayar ("cascading renders").
 * Sunucu (localStorage'a erişimi OLMAYAN) HTML'i ile istemcinin gerçek
 * taslağı arasındaki fark `getServerSnapshot` ile KABUL EDİLİR — React
 * hydration'ı bunu kendi mekanizmasıyla onarır, ayrı bir "mount sonrası
 * setState" adımı GEREKMEZ.
 *
 * Aynı sekmenin KENDİ `localStorage.setItem` çağrısı tarayıcının native
 * `storage` olayını TETİKLEMEZ (yalnız BAŞKA sekmeler/pencereler için
 * tetiklenir — MDN `Window: storage event`); bu yüzden `setValue` kendi
 * özel olayını da DISPATCH eder, `subscribe` HER İKİSİNİ dinler.
 */
import { useCallback, useRef, useSyncExternalStore } from "react";
import {
  clientStateKey,
  readClientState,
  saveClientState,
  type ClientStateScope,
  type StorageLike,
} from "./client-state";

const NOTIFY_EVENT = "dolmus_takip:client_state_written";

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(NOTIFY_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(NOTIFY_EVENT, onStoreChange);
  };
}

/**
 * Bir taslak güncellemesini DEPOLANMIŞ güncel değerin üzerine uygular:
 * `next` bir fonksiyonsa argümanı React state'indeki (bir önceki render'dan
 * kalma olabilecek) snapshot DEĞİL, localStorage'daki EN SON değerdir
 * (yoksa/bozuksa `fallback`). Böylece bir alt formun isteği sürerken başka
 * bir alt forma yazılan taslak, ilkinin bitişindeki yazımla EZİLMEZ.
 * Sonucu depoya yazar ve döndürür.
 */
export function applyStoredDraftUpdate<T>(
  storage: StorageLike,
  scope: ClientStateScope,
  name: string,
  fallback: T,
  next: T | ((prev: T) => T),
): T {
  let resolved: T;
  if (typeof next === "function") {
    let prev: T;
    try {
      prev = readClientState<T>(storage, scope, name) ?? fallback;
    } catch {
      prev = fallback;
    }
    resolved = (next as (prev: T) => T)(prev);
  } else {
    resolved = next;
  }
  saveClientState(storage, scope, name, resolved);
  return resolved;
}

/**
 * `scope`/`name` bu hook'u çağıran bileşenin ömrü boyunca SABİT kabul
 * edilir (işletme kimliği/oturum kapsamı sayfa yenilenmeden değişmez —
 * bkz. çağıranların üst notu). `createFallback` yalnız BİR KEZ (ilk
 * render'da) çağrılır ve sonucu sabit tutulur — her render'da YENİ bir
 * nesne üretmek `getServerSnapshot`in "değişmeyen değer" beklentisini
 * bozardı.
 *
 * Çağıranlar `scope` nesnesini her render'da yeniden kurar; bu yüzden
 * bağımlılık olarak yalnız ilkel `scopeKey` kullanılır ve kapsam callback'
 * lerin İÇİNDE bu değerden kurulur.
 */
export function useStoredDraft<T>(
  scope: ClientStateScope,
  name: string,
  createFallback: () => T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const { scopeKey } = scope;
  const fallbackRef = useRef<T | undefined>(undefined);
  if (fallbackRef.current === undefined) {
    fallbackRef.current = createFallback();
  }
  const cacheRef = useRef<{ raw: string | null; value: T } | null>(null);

  const getSnapshot = useCallback((): T => {
    const fallback = fallbackRef.current as T;
    const scoped: ClientStateScope = { scopeKey };
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(clientStateKey(scoped, name));
    } catch {
      raw = null;
    }
    if (!cacheRef.current || cacheRef.current.raw !== raw) {
      let value: T;
      try {
        value = readClientState<T>(window.localStorage, scoped, name) ?? fallback;
      } catch {
        value = fallback;
      }
      cacheRef.current = { raw, value };
    }
    return cacheRef.current.value;
  }, [scopeKey, name]);

  const getServerSnapshot = useCallback((): T => fallbackRef.current as T, []);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      try {
        applyStoredDraftUpdate(
          window.localStorage,
          { scopeKey },
          name,
          fallbackRef.current as T,
          next,
        );
      } finally {
        window.dispatchEvent(new Event(NOTIFY_EVENT));
      }
    },
    [scopeKey, name],
  );

  return [value, setValue];
}
