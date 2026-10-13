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
    supabase.from("zones").select("code, name, description, travel_fee_cents, min_booking_minutes, neighborhoods, postal_codes, boundary, map_color").eq("is_bookable", true).order("sort_order"),
    supabase.from("pricing_config").select("*").single(),
    supabase.from("package_offerings").select("name, lesson_count, discount_pct").eq("is_active", true).order("sort_order"),
    supabase.from("platform_settings").select("cancellation_window_hours").single(),
    loadInstructorCards(),
  ]);

  const trust = [
    { icon: "🛟", title: "Lifeguard & CPR certified", body: "Every instructor holds current CPR and lifeguard or water-safety certifications — we verify them and track expirations." },
    { icon: "🛡️", title: "Insured & background-checked", body: "Lessons are covered by our liability insurance, and every instructor passes a background check before teaching." },
    { icon: "🏡", title: "In your own pool", body: "No crowded public pools or drive time. Kids learn faster where they actually swim." },
    { icon: "📈", title: "Progress after every lesson", body: "Your instructor sends a skills checklist and notes after each lesson so you can see real progress." },
  ];

  return (
    <main className="flex-1">
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="font-semibold text-sky-800">{brand.name}</span>
          <nav className="flex items-center gap-4 text-sm">
            <a href="#pricing" className="hidden text-slate-700 hover:text-slate-900 sm:inline">Pricing</a>
            <a href="#area" className="hidden text-slate-700 hover:text-slate-900 sm:inline">Service area</a>
            <Link href="/login" className="text-slate-700 hover:text-slate-900">Sign in</Link>
            <Link href="/book" className="btn-primary">Book a lesson</Link>
          </nav>
        </div>
      </header>

      <section className="bg-gradient-to-b from-sky-100 via-sky-50 to-slate-50 pt-24">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-sm font-semibold tracking-wide text-sky-700 uppercase">Private swim lessons · San Diego County</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">Swim lessons in your own backyard pool.</h1>
            <p className="mt-4 text-lg text-slate-600">
              Certified, insured instructors come to you — Encinitas, Carmel Valley, Del Mar, Carlsbad, La Jolla and beyond. Toddlers to stroke technique, nervous swimmers
              welcome.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/book" className="btn-primary px-6 py-3 text-base">
                Find a lesson time
              </Link>
              <a href="#instructors" className="btn-secondary px-6 py-3 text-base">
                Meet our instructors
              </a>
            </div>
          </div>
          <ZipChecker
            zones={(zones ?? []).map((z) => ({ code: z.code, name: z.name, travelFeeCents: z.travel_fee_cents, minBookingMinutes: z.min_booking_minutes, postalCodes: z.postal_codes }))}
          />
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        {trust.map((t) => (
          <div key={t.title} className="card">
            <p className="text-2xl" aria-hidden>
              {t.icon}
            </p>
            <h3 className="mt-2 font-semibold">{t.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{t.body}</p>
          </div>
        ))}
      </section>

      <section className="bg-white py-14">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-2xl font-semibold">How it works</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-4">
            {[
              ["Enter your address", "We confirm you're in our service area and show any travel fee."],
              ["Pick your swimmers & length", "30, 60 or 90 minutes — siblings can share a lesson."],
              ["Choose an instructor & time", "Pick a favorite or take the first available. Look for neighborhood discounts."],
              ["Swim!", "Your instructor confirms, arrives at your pool, and sends progress notes after."],
            ].map(([title, body], i) => (
              <li key={title}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 font-semibold text-white">{i + 1}</span>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-slate-600">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="text-2xl font-semibold">Simple pricing</h2>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="card lg:col-span-2">
            <div className="grid grid-cols-3 gap-4 text-center">
              {(prices ?? []).map((p) => (
                <div key={p.duration_minutes} className="rounded-xl bg-sky-50 p-4">
                  <p className="text-sm text-slate-600">{p.duration_minutes} minutes</p>
                  <p className="mt-1 text-3xl font-semibold text-slate-900">{money(p.price_cents)}</p>
                </div>
              ))}
            </div>
            <ul className="mt-5 space-y-1.5 text-sm text-slate-700">
              <li>✓ Prices cover up to {pricing?.included_children ?? 2} swimmers; each additional swimmer is {money(pricing?.extra_child_cents ?? 0)} per lesson.</li>
              {(offerings ?? []).map((o) => (
                <li key={o.name}>
                  ✓ {o.name}: {Number(o.discount_pct)}% off
                </li>
              ))}
              <li>✓ Weekly recurring lessons: {Number(pricing?.recurring_discount_pct ?? 0)}% off, same time and instructor every week.</li>
              <li>✓ Neighborhood slots — times right next to another lesson nearby — are {money(pricing?.neighborhood_discount_cents ?? 0)} off.</li>
              <li>✓ Free cancellation or rescheduling up to {settings?.cancellation_window_hours ?? 24} hours before a lesson.</li>
            </ul>
          </div>
          <div className="card">
            <h3 className="font-semibold">Travel fees</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {(zones ?? []).map((z) => (
                <li key={z.code} className="flex justify-between gap-2">
                  <span>
                    Zone {z.code} <span className="text-slate-500">· {z.name}</span>
                    {z.min_booking_minutes ? <span className="block text-xs text-slate-500">{z.min_booking_minutes}-min minimum</span> : null}
                  </span>
                  <span className="font-medium">{z.travel_fee_cents ? `+${money(z.travel_fee_cents)}` : "Free"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="area" className="bg-white py-14">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-2xl font-semibold">Where we teach</h2>
            <p className="mt-2 text-slate-600">We teach throughout coastal North County and greater San Diego. Enter your address when booking and we&apos;ll confirm instantly.</p>
            <div className="mt-4 space-y-3 text-sm">
              {(zones ?? []).map((z) => (
                <p key={z.code}>
                  <strong>Zone {z.code}:</strong> <span className="text-slate-600">{z.neighborhoods.join(", ")}</span>
                </p>
              ))}
            </div>
          </div>
          <ServiceAreaMap
            zones={(zones ?? []).map((z) => ({ code: z.code, name: z.name, color: z.map_color, boundary: z.boundary as GeoJsonPolygon | null, travelFeeCents: z.travel_fee_cents }))}
          />
        </div>
      </section>

      {instructors.length > 0 && (
        <section id="instructors" className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="text-2xl font-semibold">Meet our instructors</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {instructors.slice(0, 4).map((i) => (
              <InstructorCard key={i.id} instructor={i} />
            ))}
          </div>
        </section>
      )}

      <section className="bg-white py-14">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-2xl font-semibold">Questions</h2>
          <dl className="mt-6 space-y-5">
            {[
              ["What do I need?", "A pool (yours, a neighbor's or your HOA's) that's warm enough to be comfortable — ideally 82°F or warmer for little ones. We bring the gear."],
              ["How young can my child start?", "Several instructors teach infants from 6 months with a parent in the water. Each instructor's card lists the ages they teach."],
              ["Can siblings share a lesson?", `Yes. Lessons include up to ${pricing?.included_children ?? 2} swimmers; each additional swimmer is ${money(pricing?.extra_child_cents ?? 0)}.`],
              ["What if it rains or I need to cancel?", `Reschedule or cancel free up to ${settings?.cancellation_window_hours ?? 24} hours ahead from your account. For weather on the day, your instructor will message you.`],
              ["How do I pay?", "Securely online when you book. Your instructor never handles payment, and you'll get a receipt for every lesson."],
            ].map(([q, a]) => (
              <div key={q}>
                <dt className="font-semibold">{q}</dt>
                <dd className="mt-1 text-slate-600">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} {brand.name} · {brand.region}
      </footer>
    </main>
  );
}
