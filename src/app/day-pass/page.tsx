import Link from "next/link";
import { brand } from "@/config/brand";
import { Photo } from "@/components/photo";
import { SiteFooter } from "@/components/site-footer";
import { PHOTOS } from "@/content/photos";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, laDateString } from "@/lib/time";
import { InquiryForm } from "./inquiry-form";

export const metadata = { title: "Partner Club Day Pass" };

export default async function DayPassPage() {
  const user = await getCurrentUser();
  const supabase = await createClient();
  const { data: s } = await supabase.from("platform_settings").select("day_pass_enabled, partner_club_name").single();
  const clubName = s?.partner_club_name || "our partner country club";

  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/" className="font-display text-lg font-semibold text-brand-800">
          {brand.name}
        </Link>
        <Link href={user ? "/dashboard" : "/login"} className="text-sm text-stone-600 hover:text-stone-900">
          {user ? "My account" : "Sign in"}
        </Link>
      </header>

      <section className="mx-auto max-w-3xl px-5 pt-6 pb-16 lg:pb-24">
        <Photo photo={PHOTOS.club} tone="dusk" className="mb-8 aspect-video w-full rounded-3xl" sizes="(min-width: 768px) 720px, 95vw" priority />
        <p className="text-sm font-semibold tracking-wide text-coral-600 uppercase">For our swim families</p>
        <h1 className="h-display mt-2">Partner Club Day Pass</h1>
        <p className="measure mt-4 text-lg text-stone-600">Spend a day at {clubName}: pools, lounge chairs and lunch by the water, at a discounted rate for families who swim with us.</p>
        <ul className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
          {[
            ["Member-family pricing", "A discounted rate for families who swim with us. We quote it when you ask."],
            ["Inquiry only", "Tell us your dates and we'll check availability with the club."],
            ["Pay once it's confirmed", "We send a secure payment link after the club approves your day."],
          ].map(([t, d]) => (
            <li key={t} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200/70">
              <p className="font-semibold text-stone-900">{t}</p>
              <p className="mt-1 text-stone-600">{d}</p>
            </li>
          ))}
        </ul>

        <div className="mt-10">
          {s?.day_pass_enabled === false ? (
            <p className="card text-stone-600">We&apos;re not taking day pass inquiries right now. Please check back soon.</p>
          ) : (
            <InquiryForm
              clubName={clubName}
              minDate={addDays(laDateString(), 1)}
              defaults={{ name: [user?.firstName, user?.lastName].filter(Boolean).join(" "), email: user?.email ?? "", phone: user?.phone ?? "" }}
            />
          )}
        </div>
        <p className="mt-6 text-xs text-stone-500">Day passes are subject to the club&apos;s availability and guest rules. Submitting this form doesn&apos;t reserve anything.</p>
      </section>
      <SiteFooter />
    </main>
  );
}
