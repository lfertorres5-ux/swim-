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
    supabase.from("package_offerings").select("name, lesson_count, discount_pct, validity_days").eq("is_active", true).order("sort_order"),
    supabase.from("platform_settings").select("cancellation_window_hours").single(),
    loadInstructorCards(),
  ]);
  const [contact, hsaFsa] = await Promise.all([getContact(), hsaFsaAvailable()]);
  const extra = money(pricing?.extra_child_cents ?? 0);
  const included = pricing?.included_children ?? 2;

  const cancelHours = settings?.cancellation_window_hours ?? 24;
  // Two-column grid: show an even number so there's never a lone card in the last row.
  const shownInstructors = instructors.slice(0, instructors.length > 1 ? Math.min(4, instructors.length - (instructors.length % 2)) : 1);
  const faqs: [string, string][] = [
    ["What do I need?", "A pool (yours, a neighbor's or your HOA's), ideally with steps or a shallow area so little swimmers can stand and get in safely, and warm water (around 82–86°F for young kids). We bring the kickboards and everything else."],
    ["We don't have a pool. Can we still take lessons?", "In some cases, yes: we can teach at one of our partner country club pools. Get in touch and we'll tell you what's possible for your family and schedule."],
    ["How young can my child start?", "Some of our instructors teach babies from 6 months, with a parent in the water."],
    ["My child already swims. Is this for them?", "Yes. We also teach established swimmers who want to refine their strokes, breathing and turns, or get ready for swim team. When you book, choose the “Stroke technique” level and we'll match you with an instructor who coaches it."],
    ["Can siblings share a lesson?", `Yes. Each lesson includes up to ${included} kids, and each extra swimmer is ${extra}.`],
    ["Do packages renew automatically?", "Only if you choose to. When you buy a package you can tick “Auto-renew this package”: once you've booked its last lesson, we renew the same package at the regular price, charged to the same card after that lesson. We email you at least 3 days before every renewal, and you can turn it off any time from your account."],
    ["What if we need to cancel?", `You can cancel or reschedule from your account up to ${cancelHours} hours before your lesson at no charge. Within ${cancelHours} hours, the lesson isn't refunded, but please still let us know as soon as you can so your instructor isn't left waiting. If the weather turns, your instructor will reach out.`],
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
          <Link href="/book" className="btn-primary hidden sm:inline-flex">
            Book a lesson
          </Link>
          <Link href="/login" className="text-stone-600 hover:text-stone-900">
            Sign in
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid w-full max-w-6xl gap-12 px-5 pt-4 pb-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-12 lg:pb-24">
        <div className="min-w-0">
          <h1 className="h-display">
            Swim lessons in{" "}
            <span className="relative whitespace-nowrap">
              your own backyard.
              <svg aria-hidden viewBox="0 0 300 18" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-3 w-full text-coral-400">
                <path d="M3 12 C 60 3 120 16 180 8 S 270 6 297 10" stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" />
              </svg>
            </span>
          </h1>
          <p className="measure mt-6 text-lg text-stone-600">
            Private lessons at your pool with former Division I and national-level swimmers, from Encinitas and Del Mar to Carlsbad and La Jolla. Babies to swim team, nervous swimmers included.
          </p>
          <div className="mt-8 max-w-md">
            <ZipChecker
              zones={(zones ?? []).map((z) => ({ code: z.code, name: z.name, travelFeeCents: z.travel_fee_cents, minBookingMinutes: z.min_booking_minutes, postalCodes: z.postal_codes }))}
            />
          </div>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-600">
            <li>✓ Lifeguard and CPR certified</li>
            <li>✓ Background checked</li>
            <li>✓ Notes after every lesson</li>
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <Photo photo={PHOTOS.hero} priority className="pool-shape aspect-square w-full shadow-[0_30px_60px_-30px_rgba(15,94,115,0.55)]" />
          <div className="absolute -top-6 -left-3 w-[38%] rotate-[-5deg] rounded-2xl bg-white p-2 pb-3 shadow-xl sm:-left-8">
            <Photo photo={PHOTOS.toddler} tone="dusk" className="aspect-square w-full rounded-xl" sizes="240px" />
            <p className="note mt-2 text-center text-sm">one-on-one, at your pool</p>
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
        <div className="section mx-auto max-w-6xl px-5">
          <div className="grid gap-px overflow-hidden rounded-3xl bg-stone-200 sm:grid-cols-3">
            {[
              ["Certified and insured", "Every instructor is lifeguard- and CPR-certified, background-checked and covered by our insurance."],
              ["At your pool", "No crowded public pools, no driving across town. Kids learn best in the pool they actually swim in."],
              ["A note after every lesson", "Your instructor sends a short note on what your kids worked on and what comes next."],
            ].map(([title, text], i) => (
              <div key={title} className="relative bg-white p-6 pt-10">
                <span className="absolute top-4 left-6 font-display text-sm font-semibold text-brand-600">Lane {i + 1}</span>
                <span aria-hidden className="absolute top-0 right-6 bottom-0 w-1.5 bg-[repeating-linear-gradient(to_bottom,var(--color-lane-blue)_0_10px,#fff_10px_20px)] opacity-60" />
                <h3 className="h-card pr-8">{title}</h3>
                <p className="mt-2 pr-8 text-stone-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <WaveEdge fill="var(--color-sand)" className="-mt-px bg-white" />

      {/* How we're different */}
      <section id="different" className="mx-auto w-full max-w-6xl px-5 pt-16 lg:pt-24">
        <div className="relative overflow-hidden rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200/70 sm:p-12">
          <span aria-hidden className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-brand-50" />
          <div className="relative">
            <h2 className="h-section max-w-2xl">San Diego&apos;s best swimmers, in your backyard.</h2>
            <p className="measure mt-4 text-stone-600">We&apos;re local swimmers with one goal: every family taught by the best instructors in the water.</p>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Local swimmers", "We swim here too. This is our community's pools, beaches and kids, not a territory on a map."],
                ["Small on purpose", "Staying local lets us be choosy. We only bring on the most capable instructors, not whoever's available."],
                ["Partners, not employees", "Our instructors are partners in the business. They choose to teach here and own the results with you."],
                ["Checked every lesson", "Every lesson ends with a progress note, and every instructor's certifications are tracked and kept current."],
              ].map(([title, text], i) => (
                <div key={title}>
                  <span className="font-display text-3xl font-semibold text-coral-500">0{i + 1}</span>
                  <h3 className="h-card mt-2">{title}</h3>
                  <p className="mt-2 text-sm text-stone-600">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Vetting */}
      <section id="vetting" className="section mx-auto w-full max-w-6xl px-5">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-start">
          <div className="lg:sticky lg:top-8">
            <h2 className="h-section">Who&apos;s in the water with your kids</h2>
            <p className="measure mt-4 text-stone-600">
              Every instructor is a former <strong className="text-stone-900">NCAA Division I or national-level competitive swimmer</strong>. Speed is only the start: before teaching a single
              lesson, each one passes the seven steps below.
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
              ["Competitive record", "NCAA Division I or national-level meet experience, confirmed against published results and rosters."],
              ["Lifeguard, CPR/AED and First Aid", "Current American Red Cross (or equivalent) lifeguarding and CPR/AED/First Aid certification, kept on file and tracked to expiry."],
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

      {/* Stroke technique for established swimmers */}
      <section id="stroke" className="bg-white">
        <div className="section mx-auto grid max-w-6xl gap-10 px-5 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <Photo photo={PHOTOS.stroke} className="aspect-video w-full rounded-3xl" sizes="(min-width: 1024px) 55vw, 95vw" />
          <div>
            <p className="text-sm font-semibold tracking-wide text-coral-600 uppercase">Already swimming?</p>
            <h2 className="h-section mt-2">Sharpen your stroke with a D1 swimmer</h2>
            <p className="measure mt-4 text-stone-600">
              Lessons aren&apos;t just for beginners. Established swimmers, from swim-team kids to teens chasing faster times, get one-on-one technique work from a
              former NCAA Division I or national-level competitor.
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                ["Stroke mechanics", "Freestyle, backstroke, breaststroke and butterfly, refined one detail at a time."],
                ["Breathing and turns", "Bilateral breathing, flip turns, open turns and streamlines."],
                ["Starts and racing", "Starts off the wall or block, pacing and finishing strong."],
                ["Swim team prep", "Get ready for tryouts or move up a group with confidence."],
              ].map(([title, text]) => (
                <li key={title} className="rounded-2xl bg-sand p-4">
                  <span className="block font-semibold text-stone-900">{title}</span>
                  <span className="mt-1 block text-sm text-stone-600">{text}</span>
                </li>
              ))}
            </ul>
            <Link href="/book" className="btn-primary btn-lg mt-8">
              Book a stroke lesson
            </Link>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="section mx-auto w-full max-w-6xl px-5">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-start">
          <div>
            <h2 className="h-section">Pay per lesson</h2>
            <p className="measure mt-4 text-stone-600">
              Each lesson covers up to {included} kids, and each extra swimmer is {extra}. No membership, no sign-up fee.
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
            <Link href="/book" className="btn-primary btn-lg mt-8">
              Book a lesson
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl bg-brand-800 p-6 text-brand-50">
              <p className="text-xs font-semibold tracking-wide text-brand-200 uppercase">Packages</p>
              <h3 className="h-card mt-1 text-white">Save with a package</h3>
              <ul className="mt-4 space-y-2">
                {(offerings ?? []).map((o) => (
                  <li key={o.name} className="flex items-center justify-between border-b border-dashed border-brand-600 pb-2">
                    <span>
                      {o.lesson_count} lessons <span className="text-sm text-brand-200">· use within {o.validity_days} days</span>
                    </span>
                    <span className="rounded-full bg-coral-500 px-2.5 py-0.5 text-sm font-semibold text-white">{Number(o.discount_pct)}% off</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200/70">
              <h3 className="h-card">Travel fees and savings</h3>
              <ul className="mt-4 space-y-2.5 text-sm text-stone-600">
                {(zones ?? []).map((z) => (
                  <li key={z.code}>
                    <span className="font-medium text-stone-800">{z.name}:</span> {z.travel_fee_cents ? `${money(z.travel_fee_cents)} travel fee` : "no travel fee"}
                    {z.min_booking_minutes ? `, ${z.min_booking_minutes} min minimum` : ""}
                  </li>
                ))}
                <li>Book a time next to a neighbor&apos;s lesson and save {money(pricing?.neighborhood_discount_cents ?? 0)} per lesson</li>
                {hsaFsa && <li className="font-medium text-brand-800">Pay with HSA/FSA through Truemed, if your lessons qualify</li>}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-5">
        <LaneRope count={36} />
      </div>

      {shownInstructors.length > 0 && (
        <section className="section mx-auto w-full max-w-6xl px-5">
          <div className="grid gap-8 lg:grid-cols-[280px_1fr] lg:items-start">
            <div>
              <h2 className="h-section">Meet the instructors</h2>
              <p className="measure mt-4 text-stone-600">Pick a favorite when you book, or we&apos;ll match you with the instructor who fits your kids and schedule.</p>
              <Photo photo={PHOTOS.instructor} className="mt-6 aspect-square w-full max-w-sm rounded-3xl lg:max-w-none" sizes="(min-width: 1024px) 280px, 384px" />
            </div>
            <div className={`grid gap-4 ${shownInstructors.length > 1 ? "md:grid-cols-2" : ""}`}>
              {shownInstructors.map((i) => (
                <InstructorCard key={i.id} instructor={i} />
              ))}
            </div>
          </div>
        </section>
      )}

      <WaveEdge fill="#ffffff" />
      <section className="bg-white">
        <div className="section mx-auto grid max-w-6xl gap-10 px-5 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <h2 className="h-section">Where we teach</h2>
            <p className="measure mt-4 text-stone-600">Coastal North County and greater San Diego. Enter your ZIP code or neighborhood to see if we come to you and what it costs.</p>
          </div>
          <AreaSearch
            zones={(zones ?? []).map((z) => ({ code: z.code, name: z.name, travelFeeCents: z.travel_fee_cents, minBookingMinutes: z.min_booking_minutes, postalCodes: z.postal_codes, neighborhoods: z.neighborhoods, color: z.map_color }))}
          />
        </div>
      </section>
      <WaveEdge fill="var(--color-sand)" className="-mt-px bg-white" />

      {/* What you need */}
      <section id="pool" className="mx-auto w-full max-w-6xl px-5 pt-16 lg:pt-24">
        <h2 className="h-section">What you need</h2>
        <p className="measure mt-4 text-stone-600">Lessons happen at your pool, so here&apos;s the short checklist. Your instructor brings everything else.</p>
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
              <h3 className="h-card text-white">No pool? We may still have you covered.</h3>
              <p className="mt-2 text-brand-100">In some cases we can teach at one of our partner country club pools. Tell us about your family and schedule, and we&apos;ll tell you what&apos;s possible.</p>
            </div>
            <a href="#contact" className="btn-light mt-6 w-fit">
              Ask about club lessons
            </a>
          </div>
        </div>
      </section>

      <section className="section mx-auto w-full max-w-3xl px-5">
        <h2 className="h-section">Common questions</h2>
        <div className="mt-8 space-y-3">
          {faqs.map(([q, a]) => (
            <details key={q} className="group rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-stone-200/70 open:ring-brand-200">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-stone-900">
                {q}
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="measure mt-2 text-stone-600">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="contact" className="mx-auto w-full max-w-6xl px-5 pb-16 lg:pb-24">
        <div className="relative overflow-hidden rounded-3xl bg-brand-700 px-6 py-12 text-white sm:px-12">
          <span aria-hidden className="absolute -right-16 -bottom-16 h-56 w-56 rounded-full bg-brand-500/40" />
          <span aria-hidden className="absolute -top-10 right-24 h-24 w-24 rounded-full bg-coral-500/80" />
          <div className="relative grid gap-8 md:grid-cols-[1.3fr_1fr] md:items-center">
            <div>
              <h2 className="h-section text-white">Contact us</h2>
              <p className="measure mt-4 text-brand-100">Talk to a real person about ages, levels, pool temperature or anything else before you book.</p>
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
              {!contact.phone && !contact.email && <p className="rounded-2xl bg-white/10 px-5 py-4 text-brand-100">Phone and email coming soon. You can book online anytime.</p>}
              <Link href="/book" className="btn-light btn-lg w-full">
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
