# Scheduling engine

Code: `src/lib/scheduling/` (pure engine + server glue), migrations `20261014000200_scheduling.sql` and
`20261014000300_offer_automation.sql`. Every setting below is in `platform_settings`, `pricing_config` or
`zone_travel_buffers`, all editable in admin. Nothing is hardcoded.

## When is a slot available?

A start time is offered for an instructor when **all** of these hold:

1. **Qualified.** The instructor:
   - covers the zone (`instructor_zones`);
   - teaches every swimmer's level;
   - meets their minimum age (`min_child_age_months`);
   - allows that many swimmers;
   - is accepting new clients, unless the family requested or favorited them.
2. **Inside their hours.** The whole lesson must fit inside that local day's availability (America/Los_Angeles):
   weekly rules (with effective dates), plus "extra hours" overrides, minus blackouts (whole-day or partial).
3. **Travel time is kept.** Around every live lesson they already have, the engine keeps the buffer for that
   zone pair, in each direction (`zone_travel_buffers`, falling back to `default_travel_buffer_minutes`,
   which is 30). External busy blocks (calendar sync, Phase 6) get the default buffer.
4. **Notice and horizon.** The slot must start at least `min_booking_notice_hours` from now (24), and no more
   than `max_booking_horizon_days` out (60). Starts fall on a `slot_step_minutes` grid (30).
5. **Zone rules.** The zone is bookable, and the lesson meets the zone's `min_booking_minutes` (Zone C is
   60 minutes).

Only the San Diego County service area exists: zone ZIPs, zone polygons, and home and lesson addresses are all
constrained to the county in Postgres. See [security-model.md](security-model.md).

### The database is the final word

The engine decides what to *offer*. Postgres decides what can be *booked*:

- An **exclusion constraint** rejects overlapping live bookings for the same instructor.
- A **trigger** (`private.bookings_enforce_travel_buffer`) rejects bookings that violate the zone-pair buffer.
  It takes a per-instructor advisory lock, so two simultaneous checkouts can't both squeeze into the same gap.
  Its error code is `SB001`. Admins can set `buffer_override` for a deliberate manual exception, but overlaps
  are still impossible.

A test (`tests/rls/scheduling.test.ts`, "engine ⇄ database agreement") inserts every slot the engine offers
on the seed data and checks that the database accepts each one.

## Ranking

Each (slot, instructor) pair gets a score, and the explanation is visible on hover in **Admin → Scheduling**:

| Signal | Points | Why |
| --- | --- | --- |
| Neighborhood slot: same zone as one of that instructor's lessons, within ±60 min (`neighborhood_window_minutes`) | +40 | geographic clustering; this is also what earns the $5 neighborhood discount |
| Fills a gap: snug against lessons on both sides | +50 | contiguous days |
| Back-to-back with a lesson on one side | +30 | contiguous days |
| Already teaching in this zone that day (not adjacent) | +15 | clustering |
| Opens a new day for the instructor | −10 | pack existing days first |
| Leaves an idle gap too short to sell (shorter than the shortest lesson + buffer) | −15 per side | avoid dead time |
| Family's requested or favorite instructor | +25 | rebook loyalty |
| Matches the family's preferred days/times | +10 | (or filter with `onlyPreferred`) |
| Each day further out | −0.25 | mild preference for sooner |

A slot's badge reflects its **top-ranked** instructor. "Suggested" shows the best six slots, at most two per
day.

## Booking requests: accept / decline / auto-offer

1. After payment (Phase 3), the booking is `pending_instructor` and `offerNextInstructor()` runs. The
   requested instructor ranks first if they're free; otherwise the engine's best match does. The instructor is
   assigned, which holds the slot, and a `booking_offers` row is created with a deadline of
   `min(now + booking_request_window_hours, lesson start − offer_min_lead_minutes)`.
2. The instructor sees **ages, levels, zone, neighborhood and time only**, with no names or address, and
   answers in **Instructor → Requests** (`respond_to_booking_offer` RPC).
   - **Accept:** the booking is `confirmed`, and names and the day-of address become available through the
     audited lesson RPC.
   - **Decline:** the booking is released and offered to the next-ranked instructor who hasn't seen it.
3. The **cron** (`/api/cron/scheduling`, every 10 minutes via `vercel.json`) expires unanswered offers,
   re-offers them, expires lapsed payment holds, and retries any request left without an offer.
4. If nobody is left, or the lesson is too close, the booking gets `needs_attention`. It appears on the admin
   dashboard; Phase 3 adds the parent reschedule/refund path.

## API

`POST /api/availability` (signed-in users):

```json
{
  "zoneId": "…",
  "durationMinutes": 60,
  "swimmers": [{ "ageMonths": 62, "level": "beginner" }],
  "fromDate": "2026-10-14",
  "toDate": "2026-10-27",
  "instructorId": null,
  "preferences": { "weekdays": [1, 3], "windows": [{ "start": "15:00", "end": "18:00" }] },
  "onlyPreferred": false
}
```

The response contains `slots` and `suggested`, each with `start`, `end`, `date`, `isNeighborhoodSlot`,
`matchesPreferences` and ranked `instructorIds`. It never includes anyone's bookings. The search range is
capped at 31 days.
