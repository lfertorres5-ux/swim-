import pg from "pg";
import { randomUUID } from "node:crypto";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL is not set. See README → Testing (e.g. postgres://postgres@127.0.0.1:5432/swim_test).",
  );
}

export const pool = new pg.Pool({ connectionString: url, max: 4 });

type Db = pg.PoolClient;

/** Run as the database owner (bypasses RLS) — fixtures and assertions only. */
export async function asOwner<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    return await fn(db);
  } finally {
    db.release();
  }
}

/**
 * Run `fn` exactly the way PostgREST would for a signed-in user: inside a
 * transaction, as the `authenticated` role, with JWT claims set. Always rolled
 * back, so tests never leak state into each other.
 */
export async function asUser<T>(userId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return impersonate("authenticated", { sub: userId, role: "authenticated" }, fn);
}

export async function asAnon<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return impersonate("anon", { role: "anon" }, fn);
}

async function impersonate<T>(role: string, claims: Record<string, string>, fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [claims.sub ?? ""]);
    return await fn(db);
  } finally {
    await db.query("rollback").catch(() => {});
    db.release();
  }
}

/** Assert a statement fails with a given SQLSTATE without aborting the outer transaction. */
export async function expectSqlError(db: Db, sql: string, params: unknown[] = [], code?: string): Promise<pg.DatabaseError> {
  const sp = `sp_${randomUUID().replace(/-/g, "")}`;
  await db.query(`savepoint ${sp}`);
  try {
    await db.query(sql, params);
  } catch (err) {
    await db.query(`rollback to savepoint ${sp}`);
    const e = err as pg.DatabaseError;
    if (code && e.code !== code) {
      throw new Error(`expected SQLSTATE ${code}, got ${e.code}: ${e.message}`);
    }
    return e;
  }
  await db.query(`release savepoint ${sp}`);
  throw new Error(`expected statement to fail${code ? ` with ${code}` : ""}: ${sql}`);
}

export const PERMISSION_DENIED = "42501"; // insufficient_privilege (also RLS WITH CHECK violations)
export const EXCLUSION_VIOLATION = "23P01";
export const NO_DATA_FOUND = "P0002";
export const INVALID_PARAMETER = "22023";
export const CHECK_VIOLATION = "23514";
export const TRAVEL_BUFFER_CONFLICT = "SB001";
export const OFFER_NOT_PENDING = "SB002";

/** One transaction (always rolled back) in which the test can switch identities. */
export async function inTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    return await fn(db);
  } finally {
    await db.query("rollback").catch(() => {});
    db.release();
  }
}

export async function becomeUser(db: Db, userId: string) {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
}

export async function becomeServiceRole(db: Db) {
  await db.query("set local role service_role");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
}

export async function becomeOwner(db: Db) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', '', true)");
}
