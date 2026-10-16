import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Field } from "@/components/action-form";
import { CERT_BADGE, CERT_LABELS, certState } from "@/lib/admin/certs";
import { instructorPhotoUrl, LEVEL_LABELS } from "@/lib/instructors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, laDateString } from "@/lib/time";
import { formatCents, one } from "@/lib/utils";
import { addCertification, deleteCertification, setInstructorActive, setPayRate, verifyCertification } from "../actions";

export default async function AdminInstructor({ params }: PageProps<"/admin/instructors/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const today = laDateString();
  const [{ data: i }, { data: settings }, { data: upcoming }, { data: earnings }, { count: hours }] = await Promise.all([
    supabase
      .from("instructors")
      .select("id, first_name, photo_path, bio, is_active, levels_taught, min_child_age_months, max_children_per_lesson, years_experience, user:users!instructors_id_fkey(email, last_name, phone), private:instructor_private(pay_rate_cents_per_hour, deactivated_at, deactivation_reason), certs:instructor_certifications(id, kind, issuer, issued_on, expires_on, verified_at), zones:instructor_zones(zone:zones(code, name)), terms:instructor_terms_acceptances(terms_version, accepted_at)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("platform_settings").select("instructor_terms_version").single(),
    supabase.from("bookings").select("id, starts_at, status, neighborhood, needs_attention").eq("instructor_id", id).in("status", ["pending_instructor", "confirmed"]).gte("starts_at", new Date().toISOString()).order("starts_at").limit(10),
    supabase.from("instructor_earnings").select("amount_cents, status").eq("instructor_id", id),
    createAdminClient().from("availability_rules").select("id", { count: "exact", head: true }).eq("instructor_id", id),
  ]);
  if (!i) notFound();
  const user = one(i.user);
  const priv = one(i.private);
  const photo = instructorPhotoUrl(i.photo_path);
  const terms = (i.terms ?? []).find((t) => t.terms_version === settings?.instructor_terms_version);
  const unpaid = (earnings ?? []).filter((e) => e.status !== "paid" && e.status !== "void").reduce((s, e) => s + e.amount_cents, 0);
  const checklist = [
    { label: "Photo", ok: Boolean(i.photo_path) },
    { label: "Bio (40+ characters)", ok: (i.bio ?? "").trim().length >= 40 },
    { label: "Zones", ok: (i.zones ?? []).length > 0 },
    { label: "Weekly hours", ok: (hours ?? 0) > 0 },
    { label: `Agreement (${settings?.instructor_terms_version})`, ok: Boolean(terms) },
    { label: "Verified CPR", ok: (i.certs ?? []).some((c) => c.kind === "cpr" && c.verified_at && certState(c.expires_on, today).state !== "expired") },
  ];

  return (
    <div className="space-y-6">
      <Link href="/admin/instructors" className="text-sm text-stone-500 hover:text-stone-800">
        ← Instructors
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        {photo && <Image src={photo} alt="" width={72} height={72} className="h-18 w-18 rounded-full object-cover" unoptimized />}
        <div>
          <h1 className="text-2xl font-semibold">
            {i.first_name} {user?.last_name}
          </h1>
          <p className="text-sm text-stone-500">
            {user?.email}
            {user?.phone && ` · ${user.phone}`}
          </p>
        </div>
        <span className={`badge ${i.is_active ? "bg-brand-50 text-brand-800" : "bg-amber-100 text-amber-900"}`}>{i.is_active ? "Active" : priv?.deactivated_at ? "Deactivated" : "Pending activation"}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold">Status</h2>
          <ul className="mt-3 grid grid-cols-2 gap-1.5 text-sm">
            {checklist.map((c) => (
              <li key={c.label} className={c.ok ? "text-stone-700" : "text-amber-800"}>
                {c.ok ? "✓" : "○"} {c.label}
              </li>
            ))}
          </ul>
          {priv?.deactivated_at && (
            <p className="mt-3 text-sm text-stone-500">
              Deactivated {formatDate(priv.deactivated_at)}
              {priv.deactivation_reason && ` — ${priv.deactivation_reason}`}
            </p>
          )}
          <div className="mt-4">
            {i.is_active ? (
              <ActionForm action={setInstructorActive} submitLabel="Deactivate" variant="danger" confirm={`Deactivate ${i.first_name}? They'll lose access right away and their upcoming lessons will be flagged for reassignment.`}>
                <input type="hidden" name="id" value={i.id} />
                <input type="hidden" name="active" value="false" />
                <Field label="Reason (private)">
                  <input name="reason" className="input" maxLength={300} />
                </Field>
              </ActionForm>
            ) : (
              <ActionForm action={setInstructorActive} submitLabel="Activate">
                <input type="hidden" name="id" value={i.id} />
                <input type="hidden" name="active" value="true" />
                {!terms && <p className="text-sm text-amber-800">They haven&apos;t accepted the current agreement yet, so they won&apos;t see lessons until they do.</p>}
              </ActionForm>
            )}
          </div>
        </section>

        <section className="card">
          <h2 className="font-semibold">Pay</h2>
          <p className="mt-1 text-sm text-stone-500">Earned per lesson when they submit the progress note. Unpaid so far: {formatCents(unpaid)}.</p>
          <ActionForm action={setPayRate} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={i.id} />
            <Field label="Per hour ($)">
              <input name="pay_rate" inputMode="decimal" className="input w-32" defaultValue={((priv?.pay_rate_cents_per_hour ?? 4000) / 100).toFixed(2)} />
            </Field>
          </ActionForm>
        </section>
      </div>

      <section className="card">
        <h2 className="font-semibold">Certifications</h2>
        <ul className="mt-3 divide-y divide-stone-100">
          {(i.certs ?? [])
            .toSorted((a, b) => (a.expires_on ?? "9999").localeCompare(b.expires_on ?? "9999"))
            .map((c) => {
              const s = certState(c.expires_on, today);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {CERT_LABELS[c.kind]} <span className="font-normal text-stone-500">{c.issuer && `· ${c.issuer}`}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className={`badge ${CERT_BADGE[s.state]}`}>
                        {s.state === "no_expiry" ? "No expiry" : s.state === "expired" ? `Expired ${formatDate(`${c.expires_on}T20:00:00Z`)}` : `Expires ${formatDate(`${c.expires_on}T20:00:00Z`, { month: "short", day: "numeric", year: "numeric" })}`}
                      </span>
                      <span className={`badge ${c.verified_at ? "bg-brand-50 text-brand-800" : "bg-amber-100 text-amber-900"}`}>{c.verified_at ? "Verified" : "Not verified"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <ActionForm action={verifyCertification} submitLabel={c.verified_at ? "Unverify" : "Mark verified"} variant="link" inline>
                      <input type="hidden" name="certId" value={c.id} />
                      <input type="hidden" name="verify" value={c.verified_at ? "false" : "true"} />
                    </ActionForm>
                    <ActionForm action={deleteCertification} submitLabel="Remove" variant="link" inline confirm="Remove this certification?">
                      <input type="hidden" name="certId" value={c.id} />
                    </ActionForm>
                  </div>
                </li>
              );
            })}
          {!(i.certs ?? []).length && <li className="py-3 text-sm text-stone-500">None on file.</li>}
        </ul>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-700">Add a certification</summary>
          <ActionForm action={addCertification} submitLabel="Add" className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={i.id} />
            <Field label="Type">
              <select name="kind" className="input">
                {Object.entries(CERT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Issuer">
              <input name="issuer" className="input" placeholder="American Red Cross" />
            </Field>
            <Field label="Issued">
              <input name="issued_on" type="date" className="input" />
            </Field>
            <Field label="Expires">
              <input name="expires_on" type="date" className="input" />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="verified" defaultChecked /> I&apos;ve seen the card — mark verified
            </label>
          </ActionForm>
        </details>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold">Teaches</h2>
          <p className="mt-2 text-sm text-stone-600">Zones: {(i.zones ?? []).map((z) => `${one(z.zone)?.code} (${one(z.zone)?.name})`).join(", ") || "none"}</p>
          <p className="mt-1 text-sm text-stone-600">Levels: {(i.levels_taught ?? []).map((l: string) => LEVEL_LABELS[l]).join(", ")}</p>
          <p className="mt-1 text-sm text-stone-600">
            Ages {Math.floor(i.min_child_age_months / 12) || `${i.min_child_age_months} mo`}+ · up to {i.max_children_per_lesson} swimmers{i.years_experience !== null && ` · ${i.years_experience} yrs experience`}
          </p>
          {i.bio && <p className="mt-3 text-sm text-stone-500">“{i.bio}”</p>}
        </section>
        <section className="card">
          <h2 className="font-semibold">Upcoming lessons</h2>
          <ul className="mt-2 divide-y divide-stone-100 text-sm">
            {(upcoming ?? []).map((b) => (
              <li key={b.id} className="py-2">
                <Link href={`/admin/bookings/${b.id}`} className="hover:underline">
                  {formatDateTime(b.starts_at)} · {b.neighborhood}
                </Link>
                {b.needs_attention && <span className="badge ml-2 bg-amber-100 text-amber-900">needs attention</span>}
                {b.status === "pending_instructor" && <span className="badge ml-2 bg-stone-100 text-stone-600">awaiting reply</span>}
              </li>
            ))}
            {!upcoming?.length && <li className="py-2 text-stone-500">Nothing scheduled.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
