import { redirect } from "next/navigation";
import { homeForRole, requireUser } from "@/lib/auth";

/** Post-login router: sends each role to its home, parents through onboarding first. */
export default async function DashboardRouter() {
  const user = await requireUser("/dashboard");
  if (user.role === "parent" && !user.onboardedAt) redirect("/onboarding");
  redirect(homeForRole(user.role));
}
