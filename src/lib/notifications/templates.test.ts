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
