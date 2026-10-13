import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signJwt } from "./jwt";

/**
 * API-level tests run supabase-js against a real PostgREST in front of the test
 * database (see scripts/api-test/run.sh). They exercise the exact queries,
 * relation embeds and RPC signatures the app uses.
 */
export const API_URL = process.env.API_TEST_URL ?? "";
export const enabled = Boolean(API_URL && process.env.API_TEST_JWT_SECRET);

export const ids = {
  zoneA: "00000000-0000-4000-b000-00000000000a",
  zoneB: "00000000-0000-4000-b000-00000000000b",
  maya: "00000000-0000-4000-a000-000000000101",
  jordan: "00000000-0000-4000-a000-000000000102",
  sofia: "00000000-0000-4000-a000-000000000103",
  tyler: "00000000-0000-4000-a000-000000000104",
  emily: "00000000-0000-4000-a000-000000000201",
  marcus: "00000000-0000-4000-a000-000000000204",
  childEli: "00000000-0000-4000-c000-000000000007",
};

export function clientAs(sub: string | "service_role" | "anon"): SupabaseClient {
  const anonKey = signJwt({ role: "anon" });
  const token =
    sub === "anon" ? anonKey : sub === "service_role" ? signJwt({ role: "service_role" }) : signJwt({ sub, role: "authenticated" });
  return createClient(API_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Env the app's server modules read (createAdminClient). */
export function configureServerEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = signJwt({ role: "anon" });
  process.env.SUPABASE_SERVICE_ROLE_KEY = signJwt({ role: "service_role" });
}
