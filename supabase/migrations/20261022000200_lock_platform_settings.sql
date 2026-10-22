-- =============================================================================
-- Public pages read a handful of policy settings; internal operating values
-- (default instructor pay, buffers, hold times, offer timing…) stay server-side.
-- Column-level SELECT replaces the table-wide grant for anon/authenticated.
-- The service role (server code, admin pages) still reads everything.
-- =============================================================================
revoke select on public.platform_settings from anon, authenticated;
grant select (
  id,
  timezone,
  cancellation_window_hours,
  late_cancel_refund_pct,
  booking_request_window_hours,
  min_booking_notice_hours,
  max_booking_horizon_days,
  max_children_per_lesson,
  recurring_term_weeks,
  instructor_terms_version,
  sub_board_requires_approval,
  sub_board_min_notice_hours,
  day_pass_enabled,
  partner_club_name,
  hsa_fsa_enabled,
  support_email,
  support_phone
) on public.platform_settings to anon, authenticated;
