import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * One-off messages carried in the URL after a redirect ("That time was just
 * taken…"). Each is signed with a server-only key, and pages render it only
 * if the signature checks out — so a crafted link can't put attacker-written
 * text ("call 555… for your refund") on our pages.
 */
type Kind = "error" | "notice";

function key() {
  const base =
    process.env.FLASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base)
    throw new Error("FLASH_SECRET (or SUPABASE_SERVICE_ROLE_KEY) must be set");
  return createHash("sha256").update(`flash:${base}`).digest();
}

const sign = (kind: Kind, message: string) =>
  createHmac("sha256", key()).update(`${kind}\n${message}`).digest("base64url");

/** Query-string fragment, e.g. `error=…&error_sig=…`. */
export function flashQuery(kind: Kind, message: string): string {
  const text = message.slice(0, 300);
  return `${kind}=${encodeURIComponent(text)}&${kind}_sig=${sign(kind, text)}`;
}

/** The message if it was signed by us, otherwise null. */
export function readFlash(
  params: Record<string, string | string[] | undefined>,
  kind: Kind,
): string | null {
  const text = params[kind];
  const sig = params[`${kind}_sig`];
  if (typeof text !== "string" || typeof sig !== "string" || text.length > 300)
    return null;
  const expected = Buffer.from(sign(kind, text));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given)
    ? text
    : null;
}
