# Booking, pricing & payments

Code: `src/lib/pricing/` (pure pricing engine), `src/lib/booking/` (checkout, fulfillment, cancel/reschedule),
`src/lib/payments/` (Stripe gateway + webhook), migration `20261015000100_booking_payments.sql`.

## Price rules (all in Admin config: `lesson_prices`, `pricing_config`, `package_offerings`, `zones`)

| Rule | Default |
| --- | --- |
| Base price, 1–2 swimmers | 30 min $65 · 60 min $90 · 90 min $130 |
| Each swimmer beyond 2 | +$25 per lesson |
| Travel fee (per lesson) | Zone A $0 · Zone B $10 · Zone C $20 |
| Zone minimum | Zone C: 60 minutes |
| 4-pack / 8-pack | 5% / 10% off the lesson price |
| Weekly series | 10% off the lesson price; terms of 4 or 8 weeks (`platform_settings.recurring_term_weeks`) |
| Neighborhood slot | $5 off (single lessons only) |
| Promo codes | `discount_codes`: % or $ off, limited to plan kinds, dates and redemptions |

The package, series and neighborhood discounts apply to the lesson price, not the travel fee. They don't stack
with each other. Promo codes apply last, to the order total. Every quote is computed on the server; the price
the browser shows is only for display, and checkout recomputes it.

## Checkout flow

1. **`createBookingCheckout`** re-derives everything from the parent's input:
   - the zone, from the address (Google geocoding server-side; San Diego County only);
   - the swimmers, which must belong to the family;
   - the slot and instructor, re-ranked by the scheduling engine (weekly series: same instructor free every week);
   - the price, from the pricing engine.
2. **`create_booking_hold`** (one SQL transaction) writes the package or series row, a `pending` payment, and
   every lesson as `pending_payment`, with the instructor assigned and the slot held until
   `payment_hold_minutes` (35 min, which outlives Stripe Checkout's 30-minute minimum). The exclusion constraint
   and the travel-buffer trigger guard every lesson. If any slot was taken in the meantime, nothing is written.
3. The parent pays on **Stripe Checkout**: a single line item at our computed amount, idempotency-keyed by
   payment id.
4. **Fulfillment** (`fulfillPayment`) runs from the webhook and from the success page; both are idempotent:
   - the payment is marked `succeeded`, with the receipt URL;
   - the package is activated (expiry = `validity_days`), or the series is activated;
   - the promo code is redeemed;
   - each lesson moves to `pending_instructor`, and the instructor's accept/decline request opens
     (`start_booking_request`), which hands off to the Phase 2 auto-offer loop.
5. **Abandoned checkout:** Stripe's `checkout.session.expired` event, the cancel page, or the maintenance cron
   calls `release_booking_hold`, which voids the payment and expires the held lessons.

Lessons booked with a **package credit**, or orders a promo makes free, skip Stripe and open the instructor
request immediately. Credits are consumed atomically (`consume_package_credit`) and must match the package's
lesson length, number of swimmers and zone.

## Cancel & reschedule (parent)

| When | Cancel | Reschedule |
| --- | --- | --- |
| ≥ `cancellation_window_hours` (24) before | full refund to the card (Stripe refund, idempotency-keyed), or the credit returns to the package | self-serve; keeps the same instructor if they're free, otherwise the lesson is re-offered |
| inside the window | refund of `late_cancel_refund_pct` (0%); package credit forfeited | not available online |

A weekly-series lesson refunds its own share, including its slice of any promo discount. Refunds issued in the
Stripe dashboard flow back through `charge.refunded`.

## Stripe setup

1. **Keys:** `STRIPE_SECRET_KEY` (server) and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (reserved for embedded
   Elements; Checkout doesn't need it).
2. **Webhook endpoint:** `https://your-domain.com/api/webhooks/stripe`, subscribed to these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `charge.refunded`

   Put the signing secret in `STRIPE_WEBHOOK_SECRET`. Locally, run
   `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
3. **Customer Portal:** enable it in the dashboard (payment methods, invoice history). Parents reach it from
   **Receipts → Manage payment methods**. You can optionally pin a configuration with
   `STRIPE_PORTAL_CONFIGURATION_ID`.
4. Events are de-duplicated in `stripe_events`. Failed handling returns HTTP 500 so that Stripe retries.

## Local development without Stripe

Set `PAYMENTS_DEV_MODE=true` and leave `STRIPE_SECRET_KEY` empty. Checkout then redirects to `/dev/checkout`,
which simulates paying or cancelling. Refunds succeed with fake ids. This is disabled in production builds
(`NODE_ENV=production`) and whenever a Stripe key is set.
