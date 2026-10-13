import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getInstructorContext, REQUIREMENT_LABELS } from "@/lib/instructor-context";

export default async function InstructorLayout({ children }: LayoutProps<"/instructor">) {
  const ctx = await getInstructorContext();
  // UX mirror of the RLS rule private.is_active_instructor(): the database
  // already returns no client data until terms are accepted and admin activates.
  if (!ctx.termsAccepted) redirect("/onboarding/instructor-terms");

  return (
    <>
      <AppHeader
        user={ctx.user}
        nav={[
          { href: "/instructor", label: "Today" },
          { href: "/instructor/requests", label: "Requests" },
          { href: "/instructor/families", label: "Families" },
          { href: "/instructor/availability", label: "Availability" },
          { href: "/instructor/profile", label: "Profile" },
        ]}
      />
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {(!ctx.isActive || ctx.missing.length > 0) && (
          <div className="card mb-6 border-amber-300 bg-amber-50">
            <p className="font-semibold text-amber-900">
              {ctx.isActive ? "Finish your profile" : "Your account is pending activation"}
            </p>
            {ctx.missing.length > 0 ? (
              <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
                {ctx.missing.map((m) => (
                  <li key={m}>
                    <Link className="underline" href={m === "photo" || m === "bio" ? "/instructor/profile" : "/instructor/availability"}>
                      {REQUIREMENT_LABELS[m]}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-amber-900">
                Your profile is complete. The owner will verify your certifications and activate your account.
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </>
  );
}
