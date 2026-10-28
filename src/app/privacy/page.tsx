import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Section } from "@/components/legal/legal-page";
import { brand } from "@/config/brand";
import { getContact } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `What ${brand.name} collects when you book swim lessons, why, who it's shared with, and your choices.`,
};

export default async function PrivacyPage() {
  const contact = await getContact();
  const reach = [contact.email, contact.phone].filter(Boolean).join(" or ") || "the contact details on our home page";

  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <p>
          This policy explains what {brand.name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects when you visit our website or book swim lessons, how we use it, and
          your choices. We don&apos;t sell your personal information, we don&apos;t share it for advertising, and we don&apos;t use advertising or analytics trackers.
        </p>
      }
    >
      <Section title="1. What we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Your details:</strong> name, email, mobile number (optional) and whether you want text reminders.
          </li>
          <li>
            <strong>Lesson location:</strong> the pool address, gate codes or access notes you give us.
          </li>
          <li>
            <strong>Swimmer details:</strong> each child&apos;s first name, birth date, swim level, and any notes you choose to share (which may include health or
            safety information).
          </li>
          <li>
            <strong>Bookings and progress:</strong> lessons, packages, cancellations, and the progress notes instructors write after lessons.
          </li>
          <li>
            <strong>Payments:</strong> amounts, receipts and payment status. Card details are entered on Stripe&apos;s (or, for HSA/FSA, Truemed&apos;s) secure
            page; we never see or store full card numbers. If you turn on package auto-renewal, Stripe keeps your card on file and we store only a reference to it.
          </li>
          <li>
            <strong>Partner Club Day Pass inquiries:</strong> the contact details, party size, dates and message you send.
          </li>
          <li>
            <strong>Technical data:</strong> a sign-in cookie that keeps you signed in, and basic server logs (such as IP address and browser) kept by our hosting
            provider for security. For rate-limiting, we store a one-way hash of an IP address, not the address itself.
          </li>
        </ul>
      </Section>

      <Section title="2. Children's information">
        <p>
          Our website is for parents and guardians. Children don&apos;t create accounts or give us information; a parent or guardian provides it. We use
          swimmers&apos; details only to arrange and teach their lessons and share progress with their family. Instructors see a swimmer&apos;s first name, age, level and
          notes for their own lessons; they don&apos;t see your email, phone or last name unless you buy a package that includes sharing contact details, and they
          see your address only on lesson day. You can ask us to correct or delete a child&apos;s information at any time.
        </p>
      </Section>

      <Section title="3. How we use it">
        <ul className="list-disc space-y-1 pl-5">
          <li>to book, match, schedule and teach lessons, and to send confirmations, reminders and progress notes;</li>
          <li>to take payments, issue refunds, and run package auto-renewal if you turn it on;</li>
          <li>to keep the service safe, prevent fraud and abuse, and keep records we&apos;re required to keep;</li>
          <li>to answer your questions and improve our lessons.</li>
        </ul>
        <p>We don&apos;t send marketing emails or texts. Texts are sent only if you opt in, and you can reply STOP at any time.</p>
      </Section>

      <Section title="4. Who we share it with">
        <p>We share information only as needed to run lessons, with:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>your instructor</strong>, limited as described above;
          </li>
          <li>
            <strong>service providers</strong> that process it on our behalf: Supabase (database and sign-in), Vercel (website hosting), Stripe (card payments),
            Truemed (HSA/FSA payments, if you choose them), our email provider and text-message provider (to deliver messages), and Google (address lookup, if
            enabled);
          </li>
          <li>
            <strong>our partner club</strong>, only the details needed for a Day Pass you ask about;
          </li>
          <li>authorities or others when required by law, or to protect the safety of a child or anyone else.</li>
        </ul>
        <p>We don&apos;t sell personal information or share it for cross-context behavioral advertising.</p>
      </Section>

      <Section title="5. Cookies, Do Not Track and Global Privacy Control">
        <p>
          We use only a strictly necessary cookie to keep you signed in. We don&apos;t use advertising, analytics or tracking cookies, so there&apos;s nothing to opt
          out of. Because we don&apos;t track you across sites, we treat every visitor as if a Do Not Track or Global Privacy Control signal were on. Stripe and
          Truemed may set their own cookies on their payment pages.
        </p>
      </Section>

      <Section title="6. How long we keep it">
        <p>
          We keep account, booking and payment records while your account is open and for as long as needed for tax, accounting and legal purposes (generally up to
          7 years for payment records). Lesson notes and swimmer details are deleted or anonymized when you ask us to close your account, unless we must keep them
          by law.
        </p>
      </Section>

      <Section title="7. Your choices and California rights">
        <p>
          You can view and update your details in your account. To get a copy of your information, correct it, delete it, or close your account, contact us at{" "}
          {reach}. We&apos;ll verify the request comes from you and respond within 45 days. We won&apos;t treat you differently for making a request. California
          residents may also request information about disclosures of personal information for direct marketing; we don&apos;t make such disclosures.
        </p>
      </Section>

      <Section title="8. Security">
        <p>
          We protect information with encryption in transit, access controls that limit what instructors and staff can see, and audited access to family contact
          details. No system is perfectly secure; if a breach affects you, we&apos;ll tell you as required by law.
        </p>
      </Section>

      <Section title="9. Changes and contact">
        <p>
          We&apos;ll post any changes here and update the date above; for significant changes we&apos;ll email account holders. Questions or requests: {brand.name},
          San Diego, California, at {reach}. See also our{" "}
          <Link href="/terms" className="underline">
            Terms of Service
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
