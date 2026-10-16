# Deploying to Supabase + Vercel

## 1. Supabase project

1. Create a project at <https://supabase.com/dashboard>. Pick region **West US (N. California)**, closest to
   San Diego, and save the database password.
2. Link and push the schema from your machine:

   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push          # applies supabase/migrations/*.sql
   ```

   **Do not** run `seed.sql` against production. For a staging project you can load it with
   `psql "$STAGING_DB_URL" -f supabase/seed.sql`.
3. **Auth → URL Configuration**
   - Site URL: `https://your-domain.com`
   - Redirect URLs: `https://your-domain.com/auth/callback`, `https://your-domain.com/auth/confirm`, and for
     Vercel previews `https://*-<your-vercel-team>.vercel.app/**`
4. **Auth → Email Templates.** Paste `supabase/templates/magic_link.html` into *Magic Link* and
   `supabase/templates/confirmation.html` into *Confirm signup*. Both use token-hash links, so a link opened
   on a different device than the one that requested it still works.
5. **Auth → SMTP.** Supabase's built-in mailer is rate-limited and not meant for production. Use Resend:
   host `smtp.resend.com`, port `465`, user `resend`, password = your Resend API key, sender = a verified
   domain address.
6. **Auth → Providers → Google.** Enable it and paste the OAuth client ID/secret. In Google Cloud, add
   `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI.
7. **Auth → Providers → Email.** Keep *Confirm email* on, and keep the OTP expiry at 3600 s or less.
8. **Storage.** The migration creates the `instructor-photos` (public) and `certifications` (private)
   buckets and their policies. Nothing to do.
9. **API keys.** Copy the project URL, the anon/publishable key and the service-role/secret key for Vercel.

## 2. Vercel

1. Import the GitHub repo. The framework preset is auto-detected as Next.js; the build command is
   `npm run build`.
2. Under **Settings → Environment Variables**, add the variables from `.env.example` for *Production* and
   *Preview*. Phase 1 needs only:
   - `NEXT_PUBLIC_SITE_URL` (e.g. `https://your-domain.com`; leave it unset on Preview to fall back to the
     preview URL)
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only, never prefixed with `NEXT_PUBLIC_`)
3. Deploy, then add your custom domain under **Settings → Domains**.

## 3. Bootstrap the owner account

Sign in once on the deployed site (magic link or Google), then in the Supabase SQL editor:

```sql
update public.users set role = 'admin' where email = 'owner@your-domain.com';
-- The trigger created a parents row on first sign-in; the admin doesn't need it.
delete from public.parents where id = (select id from public.users where email = 'owner@your-domain.com');
```

Invite instructors from **Admin → Instructors** (they get an email).
When an invited email signs in, it becomes an **inactive** instructor who must accept the platform terms
before seeing any client data, and whom an admin must then activate.

## 4. Later phases (checklist)

| Phase | Extra setup |
| --- | --- |
| 2 | `CRON_SECRET` (any long random string). `vercel.json` runs `/api/cron/scheduling` every 10 minutes, which expires booking requests and re-offers them. **Vercel Hobby only allows daily crons**, so use Pro, or call the endpoint from an external scheduler with `Authorization: Bearer $CRON_SECRET` |
| 3 | Stripe: `STRIPE_SECRET_KEY`, webhook endpoint `https://your-domain.com/api/webhooks/stripe` → `STRIPE_WEBHOOK_SECRET`, Customer Portal enabled (see [payments.md](payments.md)). Google Maps: a browser key `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` restricted to your domains with **Places API (New)**, and a server key `GOOGLE_MAPS_SERVER_API_KEY` with the **Geocoding API**. Make sure `PAYMENTS_DEV_MODE` is unset in production |
| 4 | **Email:** `RESEND_API_KEY` + a verified sending domain, `EMAIL_FROM`. **Text:** Twilio `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` (register the number for A2P 10DLC; Twilio handles STOP/opt-out). `ADMIN_ALERT_EMAIL` for owner alerts. `/api/cron/notifications` runs every 5 minutes (reminders + retries). Without keys, messages are only logged — see Admin → Messages |
| 5 | Nothing new. Set `ADMIN_ALERT_EMAIL` to get sub-approval and day-pass alerts; create day-pass links in Stripe → Payment Links |
| 6 | Google Calendar OAuth client; `TOKEN_ENCRYPTION_KEY` |

## 5. Ongoing migrations

Add new SQL files under `supabase/migrations/` (`supabase migration new <name>`), run `npm run test:rls`
locally, open a PR (CI runs migrations + the RLS suite against Postgres 17), and after merge run
`supabase db push`. Supabase's GitHub integration can also apply migrations automatically on merge to `main`.
