"use server";

import type { FormState } from "@/components/action-form";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { submitDayPassInquiry } from "@/lib/day-pass";

/** A one-way hash of the visitor's IP: enough to rate-limit, never stored readable. */
async function clientKey() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";
  if (!ip) return null;
  const salt = process.env.FLASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createHash("sha256").update(`daypass:${salt}:${ip}`).digest("hex").slice(0, 32);
}

export async function submitInquiry(_: FormState, fd: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  const num = (k: string) => Number(fd.get(k) ?? 0) || 0;
  const r = await submitDayPassInquiry(
    {
      contactName: String(fd.get("name") ?? ""),
      contactEmail: String(fd.get("email") ?? "").trim(),
      contactPhone: String(fd.get("phone") ?? "") || undefined,
      adults: num("adults"),
      children: num("children"),
      preferredDates: fd.getAll("date").map(String).filter(Boolean),
      interestLevel: (String(fd.get("interest") ?? "interested") as "just_curious" | "interested" | "ready_to_book"),
      message: String(fd.get("message") ?? "") || undefined,
      website: String(fd.get("website") ?? "") || undefined,
    },
    user?.role === "parent" ? user.id : null,
    { clientKey: await clientKey() },
  );
  return r.ok ? { ok: true, message: "sent" } : { error: r.error };
}
