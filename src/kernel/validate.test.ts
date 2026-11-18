import { describe, expect, it } from "vitest";
import { intInRange, isValidSlug, requireSlug, requireString } from "./validate";
import { WordlessError } from "./errors";

describe("validate", () => {
  it("requireString trims and rejects empty input", () => {
    expect(requireString("  hello ", "title")).toBe("hello");
    expect(() => requireString("   ", "title")).toThrow(WordlessError);
    expect(() => requireString(42, "title")).toThrow(WordlessError);
  });

  it("validates slugs", () => {
    expect(isValidSlug("hello-world-2")).toBe(true);
    expect(isValidSlug("Hello")).toBe(false);
    expect(isValidSlug("hello_world")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(requireSlug("My-Post", "slug")).toBe("my-post");
    expect(() => requireSlug("bad slug!", "slug")).toThrow(WordlessError);
  });

  it("parses bounded query integers with a fallback", () => {
    expect(intInRange(null, "page", 1, 100, 1)).toBe(1);
    expect(intInRange("5", "page", 1, 100, 1)).toBe(5);
    expect(() => intInRange("0", "page", 1, 100, 1)).toThrow(WordlessError);
    expect(() => intInRange("abc", "page", 1, 100, 1)).toThrow(WordlessError);
  });
});
