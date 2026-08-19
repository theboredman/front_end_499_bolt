import { describe, expect, it } from "vitest";
import { PASSWORD_RULES, passwordMeetsRules } from "./AuthShell";

// The rules are shown live as the user types, so they have to be cheap,
// total, and honest about what they accept. A rule that is stricter than the
// server would block a valid password; one that is looser lets the user
// through to a rejection they were told would not happen.

describe("password rules", () => {
  it("rejects anything under 12 characters", () => {
    expect(passwordMeetsRules("Short1!")).toBe(false);
    expect(passwordMeetsRules("elevenchar1")).toBe(false);
  });

  it("accepts a long passphrase with a digit", () => {
    expect(passwordMeetsRules("correct horse battery 1")).toBe(true);
  });

  it("rejects letters alone, however long", () => {
    // Length alone is a weak rule; this is the cheapest addition that does not
    // push people into the symbol-soup passwords they then write down.
    expect(passwordMeetsRules("correcthorsebattery")).toBe(false);
  });

  it("counts a space as the non-letter, so passphrases pass", () => {
    // Deliberate: "correct horse battery staple" is a good password and a
    // rule that demanded punctuation would reject it.
    expect(passwordMeetsRules("correct horse battery")).toBe(true);
  });

  it("evaluates every rule independently, so the checklist can show partials", () => {
    const partial = "correcthorsebattery";
    const met = PASSWORD_RULES.filter((r) => r.test(partial));
    expect(met).toHaveLength(1);
    expect(met[0].id).toBe("length");
  });

  it("never throws on empty input — it runs on every keystroke from empty", () => {
    expect(() => passwordMeetsRules("")).not.toThrow();
    expect(passwordMeetsRules("")).toBe(false);
  });
});
