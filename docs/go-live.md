# Putting the site online (no coding needed)

About 45 minutes. You'll create three free accounts, copy a few values between them, and click Deploy.
At the end you'll have a real link (like `coastal-swim.vercel.app`) you can open on your phone.

| You'll need | What it's for | Cost |
| --- | --- | --- |
| **GitHub** (you already have it) | Holds the code | Free |
| **Supabase** | Database, logins, sign-in emails | Free to start |
| **Vercel** | Runs the website | Free (see step 4 note), Pro $20/mo |
| **Stripe** | Card payments (test mode first) | Free; fees only on real charges |

---

## Step 1 — Put the latest code on the main branch

The work lives on the branch `claude/affectionate-knuth-hwei4j`. Vercel publishes the **main** branch as your live site.
Ask Claude to "open a pull request to main", then click **Merge** on GitHub. (Or, in step 3, point Vercel at that branch.)

## Step 2 — Supabase (database + logins)

1. Go to <https://supabase.com> → **Start your project** → sign in with GitHub.
2. **New project** → name it (e.g. `coastal-swim`) → set a database password (save it somewhere safe) →
   Region **West US (North California)** → **Create**. Wait ~2 minutes.
3. Left menu → **SQL Editor** → **New query**. Open the file `supabase/setup-all.sql` from the repo on GitHub,
   click **Raw**, select all, copy, paste into Supabase, click **Run**. You should see "Success. No rows returned".
4. Left menu → **Project Settings → API**. Keep this tab open; you'll copy three values:
   - **Project URL**
   - **anon public** key
   - **service_role** key (secret — never share it or put it anywhere public)
5. Left menu → **Authentication → URL Configuration**: you'll fill this in after step 3 gives you your web address.

## Step 3 — Vercel (the website)

1. Go to <https://vercel.com> → **Sign up** → **Continue with GitHub**.
2. **Add New… → Project** → find **swim-** → **Import**.
3. Open **Environment Variables** and add these (name on the left, value on the right):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase **Project URL** |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase **anon public** key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service_role** key |
   | `CRON_SECRET` | any long random phrase, e.g. 40 random letters and numbers |
   | `ADMIN_ALERT_EMAIL` | your email (owner alerts) |
   | `STRIPE_SECRET_KEY` | from step 5 (you can add it later) |

4. Click **Deploy**. When it finishes you get a link like `https://swim-abc123.vercel.app`. **That's your website.**

> **Free-plan note.** The site has two background jobs (24-hour reminders every 5 minutes, and re-offering
> unanswered requests every 10 minutes). Vercel's free plan only allows jobs once a day, so the deploy may stop
> with a "cron" error. Two fixes — pick one:
> - Upgrade the project to **Vercel Pro** ($20/month), or
> - Ask Claude to "switch the background jobs to an outside scheduler": it removes them from `vercel.json`,
>   and you add two free jobs at <https://cron-job.org> that call your site every 5 and 10 minutes with the
>   `CRON_SECRET`.

## Step 4 — Connect logins to your web address

Back in Supabase → **Authentication → URL Configuration**:
- **Site URL**: your Vercel link, e.g. `https://swim-abc123.vercel.app`
- **Redirect URLs** → add `https://swim-abc123.vercel.app/auth/callback` and `https://swim-abc123.vercel.app/auth/confirm`

Then **Authentication → Email Templates**: paste `supabase/templates/magic_link.html` into *Magic Link* and
`supabase/templates/confirmation.html` into *Confirm signup* (open each on GitHub → Raw → copy).

Supabase sends the sign-in emails itself at first (limited to a few per hour — fine for trying it out).
Before real customers, connect Resend (see `docs/deploy.md`, section 1, step 5).

## Step 5 — Stripe (test mode)

1. <https://dashboard.stripe.com/register> → create an account. Leave **Test mode** on (top right).
2. **Developers → API keys** → copy the **Secret key** (`sk_test_…`) → add it in Vercel as `STRIPE_SECRET_KEY`.
3. **Developers → Webhooks → Add endpoint** → URL `https://<your link>/api/webhooks/stripe` → select events
   `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `charge.refunded` → **Add**. Copy the **Signing secret**
   (`whsec_…`) → add it in Vercel as `STRIPE_WEBHOOK_SECRET`.
4. In Vercel → **Deployments** → **⋯ → Redeploy** so the new keys take effect.

Test card: **4242 4242 4242 4242**, any future date, any CVC. Nothing is really charged in test mode.

## Step 6 — Make yourself the owner

1. Open your site → **Sign in** → enter your email → click the link in the email.
2. In Supabase → **SQL Editor** → run (with your email):

   ```sql
   update public.users set role = 'admin' where email = 'you@yourdomain.com';
   delete from public.parents where id = (select id from public.users where email = 'you@yourdomain.com');
   ```
3. Refresh the site — you'll land on the Admin dashboard.

## Step 7 — Fill in your business

In **Admin → Settings**:
- **Policies → Contact**: your phone number and email. They appear on the home page ("Still have questions?")
  and in the footer. Until then the site says "Phone and email coming soon".
- **Prices & packages**, **Zones**, **Discount codes**: check the starting values.
- **Admin → Instructors → Invite**: invite each instructor by email.

Now scroll through it: open the link on your phone, try a booking with the test card, and check the emails.

---

## Adding the photos

The home page has four photo spots (main hero, small polaroid, the instructors section, and the Day Pass banner).
Until photos are added they show a drawn pool-water illustration.

1. Find photos on <https://unsplash.com> or <https://www.pexels.com> (free for business use — skip anything labeled
   "Unsplash+"). What fits each spot is described in `src/content/photos.ts`.
2. Send them to Claude (or put them in `public/photos/` as `hero.jpg`, `splash.jpg`, `toddler.jpg`, `club.jpg`)
   along with the photographer's name and photo link. Claude fills in `src/content/photos.ts`, and the credit
   appears in the footer automatically.

## Using your own domain (optional)

Buy a domain (e.g. at Namecheap, Squarespace, or in Vercel itself) → Vercel → your project →
**Settings → Domains → Add** → follow the instructions shown. Then repeat step 4 with the new address.
