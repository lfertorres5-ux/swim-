import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { laDateString } from "@/lib/time";
import { BookingWizard } from "./booking-wizard";

export const metadata: Metadata = { title: "Book a lesson" };

export default async function BookPage({ searchParams }: PageProps<"/book">) {
  const user = await requireRole("parent", "/book");
  if (!user.onboardedAt) redirect("/onboarding?next=/book");
  const { instructor } = await searchParams;
  const supabase = await createClient();

  const [{ data: prices }, { data: offerings }, { data: pricing }, { data: settings }, { data: children }, { data: parent }, { data: packages }] = await Promise.all([
    supabase.from("lesson_prices").select("duration_minutes, price_cents").eq("is_active", true).order("sort_order"),
    supabase.from("package_offerings").select("id, name, lesson_count, discount_pct").eq("is_active", true).order("sort_order"),
    supabase.from("pricing_config").select("*").single(),
    supabase.from("platform_settings").select("cancellation_window_hours, booking_request_window_hours, recurring_term_weeks").single(),
    supabase.from("children").select("id, first_name, birth_date, swim_level").eq("is_active", true).order("first_name"),
    supabase.from("parents").select("address_line1, address_line2, city, postal_code, access_notes, favorite_instructor_id, preferred_days, preferred_time_windows").eq("id", user.id).single(),
    supabase.from("packages").select("id, lessons_remaining, duration_minutes, children_count, zone_id, expires_at").eq("status", "active").gt("lessons_remaining", 0),
  ]);

  const today = laDateString();
  return (
    <>
      <AppHeader user={user} nav={[{ href: "/parent", label: "My lessons" }, { href: "/book", label: "Book" }]} />
      <main className="w-full flex-1 px-6 py-8">
        <BookingWizard
          prices={(prices ?? []).map((p) => ({ durationMinutes: p.duration_minutes, priceCents: p.price_cents }))}
          offerings={(offerings ?? []).map((o) => ({ id: o.id, name: o.name, lessonCount: o.lesson_count, discountPct: Number(o.discount_pct) }))}
          recurringTermWeeks={settings?.recurring_term_weeks ?? [4, 8]}
          recurringDiscountPct={Number(pricing?.recurring_discount_pct ?? 0)}
          includedChildren={pricing?.included_children ?? 2}
          extraChildCents={pricing?.extra_child_cents ?? 0}
          neighborhoodDiscountCents={pricing?.neighborhood_discount_cents ?? 0}
          cancellationWindowHours={settings?.cancellation_window_hours ?? 24}
          bookingRequestWindowHours={settings?.booking_request_window_hours ?? 12}
          kids={(children ?? []).map((c) => ({ id: c.id, firstName: c.first_name, birthDate: c.birth_date, swimLevel: c.swim_level }))}
          savedAddress={
            parent?.address_line1
              ? { line1: parent.address_line1, line2: parent.address_line2, city: parent.city ?? "", postalCode: parent.postal_code ?? "", accessNotes: parent.access_notes }
              : null
          }
          favoriteInstructorId={parent?.favorite_instructor_id ?? null}
          packages={(packages ?? [])
            .filter((p) => !p.expires_at || p.expires_at > new Date().toISOString())
            .map((p) => ({ id: p.id, lessonsRemaining: p.lessons_remaining, durationMinutes: p.duration_minutes, childrenCount: p.children_count, zoneId: p.zone_id, expiresAt: p.expires_at }))}
          preferences={{ weekdays: parent?.preferred_days ?? [], windows: (parent?.preferred_time_windows as { start: string; end: string }[]) ?? [] }}
          mapsBrowserKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || null}
          today={today}
          initialInstructorId={typeof instructor === "string" ? instructor : null}
        />
      </main>
    </>
  );
}
