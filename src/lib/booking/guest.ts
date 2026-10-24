import "server-only";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { siteUrl } from "@/lib/env";
import { toE164 } from "@/lib/phone";
import { SWIM_LEVELS } from "@/lib/scheduling/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { laDateString } from "@/lib/time";
import { BookingError, checkoutInputSchema, createBookingCheckout } from "./checkout";

/**
 * Guest checkout: families book without an account and we create it at the
 * very end, when they pay.
 *
 *  - New email: create the account (as a parent), save their name, phone and
 *    swimmers, sign them in on this browser, then run the normal checkout.
 *  - Email that already has an account: never attach a booking to it from an
 *    unverified form. Email them a sign-in link instead.
 *  - Already signed in (e.g. a retry after a payment error): just save the
 *    swimmers and check out.
 *
 * Creating accounts is rate-limited per network (hashed IP).
 */
export const MAX_GUEST_ACCOUNTS_PER_DAY = 5;

export const guestSwimmerSchema = z.object({
  firstName: z.string().trim().min(1, "Add each swimmer's first name").max(60),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Add each swimmer's birth date"),
  swimLevel: z.enum(SWIM_LEVELS),
  notes: z.string().trim().max(500).optional(),
});

export const guestCheckoutSchema = checkoutInputSchema.omit({ childIds: true }).extend({
  swimmers: z.array(guestSwimmerSchema).min(1).max(10),
  contact: z.object({
    firstName: z.string().trim().min(1, "Add your first name").max(60),
    lastName: z.string().trim().min(1, "Add your last name").max(60),
    email: z.email("Enter a valid email address").max(200),
    phone: z.string().trim().max(30).optional(),
    smsOptIn: z.boolean().optional(),
  }),
});
export type GuestCheckoutInput = z.infer<typeof guestCheckoutSchema>;

export type GuestCheckoutResult = { kind: "redirect"; url: string } | { kind: "confirmed"; url: string } | { kind: "sign_in"; email: string };

export async function guestCheckout(input: GuestCheckoutInput, clientKey: string | null): Promise<GuestCheckoutResult> {
  const admin = createAdminClient();
  const today = laDateString();
  if (input.swimmers.some((s) => s.birthDate > today || s.birthDate < "1990-01-01")) throw new BookingError("invalid_swimmers", "Check each swimmer's birth date.");
  const phone = input.contact.phone ? toE164(input.contact.phone) : null;
  if (input.contact.phone && !phone) throw new BookingError("invalid_contact", "Enter a valid US mobile number, e.g. (619) 555-0123.");
  const email = input.contact.email.trim().toLowerCase();

  const current = await getCurrentUser();
  let parentId: string;
  if (current) {
    if (current.role !== "parent") throw new BookingError("not_parent", "You're signed in with a staff account. Sign out to book as a family.");
    parentId = current.id;
  } else {
    const { data: existing } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (existing) return sendSignInLink(email);

    if (clientKey) {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const { count } = await admin.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "guest.account_created").eq("metadata->>client_key", clientKey).gte("created_at", since);
      if ((count ?? 0) >= MAX_GUEST_ACCOUNTS_PER_DAY) throw new BookingError("rate_limited", "Too many new accounts from this network today. Please sign in or try again tomorrow.");
    }

    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { first_name: input.contact.firstName, last_name: input.contact.lastName },
    });
    if (error || !created.user) {
      // Lost a race with another sign-up for the same email.
      if (error?.status === 422) return sendSignInLink(email);
      throw new Error(`guest createUser failed: ${error?.message}`);
    }
    parentId = created.user.id;

    const { data: row } = await admin.from("users").select("role").eq("id", parentId).single();
    if (row?.role !== "parent") return sendSignInLink(email); // e.g. an instructor invite for this email

    await admin
      .from("users")
      .update({
        first_name: input.contact.firstName,
        last_name: input.contact.lastName,
        phone,
        sms_opt_in: Boolean(phone) && Boolean(input.contact.smsOptIn),
        onboarded_at: new Date().toISOString(),
      })
      .eq("id", parentId);
    await admin.from("audit_log").insert({ actor_id: parentId, actor_role: "parent", action: "guest.account_created", entity_type: "user", entity_id: parentId, metadata: { client_key: clientKey } });

    // Sign them in on this browser so checkout, the confirmation page and their account just work.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) throw new Error(`guest sign-in link failed: ${linkError?.message}`);
    const supabase = await createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (verifyError) throw new Error(`guest sign-in failed: ${verifyError.message}`);
  }

  const childIds = await saveSwimmers(parentId, input.swimmers);
  const result = await createBookingCheckout(parentId, {
    address: input.address,
    saveAsHome: input.saveAsHome,
    durationMinutes: input.durationMinutes,
    childIds,
    instructorId: input.instructorId,
    plan: input.plan,
    start: input.start,
    promoCode: input.promoCode,
    paymentMethod: input.paymentMethod,
    autoRenew: input.autoRenew,
  });
  return result.kind === "confirmed" ? { kind: "confirmed", url: result.url } : { kind: "redirect", url: result.url };
}

/** Reuse a swimmer the family already has (same name and birth date), so a retry doesn't duplicate kids. */
async function saveSwimmers(parentId: string, swimmers: z.infer<typeof guestSwimmerSchema>[]) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("children").select("id, first_name, birth_date").eq("parent_id", parentId).eq("is_active", true);
  const ids: string[] = [];
  for (const s of swimmers) {
    const match = (existing ?? []).find((c) => c.first_name.toLowerCase() === s.firstName.toLowerCase() && c.birth_date === s.birthDate);
    if (match) {
      ids.push(match.id);
      continue;
    }
    const { data, error } = await admin
      .from("children")
      .insert({ parent_id: parentId, first_name: s.firstName, birth_date: s.birthDate, swim_level: s.swimLevel, notes: s.notes || null })
      .select("id")
      .single();
    if (error || !data) throw new BookingError("invalid_swimmers", "Couldn't save your swimmers. Please try again.");
    ids.push(data.id);
  }
  return [...new Set(ids)];
}

async function sendSignInLink(email: string): Promise<GuestCheckoutResult> {
  const supabase = await createClient();
  await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent("/book")}` } });
  return { kind: "sign_in", email };
}
