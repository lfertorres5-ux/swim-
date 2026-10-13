"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { offerNextInstructor } from "@/lib/scheduling/offers";
import { createClient } from "@/lib/supabase/server";

export async function respondToRequest(formData: FormData) {
  await requireRole("instructor");
  const offerId = z.uuid().parse(formData.get("offerId"));
  const accept = formData.get("decision") === "accept";
  const reason = String(formData.get("reason") ?? "").slice(0, 500) || null;

  const supabase = await createClient();
  // Read the booking id first (RLS: own offers only); after a decline the
  // booking is no longer visible to this instructor.
  const { data: offer } = await supabase.from("booking_offers").select("booking_id").eq("id", offerId).maybeSingle();
  const { data: outcome, error } = await supabase.rpc("respond_to_booking_offer", {
    p_offer_id: offerId,
    p_accept: accept,
    p_reason: reason,
  });

  if (error) {
    redirect(`/instructor/requests?error=${encodeURIComponent(error.code === "SB002" ? "That request was already answered or reassigned." : "Couldn't record your response.")}`);
  }

  if (outcome !== "accepted" && offer?.booking_id) {
    try {
      await offerNextInstructor(offer.booking_id);
    } catch (err) {
      // The cron retries bookings left without an offer, so this is recoverable.
      console.error("auto-offer after decline failed", err);
    }
  }

  revalidatePath("/instructor", "layout");
  redirect(`/instructor/requests?done=${outcome}`);
}
