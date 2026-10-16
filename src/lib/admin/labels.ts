export const BOOKING_STATUS: Record<string, { label: string; cls: string }> = {
  pending_payment: { label: "Awaiting payment", cls: "bg-stone-100 text-stone-600" },
  pending_instructor: { label: "Awaiting instructor", cls: "bg-amber-100 text-amber-900" },
  confirmed: { label: "Confirmed", cls: "bg-brand-50 text-brand-800" },
  completed: { label: "Completed", cls: "bg-stone-100 text-stone-700" },
  cancelled: { label: "Cancelled", cls: "bg-red-50 text-red-700" },
  no_show: { label: "No-show", cls: "bg-red-50 text-red-700" },
  expired: { label: "Expired", cls: "bg-stone-100 text-stone-500" },
};

export const PAYMENT_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Unpaid", cls: "bg-amber-100 text-amber-900" },
  succeeded: { label: "Paid", cls: "bg-brand-50 text-brand-800" },
  partially_refunded: { label: "Partly refunded", cls: "bg-stone-100 text-stone-700" },
  refunded: { label: "Refunded", cls: "bg-stone-100 text-stone-700" },
  failed: { label: "Failed", cls: "bg-red-50 text-red-700" },
  cancelled: { label: "Void", cls: "bg-stone-100 text-stone-500" },
};
