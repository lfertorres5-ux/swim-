import type { Metadata } from "next";
import { ContactCard } from "@/components/contact-card";
import { getInstructorContext } from "@/lib/instructor-context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My families" };

type Family = { parent_id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; children: string[] };

export default async function FamiliesPage() {
  const ctx = await getInstructorContext();
  if (!ctx.isActive) return <p className="card text-slate-600">Your families will appear here once your account is activated.</p>;
  const supabase = await createClient();
  // Audited RPC: only families with a paid package whose lesson you accepted.
  const { data } = await supabase.rpc("my_family_contacts");
  const families = (data ?? []) as Family[];

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">My families</h1>
      <p className="text-sm text-slate-500">
        Families who bought a lesson package and whose lesson you accepted. Coordinate directly — but every lesson and payment still goes through the platform.
      </p>
      {families.length ? (
        <ContactCard
          title="Contacts"
          people={families.map((f) => ({
            name: [f.first_name, f.last_name].filter(Boolean).join(" ") || "Family",
            email: f.email,
            phone: f.phone,
            detail: f.children.length ? `Swimmers: ${f.children.join(", ")}` : undefined,
          }))}
        />
      ) : (
        <p className="card text-slate-600">No package families yet. Contact details appear here after you accept a lesson from a family&apos;s package.</p>
      )}
    </div>
  );
}
