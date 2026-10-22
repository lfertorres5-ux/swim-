"use server";

import { z } from "zod";
import type { FormState } from "@/components/action-form";
import { AdminError, adminAudit, bool, cents, check, int, list, runAdmin, text } from "@/lib/admin/action";
import { boundaryVerticesOutsideCounty, isSanDiegoCountyZip, type GeoJsonPolygon } from "@/lib/geo/san-diego-county";
import { createAdminClient } from "@/lib/supabase/admin";

const nn = <T>(v: T | null, label: string): T => {
  if (v === null) throw new AdminError(`${label} is required`);
  return v;
};

// --- Lesson prices + pricing rules ------------------------------------------------

export async function saveLessonPrice(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const duration = nn(int(fd, "duration_minutes"), "Length");
    if (duration < 15 || duration > 240 || duration % 15) throw new AdminError("Lesson length must be 15–240 minutes, in 15-minute steps.");
    const row = { duration_minutes: duration, price_cents: nn(cents(fd, "price"), "Price"), label: text(fd, "label"), is_active: bool(fd, "is_active") };
    const admin = createAdminClient();
    check((await admin.from("lesson_prices").upsert(row, { onConflict: "duration_minutes" })).error);
    await adminAudit(user.id, "admin.save_lesson_price", "lesson_price", null, row);
    return `${duration}-minute price saved.`;
  });
}

export async function savePricingRules(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const row = {
      included_children: nn(int(fd, "included_children"), "Swimmers included"),
      extra_child_cents: nn(cents(fd, "extra_child"), "Extra swimmer price"),
      recurring_discount_pct: nn(int(fd, "recurring_discount_pct"), "Weekly discount"),
      neighborhood_discount_cents: nn(cents(fd, "neighborhood_discount"), "Neighborhood discount"),
      neighborhood_window_minutes: nn(int(fd, "neighborhood_window_minutes"), "Neighborhood window"),
      updated_by: user.id,
    };
    if (row.included_children < 1 || row.recurring_discount_pct > 100) throw new AdminError("Check the numbers — discounts are 0–100%.");
    const admin = createAdminClient();
    check((await admin.from("pricing_config").update(row).eq("id", true)).error, { "23514": "One of those values is out of range." });
    await adminAudit(user.id, "admin.save_pricing_rules", "pricing_config", null, row);
    return "Pricing rules saved. New bookings use them right away.";
  });
}

export async function savePackage(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const id = text(fd, "id");
    const row = {
      name: nn(text(fd, "name"), "Name"),
      lesson_count: nn(int(fd, "lesson_count"), "Lessons"),
      discount_pct: nn(int(fd, "discount_pct"), "Discount"),
      validity_days: nn(int(fd, "validity_days"), "Valid for"),
      is_active: bool(fd, "is_active"),
      sort_order: int(fd, "sort_order") ?? 0,
    };
    if (row.lesson_count < 2 || row.discount_pct < 0 || row.discount_pct > 100 || row.validity_days < 1) throw new AdminError("Packages need 2+ lessons, a 0–100% discount and a validity of at least a day.");
    const admin = createAdminClient();
    const { data, error } = id ? await admin.from("package_offerings").update(row).eq("id", z.guid().parse(id)).select("id").single() : await admin.from("package_offerings").insert(row).select("id").single();
    check(error, { "23505": `There's already a ${row.lesson_count}-lesson package.` });
    await adminAudit(user.id, id ? "admin.update_package" : "admin.create_package", "package_offering", data!.id, row);
    return `${row.name} saved.`;
  });
}

// --- Discount codes ------------------------------------------------------------

export async function saveDiscountCode(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const id = text(fd, "id");
    const code = nn(text(fd, "code"), "Code").toUpperCase();
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new AdminError("Codes are 3–30 letters, numbers, - or _.");
    const kind = fd.get("discount_kind") === "amount" ? "amount" : "percent";
    const value = kind === "amount" ? cents(fd, "value") : int(fd, "value");
    if (!value || value <= 0 || (kind === "percent" && value > 100)) throw new AdminError("Enter the discount (1–100% or a dollar amount).");
    const appliesTo = fd.getAll("applies_to").map(String).filter((v) => ["single", "package", "recurring"].includes(v));
    if (!appliesTo.length) throw new AdminError("Pick what the code works on.");
    const validUntil = text(fd, "valid_until");
    const row = {
      code,
      description: text(fd, "description"),
      percent_off: kind === "percent" ? value : null,
      amount_off_cents: kind === "amount" ? value : null,
      applies_to: appliesTo,
      max_redemptions: int(fd, "max_redemptions"),
      valid_until: validUntil ? new Date(`${validUntil}T23:59:59-08:00`).toISOString() : null,
      is_active: bool(fd, "is_active"),
    };
    const admin = createAdminClient();
    const { data, error } = id ? await admin.from("discount_codes").update(row).eq("id", z.guid().parse(id)).select("id").single() : await admin.from("discount_codes").insert(row).select("id").single();
    check(error, { "23505": `${code} already exists.` });
    await adminAudit(user.id, id ? "admin.update_discount_code" : "admin.create_discount_code", "discount_code", data!.id, row);
    return `${code} saved.`;
  });
}

// --- Zones -----------------------------------------------------------------------

export async function saveZone(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const id = text(fd, "id");
    const postal = list(fd, "postal_codes");
    const bad = postal.filter((z) => !/^\d{5}$/.test(z) || !isSanDiegoCountyZip(z));
    if (bad.length) throw new AdminError(`Not San Diego County ZIPs: ${bad.join(", ")}`);
    let boundary: GeoJsonPolygon | null = null;
    const raw = text(fd, "boundary");
    if (raw) {
      try {
        boundary = JSON.parse(raw) as GeoJsonPolygon;
      } catch {
        throw new AdminError("The boundary isn't valid GeoJSON.");
      }
      if (!boundary || !["Polygon", "MultiPolygon"].includes(boundary.type)) throw new AdminError("The boundary must be a GeoJSON Polygon or MultiPolygon.");
      const outside = boundaryVerticesOutsideCounty(boundary);
      if (outside.length) throw new AdminError(`${outside.length} boundary point${outside.length === 1 ? " is" : "s are"} outside San Diego County (e.g. ${outside[0].join(", ")}).`);
    }
    const code = nn(text(fd, "code"), "Code").toUpperCase();
    const row = {
      code,
      name: nn(text(fd, "name"), "Name"),
      description: text(fd, "description"),
      travel_fee_cents: cents(fd, "travel_fee") ?? 0,
      min_booking_minutes: int(fd, "min_booking_minutes") ?? 0,
      is_bookable: bool(fd, "is_bookable"),
      postal_codes: postal,
      neighborhoods: list(fd, "neighborhoods"),
      map_color: text(fd, "map_color"),
      sort_order: int(fd, "sort_order") ?? 0,
      ...(raw !== null || !id ? { boundary } : {}),
    };
    const admin = createAdminClient();
    const { data, error } = id ? await admin.from("zones").update(row).eq("id", z.guid().parse(id)).select("id").single() : await admin.from("zones").insert(row).select("id").single();
    check(error, { "23505": `Zone ${code} already exists.`, "23514": "The database rejected this zone: every ZIP and boundary point must be inside San Diego County." });
    await adminAudit(user.id, id ? "admin.update_zone" : "admin.create_zone", "zone", data!.id, { ...row, boundary: boundary ? "(set)" : null });
    return `Zone ${code} saved.`;
  });
}

export async function saveTravelBuffers(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const rows: { from_zone_id: string; to_zone_id: string; buffer_minutes: number }[] = [];
    for (const [key, value] of fd.entries()) {
      const m = /^buffer:([0-9a-f-]{36}):([0-9a-f-]{36})$/.exec(key);
      if (!m || typeof value !== "string" || value.trim() === "") continue;
      const minutes = Number(value);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) throw new AdminError("Buffers are whole minutes between 0 and 240.");
      rows.push({ from_zone_id: m[1], to_zone_id: m[2], buffer_minutes: minutes });
    }
    const admin = createAdminClient();
    if (rows.length) check((await admin.from("zone_travel_buffers").upsert(rows, { onConflict: "from_zone_id,to_zone_id" })).error);
    await adminAudit(user.id, "admin.save_travel_buffers", "zone_travel_buffers", null, { count: rows.length });
    return "Travel times saved.";
  });
}

// --- Policies -------------------------------------------------------------------

export async function savePolicies(_: FormState, fd: FormData): Promise<FormState> {
  return runAdmin(async (user) => {
    const sharing = fd.get("contact_sharing") === "never" ? "never" : "package_instructor";
    const row = {
      cancellation_window_hours: nn(int(fd, "cancellation_window_hours"), "Cancellation window"),
      late_cancel_refund_pct: nn(int(fd, "late_cancel_refund_pct"), "Late refund"),
      min_booking_notice_hours: nn(int(fd, "min_booking_notice_hours"), "Booking notice"),
      max_booking_horizon_days: nn(int(fd, "max_booking_horizon_days"), "Booking horizon"),
      booking_request_window_hours: nn(int(fd, "booking_request_window_hours"), "Reply window"),
      payment_hold_minutes: nn(int(fd, "payment_hold_minutes"), "Payment hold"),
      default_travel_buffer_minutes: nn(int(fd, "default_travel_buffer_minutes"), "Default travel buffer"),
      default_instructor_pay_cents_per_hour: nn(cents(fd, "default_pay"), "Default pay"),
      reminder_hours_before: nn(int(fd, "reminder_hours_before"), "Reminder"),
      sub_board_requires_approval: bool(fd, "sub_board_requires_approval"),
      sub_board_min_notice_hours: nn(int(fd, "sub_board_min_notice_hours"), "Sub board notice"),
      contact_sharing: sharing,
      max_children_per_lesson: nn(int(fd, "max_children_per_lesson"), "Max swimmers"),
      day_pass_enabled: bool(fd, "day_pass_enabled"),
      hsa_fsa_enabled: bool(fd, "hsa_fsa_enabled"),
      partner_club_name: text(fd, "partner_club_name"),
      support_email: text(fd, "support_email"),
      support_phone: text(fd, "support_phone"),
      updated_by: user.id,
    };
    const admin = createAdminClient();
    const { data: before } = await admin.from("platform_settings").select("*").single();
    check((await admin.from("platform_settings").update(row).eq("id", true)).error, { "23514": "One of those values is out of range (e.g. refund 0–100%, reminder 1–168 hours, payment hold 31+ minutes)." });
    const changed = Object.fromEntries(Object.entries(row).filter(([k, v]) => k !== "updated_by" && String(before?.[k as keyof typeof before] ?? "") !== String(v ?? "")));
    await adminAudit(user.id, "admin.save_policies", "platform_settings", null, changed);
    return Object.keys(changed).length ? `Saved ${Object.keys(changed).length} change${Object.keys(changed).length === 1 ? "" : "s"}.` : "No changes.";
  });
}
