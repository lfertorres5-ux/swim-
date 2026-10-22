import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { laDateString, addDays } from "@/lib/time";
import { one } from "@/lib/utils";
import { ManualBookingForm, type FamilyOption } from "./manual-booking-form";

export default async function NewBooking() {
  await requireRole("admin"); // every admin page checks on its own, never only via the layout
  const supabase = await createClient();
  const [{ data: parents }, { data: instructors }, { data: prices }] = await Promise.all([
    supabase.from("parents").select("id, address_line1, address_line2, city, postal_code, access_notes, user:users!inner(first_name, last_name, email, role), children(id, first_name, is_active)").eq("user.role", "parent").limit(1000),
    supabase.from("instructors").select("id, first_name").eq("is_active", true).order("first_name"),
    supabase.from("lesson_prices").select("duration_minutes, price_cents").eq("is_active", true).order("duration_minutes"),
  ]);
  const families: FamilyOption[] = (parents ?? [])
    .map((p) => {
      const u = one(p.user);
      return {
        id: p.id,
        name: [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.email || "Family",
        email: u?.email ?? "",
        address: p.address_line1 ? { line1: p.address_line1, line2: p.address_line2 ?? "", city: p.city ?? "", postalCode: p.postal_code ?? "", accessNotes: p.access_notes ?? "" } : null,
        children: (p.children ?? []).filter((c) => c.is_active).map((c) => ({ id: c.id, firstName: c.first_name })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <Link href="/admin/bookings" className="text-sm text-stone-500 hover:text-stone-800">
        ← Bookings
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">New booking</h1>
        <p className="mt-1 text-sm text-stone-500">
          Book a lesson for a family directly — it&apos;s confirmed with the instructor you pick. Not sure who&apos;s free? <Link href="/admin/scheduling" className="text-brand-700 underline">Check availability</Link>.
        </p>
      </div>
      <ManualBookingForm families={families} instructors={instructors ?? []} durations={(prices ?? []).map((p) => ({ minutes: p.duration_minutes, priceCents: p.price_cents }))} defaultDate={addDays(laDateString(), 1)} />
    </div>
  );
}
