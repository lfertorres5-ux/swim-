/** Only allow same-origin relative redirects (blocks //evil.com and absolute URLs). */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!next || !next.startsWith("/") || next.length > 500) return fallback;
  // Browsers drop tabs/newlines and treat "\" as "/", so "/\t/evil.com" would leave the site.
  if (/[\x00-\x1f\x7f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
