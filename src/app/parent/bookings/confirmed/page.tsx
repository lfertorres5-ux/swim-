import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { fulfillPayment } from "@/lib/booking/checkout";
import { paymentsGateway } from "@/lib/payments/gateway";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";

/**
 * Stripe success_url. Fulfillment normally happens via the webhook; we also
 * run it here (idempotent) so the parent sees a confirmed state immediately.
 */
export default async function BookingConfirmed({ searchParams }: PageProps<"/parent/bookings/confirmed">) {
  const user = await requireRole("parent");
  const { session_id: sessionId, booking, payment: paymentParam } = await searchParams;
  const supabase = await createClient();

  let paymentId: string | null = null;
  let packageId: string | null = null;
  if (typeof sessionId === "string") {
    const { data: payment } = await supabase.from("payments").select("id, status, package_id").eq("stripe_checkout_session_id", sessionId).maybeSingle();
    if (payment) {
      paymentId = payment.id;
      packageId = payment.package_id;
      if (payment.status === "pending") {
        const details = await paymentsGateway().completedCheckout(sessionId);
        if (details.paid && details.paymentId === payment.id) await fulfillPayment({ ...details, paymentId: payment.id });
      }
    }
  }

  // HSA/FSA (Truemed) returns here with our payment id; fulfillment waits for Truemed's webhook.
  if (!paymentId && typeof paymentParam === "string" && /^[0-9a-f-]{36}$/i.test(paymentParam)) {
    const { data: payment } = await supabase.from("payments").select("id, package_id").eq("id", paymentParam).maybeSingle();
    if (payment) {
      paymentId = payment.id;
      packageId = payment.package_id;
    }
  }

  const query = supabase
    .from("bookings")
    .select("id, starts_at, status, kind, instructor:instructors!bookings_instructor_id_fkey(first_name)")
    .eq("parent_id", user.id)
    .order("starts_at");
  const { data: lessons } = paymentId
    ? packageId
      ? await query.eq("package_id", packageId)
      : await query.eq("payment_id", paymentId)
    : typeof booking === "string"
      ? await query.eq("id", booking)
      : { data: [] };

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">You&apos;re booked!</h1>
      <p className="mt-2 text-stone-600">We&apos;ve sent your request to your instructor. You&apos;ll get a confirmation as soon as they accept (usually within a few hours).</p>
      <ul className="mt-6 space-y-2">
        {(lessons ?? []).map((l) => {
          const instructor = Array.isArray(l.instructor) ? l.instructor[0] : l.instructor;
          return (
            <li key={l.id} className="card flex justify-between text-sm">
              <span>
                {formatDateTime(l.starts_at)}
                {instructor ? ` · ${instructor.first_name}` : ""}
              </span>
              <span className="badge bg-brand-50 text-brand-700">{l.status === "pending_payment" ? "confirming payment" : l.status.replace("_", " ")}</span>
            </li>
          );
        })}
      </ul>
      <Link href="/parent" className="btn-primary mt-8 w-fit">
        Go to my lessons
      </Link>
    </main>
  );
}
