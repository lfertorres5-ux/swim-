"use server";

import { z } from "zod";
import type { FormState } from "@/components/action-form";
import { AdminError, adminAudit, bool, cents, check, runAdmin, text } from "@/lib/admin/action";
import { notifyInstructorInvite, safely } from "@/lib/notifications/events";
import { createAdminClient } from "@/lib/supabase/admin";

const CERT_KINDS = ["cpr", "first_aid", "lifeguard", "water_safety_instructor", "swim_instructor", "background_check", "other"] as const;

export async function inviteInstructor(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const email = z.email("Enter a valid email").parse(text(fd, "email")?.toLowerCase());
    const rate = cents(fd, "pay_rate");
    const admin = createAdminClient();
    const { data: existing } = await admin.from("users").select("role").ilike("email", email).maybeSingle();
    if (existing) throw new AdminError(existing.role === "instructor" ? "That person is already an instructor." : "That email already has a family account. Ask them to use a different email to teach.");
    const { data: invite, error } = await admin
      .from("instructor_invites")
      .insert({ email, invited_by: user.id, pay_rate_cents_per_hour: rate })
      .select("id")
      .single();
    check(error, { "23505": "There's already a pending invite for that email." });
    await adminAudit(user.id, "admin.invite_instructor", "instructor_invite", invite!.id, { email, pay_rate_cents_per_hour: rate });
    await safely("invite", () => notifyInstructorInvite(invite!.id, email));
    return `Invite sent to ${email}.`;
  });
}

export async function revokeInvite(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const id = z.guid().parse(fd.get("id"));
    const admin = createAdminClient();
    // Expire instead of delete so the history stays.
    check((await admin.from("instructor_invites").update({ expires_at: new Date().toISOString() }).eq("id", id).is("accepted_at", null)).error);
    await adminAudit(user.id, "admin.revoke_invite", "instructor_invite", id);
    return "Invite cancelled.";
  });
}

export async function setInstructorActive(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const id = z.guid().parse(fd.get("id"));
    const activate = fd.get("active") === "true";
    const reason = text(fd, "reason");
    const admin = createAdminClient();

    if (activate) {
      const { data: i } = await admin.from("instructors").select("photo_path, bio").eq("id", id).single();
      if (!i?.photo_path || (i.bio ?? "").trim().length < 40) throw new AdminError("They need a photo and a bio (40+ characters) before they can be active.");
    }
    const { error } = await admin.from("instructors").update({ is_active: activate }).eq("id", id);
    check(error, { instructors_profile_complete_when_active: "They need a photo and a bio (40+ characters) before they can be active." });
    await admin
      .from("instructor_private")
      .update(activate ? { deactivated_at: null, deactivation_reason: null } : { deactivated_at: new Date().toISOString(), deactivation_reason: reason })
      .eq("instructor_id", id);

    let flagged = 0;
    if (!activate) {
      // Their upcoming lessons need a new instructor — surface them on the dashboard.
      const { data } = await admin
        .from("bookings")
        .update({ needs_attention: true, attention_reason: "Instructor was deactivated — reassign" })
        .eq("instructor_id", id)
        .in("status", ["pending_instructor", "confirmed"])
        .gt("starts_at", new Date().toISOString())
        .select("id");
      flagged = data?.length ?? 0;
      await admin.from("open_shifts").update({ status: "cancelled" }).eq("released_by", id).in("status", ["open", "pending_approval"]);
    }
    await adminAudit(user.id, activate ? "admin.activate_instructor" : "admin.deactivate_instructor", "instructor", id, { reason, flagged_lessons: flagged });
    return activate ? "Activated — they're now bookable." : flagged ? `Deactivated. ${flagged} upcoming lesson${flagged === 1 ? "" : "s"} flagged for reassignment.` : "Deactivated.";
  });
}

export async function setPayRate(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const id = z.guid().parse(fd.get("id"));
    const rate = cents(fd, "pay_rate");
    if (rate === null || rate > 50_000) throw new AdminError("Enter an hourly rate up to $500.");
    const admin = createAdminClient();
    const { data: before } = await admin.from("instructor_private").select("pay_rate_cents_per_hour").eq("instructor_id", id).single();
    check((await admin.from("instructor_private").update({ pay_rate_cents_per_hour: rate }).eq("instructor_id", id)).error);
    await adminAudit(user.id, "admin.set_pay_rate", "instructor", id, { from: before?.pay_rate_cents_per_hour, to: rate });
    return `Pay rate set to $${(rate / 100).toFixed(2)}/hr. Applies to lessons completed from now on.`;
  });
}

export async function addCertification(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const input = z
      .object({
        instructor_id: z.guid(),
        kind: z.enum(CERT_KINDS),
        issuer: z.string().max(120).nullable(),
        issued_on: z.iso.date().nullable(),
        expires_on: z.iso.date().nullable(),
      })
      .parse({ instructor_id: fd.get("id"), kind: fd.get("kind"), issuer: text(fd, "issuer"), issued_on: text(fd, "issued_on"), expires_on: text(fd, "expires_on") });
    const verified = bool(fd, "verified");
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("instructor_certifications")
      .insert({ ...input, verified_at: verified ? new Date().toISOString() : null, verified_by: verified ? user.id : null })
      .select("id")
      .single();
    check(error, { "23514": "The expiration date must be after the issue date." });
    await adminAudit(user.id, "admin.add_certification", "instructor_certification", data!.id, { instructor_id: input.instructor_id, kind: input.kind, expires_on: input.expires_on });
    return "Certification added.";
  });
}

export async function verifyCertification(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const id = z.guid().parse(fd.get("certId"));
    const verify = fd.get("verify") !== "false";
    const admin = createAdminClient();
    check((await admin.from("instructor_certifications").update(verify ? { verified_at: new Date().toISOString(), verified_by: user.id } : { verified_at: null, verified_by: null }).eq("id", id)).error);
    await adminAudit(user.id, verify ? "admin.verify_certification" : "admin.unverify_certification", "instructor_certification", id);
    return verify ? "Verified." : "Marked unverified.";
  });
}

export async function deleteCertification(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const id = z.guid().parse(fd.get("certId"));
    const admin = createAdminClient();
    check((await admin.from("instructor_certifications").delete().eq("id", id)).error);
    await adminAudit(user.id, "admin.delete_certification", "instructor_certification", id);
    return "Removed.";
  });
}

