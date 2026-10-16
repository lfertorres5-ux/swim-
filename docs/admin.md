# Admin tools (Phase 5)

Everything the owner does day to day lives under **/admin**. Every change is written to the
append-only `audit_log` with the owner as actor (see **Activity**).

| Page | What you do there |
| --- | --- |
| **Dashboard** | Net revenue, lessons taught and cancellations (last 30 days); requests waiting on an instructor; a **Needs you** list (bookings needing attention, subs to approve, new day-pass inquiries, certifications expiring within 30 days); instructor utilization (booked ÷ available hours, next 14 days); a zone × weekday heatmap |
| **Bookings** | Upcoming / needs attention / past / cancelled, searchable by family. Open a lesson to **reassign** the instructor (confirms it; optional "ignore travel buffer"), **cancel** with the refund you choose (the policy amount is pre-filled) or give a package credit back, **email a payment link**, or **refund** a payment |
| **Bookings → New booking** | Book for a family directly with the instructor you pick, at their address on file or another San Diego County address. Payment: email a card link (blank amount = standard price), record a payment taken outside the app, or no charge |
| **Payments** | Every payment; full or partial refunds back to the card through Stripe |
| **Instructors** | Invite by email (with pay rate), cancel invites, activate / deactivate (deactivating flags their upcoming lessons for reassignment), pay rate, certifications with expiry (add, verify, remove) |
| **Sub board** | Approve or turn down claims (when "I approve every sub" is on), see open and recent hand-offs |
| **Day pass** | Inquiry inbox: status, quote, private notes, paste a Stripe Payment Link and email it to the family |
| **Settings** | Lesson prices, pricing rules, packages · discount codes · zones (ZIPs, neighborhoods, travel fee, boundary GeoJSON, zone-to-zone travel times) · policies (cancellation window and late refund, booking notice and horizon, reply window, checkout hold, reminders, sub-board approval and notice, contact sharing, day pass on/off and club name, support contact) |
| **Activity** | The audit log, filterable (admin / instructor / family / system). Links to every email and text sent |

## Sub board

1. An instructor opens **Sub board → Need a sub?** and posts one of their confirmed lessons (at least
   `sub_board_min_notice_hours` ahead, default 2). The lesson stays theirs until it's covered.
2. Every active instructor who covers the zone, teaches the swimmers' levels and ages, and is free
   (no overlap, travel buffer respected) gets an "up for grabs" email/text. The board shows only time,
   zone, neighborhood, ages and levels — never names, contact details or the address.
3. The first to tap **I'll take it** claims it. With approval on, the owner gets an alert and approves
   or turns it down (turned-down lessons go back on the board). With approval off it's filled at once.
4. When filled, the booking moves to the sub in the same database transaction: the original instructor
   loses access immediately, the family gets "Tyler can't make it, so Jordan will teach…", and both
   instructors are told. Covering a package lesson **never** unlocks the family's phone/email for the sub.
5. Cancelling, moving or reassigning the lesson takes it off the board automatically; lessons that start
   while still unclaimed expire (cron).

All of this is enforced in Postgres (`release_lesson_to_board`, `claim_open_shift`, `decide_open_shift`,
`withdraw_open_shift`, `sub_board_shifts` in `supabase/migrations/20261017000100_sub_board_and_admin.sql`).

## Partner Club Day Pass

`/day-pass` (linked from the family menu and the site footer) is **inquiry only**: family size, preferred
dates, interest level and a message. Bots are dropped by a honeypot, and one email can send at most 3
inquiries a day. The family gets a "we got it" email; the owner gets an alert at `ADMIN_ALERT_EMAIL`.
In **Day pass** the owner quotes, creates a Payment Link in Stripe (Dashboard → Payment Links), pastes it,
and ticks "Email the payment link" — the family receives it with the price and an optional note.

## Refunds

Refunds go through the payments gateway (Stripe in production) with an idempotency key, are capped at
what's left on the payment, and update `payments.refunded_cents` / status. Payments recorded as "paid
outside the app" have no card to refund — handle those outside the app.
