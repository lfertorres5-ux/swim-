import { describe, expect, it } from "vitest";
import * as t from "./templates";

const lesson: t.LessonInfo = {
  start: "2026-10-20T16:00:00Z", // Tue 9:00 AM PDT
  end: "2026-10-20T16:30:00Z",
  durationMinutes: 30,
  swimmers: ["Lucas", "Ava"],
  neighborhood: "Leucadia",
  instructorFirstName: "Maya",
};
const url = "https://example.com/x";

describe("notification templates", () => {
  it("formats times in San Diego time and names the kids naturally", () => {
    const r = t.bookingConfirmed({ lesson, url, contactUnlocked: false });
    expect(r.subject).toBe("Confirmed: Maya on Tue, Oct 20 9:00 AM");
    expect(r.text).toContain("Maya is all set for Lucas & Ava!");
    expect(r.text).toContain("Tuesday, October 20 at 9:00 AM");
  });

  it("mentions contact details only for package families", () => {
    expect(t.bookingConfirmed({ lesson, url, contactUnlocked: true }).text).toContain("phone and email are now on your account");
    expect(t.bookingConfirmed({ lesson, url, contactUnlocked: false }).text).not.toContain("phone");
  });

  it("explains refunds and credits on cancellation", () => {
    expect(t.parentCancelled({ lesson, refundCents: 5850, creditRestored: false, url }).text).toContain("refunded $58.50");
    expect(t.parentCancelled({ lesson, refundCents: 0, creditRestored: true, url }).text).toContain("credit is back");
    expect(t.parentCancelled({ lesson, refundCents: 0, creditRestored: false, url }).text).toContain("isn't refundable");
  });

  it("lesson-complete email carries the note and skills", () => {
    const r = t.lessonCompleted({ lesson, summary: "Great kicks today!", nextFocus: "Back float", skills: { Lucas: { "Flutter kick": "mastered" } }, url });
    expect(r.text).toContain("“Great kicks today!”");
    expect(r.text).toContain("Lucas: Flutter kick (Got it!)");
    expect(r.text).toContain("Next time: Back float");
  });

  it("instructor messages never include an address, email or phone", () => {
    const msgs = [
      t.instructorNewRequest({ lesson, ages: [5, 3], deadline: "2026-10-17T03:00:00Z", url }),
      t.instructorReminder({ lesson, url }),
      t.instructorCancelled({ lesson, url }),
      t.instructorRescheduled({ lesson, previousStart: "2026-10-19T16:00:00Z", url }),
    ];
    for (const m of msgs) {
      const all = `${m.subject} ${m.text} ${m.sms}`;
      expect(all).not.toMatch(/@|\+1\d{10}|\d{3,5} [A-Z][a-z]+ (Ave|St|Rd|Way|Ln|Ct)/);
    }
  });

  it("escapes HTML and keeps SMS short", () => {
    const r = t.lessonCompleted({ lesson, summary: "<script>x</script>", nextFocus: null, skills: {}, url });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    for (const m of [t.bookingConfirmed({ lesson, url, contactUnlocked: true }), t.parentReminder({ lesson, accessNotes: null, url }), t.instructorReminder({ lesson, url })]) {
      expect(m.sms!.length).toBeLessThanOrEqual(320);
    }
  });
});

describe("sub board, invite and day pass templates", () => {
  const shift: t.ShiftInfo = { start: lesson.start, end: lesson.end, durationMinutes: 30, neighborhood: "Leucadia", ages: [6, null] };

  it("'up for grabs' shows ages and area only", () => {
    const r = t.instructorShiftAvailable({ shift, url });
    expect(r.subject).toBe("Up for grabs: Tue, Oct 20 9:00 AM in Leucadia");
    expect(r.text).toContain("6-year-old, swimmer");
    expect(r.sms).toContain("Leucadia");
  });

  it("the family meets the sub by first name; the original instructor is told it's covered", () => {
    const fam = t.instructorChanged({ lesson: { ...lesson, instructorFirstName: "Jordan" }, previousFirstName: "Tyler", url });
    expect(fam.text).toContain("Tyler can't make it, so Jordan will teach Lucas & Ava");
    const orig = t.instructorShiftCovered({ lesson, subFirstName: "Jordan", url });
    expect(orig.text).toContain("Jordan is teaching Lucas & Ava");
  });

  it("day pass messages: owner alert summarises the family; the link email carries the price and link", () => {
    const alert = t.adminDayPassInquiry({ inquiry: { name: "Priya Shah", adults: 2, children: 3, dates: ["2026-10-28"], interest: "ready_to_book", message: "Birthday!" }, url });
    expect(alert.subject).toBe("Day pass inquiry: Priya Shah (5 people)");
    expect(alert.text).toContain("ready to book");
    expect(alert.text).toContain("Wed, Oct 28");
    const link = t.dayPassPaymentLink({ name: "Priya Shah", clubName: "Rancho Club", amountCents: 18000, dates: ["2026-10-28"], url: "https://buy.stripe.com/x", note: null });
    expect(link.subject).toBe("Your Rancho Club day pass: $180");
    expect(link.text).toContain("Good news, Priya");
    expect(link.text).toContain("https://buy.stripe.com/x");
    expect(link.sms).toBeNull();
  });

  it("payment request shows the amount", () => {
    expect(t.parentPaymentRequest({ lesson, amountCents: 9000, url }).text).toContain("The total is $90");
  });
});
