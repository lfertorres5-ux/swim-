import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { INSTRUCTOR_TERMS } from "@/content/instructor-terms";
import { acceptInstructorTerms } from "../actions";

export const metadata: Metadata = { title: "Instructor agreement" };

export default async function InstructorTermsPage({ searchParams }: PageProps<"/onboarding/instructor-terms">) {
  await requireRole("instructor", "/onboarding/instructor-terms");
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: settings } = await supabase.from("platform_settings").select("instructor_terms_version").single();
  const version = settings?.instructor_terms_version ?? "";
  const terms = INSTRUCTOR_TERMS[version];

  if (!terms) {
    return (
      <main className="mx-auto max-w-2xl flex-1 px-6 py-16">
        <p className="text-red-700">
          Terms version “{version}” is configured but its text isn&apos;t deployed. Please contact the owner.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-semibold text-stone-900">{terms.title}</h1>
      <p className="mt-1 text-sm text-stone-500">
        Version {version} · effective {terms.effective}
      </p>
      <p className="mt-4 text-stone-600">
        You&apos;ll be able to see lessons and client details after you accept. Please read carefully.
      </p>

      <div className="card mt-6 max-h-[28rem] space-y-5 overflow-y-auto">
        {terms.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="font-semibold text-stone-900">{s.heading}</h2>
            <p className="mt-1 text-sm leading-relaxed text-stone-700">{s.body}</p>
          </section>
        ))}
      </div>

      <form action={acceptInstructorTerms} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="version" value={version} />
        <label className="flex items-start gap-2 text-sm text-stone-700">
          <input type="checkbox" name="agree" required className="mt-1" />
          I have read and agree to the {terms.title}, including keeping all client information confidential and
          handling every payment through the platform.
        </label>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error === "agree" ? "Please check the box to agree." : "These terms were just updated — please review and accept again."}
          </p>
        )}
        <button className="btn-primary w-fit">Accept and continue</button>
      </form>
    </main>
  );
}
