import Link from "next/link";
import { brand } from "@/config/brand";
import { PHOTO_CREDITS } from "@/content/photos";
import { getContact } from "@/lib/contact";
import { TileBand } from "./motifs";

/** Public-site footer: contact details, links and photo credits. */
export async function SiteFooter() {
  const contact = await getContact();
  return (
    <footer className="mt-auto bg-brand-950 text-brand-100">
      <TileBand className="opacity-90" />
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 sm:grid-cols-3">
        <div>
          <p className="font-display text-xl font-semibold text-white">{brand.name}</p>
          <p className="measure mt-2 text-sm text-brand-200">{brand.tagline}</p>
        </div>
        <div className="text-sm">
          <p className="font-semibold text-white">Contact</p>
          <ul className="mt-2 space-y-1.5">
            {contact.phone && (
              <li>
                <a href={contact.phoneHref!} className="hover:text-white">
                  {contact.phone}
                </a>
              </li>
            )}
            {contact.email && (
              <li>
                <a href={`mailto:${contact.email}`} className="hover:text-white">
                  {contact.email}
                </a>
              </li>
            )}
            {!contact.phone && !contact.email && <li className="text-brand-300">Phone and email coming soon</li>}
            <li className="text-brand-300">{brand.region}</li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="font-semibold text-white">Explore</p>
          <ul className="mt-2 space-y-1.5">
            <li>
              <Link href="/book" className="hover:text-white">
                Book a lesson
              </Link>
            </li>
            <li>
              <Link href="/#pricing" className="hover:text-white">
                Pricing
              </Link>
            </li>
            <li>
              <Link href="/day-pass" className="hover:text-white">
                Partner Club Day Pass
              </Link>
            </li>
            <li>
              <Link href="/login" className="hover:text-white">
                Sign in
              </Link>
            </li>
            <li>
              <Link href="/terms" className="hover:text-white">
                Terms of Service
              </Link>
            </li>
            <li>
              <Link href="/privacy" className="hover:text-white">
                Privacy Policy
              </Link>
            </li>
          </ul>
        </div>
      </div>
      {PHOTO_CREDITS.length > 0 && (
        <p className="mx-auto max-w-6xl px-5 pb-8 text-xs text-brand-300">
          Photos:{" "}
          {PHOTO_CREDITS.map((c, i) => (
            <span key={c.url}>
              {i > 0 && ", "}
              <a href={c.url} className="underline hover:text-white" target="_blank" rel="noreferrer">
                {c.name}
              </a>{" "}
              on {c.source}
            </span>
          ))}
        </p>
      )}
    </footer>
  );
}
