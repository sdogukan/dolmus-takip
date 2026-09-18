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
 * `scope`/`name` bu hook'u çağıran bileşenin ömrü boyunca SABİT kabul
 * edilir (işletme kimliği/oturum kapsamı sayfa yenilenmeden değişmez —
 * bkz. çağıranların üst notu). `createFallback` yalnız BİR KEZ (ilk
 * render'da) çağrılır ve sonucu sabit tutulur — her render'da YENİ bir
 * nesne üretmek `getServerSnapshot`in "değişmeyen değer" beklentisini
 * bozardı.
 */
export function useStoredDraft<T>(
  scope: ClientStateScope,
  name: string,
  createFallback: () => T,
): [T, (next: T) => void] {
  const fallbackRef = useRef<T | undefined>(undefined);
  if (fallbackRef.current === undefined) {
    fallbackRef.current = createFallback();
  }
  const cacheRef = useRef<{ raw: string | null; value: T } | null>(null);

  const getSnapshot = useCallback((): T => {
    const fallback = fallbackRef.current as T;
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(clientStateKey(scope, name));
    } catch {
      raw = null;
    }
    if (!cacheRef.current || cacheRef.current.raw !== raw) {
      let value: T;
      try {
        value = readClientState<T>(window.localStorage, scope, name) ?? fallback;
      } catch {
        value = fallback;
      }
      cacheRef.current = { raw, value };
    }
    return cacheRef.current.value;
    // `scope`/`name` çağıran boyunca sabit (bkz. dosya üstü notu);
    // `fallbackRef`/`cacheRef` birer ref'tir, değişimleri render TETİKLEMEZ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.scopeKey, name]);

  const getServerSnapshot = useCallback((): T => fallbackRef.current as T, []);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: T) => {
      try {
        saveClientState(window.localStorage, scope, name, next);
      } finally {
        window.dispatchEvent(new Event(NOTIFY_EVENT));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope.scopeKey, name],
  );

  return [value, setValue];
}
