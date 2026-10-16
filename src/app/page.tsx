import Link from "next/link";
import { InstructorCard } from "@/components/instructor-card";
import { ServiceAreaMap } from "@/components/landing/service-area-map";
import { ZipChecker } from "@/components/landing/zip-checker";
import { brand } from "@/config/brand";
import { loadInstructorCards } from "@/lib/instructor-cards";
import type { GeoJsonPolygon } from "@/lib/geo/san-diego-county";
import { createClient } from "@/lib/supabase/server";

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export default async function Home() {
  const supabase = await createClient();
  const [{ data: prices }, { data: zones }, { data: pricing }, { data: offerings }, { data: settings }, instructors] = await Promise.all([
    supabase.from("lesson_prices").select("duration_minutes, price_cents").eq("is_active", true).order("sort_order"),
    supabase.from("zones").select("code, name, travel_fee_cents, min_booking_minutes, neighborhoods, postal_codes, boundary, map_color").eq("is_bookable", true).order("sort_order"),
    supabase.from("pricing_config").select("*").single(),
    supabase.from("package_offerings").select("name, lesson_count, discount_pct").eq("is_active", true).order("sort_order"),
    supabase.from("platform_settings").select("cancellation_window_hours").single(),
    loadInstructorCards(),
  ]);
  const extra = money(pricing?.extra_child_cents ?? 0);
  const included = pricing?.included_children ?? 2;

  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <span className="font-display text-lg font-semibold text-brand-800">{brand.name}</span>
        <nav className="flex items-center gap-5 text-sm">
          <a href="#pricing" className="hidden text-stone-600 hover:text-stone-900 sm:inline">
            Pricing
          </a>
          <Link href="/login" className="text-stone-600 hover:text-stone-900">
            Sign in
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 pt-6 pb-10 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-14 lg:pb-16">
        <div>
          <h1 className="text-4xl leading-[1.1] font-semibold sm:text-6xl">Swim lessons in your own backyard.</h1>
          <p className="mt-5 max-w-xl text-lg text-stone-600">
            Friendly, certified instructors who come to your pool — from Encinitas and Del Mar to Carlsbad and La Jolla. Babies to swim team, and the nervous ones too.
          </p>
          <div className="mt-7 max-w-md">
            <ZipChecker
              zones={(zones ?? []).map((z) => ({ code: z.code, name: z.name, travelFeeCents: z.travel_fee_cents, minBookingMinutes: z.min_booking_minutes, postalCodes: z.postal_codes }))}
            />
          </div>
        </div>
        <div className="relative hidden lg:block">
          <div className="aspect-[4/5] overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-200 via-brand-100 to-sand-dark">
            {/* Swap in a real photo of a lesson (public/hero.jpg) when you have one. */}
            <svg viewBox="0 0 400 500" className="h-full w-full" aria-hidden>
              <path d="M0 330 C 80 300 140 360 220 330 S 340 300 400 320 V500 H0Z" fill="#78c2c0" opacity=".55" />
              <path d="M0 370 C 90 345 150 400 230 372 S 350 345 400 365 V500 H0Z" fill="#2e8689" opacity=".45" />
              <circle cx="300" cy="110" r="46" fill="#f5936f" opacity=".85" />
            </svg>
          </div>
          {/* Add a real parent testimonial here once you have one — never a made-up quote. */}
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 sm:grid-cols-3">
          {[
            ["Certified & insured", "Every instructor is CPR- and lifeguard-certified, background-checked and covered by our insurance."],
            ["At your pool", "No crowded public pools or driving across town. Kids learn best where they actually swim."],
            ["You'll see the progress", "After every lesson your instructor sends a short note on what your kids worked on."],
          ].map(([title, body]) => (
            <div key={title}>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="mt-1 text-stone-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-3xl font-semibold">Pricing</h2>
        <p className="mt-2 text-stone-600">
          Each lesson covers up to {included} kids. Extra swimmers are {extra} each.
        </p>
        <div className="mt-6 grid grid-cols-3 gap-3 sm:max-w-xl">
          {(prices ?? []).map((p) => (
            <div key={p.duration_minutes} className="card text-center">
              <p className="text-sm text-stone-500">{p.duration_minutes} min</p>
              <p className="mt-1 font-display text-3xl font-semibold">{money(p.price_cents)}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="font-semibold">Save with a package</h3>
            <ul className="mt-2 space-y-1 text-stone-600">
              {(offerings ?? []).map((o) => (
                <li key={o.name}>
                  {o.lesson_count} lessons — {Number(o.discount_pct)}% off
                </li>
              ))}
              <li>Every week, same time — {Number(pricing?.recurring_discount_pct ?? 0)}% off</li>
            </ul>
            <p className="mt-2 text-sm text-stone-500">Packages also get you your instructor&apos;s phone number once they confirm.</p>
          </div>
          <div>
            <h3 className="font-semibold">Good to know</h3>
            <ul className="mt-2 space-y-1 text-stone-600">
              {(zones ?? []).map((z) => (
                <li key={z.code}>
                  {z.name}: {z.travel_fee_cents ? `${money(z.travel_fee_cents)} travel fee` : "no travel fee"}
                  {z.min_booking_minutes ? `, ${z.min_booking_minutes} min minimum` : ""}
                </li>
              ))}
              <li>Book a time next to a neighbor&apos;s lesson and save {money(pricing?.neighborhood_discount_cents ?? 0)}</li>
              <li>Free to cancel or move up to {settings?.cancellation_window_hours ?? 24} hours before</li>
            </ul>
          </div>
        </div>
        <Link href="/book" className="btn-primary mt-8 px-7 py-3 text-base">
          Find a time
        </Link>
      </section>

      {instructors.length > 0 && (
        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="text-3xl font-semibold">Meet the instructors</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {instructors.slice(0, 4).map((i) => (
                <InstructorCard key={i.id} instructor={i} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 className="text-3xl font-semibold">Where we teach</h2>
          <p className="mt-2 text-stone-600">Coastal North County and greater San Diego. Not sure? Pop your ZIP in above.</p>
          <ul className="mt-4 space-y-2 text-sm text-stone-600">
            {(zones ?? []).map((z) => (
              <li key={z.code}>
                <span className="font-medium text-stone-800">{z.name}:</span> {z.neighborhoods.join(", ")}
              </li>
            ))}
          </ul>
        </div>
        <ServiceAreaMap zones={(zones ?? []).map((z) => ({ code: z.code, name: z.name, color: z.map_color, boundary: z.boundary as GeoJsonPolygon | null, travelFeeCents: z.travel_fee_cents }))} />
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-5 py-16">
          <h2 className="text-3xl font-semibold">Questions</h2>
          <dl className="mt-6 divide-y divide-stone-100">
            {[
              ["What do I need?", "Just a pool — yours, a neighbor's or your HOA's. Ideally around 82°F for little ones. We bring everything else."],
              ["How young can my child start?", "Some of our instructors teach babies from 6 months, with a parent in the water."],
              ["Can siblings share a lesson?", `Yes — up to ${included} kids are included, and each extra swimmer is ${extra}.`],
              ["What if we need to cancel?", `Cancel or reschedule free from your account up to ${settings?.cancellation_window_hours ?? 24} hours ahead. If the weather turns, your instructor will reach out.`],
              ["How do I pay?", "Online when you book. You'll get a receipt for every lesson."],
            ].map(([q, a]) => (
              <div key={q} className="py-4">
                <dt className="font-semibold">{q}</dt>
                <dd className="mt-1 text-stone-600">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <footer className="py-10 text-center text-sm text-stone-500">
        {brand.name} · {brand.region} ·{" "}
        <Link href="/day-pass" className="hover:text-stone-800">
          Partner Club Day Pass
        </Link>
      </footer>
    </main>
  );
}
