import Link from "next/link";
import { PRIVACY_NOTICE } from "../../lib/messages";

/** Araç ve ekip giriş ekranlarının altındaki KVKK aydınlatma metni bağlantısı
 * (iki ekranda birebir aynı; dokunma hedefi en az 48 px). */
export function PrivacyNoticeLink() {
  return (
    <Link
      href={PRIVACY_NOTICE.path}
      className="ds-btn ds-btn-text inline-flex items-center self-center"
    >
      {PRIVACY_NOTICE.linkLabel}
    </Link>
  );
}
