import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, requireServerEnv } from "@/lib/env";

/**
 * Service-role client. BYPASSES RLS.
 *
 * Use only in server code, only after an explicit authorization check
 * (requireRole / ownership), and write an audit_log row for privileged
 * mutations. Never import this from a Client Component.
 */
export function createAdminClient() {
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, requireServerEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
