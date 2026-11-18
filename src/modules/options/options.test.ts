import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { addOption, deleteOption, getOption, setOption } from "./service";

let tdb: TestDb;

beforeEach(() => {
  tdb = createTestDb();
});

afterEach(() => {
  tdb.close();
});

describe("options round-trip (node:sqlite)", () => {
  it("stores and retrieves JSON values of every shape", async () => {
    await setOption(tdb.db, "site_title", "My Site");
    await setOption(tdb.db, "posts_per_page", 10);
    await setOption(tdb.db, "show_on_front", { page: "posts", id: 3 });
    await setOption(tdb.db, "feature_flags", ["a", "b"]);
    await setOption(tdb.db, "is_private", true);

    expect(await getOption(tdb.db, "site_title", "")).toBe("My Site");
    expect(await getOption(tdb.db, "posts_per_page", 0)).toBe(10);
    expect(await getOption(tdb.db, "show_on_front", null)).toEqual({ page: "posts", id: 3 });
    expect(await getOption(tdb.db, "feature_flags", [])).toEqual(["a", "b"]);
    expect(await getOption(tdb.db, "is_private", false)).toBe(true);
  });

  it("returns the default for a missing option", async () => {
    expect(await getOption(tdb.db, "nope", "fallback")).toBe("fallback");
    expect(await getOption(tdb.db, "nope", null)).toBeNull();
  });

  it("overwrites on set, refuses to overwrite on add", async () => {
    await setOption(tdb.db, "k", 1);
    await setOption(tdb.db, "k", 2);
    expect(await getOption(tdb.db, "k", 0)).toBe(2);

    expect(await addOption(tdb.db, "k", 99)).toBe(false);
    expect(await getOption(tdb.db, "k", 0)).toBe(2);
    expect(await addOption(tdb.db, "fresh", "yes")).toBe(true);
    expect(await getOption(tdb.db, "fresh", "")).toBe("yes");
  });

  it("deletes and reports whether a row existed", async () => {
    await setOption(tdb.db, "gone", 1);
    expect(await deleteOption(tdb.db, "gone")).toBe(true);
    expect(await deleteOption(tdb.db, "gone")).toBe(false);
    expect(await getOption(tdb.db, "gone", "dflt")).toBe("dflt");
  });
});
