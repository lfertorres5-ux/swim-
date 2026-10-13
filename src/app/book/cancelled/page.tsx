import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { releaseCheckout } from "@/lib/booking/checkout";
import { createClient } from "@/lib/supabase/server";

/** Stripe cancel_url: the parent backed out of Checkout — free the held slot now. */
export default async function CheckoutCancelled({ searchParams }: PageProps<"/book/cancelled">) {
  await requireRole("parent", "/book");
  const { payment } = await searchParams;
  if (typeof payment === "string") {
    // RLS: only resolves if this payment belongs to the signed-in parent.
    const supabase = await createClient();
    const { data } = await supabase.from("payments").select("id, status").eq("id", payment).maybeSingle();
    if (data?.status === "pending") await releaseCheckout(data.id);
  }
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Payment cancelled</h1>
      <p className="text-stone-600">No charge was made and the time you picked has been released.</p>
      <Link href="/book" className="btn-primary w-fit">
        Start over
      </Link>
    </main>
  );
}
