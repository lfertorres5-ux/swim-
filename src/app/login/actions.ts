"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth";
import { siteUrl } from "@/lib/env";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string; email?: string };

const emailSchema = z.email({ message: "Enter a valid email address." });

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0].message };

  const next = safeNextPath(String(formData.get("next") ?? ""));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    // Don't reveal whether an account exists; surface rate limits plainly.
    const message = error.status === 429 ? "Too many attempts — please wait a minute and try again." : "We couldn't send a link right now. Please try again.";
    return { status: "error", message, email: parsed.data };
  }
  return { status: "sent", email: parsed.data };
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect("/auth/error?reason=oauth");
  redirect(data.url);
}
