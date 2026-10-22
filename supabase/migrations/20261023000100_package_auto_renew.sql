-- =============================================================================
-- Package auto-renew (opt-in).
--
-- A family can tick "auto-renew" when buying a package by card. When the last
-- lesson of that package has been booked, the renewal is scheduled for after
-- that lesson; the family is emailed at least 3 days before the charge and can
-- turn it off from their account at any time. The saved card (Stripe payment
-- method) is charged off-session and the same package is added to the account.
-- =============================================================================

alter table public.packages
  add column auto_renew boolean not null default false,
  add column auto_renew_consented_at timestamptz,
  -- The regular package price (no one-time promo), as shown when they opted in.
  add column renewal_amount_cents integer check (renewal_amount_cents > 0),
  add column renewal_payment_method_id text,
  add column renewal_charge_at timestamptz,
  add column renewal_reminded_at timestamptz,
  add column renewal_started_at timestamptz,
  add column renewal_failed_at timestamptz,
  add column renewal_failure text,
  add column renewed_from_package_id uuid references public.packages (id) on delete set null,
  add column renewed_to_package_id uuid references public.packages (id) on delete set null;

create index packages_auto_renew_idx on public.packages (id)
  where auto_renew and renewed_to_package_id is null and renewal_started_at is null;

-- Parents read their own packages through RLS already; the saved card
-- reference stays server-side.
revoke select on public.packages from authenticated;
grant select (
  id, parent_id, offering_id, lesson_count, lessons_remaining, duration_minutes, children_count, zone_id,
  unit_price_cents, discount_pct, total_cents, status, purchased_at, expires_at, created_at, updated_at,
  auto_renew, auto_renew_consented_at, renewal_amount_cents, renewal_charge_at, renewal_reminded_at, renewal_started_at,
  renewal_failed_at, renewed_from_package_id, renewed_to_package_id
) on public.packages to authenticated;
