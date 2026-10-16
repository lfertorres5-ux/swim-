"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/settings", label: "Prices & packages" },
  { href: "/admin/settings/codes", label: "Discount codes" },
  { href: "/admin/settings/zones", label: "Zones" },
  { href: "/admin/settings/policies", label: "Policies" },
];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm ${path === t.href ? "bg-brand-600 font-medium text-white" : "bg-white text-stone-600 hover:text-stone-900"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
