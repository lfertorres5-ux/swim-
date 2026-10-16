import "server-only";
import { loadSchedulingData } from "@/lib/scheduling/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, laDateString, laWallTimeToUtc } from "@/lib/time";
import { one } from "@/lib/utils";
import { certState } from "./certs";
import { netRevenue, utilization, zoneHeatmap } from "./metrics";

/** Everything on the admin dashboard, in one pass. Service role: it aggregates across every table. */
export async function loadDashboard(now = Date.now()) {
  const admin = createAdminClient();
  const today = laDateString(new Date(now));
  const since30 = new Date(laWallTimeToUtc(addDays(today, -30), 0)).toISOString();
  const since90 = new Date(laWallTimeToUtc(addDays(today, -90), 0)).toISOString();
  const until30 = new Date(laWallTimeToUtc(addDays(today, 31), 0)).toISOString();
  const nowIso = new Date(now).toISOString();
  const week = new Date(now + 7 * 86_400_000).toISOString();

  const [payments, lessons, cancelled, upcoming, zones, attention, pendingShifts, inquiries, certs, awaiting, schedule] = await Promise.all([
    admin.from("payments").select("amount_cents, refunded_cents, status").gte("created_at", since30),
    admin.from("bookings").select("zone_id, starts_at, status").in("status", ["confirmed", "completed"]).gte("starts_at", since90).lt("starts_at", until30),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("status", "cancelled").gte("cancelled_at", since30),
    admin.from("bookings").select("id", { count: "exact", head: true }).in("status", ["confirmed", "pending_instructor"]).gte("starts_at", nowIso).lt("starts_at", week),
    admin.from("zones").select("id, code, name").order("sort_order").order("code"),
    admin.from("bookings").select("id, starts_at, attention_reason").eq("needs_attention", true).in("status", ["pending_instructor", "confirmed"]).order("starts_at").limit(10),
    admin.from("open_shifts").select("id, starts_at, from:instructors!open_shifts_released_by_fkey(first_name), to:instructors!open_shifts_claimed_by_fkey(first_name)").eq("status", "pending_approval").order("starts_at"),
    admin.from("day_pass_inquiries").select("id, contact_name, created_at").eq("status", "new").order("created_at"),
    admin.from("instructor_certifications").select("id, kind, expires_on, instructor:instructors!inner(id, first_name, is_active)").lte("expires_on", addDays(today, 30)).eq("instructor.is_active", true).order("expires_on"),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("status", "pending_instructor").eq("needs_attention", false),
    loadSchedulingData(today, addDays(today, 13)),
  ]);

  const past30 = (lessons.data ?? []).filter((l) => l.starts_at >= since30 && l.starts_at < nowIso).length;
  const held = past30 + (cancelled.count ?? 0);
  const util = utilization(
    schedule.instructors.map((i) => i.id),
    schedule.rules,
    schedule.overrides,
    schedule.occupied.filter((o) => o.zoneId !== null),
    today,
    addDays(today, 13),
  ).map((u) => ({ ...u, firstName: schedule.instructors.find((i) => i.id === u.instructorId)?.firstName ?? "?" }));

  return {
    revenue: netRevenue(payments.data ?? []),
    lessons30: past30,
    upcoming7: upcoming.count ?? 0,
    cancellations30: cancelled.count ?? 0,
    cancellationRate: held ? Math.round(((cancelled.count ?? 0) / held) * 100) : 0,
    awaitingInstructor: awaiting.count ?? 0,
    utilization: util.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)),
    zones: zones.data ?? [],
    heatmap: zoneHeatmap((lessons.data ?? []).map((l) => ({ zoneId: l.zone_id, startsAt: l.starts_at })), (zones.data ?? []).map((z) => z.id)),
    todo: {
      attention: attention.data ?? [],
      approvals: (pendingShifts.data ?? []).map((s) => ({ id: s.id, startsAt: s.starts_at, from: one(s.from)?.first_name, to: one(s.to)?.first_name })),
      inquiries: inquiries.data ?? [],
      certs: (certs.data ?? []).map((c) => ({ id: c.id, kind: c.kind, expiresOn: c.expires_on, instructorId: one(c.instructor)?.id, firstName: one(c.instructor)?.first_name, ...certState(c.expires_on, today) })),
    },
  };
}
