import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/test-db";
import { getPostsPerPage, getSettings, updateSettings, validateSettings } from "./service";

describe("settings", () => {
  it("returns defaults on a fresh database", async () => {
    const { db, close } = createTestDb();
    try {
      const settings = await getSettings(db);
      expect(settings.siteTitle).toBe("Wordless");
      expect(settings.postsPerPage).toBe(10);
      expect(settings.permalinkStructure).toBe("postname");
      expect(settings.timezone).toBe("UTC");
      expect(settings.defaultCommentStatus).toBe("open");
      expect(settings.commentMaxLinks).toBe(2);
    } finally {
      close();
    }
  });

  it("round-trips a valid patch", async () => {
    const { db, close } = createTestDb();
    try {
      const updated = await updateSettings(db, {
        siteTitle: "My Blog",
        siteTagline: "Thoughts",
        postsPerPage: 5,
        permalinkStructure: "day-name",
        timezone: "Africa/Lagos",
        defaultCommentStatus: "closed",
        commentMaxLinks: 0,
      });
      expect(updated.siteTitle).toBe("My Blog");
      expect(updated.postsPerPage).toBe(5);
      expect(updated.permalinkStructure).toBe("day-name");
      expect(updated.timezone).toBe("Africa/Lagos");
      expect(updated.defaultCommentStatus).toBe("closed");
      expect(updated.commentMaxLinks).toBe(0);
      // A second read returns the same values (they persisted).
      expect(await getSettings(db)).toEqual(updated);
    } finally {
      close();
    }
  });

  it("rejects invalid values", () => {
    expect(() => validateSettings({ siteTitle: "   " })).toThrow(/non-empty/);
    expect(() => validateSettings({ postsPerPage: 0 })).toThrow(/between 1 and 100/);
    expect(() => validateSettings({ postsPerPage: 101 })).toThrow(/between 1 and 100/);
    expect(() => validateSettings({ postsPerPage: 2.5 })).toThrow(/integer/);
    expect(() => validateSettings({ permalinkStructure: "pretty" })).toThrow(/plain, postname/);
    expect(() => validateSettings({ timezone: "Mars/Olympus" })).toThrow(/valid IANA/);
    expect(() => validateSettings({ timezone: "" })).toThrow(/non-empty/);
    expect(() => validateSettings({ defaultCommentStatus: "maybe" })).toThrow(/open.*closed/);
    expect(() => validateSettings({ commentMaxLinks: 11 })).toThrow(/between 0 and 10/);
    expect(() => validateSettings({ commentMaxLinks: -1 })).toThrow(/between 0 and 10/);
  });

  it("accepts boundary values", () => {
    expect(validateSettings({ postsPerPage: 1 }).postsPerPage).toBe(1);
    expect(validateSettings({ postsPerPage: 100 }).postsPerPage).toBe(100);
    expect(validateSettings({ commentMaxLinks: 10 }).commentMaxLinks).toBe(10);
    expect(validateSettings({ timezone: "UTC" }).timezone).toBe("UTC");
  });

  it("getPostsPerPage clamps stored values", async () => {
    const { db, close } = createTestDb();
    try {
      expect(await getPostsPerPage(db)).toBe(10);
      await updateSettings(db, { postsPerPage: 3 });
      expect(await getPostsPerPage(db)).toBe(3);
    } finally {
      close();
    }
  });
});
