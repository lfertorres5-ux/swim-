import { z } from "zod";

/**
 * Environment access. Integrations validate lazily so that, e.g., Phase 1 runs
 * without Stripe or Twilio keys; anything missing fails loudly when first used.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

export function publicEnv() {
  // NEXT_PUBLIC_* must be referenced literally so Next can inline them.
  return publicSchema.parse({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function siteUrl(): string {
  const fromVercel = process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined;
  return (process.env.NEXT_PUBLIC_SITE_URL || fromVercel || "http://localhost:3000").replace(/\/$/, "");
}

export function requireServerEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return value;
}
