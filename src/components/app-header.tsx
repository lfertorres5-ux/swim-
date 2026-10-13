import Link from "next/link";
import { brand } from "@/config/brand";
import type { CurrentUser } from "@/lib/auth";

type NavItem = { href: string; label: string };

export function AppHeader({ user, nav = [] }: { user: CurrentUser; nav?: NavItem[] }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="font-semibold text-sky-700">
            {brand.name}
          </Link>
          <nav className="hidden gap-4 text-sm text-slate-600 sm:flex">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-slate-900">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-slate-500 sm:inline">
            {user.firstName ?? user.email}
            <span className="badge ml-2 bg-slate-100 text-slate-600 capitalize">{user.role}</span>
          </span>
          <form action="/auth/signout" method="post">
            <button className="text-slate-600 hover:text-slate-900">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
