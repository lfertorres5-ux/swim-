-- =============================================================================
-- HSA/FSA payments through Truemed
--
-- Truemed is the merchant of record for HSA/FSA transactions: the family is
-- redirected to Truemed (eligibility survey + HSA/FSA card), and Truemed's
-- webhook tells us when the payment is captured. Off until the owner has a
-- Truemed account (TRUEMED_API_KEY) and turns it on in Admin → Policies.
-- =============================================================================

alter table public.payments
  add column processor text not null default 'stripe' check (processor in ('stripe', 'truemed', 'manual')),
  add column processor_session_id text unique;

alter table public.platform_settings
  add column hsa_fsa_enabled boolean not null default false;
