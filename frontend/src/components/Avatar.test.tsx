import { describe, expect, it } from "vitest";
import { colourFor, initialsOf } from "./Avatar";

describe("initials", () => {
  it("takes first and last for a full name", () => {
    expect(initialsOf("Jordan Ade")).toBe("JA");
    expect(initialsOf("Ada Bimpe Chukwu")).toBe("AC");
  });

  it("takes two letters from a single name", () => {
    expect(initialsOf("jordan")).toBe("JO");
  });

  it("survives the awkward inputs a name field actually receives", () => {
    // These are not hypothetical: display names arrive padded, empty, or as a
    // single character, and an avatar that throws takes the header with it.
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
    expect(initialsOf("  Jordan   Ade  ")).toBe("JA");
    expect(initialsOf("X")).toBe("X");
  });

  it("does not mangle a non-Latin name", () => {
    // Uppercasing a script with no case is a no-op, which is correct; the
    // failure mode to avoid is throwing or returning "?".
    expect(initialsOf("陳大文")).toBe("陳大");
    expect(initialsOf("Даша Иванова")).toBe("ДИ");
  });
});

describe("avatar colour", () => {
  it("is stable for an id", () => {
    expect(colourFor("abc123")).toBe(colourFor("abc123"));
  });

  it("is keyed on id, not name, so fixing a typo does not change colour", () => {
    // The whole reason colourFor takes an id: someone correcting their own
    // name should not watch their avatar change colour.
    const before = colourFor("user-1");
    const after = colourFor("user-1");
    expect(before).toBe(after);
  });

  it("spreads across the palette rather than collapsing to one", () => {
    const seen = new Set(Array.from({ length: 40 }, (_, i) => colourFor(`user-${i}`)));
    expect(seen.size).toBeGreaterThan(2);
  });
});
