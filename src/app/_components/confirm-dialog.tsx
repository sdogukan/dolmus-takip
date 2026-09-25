"use client";

/**
 * Kısa erişilebilir onay penceresi — pencere kuralı: kayıt ve para onayı
 * ayrı açılır pencerede tekrarlanmaz; yalnız kısa kararlar için
 * erişilebilir iletişim penceresi kullanılabilir; "odak kapanınca önceki
 * düğmeye döner". İlk kullanımı T2.1 (S2.1) işletme pasifleştirme onayıdır
 * (etkilenen hedef ve erişim sonucu açıkça gösterilir).
 *
 * Native `<dialog>` (`showModal`) kullanılır — tarayıcı ZATEN odak
 * tuzağını (Tab pencereden dışarı çıkmaz), Escape'i ve arka plan
 * `::backdrop`'unu SAĞLAR; kendi odak-tuzağı KODU YAZILMAZ (CLAUDE.md —
 * var olan platform garantisini yeniden icat etme). `showModal` kapanınca
 * odağı, penceriyi AÇAN öğeye (bu bileşeni render eden ekranın "Pasife
 * al" düğmesi) OTOMATİK geri verir — dosya üstü notun "odak kapanınca
 * önceki düğmeye döner" cümlesi budur.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Kırmızı düğme yalnız pasife alma gibi sonuçlu işlemlerde
   * kullanılır. */
  danger?: boolean;
  isSubmitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Vazgeç",
  danger,
  isSubmitting,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Sayfada birden çok pencere olabilir; sabit id ilkinin başlığını hepsine bağlardı.
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-[calc(100%-2rem)] max-w-[28rem] rounded-[var(--radius-card)] border-none p-0 text-[var(--color-text)] backdrop:bg-black/40"
      onCancel={(event) => {
        // Escape — Vazgeç ile AYNI (yalnız iptal), sonuçlu işlem TETİKLENMEZ.
        // Tarayıcının kendi kapatması ENGELLENİR: kapanış, çağıranın `open`
        // prop'unu `false` yapmasıyla (yukarıdaki `useEffect`) KONTROLLÜ
        // olur — aksi halde `dialog.close()` İKİ KEZ (bir burada, bir
        // effect'te) tetiklenip `close` olayının onaylama akışıyla
        // KARIŞMASINA yol açardı (bkz. aşağıdaki not).
        event.preventDefault();
        onCancel();
      }}
      // NOT `onClose`: native `close` olayı hem "Vazgeç" hem "Onayla"
      // sonrası (ikisi de `open`'ı `false` yapar) AYNI şekilde tetiklenir —
      // buraya `onCancel` bağlamak ONAYLANMIŞ bir işlemi de iptal gibi
      // ele alırdı. Kapanışın KENDİSİ zaten çağıranın state güncellemesinin
      // SONUCUDUR; ayrıca bir geri bildirim GEREKMEZ.
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="text-xl font-semibold">
          {title}
        </h2>
        <div className="text-base text-[var(--color-text-secondary)]">{description}</div>
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className={`min-h-[var(--control-min-height)] flex-1 rounded-[var(--radius-control)] text-lg font-semibold transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-70 ${
              danger
                ? "bg-[var(--color-error)] text-white focus-visible:ring-[var(--color-error)]"
                : "bg-[var(--color-primary)] text-[var(--color-on-primary)] focus-visible:ring-[var(--color-primary)]"
            }`}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="min-h-[var(--control-min-height)] flex-1 rounded-[var(--radius-control)] border border-[var(--color-input-border)] text-base font-medium text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-70"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
