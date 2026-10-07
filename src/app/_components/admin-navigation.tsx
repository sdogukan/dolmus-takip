"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, History, UsersRound } from "lucide-react";
import { useState } from "react";
import { ADMIN_NAVIGATION_MESSAGES as TEXT } from "../../lib/messages";
import { ConfirmDialog } from "./confirm-dialog";
import { useUnsavedChangesRegistry } from "./unsaved-changes";

const destinations = [
  { href: "/yonetim", label: TEXT.businesses, shortLabel: TEXT.businesses, icon: Building2 },
  { href: "/yonetim/islem-gecmisi", label: TEXT.history, shortLabel: TEXT.historyShort, icon: History },
  { href: "/yonetim/ekip", label: TEXT.team, shortLabel: TEXT.teamShort, icon: UsersRound, adminOnly: true },
] as const;

/** One navigation landmark: a sidebar on desktop and a bottom bar on phones. */
export function AdminNavigation({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const registry = useUnsavedChangesRegistry();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const section = pathname.startsWith("/yonetim/ekip")
    ? "/yonetim/ekip"
    : pathname.startsWith("/yonetim/islem-gecmisi")
      ? "/yonetim/islem-gecmisi"
      : "/yonetim";

  return (
    <>
      <nav aria-label={TEXT.label} className="ds-admin-nav">
        <ul className="ds-admin-nav-list">
          {destinations.filter((item) => !("adminOnly" in item) || isAdmin).map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={section === item.href ? "page" : undefined}
                className="ds-admin-nav-link"
                onNavigate={(event) => {
                  if (registry?.hasDirty()) {
                    event.preventDefault();
                    setPendingHref(item.href);
                  }
                }}
              >
                <item.icon aria-hidden="true" className="ds-admin-nav-icon" strokeWidth={1.75} />
                <span className="ds-admin-nav-short" aria-hidden="true">{item.shortLabel}</span>
                <span className="ds-admin-nav-full" aria-hidden="true">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <ConfirmDialog
        open={pendingHref !== null}
        title={TEXT.leaveTitle}
        description={TEXT.leaveDescription}
        confirmLabel={TEXT.leaveConfirm}
        onConfirm={() => {
          if (pendingHref) router.push(pendingHref);
          setPendingHref(null);
        }}
        onCancel={() => setPendingHref(null)}
      />
    </>
  );
}
