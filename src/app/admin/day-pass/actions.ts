"use server";

import type { FormState } from "@/components/action-form";
import { bool, cents, runAdmin, text } from "@/lib/admin/action";
import { updateInquiry } from "@/lib/day-pass";

export async function updateInquiryAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const sendLink = bool(fd, "send_link");
    const r = await updateInquiry(user.id, {
      id: String(fd.get("id")),
      status: String(fd.get("status")) as never,
      quotedAmountCents: cents(fd, "quote"),
      paymentLinkUrl: text(fd, "payment_link"),
      adminNotes: text(fd, "admin_notes"),
      sendLink,
      messageToFamily: text(fd, "message_to_family"),
    });
    return sendLink ? "Payment link emailed to the family." : `Saved (${r.status.replaceAll("_", " ")}).`;
  });
}
