import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ProfileForm } from "./profile-form";

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  if (user.role === "instructor") redirect("/onboarding/instructor-terms");
  if (user.role === "admin") redirect("/admin");

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900">Welcome! Tell us about you</h1>
      <p className="mt-2 mb-6 text-slate-600">You&apos;ll add your swimmers and pool address when you book.</p>
      <ProfileForm
        defaults={{ firstName: user.firstName ?? "", lastName: user.lastName ?? "", phone: user.phone ?? "" }}
      />
    </main>
  );
}
