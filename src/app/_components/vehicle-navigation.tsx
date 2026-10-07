"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, House, NotebookPen, UsersRound, Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { useUnsavedChangesRegistry } from "./unsaved-changes";

const ownerDestinations = [
  { href: "/sahip", label: "Özet", icon: House },
  { href: "/sahip/raporlar", label: "Raporlar", icon: Wallet },
  { href: "/sahip/soforler", label: "Şoförlerim", icon: UsersRound },
] as const;

const driverDestinations = [
  { href: "/sofor", label: "Günlük kayıt", icon: NotebookPen },
  { href: "/sofor/kayitlar", label: "Araçtaki kayıtlar", icon: ClipboardList },
] as const;

function useVehicleNavigationGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const registry = useUnsavedChangesRegistry();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  return {
    guardNavigation(event: { preventDefault: () => void }, href: string) {
      if (href === pathname) {
        event.preventDefault();
        return;
      }
      if (registry?.hasDirty()) {
        event.preventDefault();
        setPendingHref(href);
      }
    },
    confirmation: (
      <ConfirmDialog
        open={pendingHref !== null}
        title="Değişiklikleri bırakıp çık?"
        description="Kaydedilmemiş değişiklikleri bırakıp bu sayfadan çıkmak istiyor musun?"
        confirmLabel="Bırakıp çık"
        onConfirm={() => {
          if (pendingHref) router.push(pendingHref);
          setPendingHref(null);
        }}
        onCancel={() => setPendingHref(null)}
      />
    ),
  };
}

/** Detail actions also respect the form's existing unsaved-change registry. */
export function VehicleActionLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const { guardNavigation, confirmation } = useVehicleNavigationGuard();
  return (
    <>
      <Link href={href} className={className} onNavigate={(event) => guardNavigation(event, href)}>{children}</Link>
      {confirmation}
    </>
  );
}

/** The same labelled destinations stay visible throughout each role's screens. */
export function VehicleNavigation({ role }: { role: "owner" | "driver" }) {
  const pathname = usePathname();
  const { guardNavigation, confirmation } = useVehicleNavigationGuard();
  const destinations = role === "owner" ? ownerDestinations : driverDestinations;
  const section = role === "owner"
    ? pathname.startsWith("/sahip/raporlar")
      ? "/sahip/raporlar"
      : pathname.startsWith("/sahip/soforler")
        ? "/sahip/soforler"
        : "/sahip"
    : pathname.startsWith("/sofor/kayitlar") ? "/sofor/kayitlar" : "/sofor";

  return (
    <>
      <nav aria-label={role === "owner" ? "Sahip bağlantıları" : "Şoför bağlantıları"} className="ds-admin-nav ds-vehicle-nav">
        <ul className="ds-admin-nav-list">
          {destinations.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={section === item.href ? "page" : undefined}
                className="ds-admin-nav-link"
                onNavigate={(event) => guardNavigation(event, item.href)}
              >
                <item.icon aria-hidden="true" className="ds-admin-nav-icon" strokeWidth={1.75} />
                <span>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {confirmation}
    </>
  );
}
