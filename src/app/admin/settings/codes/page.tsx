import { ActionForm, Field } from "@/components/action-form";
import { createClient } from "@/lib/supabase/server";
import { formatDate, laDateString } from "@/lib/time";
import { formatCents } from "@/lib/utils";
import { saveDiscountCode } from "../actions";

type Code = { id: string; code: string; description: string | null; percent_off: number | null; amount_off_cents: number | null; applies_to: string[]; max_redemptions: number | null; redemptions: number; valid_until: string | null; is_active: boolean };

function CodeForm({ c }: { c?: Code }) {
  const kind = c?.amount_off_cents ? "amount" : "percent";
  return (
    <ActionForm action={saveDiscountCode} submitLabel={c ? "Save" : "Create code"} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {c && <input type="hidden" name="id" value={c.id} />}
      <Field label="Code">
        <input name="code" className="input uppercase" defaultValue={c?.code} placeholder="SUMMER15" required />
      </Field>
      <Field label="Discount">
        <div className="flex gap-2">
          <select name="discount_kind" className="input w-24" defaultValue={kind}>
            <option value="percent">%</option>
            <option value="amount">$</option>
          </select>
          <input name="value" className="input" inputMode="decimal" defaultValue={c ? (c.percent_off ? Number(c.percent_off) : (c.amount_off_cents ?? 0) / 100) : ""} />
        </div>
      </Field>
      <Field label="Max uses" hint="Blank = unlimited">
        <input name="max_redemptions" className="input" inputMode="numeric" defaultValue={c?.max_redemptions ?? ""} />
      </Field>
      <Field label="Ends on" hint="Blank = no end date">
        <input name="valid_until" type="date" className="input" defaultValue={c?.valid_until ? laDateString(new Date(c.valid_until)) : ""} />
      </Field>
      <Field label="Description (shown at checkout)" className="sm:col-span-2">
        <input name="description" className="input" defaultValue={c?.description ?? ""} />
      </Field>
      <fieldset className="text-sm sm:col-span-2">
        <legend className="mb-1 font-medium text-stone-700">Works on</legend>
        <div className="flex flex-wrap gap-4 pt-1.5">
          {[
            ["single", "Single lessons"],
            ["package", "Packages"],
            ["recurring", "Weekly lessons"],
          ].map(([v, l]) => (
            <label key={v} className="flex items-center gap-2">
              <input type="checkbox" name="applies_to" value={v} defaultChecked={c ? c.applies_to.includes(v) : true} /> {l}
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_active" defaultChecked={c?.is_active ?? true} /> Active
          </label>
        </div>
      </fieldset>
    </ActionForm>
  );
}

export default async function DiscountCodes() {
  const supabase = await createClient();
  const { data: codes } = await supabase.from("discount_codes").select("*").order("created_at", { ascending: false });
  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="font-semibold">New code</h2>
        <div className="mt-4">
          <CodeForm />
        </div>
      </section>
      {(codes ?? []).map((c: Code) => (
        <section key={c.id} className="card">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-mono font-semibold">{c.code}</h2>
            <span className="badge bg-stone-100 text-stone-600">{c.percent_off ? `${Number(c.percent_off)}% off` : `${formatCents(c.amount_off_cents ?? 0)} off`}</span>
            <span className="badge bg-stone-100 text-stone-600">
              used {c.redemptions}
              {c.max_redemptions ? ` / ${c.max_redemptions}` : ""}
            </span>
            {!c.is_active && <span className="badge bg-stone-200 text-stone-700">inactive</span>}
            {c.valid_until && <span className="text-xs text-stone-500">ends {formatDate(c.valid_until)}</span>}
          </div>
          <CodeForm c={c} />
        </section>
      ))}
    </div>
  );
}
