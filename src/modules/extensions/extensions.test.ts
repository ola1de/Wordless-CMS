import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/test-db";
import { bundledExtension } from "./registry";
import { getExtension, installExtension, listExtensions, setExtensionStatus } from "./service";

describe("extensions service (M4)", () => {
  it("installs, lists, reads and toggles an extension", async () => {
    const { db, close } = createTestDb();
    try {
      const rec = await installExtension(db, {
        slug: "hello-dolly",
        name: "Hello Dolly",
        version: "1.7.2",
        status: "active",
      });
      expect(rec.slug).toBe("hello-dolly");
      expect(rec.status).toBe("active");
      expect(rec.kind).toBe("plugin");

      expect(await listExtensions(db)).toHaveLength(1);
      expect((await getExtension(db, "hello-dolly")).name).toBe("Hello Dolly");

      const off = await setExtensionStatus(db, "hello-dolly", "inactive");
      expect(off.status).toBe("inactive");

      // Re-installing upserts instead of erroring.
      const again = await installExtension(db, {
        slug: "hello-dolly",
        name: "Hello Dolly",
        version: "1.7.3",
        status: "active",
      });
      expect(again.version).toBe("1.7.3");
      expect(await listExtensions(db)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("rejects a bad slug and a missing extension", async () => {
    const { db, close } = createTestDb();
    try {
      await expect(installExtension(db, { slug: "Bad Slug!", name: "x" })).rejects.toThrow(/slug/);
      await expect(getExtension(db, "nope")).rejects.toThrow(/not installed/);
      await expect(setExtensionStatus(db, "nope", "active")).rejects.toThrow(/not installed/);
    } finally {
      close();
    }
  });

  it("maps the bundled hello-dolly module", () => {
    const bundled = bundledExtension("hello-dolly");
    expect(bundled?.name).toBe("Hello Dolly");
    expect(bundled?.version).toBe("1.7.2");
    expect(typeof bundled?.activate).toBe("function");
    expect(bundledExtension("nope")).toBeUndefined();
  });
});
