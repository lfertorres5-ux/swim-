import { describe, expect, it } from "vitest";
import { toE164 } from "./phone";

describe("toE164", () => {
  it.each([
    ["(619) 555-0123", "+16195550123"],
    ["619.555.0123", "+16195550123"],
    ["1-760-555-0199", "+17605550199"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("normalizes %s", (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each(["", "12345", "055-555-0123", "+0123456789", "call me"])("rejects %s", (input) => {
    expect(toE164(input)).toBeNull();
  });
});
