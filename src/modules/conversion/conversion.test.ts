import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/test-db";
import { createConversionJob, getConversionJob, listConversionJobs, runConversionJob } from "./service";

const HELLO_PATH = fileURLToPath(
  new URL("../../../reference/wordpress-7.1.5/wp-content/plugins/hello.php", import.meta.url),
);
const HAS_HELLO = existsSync(HELLO_PATH);

describe("conversion jobs (M4)", () => {
  it.skipIf(!HAS_HELLO)("runs an upload from pending to done with a report", async () => {
    const { db, close } = createTestDb();
    try {
      const source = readFileSync(HELLO_PATH, "utf8");
      const created = await createConversionJob(db, { filename: "hello.php", source });
      expect(created.status).toBe("pending");
      expect(created.progress).toBe(0);
      expect(created.filename).toBe("hello.php");

      const done = await runConversionJob(db, created.id);
      expect(done.status).toBe("done");
      expect(done.progress).toBe(100);
      expect(done.report?.converted.functions).toEqual([
        "hello_dolly_get_lyric",
        "hello_dolly",
        "dolly_css",
      ]);
      expect(done.report?.unconverted).toEqual([]);
      expect(done.report?.extension.slug).toBe("hello-dolly");

      const fetched = await getConversionJob(db, created.id);
      expect(fetched.status).toBe("done");
      expect(fetched.report?.extension.name).toBe("Hello Dolly");

      const list = await listConversionJobs(db, {});
      expect(list.total).toBe(1);
      expect(list.jobs[0]?.id).toBe(created.id);
    } finally {
      close();
    }
  });

  it("fails a job on a blocked construct with a clear error, not a partial success", async () => {
    const { db, close } = createTestDb();
    try {
      const created = await createConversionJob(db, {
        filename: "bad.php",
        source: `<?php function f($x) { return eval($x); }`,
      });
      const failed = await runConversionJob(db, created.id);
      expect(failed.status).toBe("failed");
      expect(failed.error).toMatch(/eval/i);
      expect(failed.report).toBeUndefined();
      expect(failed.progress).toBe(0);
    } finally {
      close();
    }
  });

  it("rejects a non-php upload and an unknown fixture", async () => {
    const { db, close } = createTestDb();
    try {
      await expect(
        createConversionJob(db, { filename: "notes.txt", source: "hello" }),
      ).rejects.toThrow(/\.php/);
      await expect(
        createConversionJob(db, { filename: "hello.php", fixture: "not-a-fixture" }),
      ).rejects.toThrow(/Unknown conversion fixture/);
      await expect(
        createConversionJob(db, { filename: "hello.php" }),
      ).rejects.toThrow(/either a PHP file upload or a fixture name/);
    } finally {
      close();
    }
  });

  it.skipIf(!HAS_HELLO)("runs a fixture job through the resolver", async () => {
    const { db, close } = createTestDb();
    try {
      const created = await createConversionJob(db, { filename: "hello.php", fixture: "hello-dolly" });
      expect(created.status).toBe("pending");
      expect(created.fixture).toBe("hello-dolly");
      const done = await runConversionJob(db, created.id, {
        resolveFixture: async () => ({
          source: readFileSync(HELLO_PATH, "utf8"),
          filename: "hello.php",
        }),
      });
      expect(done.status).toBe("done");
      expect(done.report?.extension.slug).toBe("hello-dolly");
    } finally {
      close();
    }
  });

  it("fails a fixture job when no resolver is provided", async () => {
    const { db, close } = createTestDb();
    try {
      const created = await createConversionJob(db, { filename: "hello.php", fixture: "hello-dolly" });
      const failed = await runConversionJob(db, created.id);
      expect(failed.status).toBe("failed");
      expect(failed.error).toMatch(/No fixture resolver/);
    } finally {
      close();
    }
  });
});
