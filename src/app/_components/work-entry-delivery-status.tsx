import type { DeliveryStatusView } from "../../lib/work-entry-ui";
import { WORK_ENTRY_MESSAGES as TEXT } from "../../lib/messages";

/**
 * Teslim durumu: beklenen tutar, durum, (bekleyende ipucu) ve onaylıda alınan
 * tutar ile doğrulama zamanı AYRI satırlar. Sonuç ekranı ve şoför detayı aynı
 * bileşeni kullanır; durum metni ekranda bir kez çıkar.
 */
export function WorkEntryDeliveryStatus({ view }: { view: DeliveryStatusView }) {
  const wrapClass = "[overflow-wrap:anywhere]";
  return (
    <>
      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-lg tabular-nums">
        <span>{view.expectedLabel}</span>
        <span className={`font-semibold ${wrapClass}`}>{view.expectedText}</span>
      </p>
      <p className="text-lg font-medium text-[var(--color-text)]">{view.statusText}</p>
      {view.hint && <p className="text-base text-[var(--color-text-secondary)]">{view.hint}</p>}
      {view.confirmed && (
        <>
          <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-lg tabular-nums">
            <span>{TEXT.confirmedReceivedLabel}</span>
            <span className={`font-semibold ${wrapClass}`}>{view.confirmed.receivedText}</span>
          </p>
          <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-base text-[var(--color-text-secondary)] tabular-nums">
            <span>{TEXT.confirmedAtLabel}</span>
            <span className={`text-right ${wrapClass}`}>{view.confirmed.confirmedAtText}</span>
          </p>
          {view.confirmed.supportTrace && (
            <p className="text-base text-[var(--color-text-secondary)]">{view.confirmed.supportTrace}</p>
          )}
        </>
      )}
    </>
  );
}
