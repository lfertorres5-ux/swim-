import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/lib/auth";
import { BookingError } from "@/lib/booking/checkout";
import { createAdminClient } from "@/lib/supabase/admin";

export class AdminError extends Error {}

type Admin = Awaited<ReturnType<typeof requireRole>>;

/**
 * Wraps an admin server action: checks the role, turns validation and
 * business errors into a message for the form, and refreshes admin pages.
 */
export async function runAdmin(fn: (user: Admin) => Promise<string | void>): Promise<FormState> {
  const user = await requireRole("admin");
  try {
    const message = await fn(user);
    revalidatePath("/admin", "layout");
    return { ok: true, message: message ?? "Saved." };
  } catch (err) {
    if (err instanceof z.ZodError) return { error: err.issues[0]?.message ?? "Check the form." };
    if (err instanceof AdminError || err instanceof BookingError) return { error: err.message };
    console.error("admin action failed", err);
    return { error: err instanceof Error && err.message ? `Couldn't save: ${err.message}` : "Something went wrong." };
  }
}

export async function adminAudit(actorId: string, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}, bookingId: string | null = null) {
  await createAdminClient().from("audit_log").insert({ actor_id: actorId, actor_role: "admin", action, entity_type: entityType, entity_id: entityId, booking_id: bookingId, metadata });
}

/** Throw a readable error for a failed Supabase write. */
export function check(error: { message: string; code?: string } | null, friendly?: Record<string, string>) {
  if (!error) return;
  const hit = friendly && Object.entries(friendly).find(([k]) => error.code === k || error.message.includes(k));
  throw new AdminError(hit ? hit[1] : error.message);
}

// --- FormData helpers ---------------------------------------------------------
export const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
export const bool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";
export const int = (fd: FormData, key: string) => {
  const v = text(fd, key);
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new AdminError(`${key.replaceAll("_", " ")} must be a number`);
  return Math.round(n);
};
/** "$65" / "65.50" → 6550 */
export const cents = (fd: FormData, key: string) => {
  const v = text(fd, key);
  if (v === null) return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new AdminError("Enter a dollar amount");
  return Math.round(n * 100);
};
export const list = (fd: FormData, key: string) =>
  (text(fd, key) ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
