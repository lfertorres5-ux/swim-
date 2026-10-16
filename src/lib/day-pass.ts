import "server-only";
import { z } from "zod";
import { notifyDayPassInquiry, notifyDayPassPaymentLink, safely } from "@/lib/notifications/events";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, laDateString } from "@/lib/time";

/**
 * Partner Club Day Pass — inquiry only. Families ask; the owner checks with
 * the club, quotes member-family pricing, and sends a Stripe payment link by
 * hand. Nothing is ever instant-booked or charged from this form.
 */
export const dayPassInquirySchema = z.object({
  contactName: z.string().trim().min(2, "Your name, please").max(80),
  contactEmail: z.email("Enter a valid email").max(200),
  contactPhone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v.replace(/[^\d+]/g, "") : undefined))
    .refine((v) => !v || /^\+?1?\d{10}$/.test(v), "Enter a 10-digit phone number"),
  adults: z.number().int().min(0).max(20),
  children: z.number().int().min(0).max(20),
  preferredDates: z.array(z.iso.date()).max(6).default([]),
  interestLevel: z.enum(["just_curious", "interested", "ready_to_book"]),
  message: z.string().trim().max(1000).optional(),
  /** Honeypot: humans never see or fill this. */
  website: z.string().max(0).optional(),
});
export type DayPassInquiryInput = z.input<typeof dayPassInquirySchema>;

export const MAX_INQUIRIES_PER_DAY = 3;

export type InquiryResult = { ok: true; id: string | null } | { ok: false; error: string };

export async function submitDayPassInquiry(raw: DayPassInquiryInput, parentId: string | null, now = Date.now()): Promise<InquiryResult> {
  const admin = createAdminClient();
  const { data: settings } = await admin.from("platform_settings").select("day_pass_enabled").single();
  if (!settings?.day_pass_enabled) return { ok: false, error: "Day pass inquiries are paused right now." };

  // Bots fill the honeypot; pretend it worked.
  if (raw && typeof raw === "object" && "website" in raw && raw.website) return { ok: true, id: null };
  const parsed = dayPassInquirySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const q = parsed.data;
  if (q.adults + q.children < 1) return { ok: false, error: "Tell us how many people are coming." };
  const today = laDateString(new Date(now));
  if (q.preferredDates.some((d) => d < today || d > addDays(today, 365))) return { ok: false, error: "Pick dates in the next year." };

  const since = new Date(now - 86_400_000).toISOString();
  const { count } = await admin.from("day_pass_inquiries").select("id", { count: "exact", head: true }).ilike("contact_email", q.contactEmail).gte("created_at", since);
  if ((count ?? 0) >= MAX_INQUIRIES_PER_DAY) return { ok: false, error: "We already have your inquiry — we'll be in touch soon." };

  const phone = q.contactPhone ? (q.contactPhone.startsWith("+") ? q.contactPhone : `+1${q.contactPhone.replace(/^1/, "")}`) : null;
  const { data, error } = await admin
    .from("day_pass_inquiries")
    .insert({
      parent_id: parentId,
      contact_name: q.contactName,
      contact_email: q.contactEmail.toLowerCase(),
      contact_phone: phone,
      adults_count: q.adults,
      children_count: q.children,
      preferred_dates: [...new Set(q.preferredDates)].sort(),
      interest_level: q.interestLevel,
      message: q.message || null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Something went wrong. Please try again." };
  await safely("day pass inquiry", () => notifyDayPassInquiry(data.id));
  return { ok: true, id: data.id as string };
}

export const inquiryUpdateSchema = z.object({
  id: z.guid(),
  status: z.enum(["new", "contacted", "approved", "payment_link_sent", "paid", "declined", "closed"]),
  quotedAmountCents: z.number().int().min(0).max(10_000_00).nullable(),
  paymentLinkUrl: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .refine((v) => !v || /^https:\/\/\S+$/.test(v), "Paste the full https:// payment link"),
  adminNotes: z.string().trim().max(2000).nullable(),
  sendLink: z.boolean().default(false),
  messageToFamily: z.string().trim().max(500).nullable().default(null),
});

export async function updateInquiry(actorId: string, raw: z.input<typeof inquiryUpdateSchema>) {
  const input = inquiryUpdateSchema.parse(raw);
  if (input.sendLink && !input.paymentLinkUrl) throw new Error("Paste the Stripe payment link first.");
  const admin = createAdminClient();
  const status = input.sendLink ? "payment_link_sent" : input.status;
  const { error } = await admin
    .from("day_pass_inquiries")
    .update({ status, quoted_amount_cents: input.quotedAmountCents, stripe_payment_link_url: input.paymentLinkUrl || null, admin_notes: input.adminNotes || null, handled_by: actorId })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
  await admin.from("audit_log").insert({
    actor_id: actorId,
    actor_role: "admin",
    action: input.sendLink ? "admin.day_pass_send_link" : "admin.day_pass_update",
    entity_type: "day_pass_inquiry",
    entity_id: input.id,
    metadata: { status, quoted_amount_cents: input.quotedAmountCents },
  });
  if (input.sendLink) await safely("day pass link", () => notifyDayPassPaymentLink(input.id, input.messageToFamily));
  return { status };
}
