import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guards: cheap checks that fail the build if a future change
 * forgets a security rule that the type system can't enforce.
 */
const ROOT = join(process.cwd(), "src");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(ROOT);
const rel = (p: string) => p.slice(ROOT.length + 1);

describe("security guards", () => {
  it("every admin page checks the admin role itself (not only via the layout)", () => {
    const pages = files.filter((f) => /app[\\/]admin[\\/].*page\.tsx$/.test(f));
    expect(pages.length).toBeGreaterThan(10);
    const missing = pages.filter((f) => !/requireRole\(\s*"admin"/.test(readFileSync(f, "utf8"))).map(rel);
    expect(missing).toEqual([]);
  });

  it("every admin server action goes through runAdmin or requireRole", () => {
    const actions = files.filter((f) => /app[\\/]admin[\\/].*actions\.ts$/.test(f));
    for (const f of actions) {
      const src = readFileSync(f, "utf8");
      const exported = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
      for (const name of exported) {
        const body = src.slice(src.indexOf(`export async function ${name}(`)).split(/\nexport /)[0];
        expect(/runAdmin\(|requireRole\(\s*"admin"/.test(body), `${rel(f)} → ${name}`).toBe(true);
      }
    }
  });

  it("the full-access (service role) client is never imported by browser code", () => {
    const client = files.filter((f) => /\.(tsx|ts)$/.test(f) && /^\s*["']use client["']/m.test(readFileSync(f, "utf8")));
    const offenders = client.filter((f) => /supabase\/admin|SERVICE_ROLE/.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("no secret is exposed through a NEXT_PUBLIC_ variable", () => {
    const names = new Set(files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)].map((m) => m[0])));
    for (const n of names) expect(n, n).not.toMatch(/SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN|WEBHOOK/);
  });
});
