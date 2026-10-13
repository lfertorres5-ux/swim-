import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth";

/**
 * Magic-link landing for the token-hash email template (works across devices,
 * unlike PKCE). Configure the Supabase "Magic Link" template to link to:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(extractPath(searchParams.get("next")));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  return NextResponse.redirect(new URL("/auth/error?reason=link", origin));
}

// {{ .RedirectTo }} is an absolute URL; keep only its path + query.
function extractPath(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    const inner = u.searchParams.get("next");
    return inner ?? u.pathname + u.search;
  } catch {
    return value;
  }
}
