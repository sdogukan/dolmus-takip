"use client";

/**
 * Kaydedilmemiş değişiklik kaydı (dirty-form registry) — menü veya destek hedefi
 * değiştirilirken sayfadaki HERHANGİ bir formun
 * bırakılacak değeri olup olmadığını sormak için. Formlar `useUnsavedChanges`
 * ile kendi kirli durumunu bildirir; başlık `useUnsavedChangesRegistry().
 * hasDirty()` ile OKUR. Durum bir `ref`te tutulur (render tetiklemez): yalnız
 * bir tıklamada okunur, ekranda gösterilmez.
 *
 * Yönetim, sahip ve şoför sayfa kabukları sağlayıcıyı taşır.
 * Sağlayıcı dışında kayıt işlemleri sessizce boştur.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface UnsavedChangesRegistry {
  setDirty: (id: string, dirty: boolean) => void;
  hasDirty: () => boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesRegistry | null>(null);

function createRegistry(): UnsavedChangesRegistry {
  const dirtyIds = new Set<string>();
  return {
    setDirty: (id, dirty) => {
      if (dirty) dirtyIds.add(id);
      else dirtyIds.delete(id);
    },
    hasDirty: () => dirtyIds.size > 0,
  };
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createRegistry);
  return <UnsavedChangesContext.Provider value={registry}>{children}</UnsavedChangesContext.Provider>;
}

export function useUnsavedChangesRegistry(): UnsavedChangesRegistry | null {
  return useContext(UnsavedChangesContext);
}

/** Bu formun kirli durumunu kayda geçirir; kaldırılınca (unmount) temizler. */
export function useUnsavedChanges(id: string, dirty: boolean): void {
  const registry = useContext(UnsavedChangesContext);
  useEffect(() => {
    if (!registry) return;
    registry.setDirty(id, dirty);
    return () => registry.setDirty(id, false);
  }, [registry, id, dirty]);
}
