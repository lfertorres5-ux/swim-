"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { InstructorCard } from "@/components/instructor-card";
import type { InstructorCardData } from "@/lib/instructor-cards";
import type { Quote } from "@/lib/pricing/quote";
import { AddressAutocomplete } from "./address-autocomplete";
import { addChildAction, checkAddressAction, checkoutAction, eligibleInstructorsAction, quoteAction, slotsAction, type SlotView } from "./actions";
import { WeekCalendar } from "./week-calendar";

export type WizardProps = {
  prices: { durationMinutes: number; priceCents: number }[];
  offerings: { id: string; name: string; lessonCount: number; discountPct: number }[];
  recurringTermWeeks: number[];
  recurringDiscountPct: number;
  includedChildren: number;
  extraChildCents: number;
  neighborhoodDiscountCents: number;
  cancellationWindowHours: number;
  bookingRequestWindowHours: number;
  kids: Child[];
  savedAddress: { line1: string; line2: string | null; city: string; postalCode: string; accessNotes: string | null } | null;
  favoriteInstructorId: string | null;
  packages: { id: string; lessonsRemaining: number; durationMinutes: number; childrenCount: number; zoneId: string | null; expiresAt: string | null }[];
  preferences: { weekdays: number[]; windows: { start: string; end: string }[] };
  mapsBrowserKey: string | null;
  today: string;
  initialInstructorId: string | null;
};

type Child = { id: string; firstName: string; birthDate: string | null; swimLevel: string };
type Zone = { id: string; code: string; name: string; travelFeeCents: number; minBookingMinutes: number };
type Plan = { kind: "single" } | { kind: "package"; offeringId: string } | { kind: "recurring"; weeks: number } | { kind: "package_credit"; packageId: string };

const STEPS = ["Address", "Swimmers", "Instructor", "Plan", "Time", "Review"] as const;
const LEVELS: [string, string][] = [
  ["water_acclimation", "New to water / nervous"],
  ["beginner", "Beginner"],
  ["advanced_beginner", "Advanced beginner"],
  ["intermediate", "Intermediate"],
  ["advanced", "Advanced"],
  ["stroke_technique", "Stroke technique"],
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME_WINDOWS = [
  { key: "morning", label: "Morning", start: "06:00", end: "12:00" },
  { key: "afternoon", label: "Afternoon", start: "12:00", end: "17:00" },
  { key: "evening", label: "Evening", start: "17:00", end: "21:00" },
];

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const whenFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

export function BookingWizard(props: WizardProps) {
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 1. Address
  const [address, setAddress] = useState({
    placeId: undefined as string | undefined,
    line1: props.savedAddress?.line1 ?? "",
    line2: props.savedAddress?.line2 ?? "",
    city: props.savedAddress?.city ?? "",
    postalCode: props.savedAddress?.postalCode ?? "",
    accessNotes: props.savedAddress?.accessNotes ?? "",
  });
  const [zone, setZone] = useState<Zone | null>(null);
  const [neighborhood, setNeighborhood] = useState<string | null>(null);
  const [saveAsHome, setSaveAsHome] = useState(!props.savedAddress);
  const [manual, setManual] = useState(!props.mapsBrowserKey || Boolean(props.savedAddress));

  // 2. Swimmers + length
  const [children, setChildren] = useState(props.kids);
  const [childIds, setChildIds] = useState<string[]>(props.kids.length === 1 ? [props.kids[0].id] : []);
  const [duration, setDuration] = useState<number | null>(null);
  const [newChild, setNewChild] = useState({ firstName: "", birthDate: "", swimLevel: "beginner", notes: "" });
  const [showAddChild, setShowAddChild] = useState(props.kids.length === 0);

  // 3. Instructor
  const [instructors, setInstructors] = useState<InstructorCardData[] | null>(null);
  const [instructorId, setInstructorId] = useState<string | null>(props.initialInstructorId);

  // 4. Plan
  const [plan, setPlan] = useState<Plan>({ kind: "single" });
  const [planQuotes, setPlanQuotes] = useState<Record<string, Quote>>({});

  // 5. Time
  const [weekStart, setWeekStart] = useState(addDays(props.today, 1));
  const [slots, setSlots] = useState<SlotView[]>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [slot, setSlot] = useState<SlotView | null>(null);
  const [prefDays, setPrefDays] = useState<number[]>(props.preferences.weekdays);
  const [prefWindows, setPrefWindows] = useState<string[]>(
    TIME_WINDOWS.filter((w) => props.preferences.windows.some((p) => p.start < w.end && w.start < p.end)).map((w) => w.key),
  );
  const [onlyPreferred, setOnlyPreferred] = useState(false);

  // 6. Review
  const [promo, setPromo] = useState("");
  const [quote, setQuote] = useState<(Quote & { promoMessage?: string }) | null>(null);

  const weeks = plan.kind === "recurring" ? plan.weeks : null;
  const usableCredits = useMemo(
    () => props.packages.filter((p) => p.lessonsRemaining > 0 && p.durationMinutes === duration && p.childrenCount === childIds.length && (!p.zoneId || p.zoneId === zone?.id)),
    [props.packages, duration, childIds.length, zone?.id],
  );

  // --- Step 1 -------------------------------------------------------------
  function checkAddress() {
    setError(null);
    startTransition(async () => {
      const result = await checkAddressAction(address);
      if (!result.ok) {
        setZone(null);
        setError(result.message);
        return;
      }
      setZone(result.address.zone);
      setNeighborhood(result.address.neighborhood);
      setAddress((a) => ({ ...a, line1: result.address.line1, city: result.address.city, postalCode: result.address.postalCode }));
      setStep(1);
    });
  }

  // --- Step 2 -------------------------------------------------------------
  function addChild() {
    setError(null);
    startTransition(async () => {
      const r = await addChildAction(newChild);
      if (!r.ok) return setError(r.error);
      setChildren((c) => [...c, r.data]);
      setChildIds((ids) => [...ids, r.data.id]);
      setNewChild({ firstName: "", birthDate: "", swimLevel: "beginner", notes: "" });
      setShowAddChild(false);
    });
  }

  function continueToInstructors() {
    if (!zone || !duration || childIds.length === 0) return;
    setError(null);
    startTransition(async () => {
      const r = await eligibleInstructorsAction({ zoneId: zone.id, durationMinutes: duration, childIds });
      if (!r.ok) return setError(r.error);
      setInstructors(r.data);
      if (instructorId && !r.data.some((i) => i.id === instructorId)) setInstructorId(null);
      setStep(2);
    });
  }

  // --- Step 4: price every plan option for comparison -----------------------
  useEffect(() => {
    if (step !== 3 || !zone || !duration) return;
    const options: [string, Plan][] = [
      ["single", { kind: "single" }],
      ...props.offerings.map((o): [string, Plan] => [`package:${o.id}`, { kind: "package", offeringId: o.id }]),
      ...props.recurringTermWeeks.map((w): [string, Plan] => [`recurring:${w}`, { kind: "recurring", weeks: w }]),
    ];
    Promise.all(options.map(([key, p]) => quoteAction({ zoneId: zone.id, durationMinutes: duration, childrenCount: childIds.length, isNeighborhoodSlot: false, plan: p }).then((r) => [key, r] as const))).then(
      (results) => setPlanQuotes(Object.fromEntries(results.filter(([, r]) => r.ok).map(([k, r]) => [k, (r as { data: Quote }).data]))),
    );
  }, [step, zone, duration, childIds.length, props.offerings, props.recurringTermWeeks]);

  // --- Step 5 -------------------------------------------------------------
  const slotsRequest = useMemo(
    () =>
      step === 4 && zone && duration
        ? {
            zoneId: zone.id,
            durationMinutes: duration,
            childIds,
            instructorId,
            fromDate: weekStart,
            days: 7,
            weeks,
            preferences: {
              weekdays: prefDays,
              windows: TIME_WINDOWS.filter((w) => prefWindows.includes(w.key)).map(({ start, end }) => ({ start, end })),
            },
            onlyPreferred,
          }
        : null,
    [step, zone, duration, childIds, instructorId, weekStart, weeks, prefDays, prefWindows, onlyPreferred],
  );
  const slotsKey = slotsRequest ? JSON.stringify(slotsRequest) : null;
  const [loadedSlotsKey, setLoadedSlotsKey] = useState<string | null>(null);
  const slotsLoading = slotsKey !== null && slotsKey !== loadedSlotsKey;

  useEffect(() => {
    if (!slotsRequest || !slotsKey) return;
    let stale = false;
    slotsAction(slotsRequest).then((r) => {
      if (stale) return;
      if (r.ok) {
        setSlots(r.data.slots);
        setSuggested(r.data.suggested);
        setError(null);
      } else setError(r.error);
      setLoadedSlotsKey(slotsKey);
    });
    return () => {
      stale = true;
    };
  }, [slotsRequest, slotsKey]);

  // --- Step 6 -------------------------------------------------------------
  const refreshQuote = useCallback(() => {
    if (!zone || !duration || !slot) return;
    startTransition(async () => {
      const r = await quoteAction({
        zoneId: zone.id,
        durationMinutes: duration,
        childrenCount: childIds.length,
        isNeighborhoodSlot: slot.isNeighborhoodSlot,
        plan,
        promoCode: promo || undefined,
      });
      if (r.ok) setQuote(r.data);
      else setError(r.error);
    });
  }, [zone, duration, slot, childIds.length, plan, promo]);


  function pay() {
    if (!zone || !duration || !slot) return;
    setError(null);
    startTransition(async () => {
      const r = await checkoutAction({
        address: { ...address, line2: address.line2 || undefined, accessNotes: address.accessNotes || undefined },
        saveAsHome,
        durationMinutes: duration,
        childIds,
        instructorId,
        plan,
        start: slot.start,
        promoCode: promo || undefined,
      });
      if (!r.ok) {
        setError(r.error);
        if (/taken|unavailable/i.test(r.error)) {
          setSlot(null);
          setStep(4);
        }
        return;
      }
      window.location.href = r.data.url;
    });
  }

  const chosenInstructor = instructors?.find((i) => i.id === (instructorId ?? slot?.instructorIds[0]));

  return (
    <div className="mx-auto max-w-5xl">
      <ol className="mb-8 flex flex-wrap gap-2 text-sm">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              disabled={i > step}
              onClick={() => setStep(i)}
              className={`rounded-full px-3 py-1 ${i === step ? "bg-sky-600 text-white" : i < step ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-400"}`}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {error && (
        <p className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {step === 0 && (
        <section className="card max-w-2xl space-y-4">
          <h2 className="text-xl font-semibold">Where are the lessons?</h2>
          <p className="text-sm text-slate-600">We come to your pool anywhere in our San Diego County service area. Your address is only shared with your instructor on the day of each lesson.</p>
          {!manual && props.mapsBrowserKey ? (
            <>
              <AddressAutocomplete apiKey={props.mapsBrowserKey} onPick={(s) => setAddress((a) => ({ ...a, placeId: s.placeId, line1: s.line1 }))} />
              <button type="button" className="text-sm text-sky-700 underline" onClick={() => setManual(true)}>
                Enter address manually
              </button>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-6">
              <input className="input sm:col-span-4" placeholder="Street address" value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value, placeId: undefined })} />
              <input className="input sm:col-span-2" placeholder="Apt / unit" value={address.line2} onChange={(e) => setAddress({ ...address, line2: e.target.value })} />
              <input className="input sm:col-span-4" placeholder="City" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value, placeId: undefined })} />
              <input className="input sm:col-span-2" placeholder="ZIP" inputMode="numeric" maxLength={5} value={address.postalCode} onChange={(e) => setAddress({ ...address, postalCode: e.target.value, placeId: undefined })} />
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Gate code, parking or pool directions <span className="font-normal text-slate-500">(shared with your instructor on lesson day)</span>
            <input className="input" value={address.accessNotes} maxLength={500} onChange={(e) => setAddress({ ...address, accessNotes: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={saveAsHome} onChange={(e) => setSaveAsHome(e.target.checked)} /> Save as my home pool address
          </label>
          <button className="btn-primary" disabled={pending || address.line1.trim().length < 3} onClick={checkAddress}>
            {pending ? "Checking…" : "Check my address"}
          </button>
        </section>
      )}

      {step === 1 && zone && (
        <section className="space-y-6">
          <div className="card flex flex-wrap items-center justify-between gap-2 border-emerald-200 bg-emerald-50">
            <p className="text-emerald-900">
              ✓ You&apos;re in <strong>Zone {zone.code}</strong> ({zone.name}){neighborhood ? ` · ${neighborhood}` : ""}.{" "}
              {zone.travelFeeCents ? `${money(zone.travelFeeCents)} travel fee per lesson.` : "No travel fee."}
              {zone.minBookingMinutes ? ` ${zone.minBookingMinutes}-minute minimum.` : ""}
            </p>
            <button className="text-sm text-emerald-800 underline" onClick={() => setStep(0)}>
              Change
            </button>
          </div>

          <div className="card space-y-3">
            <h2 className="text-xl font-semibold">Who&apos;s swimming?</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {children.map((c) => (
                <label key={c.id} className={`flex items-center gap-3 rounded-xl border p-3 ${childIds.includes(c.id) ? "border-sky-500 bg-sky-50" : "border-slate-200"}`}>
                  <input type="checkbox" checked={childIds.includes(c.id)} onChange={(e) => setChildIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))} />
                  <span>
                    <span className="font-medium">{c.firstName}</span>
                    <span className="block text-xs text-slate-500">{LEVELS.find(([v]) => v === c.swimLevel)?.[1]}</span>
                  </span>
                </label>
              ))}
            </div>
            {showAddChild ? (
              <div className="grid gap-3 rounded-xl border border-dashed border-slate-300 p-3 sm:grid-cols-4">
                <input className="input" placeholder="First name" value={newChild.firstName} onChange={(e) => setNewChild({ ...newChild, firstName: e.target.value })} />
                <label className="text-xs text-slate-500">
                  Birth date
                  <input type="date" className="input" max={props.today} value={newChild.birthDate} onChange={(e) => setNewChild({ ...newChild, birthDate: e.target.value })} />
                </label>
                <select className="input" value={newChild.swimLevel} onChange={(e) => setNewChild({ ...newChild, swimLevel: e.target.value })}>
                  {LEVELS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <input className="input" placeholder="Notes for instructor (optional)" value={newChild.notes} onChange={(e) => setNewChild({ ...newChild, notes: e.target.value })} />
                <button className="btn-secondary sm:col-span-4 sm:w-fit" disabled={pending} onClick={addChild}>
                  Add swimmer
                </button>
              </div>
            ) : (
              <button className="text-sm text-sky-700 underline" onClick={() => setShowAddChild(true)}>
                + Add a swimmer
              </button>
            )}
            <p className="text-xs text-slate-500">
              Lessons include up to {props.includedChildren} swimmers; each additional swimmer is {money(props.extraChildCents)} per lesson. Only first names, ages, levels and
              notes are shared with your instructor.
            </p>
          </div>

          <div className="card space-y-3">
            <h2 className="text-xl font-semibold">Lesson length</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {props.prices.map((p) => {
                const disabled = p.durationMinutes < zone.minBookingMinutes;
                return (
                  <button
                    key={p.durationMinutes}
                    disabled={disabled}
                    onClick={() => setDuration(p.durationMinutes)}
                    className={`rounded-xl border p-4 text-left ${duration === p.durationMinutes ? "border-sky-500 bg-sky-50" : "border-slate-200"} ${disabled ? "opacity-40" : ""}`}
                  >
                    <span className="block text-lg font-semibold">{p.durationMinutes} min</span>
                    <span className="text-sm text-slate-600">{money(p.priceCents)} per lesson</span>
                    {disabled && <span className="block text-xs text-slate-500">Zone {zone.code} minimum is {zone.minBookingMinutes} min</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <button className="btn-primary" disabled={pending || !duration || childIds.length === 0} onClick={continueToInstructors}>
            {pending ? "Finding instructors…" : "Continue"}
          </button>
        </section>
      )}

      {step === 2 && instructors && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Choose your instructor</h2>
          <p className="text-sm text-slate-600">All instructors are CPR- and lifeguard-certified and insured. Pick someone specific, or let us match you with the first available.</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <button onClick={() => setInstructorId(null)} className="text-left">
              <div className={`card flex h-full flex-col justify-center gap-2 ${instructorId === null ? "ring-2 ring-sky-500" : ""}`}>
                <p className="text-lg font-semibold">⚡ First available</p>
                <p className="text-sm text-slate-600">See the most times. We&apos;ll match you with the best-fit instructor for your pool, swimmers and schedule.</p>
              </div>
            </button>
            {[...instructors]
              .sort((a, b) => Number(b.id === props.favoriteInstructorId) - Number(a.id === props.favoriteInstructorId))
              .slice(0, 6)
              .map((i) => (
                <button key={i.id} onClick={() => setInstructorId(i.id)} className="text-left">
                  <InstructorCard instructor={i} favorite={i.id === props.favoriteInstructorId} selected={instructorId === i.id} />
                </button>
              ))}
          </div>
          {instructors.length === 0 && <p className="card text-slate-600">No instructor currently teaches this combination of area, ages and levels. Please contact us and we&apos;ll help.</p>}
          <button className="btn-primary" disabled={instructors.length === 0} onClick={() => setStep(3)}>
            Continue
          </button>
        </section>
      )}

      {step === 3 && duration && zone && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">How would you like to book?</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <PlanOption selected={plan.kind === "single"} onClick={() => setPlan({ kind: "single" })} title="Single lesson" quote={planQuotes.single} note={`Neighborhood slots save ${money(props.neighborhoodDiscountCents)}.`} />
            {props.offerings.map((o) => (
              <PlanOption
                key={o.id}
                selected={plan.kind === "package" && plan.offeringId === o.id}
                onClick={() => setPlan({ kind: "package", offeringId: o.id })}
                title={`${o.name} · ${o.discountPct}% off`}
                quote={planQuotes[`package:${o.id}`]}
                note="Book your first lesson now and the rest whenever you like. Once your instructor confirms, you'll get their phone and email to coordinate directly."
              />
            ))}
            {props.recurringTermWeeks.map((w) => (
              <PlanOption
                key={w}
                selected={plan.kind === "recurring" && plan.weeks === w}
                onClick={() => setPlan({ kind: "recurring", weeks: w })}
                title={`Weekly for ${w} weeks · ${props.recurringDiscountPct}% off`}
                quote={planQuotes[`recurring:${w}`]}
                note="Same day, time and instructor every week."
              />
            ))}
            {usableCredits.map((p) => (
              <PlanOption
                key={p.id}
                selected={plan.kind === "package_credit" && plan.packageId === p.id}
                onClick={() => setPlan({ kind: "package_credit", packageId: p.id })}
                title={`Use a package credit (${p.lessonsRemaining} left)`}
                quote={undefined}
                note="Already paid — no charge today."
              />
            ))}
          </div>
          <button
            className="btn-primary"
            onClick={() => {
              setSlot(null);
              setStep(4);
            }}
          >
            Continue
          </button>
        </section>
      )}

      {step === 4 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{weeks ? `Pick a weekly time (${weeks} weeks)` : "Pick a time"}</h2>
              <p className="text-sm text-slate-500">
                All times are San Diego time.{" "}
                <span className="badge bg-emerald-100 text-emerald-800">Neighborhood −{money(props.neighborhoodDiscountCents)}</span> slots are next to another lesson nearby
                {plan.kind === "single" ? " and are discounted." : " (discount applies to single lessons)."}
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary" disabled={weekStart <= addDays(props.today, 1) || slotsLoading} onClick={() => setWeekStart(addDays(weekStart, -7))}>
                ← Earlier
              </button>
              <button className="btn-secondary" disabled={slotsLoading} onClick={() => setWeekStart(addDays(weekStart, 7))}>
                Later →
              </button>
            </div>
          </div>

          <div className="card flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-slate-700">Preferred:</span>
            {DAYS.map((d, i) => (
              <Chip key={d} on={prefDays.includes(i)} onClick={() => setPrefDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))}>
                {d}
              </Chip>
            ))}
            <span className="mx-1 h-5 w-px bg-slate-200" />
            {TIME_WINDOWS.map((w) => (
              <Chip key={w.key} on={prefWindows.includes(w.key)} onClick={() => setPrefWindows((x) => (x.includes(w.key) ? x.filter((y) => y !== w.key) : [...x, w.key]))}>
                {w.label}
              </Chip>
            ))}
            <label className="ml-auto flex items-center gap-2">
              <input type="checkbox" checked={onlyPreferred} onChange={(e) => setOnlyPreferred(e.target.checked)} /> Only show preferred
            </label>
          </div>

          <div className={slotsLoading ? "opacity-50" : ""}>
            <WeekCalendar
              fromDate={weekStart}
              slots={slots}
              suggested={suggested}
              selected={slot?.start ?? null}
              onSelect={setSlot}
              neighborhoodDiscountLabel={plan.kind === "single" ? `−${money(props.neighborhoodDiscountCents)} nearby` : "nearby"}
            />
          </div>
          {!slotsLoading && slots.length === 0 && <p className="text-sm text-slate-500">No openings this week{onlyPreferred ? " at your preferred times" : ""}. Try later dates{instructorId ? " or “First available”" : ""}.</p>}
          <button
            className="btn-primary"
            disabled={!slot}
            onClick={() => {
              setQuote(null);
              setStep(5);
              refreshQuote();
            }}
          >
            Continue
          </button>
        </section>
      )}

      {step === 5 && slot && zone && duration && (
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="card space-y-3 lg:col-span-2">
            <h2 className="text-xl font-semibold">Review &amp; pay</h2>
            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="text-slate-500">When</dt>
              <dd className="col-span-2 font-medium">
                {whenFmt.format(new Date(slot.start))}
                {weeks ? `, then weekly for ${weeks} weeks` : ""}
              </dd>
              <dt className="text-slate-500">Length</dt>
              <dd className="col-span-2">{duration} minutes</dd>
              <dt className="text-slate-500">Swimmers</dt>
              <dd className="col-span-2">{children.filter((c) => childIds.includes(c.id)).map((c) => c.firstName).join(", ")}</dd>
              <dt className="text-slate-500">Where</dt>
              <dd className="col-span-2">
                {address.line1}
                {address.line2 ? `, ${address.line2}` : ""}, {address.city} (Zone {zone.code})
              </dd>
              <dt className="text-slate-500">Instructor</dt>
              <dd className="col-span-2">{instructorId ? chosenInstructor?.firstName : `First available${chosenInstructor ? ` (likely ${chosenInstructor.firstName})` : ""}`}</dd>
            </dl>
            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              <p>
                <strong>What happens next:</strong> your instructor confirms within {props.bookingRequestWindowHours} hours. If they can&apos;t, we offer your lesson to the next best
                instructor automatically.
              </p>
              <p className="mt-1">
                <strong>Cancellation:</strong> free cancellation or rescheduling up to {props.cancellationWindowHours} hours before a lesson.
              </p>
            </div>
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold">Price</h3>
            {quote ? (
              <>
                <ul className="space-y-1 text-sm">
                  {quote.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="text-slate-600">{l.label}</span>
                      <span className={l.cents < 0 ? "text-emerald-700" : ""}>{l.cents < 0 ? `−${money(-l.cents)}` : money(l.cents)}</span>
                    </li>
                  ))}
                </ul>
                <p className="flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold">
                  <span>Total</span>
                  <span>{money(quote.totalCents)}</span>
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-500">Calculating…</p>
            )}
            {plan.kind !== "package_credit" && (
              <div className="flex gap-2">
                <input className="input" placeholder="Promo code" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} />
                <button className="btn-secondary" disabled={pending || !promo} onClick={refreshQuote}>
                  Apply
                </button>
              </div>
            )}
            {quote?.promoMessage && <p className="text-sm text-red-600">{quote.promoMessage}</p>}
            <button className="btn-primary w-full" disabled={pending || !quote} onClick={pay}>
              {pending ? "One moment…" : quote?.totalCents === 0 ? "Confirm booking" : "Continue to secure payment"}
            </button>
            <p className="text-center text-xs text-slate-400">Payments are processed by Stripe. We never see your card number.</p>
          </div>
        </section>
      )}

      {step > 0 && step < 5 && (
        <button className="mt-6 text-sm text-slate-500 underline" onClick={() => setStep(step - 1)}>
          ← Back
        </button>
      )}
    </div>
  );
}

function PlanOption({ title, quote, note, selected, onClick }: { title: string; quote: Quote | undefined; note: string; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-xl border bg-white p-4 text-left ${selected ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-200"}`}>
      <span className="block font-semibold">{title}</span>
      {quote && (
        <span className="mt-1 block text-sm text-slate-700">
          {quote.lessonCount > 1 ? `${money(quote.perLesson.totalCents)}/lesson · ${money(quote.totalCents)} total` : `${money(quote.totalCents)}`}
        </span>
      )}
      <span className="mt-1 block text-xs text-slate-500">{note}</span>
    </button>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full border px-2.5 py-0.5 ${on ? "border-sky-500 bg-sky-50 text-sky-800" : "border-slate-200 text-slate-600"}`} aria-pressed={on}>
      {children}
    </button>
  );
}
