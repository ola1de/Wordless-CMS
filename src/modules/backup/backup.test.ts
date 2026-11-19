/**
 * Milestone 9 backup tests — create → verify → restore round-trip on a
 * test DB with real rows, checksum tamper detection, confirmation and
 * failed-verification refusals.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { createTestDb, type TestDb } from "../../test/test-db";
import { FakeR2Bucket, fakeR2Bucket } from "../../test/fake-storage";
import { execRun, queryOne } from "../../db";
import type { Env } from "../../env";
import { createUser } from "../users/service";
import { createPost } from "../posts/service";
import { setOption } from "../options/service";
import {
  createBackup,
  getBackupDownload,
  listBackups,
  restoreBackup,
  runBackupJob,
  verifyBackup,
} from "./service";

let tdb: TestDb;
let r2: FakeR2Bucket;
let env: Env;

beforeEach(() => {
  tdb = createTestDb();
  r2 = new FakeR2Bucket();
  env = { MEDIA: fakeR2Bucket() } as unknown as Env;
  // Point the env's MEDIA at our inspectable fake.
  (env as unknown as { MEDIA: FakeR2Bucket }).MEDIA = r2;
});

afterEach(() => {
  tdb.close();
});

async function seedContent(): Promise<{ postId: number; userId: number }> {
  const user = await createUser(tdb.db, {
    login: "backup-user",
    email: "bu@example.test",
    password: "password-123",
    role: "editor",
  });
  const post = await createPost(tdb.db, {
    title: "Backup fixture post",
    content: "<p>Content worth backing up.</p>",
    status: "publish",
    authorId: user.id,
  });
  await setOption(tdb.db, "blogname", "Backup Fixture Site");
  await execRun(
    tdb.db,
    "INSERT INTO wl_products (slug, name, price_minor, currency, status, stock, created_at, updated_at) VALUES ('fixture-widget', 'Fixture Widget', 2500, 'NGN', 'published', 5, ?, ?)",
    [new Date().toISOString(), new Date().toISOString()],
  );
  await execRun(
    tdb.db,
    "INSERT INTO wl_orders (id, status, currency, total_minor, customer_email, created_at, updated_at) VALUES ('order-fixture', 'pending', 'NGN', 2500, 'buyer@example.test', ?, ?)",
    [new Date().toISOString(), new Date().toISOString()],
  );
  return { postId: post.id, userId: user.id };
}

describe("backup create → verify → restore", () => {
  it("round-trips real rows and marks the backup verified only after a re-read", async () => {
    const { postId } = await seedContent();
    const summary = await createBackup(tdb.db, env, 1, "0.9.0");
    expect(summary.verified).toBe(false);
    expect(summary.tables.wp_posts).toBeGreaterThan(0);
    expect(summary.tables.wp_users).toBeGreaterThan(0);
    expect(summary.tables.wl_products).toBe(1);
    expect(summary.tables.wl_orders).toBe(1);
    expect(summary.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(r2.keys).toContain(summary.filename);

    const listed = await listBackups(tdb.db);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.verified).toBe(false);

    const verification = await verifyBackup(tdb.db, env, summary.id);
    expect(verification.ok).toBe(true);
    expect(verification.files.every((f) => f.ok)).toBe(true);
    expect(verification.files.some((f) => f.file === "wp_posts.json")).toBe(true);
    // manifest.json holds the checksums, so it is not itself checksummed;
    // the media manifest is.
    expect(verification.files.some((f) => f.file === "media-manifest.json")).toBe(true);
    expect((await listBackups(tdb.db))[0]?.verified).toBe(true);

    // Download returns the same ZIP bytes.
    const download = await getBackupDownload(tdb.db, env, summary.id);
    expect(download.bytes.length).toBe(summary.size);
    expect(download.filename).toBe(`${summary.id}.zip`);

    // Delete the content, then restore it.
    await execRun(tdb.db, "DELETE FROM wp_posts WHERE ID = ?", [postId]);
    await execRun(tdb.db, "DELETE FROM wl_products WHERE slug = 'fixture-widget'");
    expect(await queryOne<{ n: number }>(tdb.db, "SELECT COUNT(*) AS n FROM wp_posts")).toMatchObject({ n: 0 });
    const report = await restoreBackup(tdb.db, env, summary.id, "RESTORE", "0.9.0", 1);
    expect(report.restoredTables).toContain("wp_posts");
    expect(report.restoredTables).toContain("wl_products");
    expect(report.rowsRestored).toBeGreaterThan(0);
    expect(report.missingMedia).toEqual([]);
    const restored = await queryOne<{ post_title: string }>(tdb.db, "SELECT post_title FROM wp_posts WHERE ID = ?", [postId]);
    expect(restored?.post_title).toBe("Backup fixture post");
    const product = await queryOne<{ name: string }>(tdb.db, "SELECT name FROM wl_products WHERE slug = 'fixture-widget'");
    expect(product?.name).toBe("Fixture Widget");
  });

  it("detects a checksum tamper and refuses to restore the tampered backup", async () => {
    await seedContent();
    const summary = await createBackup(tdb.db, env, 1, "0.9.0");
    // Tamper with one file inside the ZIP (re-zip with modified content).
    const stored = r2.stored(summary.filename);
    expect(stored).not.toBeNull();
    const files = unzipSync(stored as Uint8Array);
    files["wp_posts.json"] = new TextEncoder().encode('[{"ID":999,"post_title":"tampered"}]');
    const tampered = zipSync(files, { level: 6 });
    await r2.put(summary.filename, tampered, { httpMetadata: { contentType: "application/zip" } });

    const verification = await verifyBackup(tdb.db, env, summary.id);
    expect(verification.ok).toBe(false);
    expect(verification.files.find((f) => f.file === "wp_posts.json")?.ok).toBe(false);
    expect(verification.files.find((f) => f.file === "media-manifest.json")?.ok).toBe(true);
    expect((await listBackups(tdb.db))[0]?.verified).toBe(false);

    await expect(restoreBackup(tdb.db, env, summary.id, "RESTORE", "0.9.0", 1)).rejects.toThrow(
      /failed checksum verification/,
    );
  });

  it("rejects restore without the typed confirmation", async () => {
    await seedContent();
    const summary = await createBackup(tdb.db, env, 1, "0.9.0");
    await verifyBackup(tdb.db, env, summary.id);
    await expect(restoreBackup(tdb.db, env, summary.id, "", "0.9.0", 1)).rejects.toThrow(/RESTORE/);
    await expect(restoreBackup(tdb.db, env, summary.id, "restore", "0.9.0", 1)).rejects.toThrow(/RESTORE/);
  });

  it("refuses a backup from a different minor version", async () => {
    await seedContent();
    const summary = await createBackup(tdb.db, env, 1, "0.9.0");
    await verifyBackup(tdb.db, env, summary.id);
    await expect(restoreBackup(tdb.db, env, summary.id, "RESTORE", "0.8.0", 1)).rejects.toThrow(/minor versions must match/);
  });

  it("reports missing media keys instead of silently skipping them", async () => {
    await seedContent();
    // A media object referenced by the manifest but deleted before restore.
    await r2.put("media/ghost.png", new TextEncoder().encode("not-a-png"), { httpMetadata: { contentType: "image/png" } });
    const summary = await createBackup(tdb.db, env, 1, "0.9.0");
    await r2.delete("media/ghost.png");
    await verifyBackup(tdb.db, env, summary.id);
    const report = await restoreBackup(tdb.db, env, summary.id, "RESTORE", "0.9.0", 1);
    expect(report.missingMedia).toContain("media/ghost.png");
    expect(report.mediaChecked).toBeGreaterThan(0);
  });

  it("prunes older backups beyond the retention limit", async () => {
    await seedContent();
    await setOption(tdb.db, "wl_backup_retention", 2);
    const first = await createBackup(tdb.db, env, 1, "0.9.0");
    const second = await createBackup(tdb.db, env, 1, "0.9.0");
    await createBackup(tdb.db, env, 1, "0.9.0");
    const listed = await listBackups(tdb.db);
    expect(listed).toHaveLength(2);
    expect(listed.map((b) => b.id)).not.toContain(first.id);
    expect(listed.map((b) => b.id)).toContain(second.id);
    expect(r2.keys).not.toContain(first.filename);
  });

  it("runs as a wl_jobs job", async () => {
    await seedContent();
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    await execRun(
      tdb.db,
      "INSERT INTO wl_jobs (id, kind, status, payload, result, attempts, created_at, updated_at) VALUES (?, 'backup_create', 'queued', ?, NULL, 0, ?, ?)",
      [jobId, JSON.stringify({ createdBy: 1 }), now, now],
    );
    await runBackupJob(tdb.db, env, jobId, "0.9.0");
    const job = await queryOne<{ status: string; result: string }>(tdb.db, "SELECT status, result FROM wl_jobs WHERE id = ?", [jobId]);
    expect(job?.status).toBe("done");
    const result = JSON.parse(job?.result ?? "{}") as { id: string; tables: Record<string, number> };
    expect(result.tables.wp_posts).toBeGreaterThan(0);
    expect((await listBackups(tdb.db)).map((b) => b.id)).toContain(result.id);
  });

  it("stores a manifest with per-file checksums and a media manifest", async () => {
    await seedContent();
    await r2.put("media/a.png", new TextEncoder().encode("png-bytes"), { httpMetadata: { contentType: "image/png" } });
    const summary = await createBackup(tdb.db, env, 1, "0.9.0");
    const files = unzipSync(r2.stored(summary.filename) as Uint8Array);
    const manifest = JSON.parse(strFromU8(files["manifest.json"] as Uint8Array)) as {
      format: string;
      wordlessVersion: string;
      checksums: Record<string, string>;
      media: { count: number };
    };
    expect(manifest.format).toBe("wordless-backup/1");
    expect(manifest.wordlessVersion).toBe("0.9.0");
    expect(Object.keys(manifest.checksums)).toContain("wp_posts.json");
    expect(manifest.media.count).toBeGreaterThan(0);
    const mediaManifest = JSON.parse(strFromU8(files["media-manifest.json"] as Uint8Array)) as {
      keys: Array<{ key: string; size: number; etag: string }>;
    };
    expect(mediaManifest.keys.some((k) => k.key === "media/a.png")).toBe(true);
    // The backup ZIP itself is stored after the manifest is built, so it
    // is (correctly) not listed in its own media manifest.
    expect(mediaManifest.keys.some((k) => k.key === summary.filename)).toBe(false);
  });
});
