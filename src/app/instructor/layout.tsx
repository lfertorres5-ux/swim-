import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function InstructorLayout({ children }: LayoutProps<"/instructor">) {
  const user = await requireRole("instructor", "/instructor");
  const supabase = await createClient();

  const [{ data: settings }, { data: me }] = await Promise.all([
    supabase.from("platform_settings").select("instructor_terms_version").single(),
    supabase.from("instructors").select("is_active").eq("id", user.id).single(),
  ]);
  const { count } = await supabase
    .from("instructor_terms_acceptances")
    .select("id", { count: "exact", head: true })
    .eq("instructor_id", user.id)
    .eq("terms_version", settings?.instructor_terms_version ?? "");

  // UX mirror of the RLS rule private.is_active_instructor(): the database
  // already returns nothing until both conditions hold.
  if (!count) redirect("/onboarding/instructor-terms");

  return (
    <>
      <AppHeader user={user} nav={[{ href: "/instructor", label: "Today" }]} />
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {me?.is_active ? (
          children
        ) : (
          <div className="card max-w-xl">
            <h1 className="text-lg font-semibold">Your account is pending activation</h1>
            <p className="mt-2 text-slate-600">
              Thanks for accepting the instructor agreement. The owner will verify your certifications and activate your
              account — you&apos;ll get an email when lessons are available.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
