"use client";

/**
 * Destek hedefi başlığı — destek hedefi (işletme, araç, sahip) üstte
 * sabittir; hedef değiştirmek mevcut işi bırakır; kaydedilmemiş form varsa
 * "Değişiklikleri bırakıp çık?" onayı istenir. İşlemi yapan GERÇEK ekip
 * kullanıcısı (kullanıcı adı + rol) burada da görünür.
 *
 * "Hedefi değiştir": kirli form yoksa doğrudan `/yonetim`; varsa
 * `ConfirmDialog`. Vazgeç HİÇBİR ŞEYİ değiştirmez (form değerleri, saklı
 * taslak, adres). Devam edilince bu aracın taslakları silinir
 * (`../../lib/support-target.ts`) ve `/yonetim`e gidilir; formlar zaten
 * sayfayla birlikte kapanır (parola alanı yalnız bellektedir).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SUPPORT_MESSAGES } from "../../lib/messages";
import { clearVehicleDrafts } from "../../lib/support-target";
import { ConfirmDialog } from "./confirm-dialog";
import { useUnsavedChangesRegistry } from "./unsaved-changes";

export function SupportTargetHeader({
  vehicleId,
  scopeKey,
  businessName,
  plateDisplay,
  ownerName,
  username,
  roleLabel,
}: {
  vehicleId: string;
  scopeKey: string;
  businessName: string;
  plateDisplay: string;
  ownerName: string;
  username: string;
  roleLabel: string;
}) {
  const router = useRouter();
  const registry = useUnsavedChangesRegistry();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleChangeTarget(): void {
    if (registry?.hasDirty()) {
      setConfirmOpen(true);
      return;
    }
    router.push("/yonetim");
  }

  function handleLeave(): void {
    setConfirmOpen(false);
    try {
      clearVehicleDrafts(window.localStorage, { scopeKey }, vehicleId);
    } catch {
      // localStorage erişilemezse taslak zaten yazılamamıştır.
    }
    router.push("/yonetim");
  }

  return (
    <section
      aria-label={SUPPORT_MESSAGES.targetRegion}
      className="ds-target sticky top-0 z-10 flex flex-col gap-2 px-4 py-3"
    >
      <p className="ds-card-title">
        {SUPPORT_MESSAGES.business(businessName)}
      </p>
      <p className="text-base text-[var(--color-text)]">
        {SUPPORT_MESSAGES.vehicleOwner(plateDisplay, ownerName)}
      </p>
      <p className="text-base text-[var(--color-text-secondary)]">
        {SUPPORT_MESSAGES.actor(username, roleLabel)}
      </p>
      <button
        type="button"
        onClick={handleChangeTarget}
        className="ds-btn ds-btn-secondary self-start"
      >
        {SUPPORT_MESSAGES.changeTarget}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title={SUPPORT_MESSAGES.leaveTitle}
        description={SUPPORT_MESSAGES.leaveDescription}
        confirmLabel={SUPPORT_MESSAGES.leaveConfirm}
        onConfirm={handleLeave}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
