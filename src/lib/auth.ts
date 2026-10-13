import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "parent" | "instructor" | "admin";

export type CurrentUser = {
  id: string;
  role: Role;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  onboardedAt: string | null;
};

/**
 * Data Access Layer: the single place that turns a session cookie into a user.
 * Identity comes from a verified JWT (getClaims), role from public.users —
 * never from user-editable metadata. Memoized per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("users")
    .select("id, role, email, first_name, last_name, phone, onboarded_at")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;

  return {
    id: data.id,
    role: data.role,
    email: data.email,
    firstName: data.first_name,
    lastName: data.last_name,
    phone: data.phone,
    onboardedAt: data.onboarded_at,
  };
});

export async function requireUser(next?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}

/** Authorize a route/action for one or more roles. Admins are NOT implicitly allowed everywhere. */
export async function requireRole(roles: Role | Role[], next?: string): Promise<CurrentUser> {
  const user = await requireUser(next);
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(user.role)) redirect(homeForRole(user.role));
  return user;
}

export function homeForRole(role: Role): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "instructor":
      return "/instructor";
    default:
      return "/parent";
  }
}

/** Only allow same-origin relative redirects (blocks //evil.com and absolute URLs). */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
