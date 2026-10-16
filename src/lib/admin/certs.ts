import { daysBetween } from "@/lib/time";

export const CERT_LABELS: Record<string, string> = {
  cpr: "CPR",
  first_aid: "First aid",
  lifeguard: "Lifeguard",
  water_safety_instructor: "Water Safety Instructor",
  swim_instructor: "Swim instructor",
  background_check: "Background check",
  other: "Other",
};

export type CertState = "expired" | "expiring" | "ok" | "no_expiry";

/** Expired, expiring within `warnDays`, fine, or no expiry date. */
export function certState(expiresOn: string | null, today: string, warnDays = 30): { state: CertState; days: number | null } {
  if (!expiresOn) return { state: "no_expiry", days: null };
  const days = daysBetween(today, expiresOn);
  return { state: days < 0 ? "expired" : days <= warnDays ? "expiring" : "ok", days };
}

export const CERT_BADGE: Record<CertState, string> = {
  expired: "bg-red-100 text-red-800",
  expiring: "bg-amber-100 text-amber-900",
  ok: "bg-brand-50 text-brand-800",
  no_expiry: "bg-stone-100 text-stone-600",
};
