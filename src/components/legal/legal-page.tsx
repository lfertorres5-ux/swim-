import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { brand } from "@/config/brand";
import { LEGAL_UPDATED } from "@/content/legal";

/** Shared frame for the Terms of Service and Privacy Policy pages. */
export function LegalPage({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/" className="font-display text-lg font-semibold text-brand-800">
          {brand.name}
        </Link>
        <Link href="/book" className="btn-primary">
          Book a lesson
        </Link>
      </header>
      <article className="section mx-auto w-full max-w-3xl px-5 pt-8">
        <h1 className="h-section">{title}</h1>
        <p className="mt-2 text-sm text-stone-500">Last updated {LEGAL_UPDATED}</p>
        <div className="measure mt-6 text-stone-700">{intro}</div>
        <div className="legal mt-10 space-y-8 text-stone-700">{children}</div>
      </article>
      <SiteFooter />
    </main>
  );
}

export function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="h-card">{title}</h2>
      <div className="measure space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}
