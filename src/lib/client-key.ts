import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

/** A salted one-way hash of the visitor's IP: enough to rate-limit, never stored readable. */
export async function clientKey(scope: string): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";
  if (!ip) return null;
  const salt = process.env.FLASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createHash("sha256").update(`${scope}:${salt}:${ip}`).digest("hex").slice(0, 32);
}
