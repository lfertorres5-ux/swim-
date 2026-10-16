"use server";

import type { FormState } from "@/components/action-form";
import { getCurrentUser } from "@/lib/auth";
import { submitDayPassInquiry } from "@/lib/day-pass";

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
  );
  return r.ok ? { ok: true, message: "sent" } : { error: r.error };
}
