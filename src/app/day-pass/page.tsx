import Link from "next/link";
import { brand } from "@/config/brand";
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
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/" className="font-display text-lg font-semibold text-brand-800">
          {brand.name}
        </Link>
        <Link href={user ? "/dashboard" : "/login"} className="text-sm text-stone-600 hover:text-stone-900">
          {user ? "My account" : "Sign in"}
        </Link>
      </header>

      <section className="mx-auto max-w-3xl px-5 pt-6 pb-16">
        <p className="text-sm font-semibold tracking-wide text-coral uppercase">For our swim families</p>
        <h1 className="mt-2 text-4xl leading-tight font-semibold sm:text-5xl">Partner Club Day Pass</h1>
        <p className="mt-4 text-lg text-stone-600">
          Spend a day at {clubName} — pools, lounge chairs and lunch by the water — with exclusive discounted access arranged for families who swim with us.
        </p>
        <ul className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
          {[
            ["Member-family pricing", "Discounted access for our families — pricing available on inquiry."],
            ["Inquiry only", "Tell us your dates; we check availability with the club."],
            ["Pay when it's confirmed", "We send a secure payment link once your day is approved."],
          ].map(([t, d]) => (
            <li key={t} className="rounded-2xl bg-white/70 p-4">
              <p className="font-semibold text-stone-900">{t}</p>
              <p className="mt-1 text-stone-600">{d}</p>
            </li>
          ))}
        </ul>

        <div className="mt-10">
          {s?.day_pass_enabled === false ? (
            <p className="card text-stone-600">We&apos;re not taking day pass inquiries right now. Check back soon!</p>
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
    </main>
  );
}
