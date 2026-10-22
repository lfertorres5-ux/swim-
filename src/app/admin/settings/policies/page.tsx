import { ActionForm, Field } from "@/components/action-form";
import { truemedConfigured } from "@/lib/payments/truemed";
import { createClient } from "@/lib/supabase/server";
import { savePolicies } from "../actions";

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="card">
      <legend className="sr-only">{title}</legend>
      <h2 className="font-semibold">{title}</h2>
      {note && <p className="mt-1 text-sm text-stone-500">{note}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

export default async function Policies() {
  const supabase = await createClient();
  const { data: s } = await supabase.from("platform_settings").select("*").single();
  if (!s) return null;
  return (
    <ActionForm action={savePolicies} submitLabel="Save policies" className="space-y-6">
      <Group title="Cancellations" note="Families cancelling inside the window get the late refund percentage.">
        <Field label="Free cancellation up to (hours before)">
          <input name="cancellation_window_hours" className="input" inputMode="numeric" defaultValue={s.cancellation_window_hours} />
        </Field>
        <Field label="Late cancellation refund (%)">
          <input name="late_cancel_refund_pct" className="input" inputMode="numeric" defaultValue={Number(s.late_cancel_refund_pct)} />
        </Field>
      </Group>
      <Group title="Booking">
        <Field label="Book at least (hours ahead)">
          <input name="min_booking_notice_hours" className="input" inputMode="numeric" defaultValue={s.min_booking_notice_hours} />
        </Field>
        <Field label="Book up to (days ahead)">
          <input name="max_booking_horizon_days" className="input" inputMode="numeric" defaultValue={s.max_booking_horizon_days} />
        </Field>
        <Field label="Max swimmers per lesson">
          <input name="max_children_per_lesson" className="input" inputMode="numeric" defaultValue={s.max_children_per_lesson} />
        </Field>
        <Field label="Instructors reply within (hours)">
          <input name="booking_request_window_hours" className="input" inputMode="numeric" defaultValue={s.booking_request_window_hours} />
        </Field>
        <Field label="Hold a slot during checkout (minutes)" hint="31 or more (Stripe's minimum checkout time)">
          <input name="payment_hold_minutes" className="input" inputMode="numeric" defaultValue={s.payment_hold_minutes} />
        </Field>
        <Field label="Default travel time between lessons (min)">
          <input name="default_travel_buffer_minutes" className="input" inputMode="numeric" defaultValue={s.default_travel_buffer_minutes} />
        </Field>
        <Field label="Reminder (hours before)">
          <input name="reminder_hours_before" className="input" inputMode="numeric" defaultValue={s.reminder_hours_before} />
        </Field>
      </Group>
      <Group title="Instructors">
        <Field label="Default pay per hour ($)" hint="For new invites">
          <input name="default_pay" className="input" inputMode="decimal" defaultValue={(s.default_instructor_pay_cents_per_hour / 100).toFixed(2)} />
        </Field>
        <Field label="Sub board: post at least (hours before)">
          <input name="sub_board_min_notice_hours" className="input" inputMode="numeric" defaultValue={s.sub_board_min_notice_hours} />
        </Field>
        <label className="flex items-start gap-2 pt-6 text-sm">
          <input type="checkbox" name="sub_board_requires_approval" defaultChecked={s.sub_board_requires_approval} className="mt-0.5" />
          <span>
            I approve every sub <span className="block text-stone-500">Off: the first qualified instructor to claim gets it.</span>
          </span>
        </label>
        <Field label="Family ↔ instructor contact">
          <select name="contact_sharing" className="input" defaultValue={s.contact_sharing}>
            <option value="package_instructor">Share after a package is bought and accepted</option>
            <option value="never">Never share</option>
          </select>
        </Field>
      </Group>
      <Group title="HSA/FSA payments (Truemed)" note="Families can pay with HSA/FSA funds through Truemed, which runs a short eligibility survey. Needs an approved Truemed merchant account.">
        <label className="flex items-start gap-2 pt-1 text-sm sm:col-span-2">
          <input type="checkbox" name="hsa_fsa_enabled" defaultChecked={s.hsa_fsa_enabled} className="mt-0.5" disabled={!truemedConfigured() && !s.hsa_fsa_enabled} />
          <span>
            Offer “Pay with HSA/FSA” at checkout
            <span className="block text-stone-500">
              {truemedConfigured() ? "Truemed is connected." : "Add TRUEMED_API_KEY in Vercel first (see docs/hsa-fsa.md). Until then this stays off."}
            </span>
          </span>
        </label>
      </Group>
      <Group title="Partner Club Day Pass">
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input type="checkbox" name="day_pass_enabled" defaultChecked={s.day_pass_enabled} /> Accept inquiries
        </label>
        <Field label="Club name (shown to families)" hint="Blank shows “our partner country club”">
          <input name="partner_club_name" className="input" defaultValue={s.partner_club_name ?? ""} />
        </Field>
      </Group>
      <Group title="Contact">
        <Field label="Support email">
          <input name="support_email" type="email" className="input" defaultValue={s.support_email ?? ""} />
        </Field>
        <Field label="Support phone">
          <input name="support_phone" className="input" defaultValue={s.support_phone ?? ""} />
        </Field>
      </Group>
    </ActionForm>
  );
}
