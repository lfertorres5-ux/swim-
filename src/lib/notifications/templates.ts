/**
 * Message templates — pure functions. Each returns the email (subject, text,
 * html) and, where useful, a short SMS.
 *
 * Privacy rule: instructor-facing messages contain only first names, ages,
 * levels, area and time — never a parent's last name, email, phone or the
 * street address (addresses appear in the app on lesson day).
 */
import { brand } from "@/config/brand";
import { formatDate, formatTime } from "@/lib/time";
import { SKILL_STATE_LABEL, type SkillsBySwimmer } from "@/lib/skills";

export type Rendered = { subject: string; text: string; html: string; sms: string | null };

export type LessonInfo = {
  start: string; // ISO
  end: string;
  durationMinutes: number;
  swimmers: string[]; // first names
  neighborhood: string | null;
  instructorFirstName: string | null;
};

const when = (l: LessonInfo) => `${formatDate(l.start, { weekday: "long", month: "long", day: "numeric" })} at ${formatTime(l.start)}`;
const whenShort = (l: LessonInfo) => `${formatDate(l.start, { weekday: "short", month: "short", day: "numeric" })} ${formatTime(l.start)}`;
const kids = (names: string[]) => (names.length <= 1 ? (names[0] ?? "your swimmer") : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`);
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function wrap(heading: string, paragraphs: string[], cta?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#44403c">${p}</p>`).join("");
  const button = cta
    ? `<p style="margin:22px 0 4px"><a href="${esc(cta.url)}" style="display:inline-block;background:#236c71;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${esc(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#faf6ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 14px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:18px;padding:28px">
<tr><td><p style="margin:0 0 18px;font-family:Georgia,serif;font-size:16px;color:#1f585d">${esc(brand.name)}</p>
<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;color:#1c1917">${esc(heading)}</h1>${body}${button}</td></tr></table>
<p style="font-size:12px;color:#a8a29e;margin:16px 0 0">${esc(brand.name)} · ${esc(brand.region)}</p>
</td></tr></table></body></html>`;
}

function build(subject: string, heading: string, lines: string[], cta: { label: string; url: string } | undefined, sms: string | null): Rendered {
  const text = [heading, "", ...lines, ...(cta ? ["", `${cta.label}: ${cta.url}`] : [])].join("\n");
  return { subject, text, html: wrap(heading, lines.map(esc), cta), sms };
}

// --- Parents -----------------------------------------------------------------

export function bookingReceived(p: { parentFirstName: string | null; lessons: LessonInfo[]; url: string }): Rendered {
  const first = p.lessons[0];
  const more = p.lessons.length > 1 ? ` (and ${p.lessons.length - 1} more)` : "";
  return build(
    `We got your booking for ${whenShort(first)}`,
    `Thanks${p.parentFirstName ? `, ${p.parentFirstName}` : ""}! You're all paid.`,
    [
      `${kids(first.swimmers)}'s ${first.durationMinutes}-minute lesson on ${when(first)}${more} is booked.`,
      "We've asked your instructor to confirm — you'll hear from us as soon as they do, usually within a few hours.",
    ],
    { label: "See your lessons", url: p.url },
    null,
  );
}

export function bookingConfirmed(p: { lesson: LessonInfo; url: string; contactUnlocked: boolean }): Rendered {
  const l = p.lesson;
  return build(
    `Confirmed: ${l.instructorFirstName} on ${whenShort(l)}`,
    `${l.instructorFirstName} is all set for ${kids(l.swimmers)}!`,
    [
      `Your ${l.durationMinutes}-minute lesson is confirmed for ${when(l)}.`,
      p.contactUnlocked
        ? `Since you have a package, ${l.instructorFirstName}'s phone and email are now on your account if you need to reach them.`
        : "Need to change something? You can reschedule or cancel from your account.",
    ],
    { label: "View lesson", url: p.url },
    `${brand.name}: ${l.instructorFirstName} confirmed ${kids(l.swimmers)}'s lesson ${whenShort(l)}. ${p.url}`,
  );
}

export function instructorChanged(p: { lesson: LessonInfo; previousFirstName: string | null; url: string }): Rendered {
  const l = p.lesson;
  return build(
    `New instructor for ${whenShort(l)}: ${l.instructorFirstName}`,
    `Meet ${l.instructorFirstName}, your instructor for ${whenShort(l)}`,
    [
      `${p.previousFirstName ? `${p.previousFirstName} can't make it, so ` : ""}${l.instructorFirstName} will teach ${kids(l.swimmers)} on ${when(l)}. Same time, same price.`,
      "If you'd rather pick a different time instead, you can reschedule free from your account.",
    ],
    { label: `See ${l.instructorFirstName}'s profile`, url: p.url },
    `${brand.name}: ${l.instructorFirstName} will teach ${kids(l.swimmers)} on ${whenShort(l)}. ${p.url}`,
  );
}

export function parentReminder(p: { lesson: LessonInfo; accessNotes: string | null; url: string }): Rendered {
  const l = p.lesson;
  return build(
    `Tomorrow: swim lesson at ${formatTime(l.start)}`,
    `See you tomorrow, ${kids(l.swimmers)}!`,
    [
      `${l.instructorFirstName ?? "Your instructor"} arrives ${when(l)} for a ${l.durationMinutes}-minute lesson.`,
      p.accessNotes ? `We'll pass along your pool notes: “${p.accessNotes}”` : "Tip: make sure the gate is unlocked and the pool's ready to go.",
      "Plans changed? Rescheduling or cancelling now isn't refundable, but message us and we'll do what we can.",
    ],
    { label: "View lesson", url: p.url },
    `${brand.name} reminder: ${l.instructorFirstName ?? "Your instructor"} arrives tomorrow ${formatTime(l.start)} for ${kids(l.swimmers)}'s lesson.`,
  );
}

export function parentCancelled(p: { lesson: LessonInfo; refundCents: number; creditRestored: boolean; url: string }): Rendered {
  const l = p.lesson;
  const money_ = p.creditRestored ? "The lesson credit is back on your package." : p.refundCents > 0 ? `We've refunded ${money(p.refundCents)} to your card — it can take 5–10 days to show up.` : "This late cancellation isn't refundable.";
  return build(
    `Cancelled: lesson on ${whenShort(l)}`,
    "Your lesson is cancelled",
    [`${kids(l.swimmers)}'s lesson on ${when(l)} has been cancelled.`, money_],
    { label: "Book another time", url: p.url },
    `${brand.name}: ${kids(l.swimmers)}'s lesson on ${whenShort(l)} is cancelled. ${money_}`,
  );
}

export function parentRescheduled(p: { lesson: LessonInfo; previousStart: string; keptInstructor: boolean; url: string }): Rendered {
  const l = p.lesson;
  return build(
    `Moved to ${whenShort(l)}`,
    "Your lesson has moved",
    [
      `${kids(l.swimmers)}'s lesson is now ${when(l)} (was ${formatDate(p.previousStart)} at ${formatTime(p.previousStart)}).`,
      p.keptInstructor ? `${l.instructorFirstName} will be there.` : "We're confirming an instructor for the new time and will let you know shortly.",
    ],
    { label: "View lesson", url: p.url },
    `${brand.name}: ${kids(l.swimmers)}'s lesson moved to ${whenShort(l)}.`,
  );
}

export function parentUnmatched(p: { lesson: LessonInfo; url: string }): Rendered {
  const l = p.lesson;
  return build(
    `We need to find you a new time`,
    "Sorry — we couldn't confirm an instructor",
    [
      `None of our instructors can make ${when(l)} after all. We're sorry for the hassle.`,
      "Pick another time from your account, or reply to this email and we'll sort out a refund.",
    ],
    { label: "Choose a new time", url: p.url },
    `${brand.name}: we couldn't confirm an instructor for ${whenShort(l)}. Please pick a new time: ${p.url}`,
  );
}

export function lessonCompleted(p: { lesson: LessonInfo; summary: string; nextFocus: string | null; skills: SkillsBySwimmer; url: string }): Rendered {
  const l = p.lesson;
  const skillLines = Object.entries(p.skills).flatMap(([swimmer, list]) => {
    const entries = Object.entries(list);
    return entries.length ? [`${swimmer}: ${entries.map(([s, v]) => `${s} (${SKILL_STATE_LABEL[v] ?? v})`).join(", ")}`] : [];
  });
  return build(
    `How ${kids(l.swimmers)} did today`,
    `Notes from ${l.instructorFirstName ?? "your instructor"}`,
    [`“${p.summary}”`, ...skillLines, ...(p.nextFocus ? [`Next time: ${p.nextFocus}`] : [])],
    { label: "See all progress", url: p.url },
    `${brand.name}: ${l.instructorFirstName ?? "Your instructor"} left notes on today's lesson — ${p.url}`,
  );
}

// --- Instructors (no parent PII, no address) ----------------------------------

export function instructorNewRequest(p: { lesson: LessonInfo; ages: (number | null)[]; deadline: string; url: string }): Rendered {
  const l = p.lesson;
  const who = p.ages.map((a) => (a === null ? "swimmer" : `${a}-year-old`)).join(", ");
  return build(
    `New lesson request: ${whenShort(l)}`,
    "You have a new lesson request",
    [`${when(l)} · ${l.durationMinutes} min · ${l.neighborhood ?? "nearby"} · ${who}.`, `Please accept or decline by ${formatDate(p.deadline)} at ${formatTime(p.deadline)}.`],
    { label: "Respond", url: p.url },
    `${brand.name}: new request ${whenShort(l)} in ${l.neighborhood ?? "your area"}. Respond by ${formatTime(p.deadline)}: ${p.url}`,
  );
}

export function instructorReminder(p: { lesson: LessonInfo; url: string }): Rendered {
  const l = p.lesson;
  return build(
    `Tomorrow: ${kids(l.swimmers)} at ${formatTime(l.start)}`,
    "Tomorrow's lesson",
    [`${when(l)} · ${l.durationMinutes} min · ${kids(l.swimmers)} in ${l.neighborhood ?? "your area"}.`, "The address shows up in the app on the day of the lesson."],
    { label: "Open today's lessons", url: p.url },
    `${brand.name} reminder: ${kids(l.swimmers)} tomorrow ${formatTime(l.start)} in ${l.neighborhood ?? "your area"}.`,
  );
}

export function instructorCancelled(p: { lesson: LessonInfo; url: string }): Rendered {
  const l = p.lesson;
  return build(
    `Cancelled: ${whenShort(l)}`,
    "A lesson was cancelled",
    [`The ${l.durationMinutes}-minute lesson with ${kids(l.swimmers)} on ${when(l)} was cancelled. That time is open again.`],
    { label: "View schedule", url: p.url },
    `${brand.name}: ${kids(l.swimmers)}'s lesson ${whenShort(l)} was cancelled.`,
  );
}

export function instructorRescheduled(p: { lesson: LessonInfo; previousStart: string; url: string }): Rendered {
  const l = p.lesson;
  return build(
    `Moved: ${kids(l.swimmers)} now ${whenShort(l)}`,
    "A lesson moved",
    [`${kids(l.swimmers)}'s lesson moved from ${formatDate(p.previousStart)} ${formatTime(p.previousStart)} to ${when(l)}.`],
    { label: "View schedule", url: p.url },
    `${brand.name}: ${kids(l.swimmers)}'s lesson moved to ${whenShort(l)}.`,
  );
}

// --- Owner ----------------------------------------------------------------------

export function adminUnmatched(p: { lesson: LessonInfo; reason: string; url: string }): Rendered {
  return build(`Needs attention: no instructor for ${whenShort(p.lesson)}`, "A booking needs you", [`${p.reason}.`, `Lesson: ${when(p.lesson)}, ${p.lesson.neighborhood ?? ""}.`], { label: "Open admin", url: p.url }, null);
}

// --- Sub board ------------------------------------------------------------------

export type ShiftInfo = { start: string; end: string; durationMinutes: number; neighborhood: string | null; ages: (number | null)[] };

const shiftWho = (ages: (number | null)[]) => ages.map((a) => (a === null ? "swimmer" : `${a}-year-old`)).join(", ") || "swimmers";
const shiftWhen = (s: ShiftInfo) => `${formatDate(s.start, { weekday: "long", month: "long", day: "numeric" })} at ${formatTime(s.start)}`;
const shiftWhenShort = (s: ShiftInfo) => `${formatDate(s.start, { weekday: "short", month: "short", day: "numeric" })} ${formatTime(s.start)}`;

export function instructorShiftAvailable(p: { shift: ShiftInfo; url: string }): Rendered {
  const s = p.shift;
  return build(
    `Up for grabs: ${shiftWhenShort(s)} in ${s.neighborhood ?? "your area"}`,
    "A lesson needs a sub",
    [`${shiftWhen(s)} · ${s.durationMinutes} min · ${s.neighborhood ?? "your area"} · ${shiftWho(s.ages)}.`, "You're free and qualified for it. First to claim it gets it."],
    { label: "Open the sub board", url: p.url },
    `${brand.name}: sub needed ${shiftWhenShort(s)} in ${s.neighborhood ?? "your area"} (${shiftWho(s.ages)}). ${p.url}`,
  );
}

export function instructorShiftFilled(p: { lesson: LessonInfo; url: string }): Rendered {
  const l = p.lesson;
  return build(
    `It's yours: ${kids(l.swimmers)} on ${whenShort(l)}`,
    "You picked up a lesson",
    [`${when(l)} · ${l.durationMinutes} min · ${kids(l.swimmers)} in ${l.neighborhood ?? "your area"}.`, "The address shows up in the app on the day of the lesson."],
    { label: "View schedule", url: p.url },
    `${brand.name}: you're covering ${kids(l.swimmers)} ${whenShort(l)} in ${l.neighborhood ?? "your area"}.`,
  );
}

export function instructorShiftCovered(p: { lesson: LessonInfo; subFirstName: string | null; url: string }): Rendered {
  const l = p.lesson;
  return build(
    `Covered: your lesson on ${whenShort(l)}`,
    "Your lesson is covered",
    [`${p.subFirstName ?? "Another instructor"} is teaching ${kids(l.swimmers)} on ${when(l)}. It's off your schedule.`],
    { label: "View schedule", url: p.url },
    `${brand.name}: ${p.subFirstName ?? "a sub"} is covering ${kids(l.swimmers)} ${whenShort(l)}.`,
  );
}

export function instructorClaimDeclined(p: { shift: ShiftInfo; note: string | null; url: string }): Rendered {
  return build(
    `Not this time: ${shiftWhenShort(p.shift)}`,
    "The owner kept a different plan for this lesson",
    [`Thanks for offering to cover ${shiftWhen(p.shift)}. It's not going to you this time.`, ...(p.note ? [`Note from the owner: “${p.note}”`] : [])],
    { label: "Open the sub board", url: p.url },
    null,
  );
}

export function adminShiftNeedsApproval(p: { shift: ShiftInfo; fromFirstName: string | null; toFirstName: string | null; url: string }): Rendered {
  return build(
    `Approve sub: ${p.toFirstName} for ${p.fromFirstName}, ${shiftWhenShort(p.shift)}`,
    "A sub is waiting for your OK",
    [`${p.toFirstName ?? "An instructor"} wants to cover ${p.fromFirstName ?? "a colleague"}'s lesson on ${shiftWhen(p.shift)} (${p.shift.neighborhood ?? ""}).`],
    { label: "Review", url: p.url },
    null,
  );
}

// --- Admin-originated ----------------------------------------------------------

export function instructorInvite(p: { url: string }): Rendered {
  return build(
    `You're invited to teach with ${brand.name}`,
    "Come teach with us",
    [
      `You've been invited to join ${brand.name} as an instructor.`,
      "Sign in with this email address to get started: you'll add a photo and a short bio, set your hours and areas, and accept the instructor agreement. We'll activate your account after that.",
    ],
    { label: "Get started", url: p.url },
    null,
  );
}

export function parentPaymentRequest(p: { lesson: LessonInfo; amountCents: number; url: string }): Rendered {
  const l = p.lesson;
  return build(
    `Payment for ${kids(l.swimmers)}'s lesson on ${whenShort(l)}`,
    "Your lesson is booked",
    [`We've booked ${kids(l.swimmers)} with ${l.instructorFirstName ?? "your instructor"} on ${when(l)} (${l.durationMinutes} min).`, `The total is ${money(p.amountCents)}. You can pay securely with the link below.`],
    { label: `Pay ${money(p.amountCents)}`, url: p.url },
    `${brand.name}: ${kids(l.swimmers)}'s lesson ${whenShort(l)} is booked. Pay ${money(p.amountCents)} here: ${p.url}`,
  );
}

// --- Partner Club Day Pass -------------------------------------------------------

export type DayPassInfo = { name: string; adults: number; children: number; dates: string[]; interest: string; message: string | null };

const passDates = (dates: string[]) => (dates.length ? dates.map((d) => formatDate(`${d}T20:00:00Z`, { weekday: "short", month: "short", day: "numeric" })).join(", ") : "flexible");

export function dayPassReceived(p: { name: string; clubName: string; url: string }): Rendered {
  return build(
    `We got your ${p.clubName} day pass inquiry`,
    `Thanks, ${p.name.split(" ")[0]}!`,
    ["We'll check availability for your dates and get back to you with member-family pricing, usually within a day or two.", "Nothing is booked or charged until you approve the quote."],
    { label: "Back to your account", url: p.url },
    null,
  );
}

export function adminDayPassInquiry(p: { inquiry: DayPassInfo; url: string }): Rendered {
  const q = p.inquiry;
  return build(
    `Day pass inquiry: ${q.name} (${q.adults + q.children} people)`,
    "New day pass inquiry",
    [`${q.name} · ${q.adults} adults, ${q.children} kids · ${q.interest.replaceAll("_", " ")}.`, `Dates: ${passDates(q.dates)}.`, ...(q.message ? [`“${q.message}”`] : [])],
    { label: "Open the inbox", url: p.url },
    null,
  );
}

export function dayPassPaymentLink(p: { name: string; clubName: string; amountCents: number | null; dates: string[]; url: string; note: string | null }): Rendered {
  return build(
    `Your ${p.clubName} day pass${p.amountCents !== null ? `: ${money(p.amountCents)}` : ""}`,
    "Your day pass is approved",
    [
      `Good news, ${p.name.split(" ")[0]} — your day pass for ${passDates(p.dates)} is approved.`,
      ...(p.note ? [p.note] : []),
      `${p.amountCents !== null ? `The member-family price is ${money(p.amountCents)}. ` : ""}Use the secure link below to pay and we'll send the details.`,
    ],
    { label: "Pay for your day pass", url: p.url },
    null,
  );
}
