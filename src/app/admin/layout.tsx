import { AppHeader } from "@/components/app-header";
import { requireRole } from "@/lib/auth";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireRole("admin", "/admin");
  return (
    <>
      <AppHeader
        user={user}
        nav={[
          { href: "/admin", label: "Dashboard" },
          { href: "/admin/bookings", label: "Bookings" },
          { href: "/admin/payments", label: "Payments" },
          { href: "/admin/instructors", label: "Instructors" },
          { href: "/admin/sub-board", label: "Sub board" },
          { href: "/admin/day-pass", label: "Day pass" },
          { href: "/admin/settings", label: "Settings" },
          { href: "/admin/activity", label: "Activity" },
        ]}
      />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</div>
    </>
  );
}
