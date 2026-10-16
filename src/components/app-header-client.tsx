"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { brand } from "@/config/brand";

type NavItem = { href: string; label: string };

export function AppHeaderClient({ name, nav }: { name: string; nav: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Longest matching prefix wins, so "/instructor" isn't active on "/instructor/requests".
  // Long menus (admin) collapse to the menu button until there's room for them.
  const wide = nav.length > 6;
  const active = nav.filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-sand/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <Link href="/dashboard" className="font-display text-lg font-semibold text-brand-800">
          {brand.name}
        </Link>

        <nav className={`hidden items-center gap-0.5 ${wide ? "xl:flex" : "md:flex"}`}>
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-full px-3 py-1.5 text-sm ${active === item.href ? "bg-white font-medium text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={`hidden items-center gap-4 text-sm ${wide ? "xl:flex" : "md:flex"}`}>
          <span className="text-stone-500">Hi, {name}</span>
          <form action="/auth/signout" method="post">
            <button className="text-stone-500 hover:text-stone-900">Sign out</button>
          </form>
        </div>

        <button
          type="button"
          className={`-mr-2 rounded-full p-2 text-stone-700 ${wide ? "xl:hidden" : "md:hidden"}`}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <nav className={`border-t border-stone-200/70 px-5 pb-4 ${wide ? "xl:hidden" : "md:hidden"}`}>
          <ul className="flex flex-col py-2">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`block rounded-xl px-3 py-3 text-base ${active === item.href ? "bg-white font-medium text-stone-900" : "text-stone-700"}`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-stone-200/70 px-3 pt-3 text-sm text-stone-500">
            <span>Signed in as {name}</span>
            <form action="/auth/signout" method="post">
              <button className="font-medium text-stone-700">Sign out</button>
            </form>
          </div>
        </nav>
      )}
    </header>
  );
}
