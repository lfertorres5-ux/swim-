import Image from "next/image";
import Link from "next/link";
import { ActionForm, Field } from "@/components/action-form";
import { CERT_BADGE, CERT_LABELS, certState } from "@/lib/admin/certs";
import { instructorPhotoUrl } from "@/lib/instructors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatDate, laDateString } from "@/lib/time";
import { formatCents, one } from "@/lib/utils";
import { inviteInstructor, revokeInvite } from "./actions";

export default async function AdminInstructors() {
  const supabase = await createClient();
  const today = laDateString();
  const [{ data: instructors }, { data: invites }, { data: settings }, { data: rules }] = await Promise.all([
    supabase
      .from("instructors")
      .select("id, first_name, photo_path, bio, is_active, user:users!instructors_id_fkey(email, last_name), private:instructor_private(pay_rate_cents_per_hour, deactivated_at), certs:instructor_certifications(id, kind, expires_on, verified_at), zones:instructor_zones(zone:zones(code)), terms:instructor_terms_acceptances(terms_version)")
      .order("is_active", { ascending: false })
      .order("first_name"),
    supabase.from("instructor_invites").select("id, email, pay_rate_cents_per_hour, expires_at, created_at").is("accepted_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
    supabase.from("platform_settings").select("default_instructor_pay_cents_per_hour, instructor_terms_version").single(),
    createAdminClient().from("availability_rules").select("instructor_id"),
  ]);
  const hasHours = new Set((rules ?? []).map((r) => r.instructor_id));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Instructors</h1>
          <p className="mt-1 text-sm text-stone-500">Invite, activate, set pay, and keep certifications current.</p>
        </div>
      </div>

      <section className="card">
        <h2 className="font-semibold">Invite an instructor</h2>
        <p className="mt-1 text-sm text-stone-500">They get an email to sign in. Once they add a photo, bio, zones and hours and accept the agreement, you activate them here.</p>
        <ActionForm action={inviteInstructor} submitLabel="Send invite" pendingLabel="Sending…" className="mt-4 grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
          <Field label="Email">
            <input name="email" type="email" required className="input" placeholder="name@example.com" />
          </Field>
          <Field label="Pay per hour">
            <input name="pay_rate" inputMode="decimal" className="input" defaultValue={((settings?.default_instructor_pay_cents_per_hour ?? 4000) / 100).toFixed(0)} />
          </Field>
        </ActionForm>
        {!!invites?.length && (
          <ul className="mt-5 divide-y divide-stone-100 border-t border-stone-100 text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {i.email} <span className="text-stone-500">· {i.pay_rate_cents_per_hour ? `${formatCents(i.pay_rate_cents_per_hour)}/hr` : "default pay"} · invited {formatDate(i.created_at)} · expires {formatDate(i.expires_at)}</span>
                </span>
                <ActionForm action={revokeInvite} submitLabel="Cancel invite" variant="link" inline confirm={`Cancel the invite for ${i.email}?`}>
                  <input type="hidden" name="id" value={i.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ul className="grid gap-4 md:grid-cols-2">
        {(instructors ?? []).map((i) => {
          const user = one(i.user);
          const priv = one(i.private);
          const photo = instructorPhotoUrl(i.photo_path);
          const termsOk = (i.terms ?? []).some((t) => t.terms_version === settings?.instructor_terms_version);
          const missing = [!i.photo_path && "photo", (i.bio ?? "").trim().length < 40 && "bio", !(i.zones ?? []).length && "zones", !hasHours.has(i.id) && "hours", !termsOk && "agreement"].filter(Boolean);
          const certs = (i.certs ?? []).map((c) => ({ ...c, ...certState(c.expires_on, today) }));
          const worst = certs.find((c) => c.state === "expired") ?? certs.find((c) => c.state === "expiring");
          return (
            <li key={i.id}>
              <Link href={`/admin/instructors/${i.id}`} className="card flex h-full gap-4 transition hover:shadow-md">
                {photo ? (
                  <Image src={photo} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-full object-cover" unoptimized />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-stone-100 text-lg font-semibold text-stone-500">{i.first_name.slice(0, 1)}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">
                      {i.first_name} {user?.last_name}
                    </p>
                    <span className={`badge ${i.is_active ? "bg-brand-50 text-brand-800" : priv?.deactivated_at ? "bg-stone-200 text-stone-700" : "bg-amber-100 text-amber-900"}`}>
                      {i.is_active ? "Active" : priv?.deactivated_at ? "Deactivated" : "Pending"}
                    </span>
                  </div>
                  <p className="truncate text-sm text-stone-500">{user?.email}</p>
                  <p className="mt-1 text-sm text-stone-600">
                    {priv ? `${formatCents(priv.pay_rate_cents_per_hour)}/hr` : "—"} · Zones {(i.zones ?? []).map((z) => one(z.zone)?.code).filter(Boolean).sort().join(", ") || "none"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {worst && (
                      <span className={`badge ${CERT_BADGE[worst.state]}`}>
                        {CERT_LABELS[worst.kind]} {worst.state === "expired" ? "expired" : `expires in ${worst.days}d`}
                      </span>
                    )}
                    {certs.some((c) => !c.verified_at) && <span className="badge bg-amber-100 text-amber-900">Certs to verify</span>}
                    {!i.is_active && missing.length > 0 && <span className="badge bg-stone-100 text-stone-600">Missing: {missing.join(", ")}</span>}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
