import Link from "next/link";
import { InstructorCard } from "@/components/instructor-card";
import { AreaSearch } from "@/components/landing/area-search";
import { ZipChecker } from "@/components/landing/zip-checker";
import { brand } from "@/config/brand";
import { PHOTOS } from "@/content/photos";
import { getContact } from "@/lib/contact";
import { hsaFsaAvailable } from "@/lib/booking/checkout";
import { LaneRope, TileBand, WaveEdge } from "@/components/motifs";
import { Photo } from "@/components/photo";
import { SiteFooter } from "@/components/site-footer";
import { loadInstructorCards } from "@/lib/instructor-cards";
import { createClient } from "@/lib/supabase/server";

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export default async function Home() {
  const supabase = await createClient();
  const [{ data: prices }, { data: zones }, { data: pricing }, { data: offerings }, { data: settings }, instructors] = await Promise.all([
    supabase.from("lesson_prices").select("duration_minutes, price_cents").eq("is_active", true).order("sort_order"),
    supabase.from("zones").select("code, name, travel_fee_cents, min_booking_minutes, neighborhoods, postal_codes, map_color").eq("is_bookable", true).order("sort_order"),
    supabase.from("pricing_config").select("*").single(),
    supabase.from("package_offerings").select("name, lesson_count, discount_pct").eq("is_active", true).order("sort_order"),
    supabase.from("platform_settings").select("cancellation_window_hours").single(),
    loadInstructorCards(),
  ]);
  const [contact, hsaFsa] = await Promise.all([getContact(), hsaFsaAvailable()]);
  const extra = money(pricing?.extra_child_cents ?? 0);
  const included = pricing?.included_children ?? 2;

  const cancelHours = settings?.cancellation_window_hours ?? 24;
  const faqs: [string, string][] = [
    ["What do I need?", "A pool — yours, a neighbor's or your HOA's — ideally with steps or a shallow area so little swimmers can stand and get in safely, and warm water (around 82–86°F for young kids). We bring the kickboards and everything else."],
    ["We don't have a pool. Can we still take lessons?", "In certain cases, yes: we can teach at one of our partner country club pools. Get in touch and we'll let you know what's possible for your family and schedule."],
    ["How young can my child start?", "Some of our instructors teach babies from 6 months, with a parent in the water."],
    ["Can siblings share a lesson?", `Yes — up to ${included} kids are included, and each extra swimmer is ${extra}.`],
    ["What if we need to cancel?", `Cancel or reschedule free from your account up to ${cancelHours} hours ahead. If the weather turns, your instructor will reach out.`],
    ["How do I pay?", hsaFsa ? "Online when you book, by card or with your HSA/FSA card through Truemed. You'll get a receipt for every lesson." : "Online when you book. You'll get a receipt for every lesson."],
    ...(hsaFsa
      ? ([["Can I use my HSA or FSA?", "Possibly. Swim lessons may qualify for HSA/FSA funds when they're recommended for a health reason. At checkout, choose “HSA / FSA card”: Truemed asks a few quick health questions, and if a licensed provider approves, you pay with your HSA/FSA card. If not, you can pay by card instead."]] as [string, string][])
      : []),
  ];

  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
        <span className="font-display text-lg font-semibold text-brand-800">{brand.name}</span>
        <nav className="flex items-center gap-5 text-sm">
          <a href="#pricing" className="hidden text-stone-600 hover:text-stone-900 sm:inline">
            Pricing
          </a>
          <a href="#contact" className="hidden text-stone-600 hover:text-stone-900 sm:inline">
            Contact
          </a>
          <Link href="/login" className="text-stone-600 hover:text-stone-900">
            Sign in
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid w-full max-w-6xl gap-12 px-5 pt-4 pb-14 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-12 lg:pb-20">
        <div>
          <h1 className="text-4xl leading-[1.05] font-semibold sm:text-6xl">
            Swim lessons in{" "}
            <span className="relative whitespace-nowrap">
              your own backyard.
              <svg aria-hidden viewBox="0 0 300 18" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-3 w-full text-coral-400">
                <path d="M3 12 C 60 3 120 16 180 8 S 270 6 297 10" stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" />
              </svg>
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-stone-600">
            Friendly, certified instructors who come to your pool — from Encinitas and Del Mar to Carlsbad and La Jolla. Babies to swim team, and the nervous ones too.
          </p>
          <div className="mt-7 max-w-md">
            <ZipChecker
              zones={(zones ?? []).map((z) => ({ code: z.code, name: z.name, travelFeeCents: z.travel_fee_cents, minBookingMinutes: z.min_booking_minutes, postalCodes: z.postal_codes }))}
            />
          </div>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-600">
            <li>✓ CPR & lifeguard certified</li>
            <li>✓ Free to reschedule {cancelHours}h ahead</li>
            <li>✓ Progress notes after every lesson</li>
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <Photo photo={PHOTOS.hero} priority className="pool-shape aspect-[4/5] w-full shadow-[0_30px_60px_-30px_rgba(15,94,115,0.55)]" />
          <div className="absolute -bottom-6 -left-3 w-[42%] rotate-[-5deg] rounded-2xl bg-white p-2 pb-3 shadow-xl sm:-left-8">
            <Photo photo={PHOTOS.splash} tone="dusk" className="aspect-square w-full rounded-xl" sizes="200px" />
            <p className="note mt-2 text-center text-sm">we bring the kickboards</p>
          </div>
          <div className="absolute -top-3 right-2 flex h-24 w-24 rotate-[10deg] flex-col items-center justify-center rounded-full bg-coral-500 text-center text-[11px] leading-tight font-semibold text-white uppercase shadow-lg sm:right-6">
            <span className="font-display text-2xl leading-none normal-case">1:1</span>
            or siblings
          </div>
        </div>
      </section>

      {/* Why us — three lanes */}
      <section className="bg-white">
        <TileBand />
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-px overflow-hidden rounded-3xl bg-stone-200 sm:grid-cols-3">
            {[
              ["Certified & insured", "Every instructor is CPR- and lifeguard-certified, background-checked and covered by our insurance."],
              ["At your pool", "No crowded public pools or driving across town. Kids learn best where they actually swim."],
              ["You'll see the progress", "After every lesson your instructor sends a short note on what your kids worked on."],
            ].map(([title, text], i) => (
              <div key={title} className="relative bg-white p-6 pt-10">
                <span className="absolute top-4 left-6 font-display text-sm font-semibold text-brand-500">Lane {i + 1}</span>
                <span aria-hidden className="absolute top-0 right-6 bottom-0 w-1.5 bg-[repeating-linear-gradient(to_bottom,var(--color-lane-blue)_0_10px,#fff_10px_20px)] opacity-60" />
                <h3 className="pr-8 text-xl font-semibold">{title}</h3>
                <p className="mt-2 pr-8 text-stone-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <WaveEdge fill="var(--color-sand)" className="-mt-px bg-white" />

      {/* How we're different */}
      <section id="different" className="mx-auto w-full max-w-6xl px-5 pt-16">
        <div className="relative overflow-hidden rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-stone-200/70 sm:p-10">
          <span aria-hidden className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-brand-50" />
          <div className="relative">
            <h2 className="max-w-2xl text-3xl font-semibold sm:text-4xl">San Diego&apos;s best swimmers, in your backyard.</h2>
            <p className="mt-3 max-w-2xl text-stone-600">
              We&apos;re local swimmers who care about one thing: giving every family access to swimming taught by the very best instructors.
            </p>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Local swimmers", "We swim here too. This is our community's pools, beaches and kids, not a territory on a map."],
                ["Small on purpose", "Staying local lets us be choosy. We only bring on the most capable instructors, not whoever's available."],
                ["Partners, not employees", "Our instructors are partners in the business. They choose to teach here and own the results with you."],
                ["Quality, every lesson", "Every lesson ends with a progress note, and every instructor's certifications are tracked and kept current."],
              ].map(([title, text], i) => (
                <div key={title}>
                  <span className="font-display text-3xl font-semibold text-coral-500">0{i + 1}</span>
                  <h3 className="mt-2 text-lg font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-stone-600">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Vetting */}
      <section id="vetting" className="mx-auto w-full max-w-6xl px-5 py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-start">
          <div className="lg:sticky lg:top-8">
            <h2 className="text-3xl font-semibold sm:text-4xl">Who&apos;s in the water with your kids</h2>
            <p className="mt-3 text-stone-600">
              Every instructor is a former <strong className="text-stone-900">NCAA Division I and/or national-level competitive swimmer</strong>. Speed in the pool is only the start. Before anyone
              teaches a lesson, they pass every step below.
            </p>
            <div className="mt-6 flex items-center gap-4 rounded-3xl bg-brand-800 p-5 text-white">
              <span className="font-display text-5xl leading-none font-semibold text-coral-400">D1</span>
              <span className="text-sm text-brand-100">
                and national-level athletes only, who also know how to teach a nervous four-year-old.
              </span>
            </div>
          </div>
          <ol className="relative space-y-3">
            <span aria-hidden className="absolute top-4 bottom-4 left-[19px] w-[3px] rounded-full bg-[repeating-linear-gradient(to_bottom,var(--color-lane-blue)_0_8px,#fff_8px_14px)] ring-1 ring-stone-200" />
            {[
              ["Elite competitive background", "NCAA Division I and/or national-level meet experience, confirmed against published results and rosters."],
              ["Lifeguard + CPR/AED + First Aid", "Current American Red Cross (or equivalent) lifeguarding and CPR/AED/First Aid certification, kept on file and tracked to expiry."],
              ["Certified swim instructor", "Water Safety Instructor (WSI) or an equivalent learn-to-swim teaching certification."],
              ["Background check", "A national criminal background check and sex-offender registry search before activation."],
              ["In-water audition", "A live teaching session with a real student, reviewed by the owner: patience, safety habits and how they handle a nervous swimmer."],
              ["Reference checks", "Two references from coaches, employers or families they've taught."],
              ["Ongoing standards", "Certifications re-checked before they expire, and family progress notes read after every lesson."],
            ].map(([title, text], i) => (
              <li key={title} className="relative flex gap-4 rounded-2xl bg-white p-4 pr-5 shadow-sm ring-1 ring-stone-200/70">
                <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-coral-500 font-display text-sm font-semibold text-white ring-4 ring-sand">{i + 1}</span>
                <span>
                  <span className="block font-semibold text-stone-900">{title}</span>
                  <span className="mt-0.5 block text-sm text-stone-600">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto w-full max-w-6xl px-5 py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-start">
          <div>
            <h2 className="text-3xl font-semibold sm:text-4xl">Simple, honest pricing</h2>
            <p className="mt-3 text-stone-600">
              Each lesson covers up to {included} kids. Extra swimmers are {extra} each. No membership, no sign-up fee.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {(prices ?? []).map((p) => (
                <div key={p.duration_minutes} className="relative overflow-hidden rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-stone-200/70">
                  <span aria-hidden className="absolute inset-x-0 top-0 h-1.5 bg-brand-500" />
                  <p className="text-sm text-stone-500">{p.duration_minutes} min</p>
                  <p className="mt-1 font-display text-3xl font-semibold">{money(p.price_cents)}</p>
                </div>
              ))}
            </div>
            <Link href="/book" className="btn-primary mt-8 px-7 py-3 text-base">
              Find a time
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl bg-brand-800 p-6 text-brand-50">
              <p className="text-xs font-semibold tracking-wide text-brand-200 uppercase">Swim pass</p>
              <h3 className="mt-1 text-xl font-semibold text-white">Save with a package</h3>
              <ul className="mt-4 space-y-2">
                {(offerings ?? []).map((o) => (
                  <li key={o.name} className="flex items-center justify-between border-b border-dashed border-brand-600 pb-2">
                    <span>{o.lesson_count} lessons</span>
                    <span className="rounded-full bg-coral-500 px-2.5 py-0.5 text-sm font-semibold text-white">{Number(o.discount_pct)}% off</span>
                  </li>
                ))}
                <li className="flex items-center justify-between">
                  <span>Every week, same time</span>
                  <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-sm font-semibold">{Number(pricing?.recurring_discount_pct ?? 0)}% off</span>
                </li>
              </ul>
              <p className="mt-4 text-sm text-brand-200">Packages also get you your instructor&apos;s phone number once they confirm.</p>
            </div>
            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200/70">
              <h3 className="text-xl font-semibold">Good to know</h3>
              <ul className="mt-4 space-y-2.5 text-sm text-stone-600">
                {(zones ?? []).map((z) => (
                  <li key={z.code}>
                    <span className="font-medium text-stone-800">{z.name}:</span> {z.travel_fee_cents ? `${money(z.travel_fee_cents)} travel fee` : "no travel fee"}
                    {z.min_booking_minutes ? `, ${z.min_booking_minutes} min minimum` : ""}
                  </li>
                ))}
                <li>Book a time next to a neighbor&apos;s lesson and save {money(pricing?.neighborhood_discount_cents ?? 0)}</li>
                <li>Free to cancel or move up to {cancelHours} hours before</li>
                {hsaFsa && <li className="font-medium text-brand-800">Pay with HSA/FSA through Truemed, if your lessons qualify</li>}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-5">
        <LaneRope count={36} />
      </div>

      {instructors.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-5 py-16">
          <div className="grid gap-8 lg:grid-cols-[280px_1fr] lg:items-start">
            <div>
              <h2 className="text-3xl font-semibold sm:text-4xl">Meet the instructors</h2>
              <p className="mt-3 text-stone-600">Pick a favorite when you book, or let us match you with whoever fits your kids and schedule.</p>
              <Photo photo={PHOTOS.toddler} className="pool-shape mt-6 hidden aspect-square w-full lg:block" sizes="280px" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {instructors.slice(0, 4).map((i) => (
                <InstructorCard key={i.id} instructor={i} />
              ))}
            </div>
          </div>
        </section>
      )}

      <WaveEdge fill="#ffffff" />
      <section className="bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <h2 className="text-3xl font-semibold sm:text-4xl">Where we teach</h2>
            <p className="mt-3 text-stone-600">Coastal North County and greater San Diego. Type your ZIP code or neighborhood to see if we come to you, and what it costs.</p>
          </div>
          <AreaSearch
            zones={(zones ?? []).map((z) => ({ code: z.code, name: z.name, travelFeeCents: z.travel_fee_cents, minBookingMinutes: z.min_booking_minutes, postalCodes: z.postal_codes, neighborhoods: z.neighborhoods, color: z.map_color }))}
          />
        </div>
      </section>
      <WaveEdge fill="var(--color-sand)" className="-mt-px bg-white" />

      {/* What you need */}
      <section id="pool" className="mx-auto w-full max-w-6xl px-5 pt-16">
        <h2 className="text-3xl font-semibold sm:text-4xl">What you need</h2>
        <p className="mt-3 max-w-2xl text-stone-600">Lessons happen at your pool, so here&apos;s the short checklist. Your instructor brings everything else.</p>
        <div className="mt-8 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              ["A pool", "Yours, a neighbor's, or your HOA or community pool (with permission). Any shape works."],
              ["Steps or a shallow area", "Pool steps, a bench or a shallow end so little swimmers can stand, sit and get in and out safely."],
              ["Warm water", "Around 82–86°F is ideal for young kids. Cooler water shortens how long they can comfortably stay in."],
              ["Clear, safe access", "An unlocked gate or a code, a clear path to the pool, and anything we should know in the booking notes."],
            ].map(([title, text], i) => (
              <li key={title} className="flex gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200/70">
                <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                  {i + 1}
                </span>
                <span>
                  <span className="block font-semibold text-stone-900">{title}</span>
                  <span className="mt-0.5 block text-sm text-stone-600">{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <div id="no-pool" className="relative flex scroll-mt-24 flex-col justify-between overflow-hidden rounded-3xl bg-brand-800 p-6 text-white">
            <TileBand className="absolute inset-x-0 top-0 opacity-80" />
            <div className="pt-6">
              <h3 className="text-2xl font-semibold text-white">No pool? We may still have you covered.</h3>
              <p className="mt-2 text-brand-100">In certain cases, we can teach at one of our partner country club pools. Tell us a bit about your family and schedule, and we&apos;ll let you know what&apos;s possible.</p>
            </div>
            <a href="#contact" className="mt-6 inline-flex w-fit items-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 transition hover:bg-brand-50">
              Ask about club lessons →
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-5 py-16">
        <h2 className="text-3xl font-semibold sm:text-4xl">Questions</h2>
        <div className="mt-6 space-y-3">
          {faqs.map(([q, a]) => (
            <details key={q} className="group rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-stone-200/70 open:ring-brand-200">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-stone-900">
                {q}
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-2 text-stone-600">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="contact" className="mx-auto w-full max-w-6xl px-5 pb-16">
        <div className="relative overflow-hidden rounded-[2rem] bg-brand-700 px-6 py-10 text-white sm:px-10">
          <span aria-hidden className="absolute -right-16 -bottom-16 h-56 w-56 rounded-full bg-brand-500/40" />
          <span aria-hidden className="absolute -top-10 right-24 h-24 w-24 rounded-full bg-coral-500/80" />
          <div className="relative grid gap-8 md:grid-cols-[1.3fr_1fr] md:items-center">
            <div>
              <h2 className="text-3xl font-semibold text-white sm:text-4xl">Still have questions?</h2>
              <p className="mt-3 max-w-lg text-brand-100">Talk to a real person about ages, levels, pool temperature or anything else. We&apos;re happy to help you pick the right fit.</p>
            </div>
            <div className="space-y-3">
              {contact.phone && (
                <a href={contact.phoneHref!} className="flex items-center gap-3 rounded-2xl bg-white/10 px-5 py-4 transition hover:bg-white/20">
                  <span aria-hidden className="text-xl">☏</span>
                  <span>
                    <span className="block text-xs tracking-wide text-brand-200 uppercase">Call or text</span>
                    <span className="font-semibold">{contact.phone}</span>
                  </span>
                </a>
              )}
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="flex items-center gap-3 rounded-2xl bg-white/10 px-5 py-4 transition hover:bg-white/20">
                  <span aria-hidden className="text-xl">✉</span>
                  <span>
                    <span className="block text-xs tracking-wide text-brand-200 uppercase">Email</span>
                    <span className="font-semibold break-all">{contact.email}</span>
                  </span>
                </a>
              )}
              {!contact.phone && !contact.email && <p className="rounded-2xl bg-white/10 px-5 py-4 text-brand-100">Phone and email coming soon. In the meantime, you can book online anytime.</p>}
              <Link href="/book" className="inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-3 font-semibold text-brand-800 transition hover:bg-brand-50">
                Book a lesson
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
