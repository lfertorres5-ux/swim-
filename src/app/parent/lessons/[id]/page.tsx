import Link from "next/link";
import { notFound } from "next/navigation";
import { InstructorCard } from "@/components/instructor-card";
import { requireRole } from "@/lib/auth";
import { previewCancellation } from "@/lib/booking/manage";
import { loadInstructorCards } from "@/lib/instructor-cards";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatTime, laDateString } from "@/lib/time";
import { formatCents, one } from "@/lib/utils";
import { cancelLessonAction, toggleFavoriteAction } from "../../actions";
import { ReschedulePicker } from "./reschedule-picker";

export default async function LessonDetail({ params, searchParams }: PageProps<"/parent/lessons/[id]">) {
  const user = await requireRole("parent");
  const { id } = await params;
  const { error, cancelled } = await searchParams;
  const supabase = await createClient();

  const { data: b } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, ends_at, status, kind, instructor_id, package_id, cancellation_reason, booking_pricing(total_cents), booking_locations(address_line1, address_line2, city, postal_code, access_notes), booking_children(child:children(first_name)), lesson_notes(summary, next_focus, skills)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!b) notFound();

  const [{ data: parent }, cards, preview] = await Promise.all([
    supabase.from("parents").select("favorite_instructor_id").eq("id", user.id).single(),
    b.instructor_id ? loadInstructorCards([b.instructor_id]) : Promise.resolve([]),
    previewCancellation(user.id, b.id),
  ]);
  const instructor = cards[0];
  const loc = one(b.booking_locations);
  const note = one(b.lesson_notes);
  const price = one(b.booking_pricing);
  const kids = (b.booking_children ?? []).map((bc) => one(bc.child)?.first_name).filter(Boolean).join(", ");
  const active = preview.cancellable;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="space-y-4 lg:col-span-2">
        <Link href="/parent" className="text-sm text-sky-700">
          ← My lessons
        </Link>
        <h1 className="text-2xl font-semibold">
          {formatDateTime(b.starts_at)}–{formatTime(b.ends_at)}
        </h1>
        {cancelled && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Lesson cancelled.</p>}
        {typeof error === "string" && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <dl className="card grid grid-cols-3 gap-y-2 text-sm">
          <dt className="text-slate-500">Status</dt>
          <dd className="col-span-2 font-medium capitalize">{b.status.replaceAll("_", " ")}</dd>
          <dt className="text-slate-500">Swimmers</dt>
          <dd className="col-span-2">{kids}</dd>
          {loc && (
            <>
              <dt className="text-slate-500">Where</dt>
              <dd className="col-span-2">
                {loc.address_line1}
                {loc.address_line2 ? `, ${loc.address_line2}` : ""}, {loc.city} {loc.postal_code}
                {loc.access_notes && <span className="block text-slate-500">{loc.access_notes}</span>}
              </dd>
            </>
          )}
          <dt className="text-slate-500">Paid</dt>
          <dd className="col-span-2">{b.package_id ? "Package credit" : price ? formatCents(price.total_cents) : "—"}</dd>
          {b.cancellation_reason && (
            <>
              <dt className="text-slate-500">Reason</dt>
              <dd className="col-span-2">{b.cancellation_reason}</dd>
            </>
          )}
        </dl>

        {note && (
          <div className="card">
            <h2 className="font-semibold">Progress note</h2>
            <p className="mt-1 text-sm text-slate-700">{note.summary}</p>
            {note.next_focus && <p className="mt-2 text-sm text-slate-600"><strong>Next time:</strong> {note.next_focus}</p>}
          </div>
        )}

        {active && (
          <div className="card space-y-4">
            <h2 className="font-semibold">Change this lesson</h2>
            {preview.onTime ? (
              <ReschedulePicker bookingId={b.id} today={laDateString()} instructorName={instructor?.firstName ?? null} />
            ) : (
              <p className="text-sm text-slate-600">
                This lesson starts within {preview.policy.cancellationWindowHours} hours, so it can no longer be rescheduled online. Message your instructor or contact us.
              </p>
            )}
            <form action={cancelLessonAction} className="space-y-2 border-t border-slate-100 pt-4">
              <input type="hidden" name="bookingId" value={b.id} />
              <p className="text-sm text-slate-600">
                {preview.restoreCredit
                  ? "Cancelling now returns the credit to your package."
                  : preview.refundCents > 0
                    ? `Cancelling now refunds ${formatCents(preview.refundCents)} to your card.`
                    : preview.onTime
                      ? "Cancelling now is free."
                      : `Cancellations within ${preview.policy.cancellationWindowHours} hours of the lesson aren't refunded.`}
              </p>
              <input name="reason" placeholder="Reason (optional)" maxLength={500} className="input" />
              <button className="btn-secondary text-red-700">Cancel lesson</button>
            </form>
          </div>
        )}
      </section>

      <aside className="space-y-3">
        {instructor ? (
          <>
            <InstructorCard instructor={instructor} favorite={parent?.favorite_instructor_id === instructor.id} />
            <form action={toggleFavoriteAction}>
              <input type="hidden" name="instructorId" value={instructor.id} />
              <button className="text-sm text-sky-700 underline">
                {parent?.favorite_instructor_id === instructor.id ? "Remove from favorites" : `♥ Make ${instructor.firstName} my favorite`}
              </button>
            </form>
            <Link href={`/book?instructor=${instructor.id}`} className="btn-secondary w-full">
              Book {instructor.firstName} again
            </Link>
          </>
        ) : (
          <p className="card text-sm text-slate-600">We&apos;re confirming your instructor.</p>
        )}
      </aside>
    </div>
  );
}
