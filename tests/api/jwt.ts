import { createHmac } from "node:crypto";

const b64 = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** HS256 JWT signed with the PostgREST secret — mimics Supabase access tokens. */
export function signJwt(claims: Record<string, unknown>, secret = process.env.API_TEST_JWT_SECRET!) {
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims }));
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}
