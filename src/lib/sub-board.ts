import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyClaimDeclined, notifyShiftClaimed, notifyShiftFilled, notifyShiftPosted, safely } from "@/lib/notifications/events";

/**
 * Sub board actions. Each runs as the signed-in user (RLS client), so the
 * database decides who may post, claim or approve; this module only maps the
 * outcome to messages and notifications.
 */
type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

function message(err: { code?: string; message: string }): string {
  if (err.code === "42501") return "You can't do that.";
  if (err.code === "P0002") return "That lesson isn't on the board any more.";
  return err.message;
}

export async function releaseLesson(client: SupabaseClient, bookingId: string, reason: string | null): Promise<Result<string>> {
  const { data, error } = await client.rpc("release_lesson_to_board", { p_booking_id: bookingId, p_reason: reason });
  if (error) return { ok: false, error: message(error) };
  await safely("shift posted", () => notifyShiftPosted(data as string));
  return { ok: true, value: data as string };
}

export async function withdrawShift(client: SupabaseClient, shiftId: string): Promise<Result> {
  const { error } = await client.rpc("withdraw_open_shift", { p_shift_id: shiftId });
  return error ? { ok: false, error: message(error) } : { ok: true, value: undefined };
}

export async function claimShift(client: SupabaseClient, shiftId: string): Promise<Result<"filled" | "pending_approval">> {
  const { data, error } = await client.rpc("claim_open_shift", { p_shift_id: shiftId });
  if (error) return { ok: false, error: message(error) };
  if (data === "filled") await safely("shift filled", () => notifyShiftFilled(shiftId));
  else await safely("shift claimed", () => notifyShiftClaimed(shiftId));
  return { ok: true, value: data as "filled" | "pending_approval" };
}

export async function decideShift(client: SupabaseClient, shiftId: string, approve: boolean, note: string | null): Promise<Result> {
  const { data: before } = await client.from("open_shifts").select("claimed_by").eq("id", shiftId).maybeSingle();
  const { error } = await client.rpc("decide_open_shift", { p_shift_id: shiftId, p_approve: approve, p_note: note });
  if (error) return { ok: false, error: message(error) };
  if (approve) await safely("shift filled", () => notifyShiftFilled(shiftId));
  else if (before?.claimed_by) await safely("claim declined", () => notifyClaimDeclined(shiftId, before.claimed_by as string));
  return { ok: true, value: undefined };
}
