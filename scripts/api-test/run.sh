#!/usr/bin/env bash
# API-level tests: real PostgREST + supabase-js against a fresh, seeded database.
# Requires: TEST_DATABASE_URL (superuser; database will be recreated), curl, tar.
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${TEST_DATABASE_URL:?set TEST_DATABASE_URL, e.g. postgres://postgres:postgres@127.0.0.1:5432/swim_api}"
PGRST_VERSION="${PGRST_VERSION:-v12.2.3}"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/swim-platform"
BIN="$CACHE/postgrest-$PGRST_VERSION"
SECRET="api-test-secret-api-test-secret-0123456789"
export PGRST_PORT=54331 PROXY_PORT=54330

if [ ! -x "$BIN" ]; then
  mkdir -p "$CACHE"
  curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$PGRST_VERSION/postgrest-$PGRST_VERSION-linux-static-x64.tar.xz" | tar -xJ -C "$CACHE"
  mv "$CACHE/postgrest" "$BIN"
fi

for port in $PGRST_PORT $PROXY_PORT; do
  if (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; then
    echo "Port $port is already in use — stop the other PostgREST/proxy first (tests would hit the wrong database)." >&2
    exit 1
  fi
done

node scripts/db/prepare-test-db.mjs
psql "$TEST_DATABASE_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator';
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
SQL

DB_URI="$(node -e 'const u=new URL(process.env.TEST_DATABASE_URL); u.username="authenticator"; u.password="authenticator"; console.log(u.toString())')"
PGRST_DB_URI="$DB_URI" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$SECRET" \
  PGRST_SERVER_PORT=$PGRST_PORT PGRST_SERVER_HOST=127.0.0.1 "$BIN" >/tmp/postgrest-api-test.log 2>&1 &
PGRST_PID=$!
node scripts/api-test/proxy.mjs >/tmp/proxy-api-test.log 2>&1 &
PROXY_PID=$!
trap 'kill $PGRST_PID $PROXY_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  curl -fs "http://127.0.0.1:$PROXY_PORT/rest/v1/zones?select=code" >/dev/null 2>&1 && break
  sleep 0.25
done

API_TEST_URL="http://127.0.0.1:$PROXY_PORT" API_TEST_JWT_SECRET="$SECRET" npx vitest run tests/api
