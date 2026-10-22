import { requireRole } from "@/lib/auth";
import { ActionForm, Field } from "@/components/action-form";
import { createClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/utils";
import { savePackage, saveLessonPrice, savePricingRules } from "./actions";

const dollars = (c: number) => (c / 100).toFixed(c % 100 ? 2 : 0);

export default async function PricesAndPackages() {
  await requireRole("admin"); // every admin page checks on its own, never only via the layout
  const supabase = await createClient();
  const [{ data: prices }, { data: config }, { data: packages }] = await Promise.all([
    supabase.from("lesson_prices").select("*").order("duration_minutes"),
    supabase.from("pricing_config").select("*").single(),
    supabase.from("package_offerings").select("*").order("lesson_count"),
  ]);
  const base60 = prices?.find((p) => p.duration_minutes === 60)?.price_cents;

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="font-semibold">Lesson prices</h2>
        <p className="mt-1 text-sm text-stone-500">Price per lesson, before extra swimmers, travel fees and discounts.</p>
        <div className="mt-4 space-y-3">
          {(prices ?? []).map((p) => (
            <ActionForm key={p.duration_minutes} action={saveLessonPrice} className="grid grid-cols-2 items-end gap-3 rounded-xl bg-sand/60 p-3 sm:grid-cols-[90px_120px_1fr_auto_auto]">
              <input type="hidden" name="duration_minutes" value={p.duration_minutes} />
              <p className="pb-2.5 font-medium">{p.duration_minutes} min</p>
              <Field label="Price ($)">
                <input name="price" className="input" inputMode="decimal" defaultValue={dollars(p.price_cents)} />
              </Field>
              <Field label="Label" className="col-span-2 sm:col-span-1">
                <input name="label" className="input" defaultValue={p.label ?? ""} />
              </Field>
              <label className="flex items-center gap-2 pb-2.5 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={p.is_active} /> Offered
              </label>
            </ActionForm>
          ))}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-brand-700">Add a lesson length</summary>
            <ActionForm action={saveLessonPrice} submitLabel="Add" className="mt-3 grid grid-cols-2 items-end gap-3 sm:grid-cols-[120px_120px_1fr_auto_auto]">
              <Field label="Minutes">
                <input name="duration_minutes" className="input" inputMode="numeric" placeholder="45" />
              </Field>
              <Field label="Price ($)">
                <input name="price" className="input" inputMode="decimal" />
              </Field>
              <Field label="Label" className="col-span-2 sm:col-span-1">
                <input name="label" className="input" placeholder="Standard" />
              </Field>
              <label className="flex items-center gap-2 pb-2.5 text-sm">
                <input type="checkbox" name="is_active" defaultChecked /> Offered
              </label>
            </ActionForm>
          </details>
        </div>
      </section>

      {config && (
        <section className="card">
          <h2 className="font-semibold">Pricing rules</h2>
          <ActionForm action={savePricingRules} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Swimmers included in the price">
              <input name="included_children" className="input" inputMode="numeric" defaultValue={config.included_children} />
            </Field>
            <Field label="Each extra swimmer ($)">
              <input name="extra_child" className="input" inputMode="decimal" defaultValue={dollars(config.extra_child_cents)} />
            </Field>
            <Field label="Weekly lessons discount (%)">
              <input name="recurring_discount_pct" className="input" inputMode="numeric" defaultValue={Number(config.recurring_discount_pct)} />
            </Field>
            <Field label="Neighborhood discount ($)" hint="When a lesson sits next to another one nearby.">
              <input name="neighborhood_discount" className="input" inputMode="decimal" defaultValue={dollars(config.neighborhood_discount_cents)} />
            </Field>
            <Field label="“Next to” means within (minutes)">
              <input name="neighborhood_window_minutes" className="input" inputMode="numeric" defaultValue={config.neighborhood_window_minutes} />
            </Field>
          </ActionForm>
        </section>
      )}

      <section className="card">
        <h2 className="font-semibold">Packages</h2>
        <p className="mt-1 text-sm text-stone-500">Families buying a package can reach their instructor directly once the instructor accepts.</p>
        <div className="mt-4 space-y-3">
          {(packages ?? []).map((p) => (
            <ActionForm key={p.id} action={savePackage} className="grid grid-cols-2 items-end gap-3 rounded-xl bg-sand/60 p-3 sm:grid-cols-[1fr_90px_100px_110px_auto_auto]">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="sort_order" value={p.sort_order} />
              <Field label="Name" className="col-span-2 sm:col-span-1">
                <input name="name" className="input" defaultValue={p.name} />
              </Field>
              <Field label="Lessons">
                <input name="lesson_count" className="input" inputMode="numeric" defaultValue={p.lesson_count} />
              </Field>
              <Field label="Discount %">
                <input name="discount_pct" className="input" inputMode="numeric" defaultValue={Number(p.discount_pct)} />
              </Field>
              <Field label="Valid (days)">
                <input name="validity_days" className="input" inputMode="numeric" defaultValue={p.validity_days} />
              </Field>
              <label className="flex items-center gap-2 pb-2.5 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={p.is_active} /> On sale
              </label>
              {base60 !== undefined && (
                <p className="col-span-2 text-xs text-stone-500 sm:col-span-6">
                  60-min, 1–2 swimmers: {formatCents(Math.round(base60 * (1 - Number(p.discount_pct) / 100)))}/lesson · {formatCents(Math.round(base60 * (1 - Number(p.discount_pct) / 100)) * p.lesson_count)} total
                </p>
              )}
            </ActionForm>
          ))}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-brand-700">Add a package</summary>
            <ActionForm action={savePackage} submitLabel="Add" className="mt-3 grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_90px_100px_110px_auto_auto]">
              <Field label="Name" className="col-span-2 sm:col-span-1">
                <input name="name" className="input" placeholder="10-lesson pack" />
              </Field>
              <Field label="Lessons">
                <input name="lesson_count" className="input" inputMode="numeric" />
              </Field>
              <Field label="Discount %">
                <input name="discount_pct" className="input" inputMode="numeric" />
              </Field>
              <Field label="Valid (days)">
                <input name="validity_days" className="input" inputMode="numeric" defaultValue={180} />
              </Field>
              <label className="flex items-center gap-2 pb-2.5 text-sm">
                <input type="checkbox" name="is_active" defaultChecked /> On sale
              </label>
            </ActionForm>
          </details>
        </div>
      </section>
    </div>
  );
}
