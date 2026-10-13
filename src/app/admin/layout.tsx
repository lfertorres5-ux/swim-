import { AppHeader } from "@/components/app-header";
import { requireRole } from "@/lib/auth";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireRole("admin", "/admin");
  return (
    <>
      <AppHeader user={user} nav={[
          { href: "/admin", label: "Dashboard" },
          { href: "/admin/scheduling", label: "Scheduling" },
        ]} />
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</div>
    </>
  );
}
