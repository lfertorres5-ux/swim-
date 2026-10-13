import Link from "next/link";
import { brand } from "@/config/brand";
import { createClient } from "@/lib/supabase/server";

// Phase 1 placeholder landing. The full San Diego landing page (trust signals,
// pricing, service-area map) ships in Phase 3; prices below already come from
// the database so nothing is hardcoded.
export default async function Home() {
  const supabase = await createClient();
  const [{ data: prices }, { data: zones }] = await Promise.all([
    supabase.from("lesson_prices").select("duration_minutes, price_cents").order("sort_order"),
    supabase.from("zones").select("code, name, travel_fee_cents, neighborhoods").eq("is_bookable", true).order("sort_order"),
  ]);

  return (
    <main className="flex-1">
      <section className="bg-gradient-to-b from-sky-100 to-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <p className="text-sm font-semibold tracking-wide text-sky-700 uppercase">{brand.region}</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Private swim lessons in your own backyard pool.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-slate-600">
            CPR- and lifeguard-certified, insured instructors who come to you — from Encinitas to Del Mar and beyond.
          </p>
          <div className="mt-8 flex gap-3">
            <Link href="/login?next=/parent" className="btn-primary">
              Book a lesson
            </Link>
            <Link href="/login" className="btn-secondary">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-6 py-12 sm:grid-cols-2">
        <div className="card">
          <h2 className="font-semibold">Lesson pricing</h2>
          <ul className="mt-3 space-y-1 text-slate-700">
            {(prices ?? []).map((p) => (
              <li key={p.duration_minutes} className="flex justify-between">
                <span>{p.duration_minutes} minutes (1–2 kids)</span>
                <span className="font-medium">${(p.price_cents / 100).toFixed(0)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2 className="font-semibold">Service area</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {(zones ?? []).map((z) => (
              <li key={z.code}>
                <span className="font-medium">
                  Zone {z.code} · {z.travel_fee_cents ? `+$${z.travel_fee_cents / 100} travel` : "no travel fee"}
                </span>
                <span className="block text-slate-500">{z.neighborhoods.join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
