"use client";

/**
 * Destek hedefi başlığı — DESIGN §2.9 "Destek hedefi (işletme, araç, sahip)
 * üstte sabit; hedef değiştirmek mevcut işi bırakır; kaydedilmemiş form
 * varsa 'Değişiklikleri bırakıp çık?' onayı." İşlemi yapan GERÇEK ekip
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
      className="sticky top-0 z-10 flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-divider)] bg-[var(--color-surface)] px-4 py-3"
    >
      <p className="text-lg font-semibold text-[var(--color-text)]">
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
        className="min-h-[var(--control-min-height)] self-start rounded-[var(--radius-control)] border border-[var(--color-input-border)] px-4 text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
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
