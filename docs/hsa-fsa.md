# HSA/FSA payments (Truemed)

Families can pay with HSA/FSA funds through [Truemed](https://www.truemed.com). Truemed runs a short health
survey; if one of its licensed providers issues a Letter of Medical Necessity, the family pays with their HSA/FSA
card. **Truemed is the merchant of record** for these payments and decides eligibility, not us.

## Turning it on

1. Apply to Truemed as a merchant (their "Custom API" partner program) and wait for approval. They decide whether
   swim lessons qualify for your business.
2. In Vercel → **swim → Settings → Environment Variables** add:
   - `TRUEMED_API_KEY` — from Truemed
   - `TRUEMED_SANDBOX` = `true` while testing (uses `dev-api.truemed.com`); remove it to go live
   - `TRUEMED_WEBHOOK_KEY` — **required**: the separate key Truemed sends on webhooks. The HSA/FSA option stays hidden until it's set; the API key is never accepted on webhooks.
3. In Truemed's dashboard set the webhook URL to `https://<your site>/api/webhooks/truemed`
   (`payment_session_complete` events).
4. Redeploy, then **Admin → Settings → Policies → HSA/FSA payments → Offer “Pay with HSA/FSA”**.

When it's on, the review step of booking shows **Credit or debit card** / **HSA / FSA card**, and the home page
FAQ and pricing mention HSA/FSA. When it's off (or the key is missing) none of that appears.

## How it works

- Checkout creates a Truemed payment session at the server-computed price and redirects the family to Truemed.
  The slot is held for an hour (the survey takes a few minutes longer than card checkout).
- Bookings are confirmed only when Truemed's webhook reports **captured** — never from the return redirect.
  `authorized` waits; failed / cancelled / expired frees the slot. Each event is processed once.
- **Refunds:** Truemed holds the money, so refunds are issued from the Truemed dashboard. When a family cancels
  an HSA/FSA lesson inside the refund window, the lesson is cancelled and you get an email
  ("Refund needed in Truemed: $65"). HSA/FSA payments are labeled in Admin → Payments.

## Before going live: confirm in the sandbox

The request fields follow Truemed's payment-session docs (`total_amount` in cents, `order_items`,
`customer_email`, `customer_name`, `success_url`, `failure_url`; webhook `payment_id` + `status`). Run one
sandbox purchase end to end and check the booking turns to "awaiting instructor" — if Truemed's field names
differ, adjust `src/lib/payments/truemed.ts` (one file).

## Wording

Keep marketing to "may qualify" / "you may be able to use HSA/FSA funds". Don't promise eligibility — it's a
medical determination made by Truemed's providers.
