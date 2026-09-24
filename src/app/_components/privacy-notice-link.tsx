import Link from "next/link";
import { PRIVACY_NOTICE } from "../../lib/messages";

/** Araç ve ekip giriş ekranlarının altındaki KVKK aydınlatma metni bağlantısı
 * (iki ekranda birebir aynı; dokunma hedefi en az 48 px). */
export function PrivacyNoticeLink() {
  return (
    <Link
      href={PRIVACY_NOTICE.path}
      className="inline-flex min-h-[var(--control-min-height)] items-center self-center text-base font-medium text-[var(--color-primary)] underline"
    >
      {PRIVACY_NOTICE.linkLabel}
    </Link>
  );
}
