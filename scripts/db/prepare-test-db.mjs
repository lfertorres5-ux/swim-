#!/usr/bin/env node
/**
 * Build a throwaway database for the RLS suite:
 *   1. (re)create the database named in TEST_DATABASE_URL
 *   2. apply scripts/db/supabase-shim.sql if the `auth` schema is missing
 *      (i.e. vanilla Postgres — CI service container or a local cluster)
 *   3. apply supabase/migrations/*.sql in filename order
 *   4. apply supabase/seed.sql (proves the seed stays valid)
 *
 * Against a real Supabase stack (`supabase start`) you don't need this — run
 * `supabase db reset` and point TEST_DATABASE_URL at port 54322 instead.
 *
 * Usage: TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/swim_test node scripts/db/prepare-test-db.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("TEST_DATABASE_URL is required");
  process.exit(1);
}

const target = new URL(url);
const dbName = target.pathname.replace(/^\//, "");
if (!/^[a-z0-9_]+$/i.test(dbName)) throw new Error(`unsafe database name: ${dbName}`);
if (dbName === "postgres" && !process.argv.includes("--in-place")) {
  console.error(
    "Refusing to drop the `postgres` database. For a Supabase stack use `supabase db reset`, " +
      "or pass --in-place to apply migrations without recreating.",
  );
  process.exit(1);
}

async function run() {
  if (!process.argv.includes("--in-place")) {
    const adminUrl = new URL(url);
    adminUrl.pathname = "/postgres";
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    await admin.query(`drop database if exists "${dbName}" with (force)`);
    await admin.query(`create database "${dbName}"`);
    await admin.end();
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const { rows } = await client.query(
    "select exists (select 1 from pg_namespace where nspname = 'auth') as has_auth",
  );
  if (!rows[0].has_auth) {
    console.log("· applying Supabase shim (vanilla Postgres detected)");
    await client.query(readFileSync(join(root, "scripts/db/supabase-shim.sql"), "utf8"));
  }

  const migrationsDir = join(root, "supabase/migrations");
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    process.stdout.write(`· migration ${file} … `);
    try {
      await client.query(readFileSync(join(migrationsDir, file), "utf8"));
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      throw err;
    }
  }

  if (!process.argv.includes("--no-seed")) {
    process.stdout.write("· seed.sql … ");
    await client.query(readFileSync(join(root, "supabase/seed.sql"), "utf8"));
    console.log("ok");
  }

  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
