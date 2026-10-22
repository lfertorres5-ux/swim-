import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-path";

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/parent/lessons/abc?x=1#top")).toBe(
      "/parent/lessons/abc?x=1#top",
    );
    expect(safeNextPath("/book")).toBe("/book");
  });

  it.each([
    null,
    "",
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/%09/evil.com".replace("%09", "\t"),
    "/\n/evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "evil.com",
  ])("rejects %j", (next) => {
    expect(safeNextPath(next)).toBe("/dashboard");
  });

  it("does not decode an encoded tab into a redirect", () => {
    // Stays a path on our own site even though it looks odd.
    expect(safeNextPath("/%09/evil.com").startsWith("/")).toBe(true);
    expect(safeNextPath("/%09/evil.com").startsWith("//")).toBe(false);
  });
});
