# Notifications & progress notes

## What gets sent

| When | Family | Instructor | Owner |
| --- | --- | --- | --- |
| Payment received | Email: "We got your booking" | Email + text: new lesson request (ages, levels, area, time — no names or address) | |
| Instructor accepts | Email + text: "Confirmed", or "New instructor" if someone other than who they picked took it | | |
| 24 hours before (`reminder_hours_before`) | Email + text reminder, with their pool notes | Email + text reminder (address appears in the app on lesson day) | |
| Cancelled | Email + text, with the refund / credit outcome | Email + text: the time is free | |
| Rescheduled | Email + text | Email + text (or "cancelled" for the instructor who lost it) | |
| No instructor available | Email + text: pick a new time | | Email to `ADMIN_ALERT_EMAIL` |
| Progress note sent | Email + text with the note and skills | | |

Texts go only to people with a phone number and SMS opt-in. Emails go to everyone except those who turned
email off (`users.email_opt_in`).

## How it works

`src/lib/notifications/`:
- `templates.ts` holds pure functions that render the subject, text, HTML and SMS. Unit tests check that
  instructor messages never contain an address, email or phone number.
- `outbox.ts` stores each rendered message in `public.notifications` under a unique `dedupe_key`, so the
  same event firing twice still sends once. It tries to deliver right away, and retries failures with
  backoff (2, 4, 8, 16 minutes; it gives up after 5 tries).
- `events.ts` maps business moments to messages. Every call is wrapped in `safely()`, so a delivery problem
  never breaks a booking, payment or cancellation.
- `providers.ts` sends through Resend (email) and Twilio Messaging (text) over plain HTTPS. **Without keys,
  messages are marked sent with provider `log`**: nothing leaves the server, and you can read every message
  in **Admin → Messages**.

The `/api/cron/notifications` cron runs every 5 minutes. It queues reminders (once per lesson time) and
delivers anything due.

## Progress notes

Instructors open **Today → Write progress note** (available once the lesson starts). They tap each skill
to mark it Tried it → Getting there → Got it!, using the checklist for each child's level in
`src/lib/skills.ts`, then write a comment and an optional "next time".

`public.submit_lesson_note` checks it's the instructor's lesson and that it has started. It then saves the
note, marks the lesson **completed**, and records the instructor's pay once (rate × minutes). The family is
notified the first time a note is sent; later edits update the note quietly.
