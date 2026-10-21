"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { InstructorCard } from "@/components/instructor-card";
import type { InstructorCardData } from "@/lib/instructor-cards";
import type { Quote } from "@/lib/pricing/quote";
import { AddressAutocomplete } from "./address-autocomplete";
import { addChildAction, checkAddressAction, checkoutAction, eligibleInstructorsAction, quoteAction, slotsAction, type SlotView } from "./actions";
import { WeekCalendar } from "./week-calendar";
import { LaneProgress, PassChips, Picked, SwimPass, type PassItem } from "./wizard-chrome";

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

const STEPS = ["Pool", "Swimmers", "Instructor", "Plan", "Time", "Review"] as const;
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
const whenShort = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" });

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

  const goToTime = () => {
    setSlot(null);
    setStep(4);
  };
  const goToReview = () => {
    setQuote(null);
    setStep(5);
    refreshQuote();
  };
  const back = step > 0 ? () => setStep(step - 1) : undefined;
  const swimmerNames = children.filter((c) => childIds.includes(c.id)).map((c) => c.firstName);

  // Sequential: only finished steps can be revisited.
  const jump = (i: number) => {
    if (i >= step) return;
    setError(null);
    if (i === 4) setSlot(null);
    setStep(i);
  };
  const pickedInstructor = instructorId ? instructors?.find((i) => i.id === instructorId) : null;
  const planLabel =
    plan.kind === "single"
      ? "Single lesson"
      : plan.kind === "package"
        ? `${props.offerings.find((o) => o.id === plan.offeringId)?.lessonCount ?? ""}-lesson package`
        : plan.kind === "recurring"
          ? `Weekly × ${plan.weeks}`
          : "Package credit";
  const planKey = plan.kind === "single" ? "single" : plan.kind === "package" ? `package:${plan.offeringId}` : plan.kind === "recurring" ? `recurring:${plan.weeks}` : null;
  const runningTotal = step === 5 && quote ? quote.totalCents : step >= 3 && planKey && planQuotes[planKey] ? planQuotes[planKey].totalCents : plan.kind === "package_credit" && step >= 3 ? 0 : null;
  const pass: PassItem[] = [
    { step: 0, label: "Pool", value: zone ? (neighborhood ?? address.city) : null },
    // Fills in live as the family picks; "Edit" appears once a step is finished.
    { step: 1, label: "Swimmers", value: step >= 1 && swimmerNames.length ? swimmerNames.join(" & ") : null },
    { step: 1, label: "Length", value: step >= 1 && duration ? `${duration} min` : null },
    { step: 2, label: "Instructor", value: step >= 2 ? (pickedInstructor?.firstName ?? "Best match") : null },
    { step: 3, label: "Plan", value: step >= 3 ? planLabel : null },
    { step: 4, label: "Time", value: slot ? whenShort.format(new Date(slot.start)) : null },
  ];

  return (
    <div className="mx-auto max-w-3xl pb-28 lg:max-w-6xl lg:pb-0">
      <div className="mb-6 space-y-3">
        <LaneProgress steps={STEPS} current={step} onJump={jump} />
        <div className="lg:hidden">
          <PassChips items={pass} current={step} onJump={jump} />
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-8">
      <div key={step} className="min-w-0 animate-step-in">
      {error && (
        <p className="mb-5 rounded-2xl bg-coral-50 p-4 text-sm text-coral-700" role="alert">
          {error}
        </p>
      )}

      {step === 0 && (
        <section className="space-y-5">
          <Heading title="Where's the pool?" sub="We come to you anywhere in our San Diego service area. Your instructor only sees the address on lesson day." />
          <div className="card space-y-4">
            {!manual && props.mapsBrowserKey ? (
              <>
                <AddressAutocomplete apiKey={props.mapsBrowserKey} onPick={(s) => setAddress((a) => ({ ...a, placeId: s.placeId, line1: s.line1 }))} />
                <button type="button" className="text-sm text-brand-700 underline" onClick={() => setManual(true)}>
                  Type it in instead
                </button>
              </>
            ) : (
              <div className="grid gap-3 sm:grid-cols-6">
                <input className="input sm:col-span-4" placeholder="Street address" autoComplete="address-line1" value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value, placeId: undefined })} />
                <input className="input sm:col-span-2" placeholder="Apt / unit" autoComplete="address-line2" value={address.line2} onChange={(e) => setAddress({ ...address, line2: e.target.value })} />
                <input className="input sm:col-span-4" placeholder="City" autoComplete="address-level2" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value, placeId: undefined })} />
                <input className="input sm:col-span-2" placeholder="ZIP" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={address.postalCode} onChange={(e) => setAddress({ ...address, postalCode: e.target.value, placeId: undefined })} />
              </div>
            )}
            <label className="block text-sm text-stone-700">
              Gate code or how to find the pool <span className="text-stone-400">(optional)</span>
              <input className="input mt-1" value={address.accessNotes} maxLength={500} onChange={(e) => setAddress({ ...address, accessNotes: e.target.value })} />
            </label>
            <label className="flex items-center gap-2 text-sm text-stone-600">
              <input type="checkbox" checked={saveAsHome} onChange={(e) => setSaveAsHome(e.target.checked)} /> Remember this address
            </label>
          </div>
          <Actions primary={pending ? "Checking…" : "Continue"} disabled={pending || address.line1.trim().length < 3} onPrimary={checkAddress} />
        </section>
      )}

      {step === 1 && zone && (
        <section className="space-y-5">
          <p className="rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
            Good news — we come to {neighborhood ?? address.city}.{" "}
            {zone.travelFeeCents ? `There's a ${money(zone.travelFeeCents)} travel fee per lesson.` : "No travel fee."}
            {zone.minBookingMinutes ? ` Lessons here are at least ${zone.minBookingMinutes} minutes.` : ""}{" "}
            <button className="underline" onClick={() => setStep(0)}>
              Change
            </button>
          </p>

          <Heading title="Who's swimming?" sub="Pick everyone joining this lesson." />
          <div className="grid gap-2 sm:grid-cols-2">
            {children.map((c) => {
              const on = childIds.includes(c.id);
              return (
                <label key={c.id} className={`relative flex cursor-pointer items-center gap-3 rounded-2xl border-2 bg-white p-4 transition ${on ? "border-brand-500 shadow-md" : "border-transparent hover:border-brand-200"}`}>
                  <Picked on={on} />
                  <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={on} onChange={(e) => setChildIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))} />
                  <span>
                    <span className="font-medium text-stone-900">{c.firstName}</span>
                    <span className="block text-sm text-stone-500">{LEVELS.find(([v]) => v === c.swimLevel)?.[1]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {showAddChild ? (
            <div className="card grid gap-3 sm:grid-cols-2">
              <input className="input" placeholder="First name" value={newChild.firstName} onChange={(e) => setNewChild({ ...newChild, firstName: e.target.value })} />
              <label className="text-sm text-stone-500">
                Birthday
                <input type="date" className="input mt-1" max={props.today} value={newChild.birthDate} onChange={(e) => setNewChild({ ...newChild, birthDate: e.target.value })} />
              </label>
              <select className="input" value={newChild.swimLevel} onChange={(e) => setNewChild({ ...newChild, swimLevel: e.target.value })} aria-label="Swim level">
                {LEVELS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <input className="input" placeholder="Anything the instructor should know?" value={newChild.notes} onChange={(e) => setNewChild({ ...newChild, notes: e.target.value })} />
              <button className="btn-secondary sm:w-fit" disabled={pending} onClick={addChild}>
                Add
              </button>
            </div>
          ) : (
            <button className="text-sm font-medium text-brand-700" onClick={() => setShowAddChild(true)}>
              + Add a swimmer
            </button>
          )}
          <p className="text-sm text-stone-500">
            Up to {props.includedChildren} kids per lesson at no extra cost, then {money(props.extraChildCents)} each.
          </p>

          <Heading title="How long in the water?" />
          <div className="grid grid-cols-3 gap-2">
            {props.prices.map((p) => {
              const disabled = p.durationMinutes < zone.minBookingMinutes;
              const on = duration === p.durationMinutes;
              return (
                <button
                  key={p.durationMinutes}
                  disabled={disabled}
                  onClick={() => setDuration(p.durationMinutes)}
                  className={`relative rounded-2xl border-2 bg-white p-4 text-center transition ${on ? "border-brand-500 shadow-md" : "border-transparent hover:border-brand-200"} ${disabled ? "opacity-40" : ""}`}
                >
                  <Picked on={on} />
                  <span className="block font-display text-xl font-semibold">{p.durationMinutes} min</span>
                  <span className="text-sm text-stone-500">{money(p.priceCents)}</span>
                </button>
              );
            })}
          </div>
          <Actions onBack={back} primary={pending ? "One sec…" : "Continue"} disabled={pending || !duration || childIds.length === 0} onPrimary={continueToInstructors} />
        </section>
      )}

      {step === 2 && instructors && (
        <section className="space-y-5">
          <Heading title="Who would you like to swim with?" sub="Everyone's CPR- and lifeguard-certified. Choose someone, or we'll match you." />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <button onClick={() => setInstructorId(null)} className="text-left">
              <div className={`card relative flex h-full flex-col justify-center gap-1 border-2 ${instructorId === null ? "border-brand-500" : "border-transparent"}`}>
                <Picked on={instructorId === null} />
                <p className="font-display text-lg font-semibold">Whoever&apos;s available</p>
                <p className="text-sm text-stone-600">You&apos;ll see the most times. We pick the best fit for your kids and schedule.</p>
              </div>
            </button>
            {[...instructors]
              .sort((a, b) => Number(b.id === props.favoriteInstructorId) - Number(a.id === props.favoriteInstructorId))
              .slice(0, 6)
              .map((i) => (
                <button key={i.id} onClick={() => setInstructorId(i.id)} className="relative text-left">
                  <Picked on={instructorId === i.id} />
                  <InstructorCard instructor={i} favorite={i.id === props.favoriteInstructorId} selected={instructorId === i.id} />
                </button>
              ))}
          </div>
          {instructors.length === 0 && <p className="card text-stone-600">We don&apos;t have an instructor for this combination of ages and levels yet. Give us a call and we&apos;ll sort it out.</p>}
          <Actions onBack={back} primary="Continue" disabled={instructors.length === 0} onPrimary={() => setStep(3)} />
        </section>
      )}

      {step === 3 && duration && zone && (
        <section className="space-y-5">
          <Heading title="One lesson or a bundle?" sub="Packages save money, and once your instructor confirms you'll have their number." />
          <div className="space-y-2">
            <PlanOption selected={plan.kind === "single"} onClick={() => setPlan({ kind: "single" })} title="Single lesson" quote={planQuotes.single} />
            {props.offerings.map((o) => (
              <PlanOption
                key={o.id}
                selected={plan.kind === "package" && plan.offeringId === o.id}
                onClick={() => setPlan({ kind: "package", offeringId: o.id })}
                title={`${o.lessonCount} lessons`}
                tag={`Save ${o.discountPct}%`}
                quote={planQuotes[`package:${o.id}`]}
                note="Book the rest whenever you like"
              />
            ))}
            {props.recurringTermWeeks.map((w) => (
              <PlanOption
                key={w}
                selected={plan.kind === "recurring" && plan.weeks === w}
                onClick={() => setPlan({ kind: "recurring", weeks: w })}
                title={`Weekly · ${w} weeks`}
                tag={`Save ${props.recurringDiscountPct}%`}
                quote={planQuotes[`recurring:${w}`]}
                note="Same time and instructor each week"
              />
            ))}
            {usableCredits.map((p) => (
              <PlanOption
                key={p.id}
                selected={plan.kind === "package_credit" && plan.packageId === p.id}
                onClick={() => setPlan({ kind: "package_credit", packageId: p.id })}
                title="Use a lesson from my package"
                note={`${p.lessonsRemaining} left · already paid`}
              />
            ))}
          </div>
          <Actions onBack={back} primary="Continue" onPrimary={goToTime} />
        </section>
      )}

      {step === 4 && (
        <section className="space-y-5">
          <div className="flex items-end justify-between gap-3">
            <Heading title={weeks ? "Pick your weekly time" : "When works for you?"} sub={weeks ? `Same time each week for ${weeks} weeks.` : "San Diego time."} />
            <div className="flex shrink-0 gap-1.5">
              <button className="btn-secondary px-3" aria-label="Earlier week" disabled={weekStart <= addDays(props.today, 1) || slotsLoading} onClick={() => setWeekStart(addDays(weekStart, -7))}>
                ←
              </button>
              <button className="btn-secondary px-3" aria-label="Later week" disabled={slotsLoading} onClick={() => setWeekStart(addDays(weekStart, 7))}>
                →
              </button>
            </div>
          </div>

          {plan.kind === "single" && (
            <p className="text-sm text-stone-600">
              <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-coral-400 align-middle" /> Times marked “Save {money(props.neighborhoodDiscountCents)}” are right next to another lesson
              nearby.
            </p>
          )}

          <details className="group rounded-2xl bg-white px-4 py-3 text-sm">
            <summary className="cursor-pointer list-none font-medium text-stone-700">
              Filter by day or time of day <span className="text-stone-400 group-open:hidden">+</span>
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {DAYS.map((d, i) => (
                <Chip key={d} on={prefDays.includes(i)} onClick={() => setPrefDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))}>
                  {d}
                </Chip>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {TIME_WINDOWS.map((w) => (
                <Chip key={w.key} on={prefWindows.includes(w.key)} onClick={() => setPrefWindows((x) => (x.includes(w.key) ? x.filter((y) => y !== w.key) : [...x, w.key]))}>
                  {w.label}
                </Chip>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 text-stone-600">
              <input type="checkbox" className="accent-brand-600" checked={onlyPreferred} onChange={(e) => setOnlyPreferred(e.target.checked)} /> Hide other times
            </label>
          </details>

          <div className={slotsLoading ? "opacity-50" : ""}>
            <WeekCalendar
              fromDate={weekStart}
              slots={slots}
              suggested={suggested}
              selected={slot?.start ?? null}
              onSelect={setSlot}
              neighborhoodDiscountLabel={plan.kind === "single" ? `Save ${money(props.neighborhoodDiscountCents)}` : ""}
            />
          </div>
          {!slotsLoading && slots.length === 0 && (
            <p className="text-sm text-stone-500">Nothing open this week{onlyPreferred ? " at those times" : ""}. Try the next week{instructorId ? " or “Whoever's available”" : ""}.</p>
          )}
          <Actions onBack={back} primary={slot ? `Continue · ${whenShort.format(new Date(slot.start))}` : "Pick a time"} disabled={!slot} onPrimary={goToReview} />
        </section>
      )}

      {step === 5 && slot && zone && duration && (
        <section className="space-y-5">
          <Heading title="Ready to dive in?" sub="Check the details, then you're all set." />
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="card space-y-4 lg:col-span-3">
              <p className="font-display text-xl font-semibold">
                {whenFmt.format(new Date(slot.start))}
                {weeks ? <span className="block text-base font-normal text-stone-600">and every week after, {weeks} lessons total</span> : null}
              </p>
              <ul className="space-y-1.5 text-sm text-stone-700">
                <li>
                  {duration} minutes with {swimmerNames.join(" & ")}
                </li>
                <li>
                  {instructorId ? `With ${chosenInstructor?.firstName}` : chosenInstructor ? `Probably with ${chosenInstructor.firstName}` : "Instructor confirmed shortly"}
                </li>
                <li>
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}, {address.city}
                </li>
              </ul>
              <p className="rounded-xl bg-sand p-3 text-sm text-stone-600">
                Your instructor confirms within {props.bookingRequestWindowHours} hours. Need to change plans? Cancel or reschedule free up to {props.cancellationWindowHours} hours before.
              </p>
            </div>

            <div className="card space-y-3 lg:col-span-2">
              {quote ? (
                <>
                  <ul className="space-y-1.5 text-sm">
                    {quote.lines.map((l, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span className="text-stone-600">{l.label}</span>
                        <span className={l.cents < 0 ? "text-brand-700" : ""}>{l.cents < 0 ? `−${money(-l.cents)}` : money(l.cents)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="flex justify-between border-t border-stone-100 pt-3 font-display text-xl font-semibold">
                    <span>Total</span>
                    <span>{money(quote.totalCents)}</span>
                  </p>
                </>
              ) : (
                <p className="text-sm text-stone-500">Working out the price…</p>
              )}
              {plan.kind !== "package_credit" && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-stone-500">Have a promo code?</summary>
                  <div className="mt-2 flex gap-2">
                    <input className="input" placeholder="Code" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} />
                    <button className="btn-secondary" disabled={pending || !promo} onClick={refreshQuote}>
                      Apply
                    </button>
                  </div>
                  {quote?.promoMessage && <p className="mt-1 text-coral-700">{quote.promoMessage}</p>}
                </details>
              )}
            </div>
          </div>
          <Actions
            onBack={back}
            primary={pending ? "One moment…" : quote?.totalCents === 0 ? "Confirm booking" : quote ? `Pay ${money(quote.totalCents)}` : "Pay"}
            disabled={pending || !quote}
            onPrimary={pay}
            note="Secure checkout by Stripe"
          />
        </section>
      )}
      </div>
      <div className="hidden lg:block">
        <SwimPass items={pass} current={step} onJump={jump} total={runningTotal === null ? null : money(runningTotal)} />
      </div>
      </div>
    </div>
  );
}

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-2xl font-semibold sm:text-3xl">{title}</h2>
      {sub && <p className="mt-1 text-stone-600">{sub}</p>}
    </div>
  );
}

/** Back / Continue. Pinned to the bottom of the screen on phones so it's always in reach. */
function Actions({ onBack, primary, onPrimary, disabled, note }: { onBack?: () => void; primary: string; onPrimary: () => void; disabled?: boolean; note?: string }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200/70 bg-sand/95 px-5 py-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:pt-2">
      <div className="mx-auto flex max-w-3xl items-center gap-3 lg:max-w-none">
        {onBack && (
          <button className="btn-secondary px-4" onClick={onBack} aria-label="Back">
            ←
          </button>
        )}
        <button className="btn-primary flex-1 py-3 text-base lg:flex-none lg:px-8" disabled={disabled} onClick={onPrimary}>
          {primary}
        </button>
        {note && <span className="hidden text-xs text-stone-400 sm:inline">{note}</span>}
      </div>
    </div>
  );
}

function PlanOption({ title, tag, quote, note, selected, onClick }: { title: string; tag?: string; quote?: Quote; note?: string; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center justify-between gap-3 rounded-2xl border-2 bg-white px-4 py-3.5 text-left transition ${selected ? "border-brand-500 shadow-md" : "border-transparent hover:border-brand-200"}`}>
      <span className="flex items-center gap-3">
        <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${selected ? "border-brand-600 bg-brand-600" : "border-stone-300"}`}>
          {selected && <span className="h-2 w-2 animate-pop rounded-full bg-white" />}
        </span>
        <span>
        <span className="font-medium text-stone-900">{title}</span>
        {tag && <span className="badge ml-2 bg-coral-50 text-coral-700">{tag}</span>}
        {note && <span className="block text-sm text-stone-500">{note}</span>}
        </span>
      </span>
      {quote && (
        <span className="shrink-0 text-right">
          <span className="block font-semibold text-stone-900">{money(quote.totalCents)}</span>
          {quote.lessonCount > 1 && <span className="block text-xs text-stone-500">{money(quote.perLesson.totalCents)} each</span>}
        </span>
      )}
    </button>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-3 py-1 ${on ? "bg-brand-600 text-white" : "bg-sand text-stone-600"}`} aria-pressed={on}>
      {children}
    </button>
  );
}
