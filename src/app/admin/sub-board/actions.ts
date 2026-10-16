"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/action-form";
import { AdminError, runAdmin, text } from "@/lib/admin/action";
import { decideShift } from "@/lib/sub-board";
import { createClient } from "@/lib/supabase/server";

export async function decideShiftAction(_: FormState, fd: FormData): Promise<FormState> {
  const approve = fd.get("decision") === "approve";
  const state = await runAdmin(async () => {
    // Runs as the signed-in admin: decide_open_shift checks the role and writes the audit row.
    const r = await decideShift(await createClient(), z.guid().parse(fd.get("shiftId")), approve, text(fd, "note"));
    if (!r.ok) throw new AdminError(r.error);
  });
  // The shift leaves the "waiting" list, so confirm with a banner after a redirect.
  if (state.ok) redirect(`/admin/sub-board?done=${approve ? "approved" : "rejected"}`);
  return state;
}
