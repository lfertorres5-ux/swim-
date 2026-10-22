"use server";

import { flashQuery } from "@/lib/flash";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/action-form";
import { AdminError, bool, cents, runAdmin, text } from "@/lib/admin/action";
import { adminCancelBooking, adminReassign, adminRefund, createManualBooking, sendPaymentLink, type ManualBookingInput } from "@/lib/admin/bookings";
import { requireRole } from "@/lib/auth";
import { laWallTimeToUtc, parseTimeOfDay } from "@/lib/time";

export async function refundAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const amount = cents(fd, "amount");
    if (!amount) throw new AdminError("Enter the amount to refund.");
    const r = await adminRefund(user.id, z.guid().parse(fd.get("paymentId")), amount, text(fd, "reason"));
    return r.refundedCents ? `Refunded $${(r.refundedCents / 100).toFixed(2)}.` : "Nothing left to refund on this payment.";
  });
}

export async function cancelAction(_: FormState, fd: FormData): Promise<FormState> {
  const bookingId = z.guid().parse(fd.get("bookingId"));
  let summary = "";
  const state = await runAdmin(async (user) => {
    const r = await adminCancelBooking(user.id, bookingId, {
      refundCents: cents(fd, "refund") ?? 0,
      restoreCredit: bool(fd, "restore_credit"),
      reason: text(fd, "reason"),
      notify: bool(fd, "notify"),
    });
    summary = `Cancelled.${r.refundedCents ? ` Refunded $${(r.refundedCents / 100).toFixed(2)}.` : ""}${r.creditRestored ? " Credit returned to the package." : ""}`;
  });
  // The cancel form disappears once the lesson is cancelled, so show the result on the page.
  if (state.ok) redirect(`/admin/bookings/${bookingId}?${flashQuery("notice", summary)}`);
  return state;
}

export async function reassignAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const r = await adminReassign(user.id, z.guid().parse(fd.get("bookingId")), z.guid({ message: "Pick an instructor" }).parse(fd.get("instructorId")), {
      ignoreBuffer: bool(fd, "ignore_buffer"),
      notify: bool(fd, "notify"),
    });
    return r.changed ? "Reassigned and confirmed." : "No change.";
  });
}

export async function paymentLinkAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const amount = cents(fd, "amount");
    if (!amount || amount < 50) throw new AdminError("Enter at least $0.50.");
    const r = await sendPaymentLink(user.id, z.guid().parse(fd.get("bookingId")), amount);
    return `Payment link emailed. (${r.url})`;
  });
}

export async function createBookingAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireRole("admin");
  let bookingId: string | null = null;
  const state = await runAdmin(async () => {
    const date = text(fd, "date");
    const time = text(fd, "time");
    if (!date || !time) throw new AdminError("Pick a date and start time.");
    const payKind = String(fd.get("payment") ?? "link");
    const amount = cents(fd, "amount");
    const address = text(fd, "line1") ? { line1: text(fd, "line1")!, line2: text(fd, "line2") ?? undefined, city: text(fd, "city") ?? undefined, postalCode: text(fd, "postal_code") ?? undefined, accessNotes: text(fd, "access_notes") ?? undefined } : undefined;
    const input: ManualBookingInput = {
      parentId: String(fd.get("parentId") ?? ""),
      childIds: fd.getAll("childIds").map(String),
      instructorId: String(fd.get("instructorId") ?? ""),
      start: new Date(laWallTimeToUtc(date, parseTimeOfDay(time))).toISOString(),
      durationMinutes: Number(fd.get("duration") ?? 60),
      address,
      payment: payKind === "comp" ? { kind: "comp" } : payKind === "offline" ? { kind: "offline", amountCents: amount ?? 0, note: text(fd, "offline_note") ?? undefined } : { kind: "link", amountCents: amount ?? undefined },
      ignoreBuffer: bool(fd, "ignore_buffer"),
      notify: bool(fd, "notify"),
    };
    const r = await createManualBooking(user.id, input);
    bookingId = r.bookingId;
  });
  if (bookingId) redirect(`/admin/bookings/${bookingId}?created=1`);
  return state;
}
