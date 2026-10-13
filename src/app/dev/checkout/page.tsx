import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { fulfillPayment, releaseCheckout } from "@/lib/booking/checkout";
import { devPaymentsEnabled, paymentsGateway } from "@/lib/payments/gateway";
import { createClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/utils";

/** Simulated Stripe Checkout for local development (PAYMENTS_DEV_MODE=true). */
export default async function DevCheckout({ searchParams }: PageProps<"/dev/checkout">) {
  if (!devPaymentsEnabled() || process.env.STRIPE_SECRET_KEY) notFound();
  await requireRole("parent");
  const { session } = await searchParams;
  if (typeof session !== "string") notFound();
  const supabase = await createClient();
  const { data: payment } = await supabase.from("payments").select("id, amount_cents, description, status").eq("stripe_checkout_session_id", session).maybeSingle();
  if (!payment) notFound();

  async function pay() {
    "use server";
    await requireRole("parent");
    const details = await paymentsGateway().completedCheckout(session as string);
    await fulfillPayment({ ...details, paymentId: payment!.id, amountTotal: payment!.amount_cents });
    redirect(`/parent/bookings/confirmed?session_id=${session}`);
  }
  async function cancel() {
    "use server";
    await requireRole("parent");
    await releaseCheckout(payment!.id);
    redirect("/book/cancelled");
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-16">
      <p className="badge w-fit bg-amber-100 text-amber-800">Development mode — no real payment</p>
      <h1 className="text-2xl font-semibold">{formatCents(payment.amount_cents)}</h1>
      <p className="text-stone-600">{payment.description}</p>
      {payment.status === "pending" ? (
        <div className="flex gap-3">
          <form action={pay}>
            <button className="btn-primary">Pay (simulated)</button>
          </form>
          <form action={cancel}>
            <button className="btn-secondary">Cancel</button>
          </form>
        </div>
      ) : (
        <p className="text-stone-600">This checkout is {payment.status}.</p>
      )}
    </main>
  );
}
