import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { requireRole } from "@/lib/auth";

export default async function ParentLayout({ children }: LayoutProps<"/parent">) {
  const user = await requireRole("parent", "/parent");
  if (!user.onboardedAt) redirect("/onboarding");
  return (
    <>
      <AppHeader
        user={user}
        nav={[
          { href: "/parent", label: "My lessons" },
          { href: "/book", label: "Book" },
          { href: "/parent/progress", label: "Progress" },
          { href: "/parent/receipts", label: "Receipts" },
          { href: "/day-pass", label: "Club day pass" },
        ]}
      />
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</div>
    </>
  );
}
