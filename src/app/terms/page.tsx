import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Section } from "@/components/legal/legal-page";
import { brand } from "@/config/brand";
import { getContact } from "@/lib/contact";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The terms for booking private swim lessons with ${brand.name}, including cancellations, packages, auto-renewal and the liability waiver.`,
};

export default async function TermsPage() {
  const supabase = await createClient();
  const [{ data: s }, contact] = await Promise.all([supabase.from("platform_settings").select("cancellation_window_hours, late_cancel_refund_pct").single(), getContact()]);
  const hours = s?.cancellation_window_hours ?? 24;
  const lateRefund = Number(s?.late_cancel_refund_pct ?? 0);
  const reach = [contact.email, contact.phone].filter(Boolean).join(" or ") || "the contact details on our home page";

  return (
    <LegalPage
      title="Terms of Service"
      intro={
        <p>
          These terms apply when you book or take a swim lesson with {brand.name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By booking, you agree to them, including the{" "}
          <a href="#waiver" className="font-medium text-brand-700 underline">
            assumption of risk and liability waiver
          </a>
          . Please read them carefully. Questions? Contact us at {reach}.
        </p>
      }
    >
      <Section title="1. Who can book">
        <p>
          You must be at least 18 and the parent or legal guardian of every swimmer you book for (or an adult swimmer booking for yourself). You&apos;re responsible
          for the accuracy of the information you give us, including each swimmer&apos;s age, swim level and anything the instructor should know, such as medical
          conditions, allergies or fears.
        </p>
      </Section>

      <Section title="2. Lessons, instructors and booking">
        <p>
          Lessons take place at the pool you provide in our service area. When you book, we send your request to an instructor, who confirms it, usually within a
          few hours. If no instructor can confirm, we&apos;ll offer another time or refund you in full. We may change the assigned instructor if needed; we&apos;ll
          tell you before the lesson.
        </p>
        <p>
          Prices are shown before you pay and include any travel fee and discounts. Payment is taken when you book, through our payment processor (Stripe) or, for
          HSA/FSA payments, Truemed.
        </p>
      </Section>

      <Section title="3. Your pool and the lesson site">
        <p>You agree to provide a pool that is safe for a lesson, including:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>clean, properly maintained water, with steps or a shallow area for young swimmers;</li>
          <li>a clear, safe path to the pool and access at the booked time;</li>
          <li>permission to use the pool if it isn&apos;t yours (for example, an HOA or neighbor&apos;s pool);</li>
          <li>
            <strong>a parent, guardian or adult you designate on the property for the whole lesson</strong>, reachable in an emergency.
          </li>
        </ul>
        <p>
          Your instructor may shorten or cancel a lesson if conditions aren&apos;t safe (for example, water quality, lightning, or an unsafe deck). If a lesson
          can&apos;t go ahead because of the pool or access, it&apos;s treated as a late cancellation.
        </p>
      </Section>

      <Section title="4. Cancellations, rescheduling, weather and no-shows">
        <p>
          You can cancel or reschedule from your account up to {hours} hours before a lesson at no charge. Within {hours} hours, the lesson
          {lateRefund > 0 ? ` is refunded at ${lateRefund}%` : " isn't refunded"}, but please still let us know as soon as you can.
        </p>
        <p>
          If nobody is at the pool when the instructor arrives, the instructor may mark the lesson as a no-show after waiting 10 minutes. No-shows aren&apos;t
          refunded, and a package lesson counts as used.
        </p>
        <p>If we cancel, or the weather makes a lesson unsafe, we&apos;ll reschedule or refund the lesson in full.</p>
      </Section>

      <Section id="packages" title="5. Packages and auto-renewal">
        <p>
          Packages are prepaid lessons at a discount. Each package must be used within the period shown before you buy it (for example, &ldquo;use within 150
          days&rdquo;). Unused lessons expire at the end of that period. Package lessons are for the same lesson length, number of swimmers and area as the
          package.
        </p>
        <p>
          <strong>Auto-renewal is optional and off unless you tick it at checkout.</strong> If you turn it on, once you&apos;ve booked the last lesson in your
          package we&apos;ll renew the same package at its regular price (one-time discounts don&apos;t repeat), charged to the card you used, after that lesson.
          It repeats until you turn it off. We email you at least 3 days before every renewal. You can turn off auto-renew at any time in your account (
          <Link href="/parent" className="underline">
            My lessons → Your packages
          </Link>
          ); turning it off before a renewal is charged means you won&apos;t be charged.
        </p>
      </Section>

      <Section id="waiver" title="6. Assumption of risk, release and liability waiver">
        <p>
          Swimming and water activities carry inherent risks, including <strong>drowning, near-drowning, and serious injury or death</strong>, as well as slips
          and falls, illness from water exposure, and injury from pool equipment or conditions. These risks exist even with qualified, careful instruction.
        </p>
        <p>
          On behalf of yourself and each swimmer you book for, you voluntarily accept these risks. To the fullest extent permitted by law, you release and agree
          not to sue {brand.name}, its owners and its instructors for injury, illness, death or property damage arising from lessons, except to the extent caused
          by gross negligence or willful misconduct. You agree to indemnify us against claims arising from the condition of the pool or premises you provide.
        </p>
        <p>
          You confirm each swimmer is fit to take part and that you&apos;ve told us about any medical condition that could affect their safety. You authorize the
          instructor to seek emergency medical care for a swimmer if you can&apos;t be reached, at your expense.
        </p>
      </Section>

      <Section title="7. Partner Club Day Pass">
        <p>
          Day pass requests are inquiries only. Nothing is reserved or charged until we confirm with the partner club and you pay the link we send. Your visit is
          subject to the club&apos;s own rules and guest policies.
        </p>
      </Section>

      <Section title="8. HSA/FSA payments">
        <p>
          If offered, HSA/FSA payment is handled by Truemed, whose licensed providers decide eligibility. We don&apos;t guarantee that lessons qualify. Refunds for
          HSA/FSA payments are processed through Truemed.
        </p>
      </Section>

      <Section title="9. Limitation of liability">
        <p>
          To the fullest extent permitted by law, our total liability for any claim related to lessons or this website is limited to the amount you paid for the
          lessons involved. We aren&apos;t liable for indirect or consequential losses. Nothing in these terms limits liability that can&apos;t be limited by law.
        </p>
      </Section>

      <Section title="10. Your account">
        <p>
          You sign in with a link we email you. Keep access to your email secure; you&apos;re responsible for bookings made from your account. We may suspend
          accounts used to abuse the service or to arrange lessons off the platform with instructors you met through us.
        </p>
      </Section>

      <Section title="11. Changes and governing law">
        <p>
          We may update these terms; the version in force when you book applies to that booking, and we&apos;ll tell you about material changes to auto-renewal
          before they affect a renewal. These terms are governed by California law, and disputes will be handled in the courts of San Diego County, California.
        </p>
      </Section>

      <Section title="12. Contact">
        <p>
          {brand.name}, San Diego, California. Contact us at {reach}. See also our{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
