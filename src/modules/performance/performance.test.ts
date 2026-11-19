/**
 * Milestone 9 performance tests — cache purge, image derivatives
 * (honest unbound behaviour + a fake Images binding), srcset, and the
 * performance health section.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { FakeR2Bucket, fakeR2Bucket } from "../../test/fake-storage";
import { execRun } from "../../db";
import type { Env } from "../../env";
import type { ImagesBinding } from "@cloudflare/workers-types";
import { createUser } from "../users/service";
import { createPost } from "../posts/service";
import { publicCacheControl, purgeUrls, urlsToPurgeForPost } from "./cache";
import { buildSrcset, derivativeStatus, getDerivativeOrOriginal, listDerivatives } from "./derivatives";
import { getPerformanceHealth } from "./service";

let tdb: TestDb;
let r2: FakeR2Bucket;

beforeEach(() => {
  tdb = createTestDb();
  r2 = new FakeR2Bucket();
});

afterEach(() => {
  tdb.close();
});

class FakeCache {
  private readonly entries = new Set<string>();

  async put(url: string): Promise<void> {
    this.entries.add(url);
  }

  async delete(request: string | Request): Promise<boolean> {
    const url = typeof request === "string" ? request : request.url;
    return this.entries.delete(url);
  }

  has(url: string): boolean {
    return this.entries.has(url);
  }
}

describe("public-page cache rules", () => {
  it("documents the 60 s + stale-while-revalidate policy", () => {
    expect(publicCacheControl()).toBe("public, max-age=60, stale-while-revalidate=60");
  });

  it("builds the purge list: post URL, home, and affected term pages", () => {
    const urls = urlsToPurgeForPost("https://example.test", "hello-world", ["news", "wordpress"]);
    expect(urls).toContain("https://example.test/hello-world");
    expect(urls).toContain("https://example.test/");
    expect(urls).toContain("https://example.test/category/news");
    expect(urls).toContain("https://example.test/tag/news");
    expect(urls).toContain("https://example.test/category/wordpress");
    expect(urls).toContain("https://example.test/tag/wordpress");
    expect(new Set(urls).size).toBe(urls.length); // no duplicates
  });

  it("purges exactly the listed URLs from a fake Cache", async () => {
    const cache = new FakeCache();
    await cache.put("https://example.test/hello-world");
    await cache.put("https://example.test/");
    await cache.put("https://example.test/other-post");
    const deleted = await purgeUrls(cache, ["https://example.test/hello-world", "https://example.test/"]);
    expect(deleted).toBe(2);
    expect(cache.has("https://example.test/hello-world")).toBe(false);
    expect(cache.has("https://example.test/")).toBe(false);
    expect(cache.has("https://example.test/other-post")).toBe(true);
    // Purging a URL that is not cached is not an error.
    expect(await purgeUrls(cache, ["https://example.test/nope"])).toBe(0);
  });
});

describe("image derivatives", () => {
  function envWithoutImages(): Env {
    return { MEDIA: fakeR2Bucket() } as unknown as Env;
  }

  it("serves the original honestly when the Images binding is absent", async () => {
    const env = envWithoutImages();
    (env as unknown as { MEDIA: FakeR2Bucket }).MEDIA = r2;
    const outcome = await getDerivativeOrOriginal(env, tdb.db, 1, "media/photo.jpg", 640, "webp");
    expect(outcome.kind).toBe("unavailable");
    expect(outcome.kind === "unavailable" ? outcome.reason : "").toMatch(/not configured/);
    // No width/format requested → original, no complaint.
    expect((await getDerivativeOrOriginal(env, tdb.db, 1, "media/photo.jpg", null, null)).kind).toBe("original");
  });

  it("rejects bad widths and formats instead of inventing a variant", async () => {
    const env = envWithoutImages();
    await expect(getDerivativeOrOriginal(env, tdb.db, 1, "media/photo.jpg", 10, "webp")).rejects.toThrow(/width/);
    await expect(getDerivativeOrOriginal(env, tdb.db, 1, "media/photo.jpg", 640, "gif" as "webp")).rejects.toThrow(/format/);
  });

  it("derives, stores and reuses a variant when Images is bound", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await r2.put("media/photo.png", pngBytes, { httpMetadata: { contentType: "image/png" } });
    const derivedBytes = new TextEncoder().encode("webp-variant-bytes");
    // Minimal fake of the Images binding shape (input → transform → output).
    const fakeImages = {
      input(_stream: ReadableStream<Uint8Array>) {
        return {
          transform(_t: { width: number; fit: string }) {
            return {
              async output(_o: { format: string }) {
                return {
                  response: () => new Response(derivedBytes as unknown as BodyInit),
                };
              },
            };
          },
        };
      },
    } as unknown as ImagesBinding;
    const env = { MEDIA: fakeR2Bucket(), IMAGES: fakeImages } as unknown as Env;
    (env as unknown as { MEDIA: FakeR2Bucket }).MEDIA = r2;

    const first = await getDerivativeOrOriginal(env, tdb.db, 42, "media/photo.png", 640, "webp");
    expect(first.kind).toBe("derivative");
    expect(first.kind === "derivative" ? first.objectKey : "").toBe("media/derivatives/42-640.webp");
    expect(r2.stored("media/derivatives/42-640.webp")).toEqual(derivedBytes);

    // Second call reuses the stored record (the fake binding is not called again).
    let calls = 0;
    const countingImages = {
      input(_stream: Parameters<ImagesBinding["input"]>[0]) {
        calls += 1;
        return fakeImages.input(_stream);
      },
    } as unknown as ImagesBinding;
    (env as unknown as { IMAGES: ImagesBinding }).IMAGES = countingImages;
    const second = await getDerivativeOrOriginal(env, tdb.db, 42, "media/photo.png", 640, "webp");
    expect(second.kind).toBe("derivative");
    expect(calls).toBe(0);

    const stored = await listDerivatives(tdb.db, 42);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.width).toBe(640);
    expect(buildSrcset("/media/photo.png", stored)).toBe("/media/photo.png?width=640&format=webp 640w");
    expect(buildSrcset("/media/photo.png", [])).toBe("");
  });

  it("reports derivative status honestly", async () => {
    expect(await derivativeStatus(tdb.db, false)).toEqual({ bound: false, stored: 0, widths: [320, 640, 1024, 1600] });
    await execRun(
      tdb.db,
      "INSERT INTO wl_media_derivatives (media_id, width, format, object_key, size, created_at) VALUES (1, 640, 'webp', 'media/derivatives/1-640.webp', 10, ?)",
      [new Date().toISOString()],
    );
    expect((await derivativeStatus(tdb.db, true)).stored).toBe(1);
  });
});

describe("performance health", () => {
  it("measures real numbers: row counts, R2 count, cache config, derivative status", async () => {
    const user = await createUser(tdb.db, { login: "perf1", email: "p@example.test", password: "password-123", role: "author" });
    await createPost(tdb.db, { title: "Perf post", content: "x".repeat(100), status: "publish", authorId: user.id });
    await r2.put("media/a.png", new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
    const env = { MEDIA: fakeR2Bucket() } as unknown as Env;
    (env as unknown as { MEDIA: FakeR2Bucket }).MEDIA = r2;
    const health = await getPerformanceHealth(tdb.db, env);
    expect(health.tables.wp_posts).toBe(1);
    expect(health.tables.wp_users).toBe(1);
    expect(health.mediaObjects.counted).toBe(1);
    expect(health.mediaObjects.capped).toBe(false);
    expect(health.cache.maxAgeSeconds).toBe(60);
    expect(health.cache.staleWhileRevalidateSeconds).toBe(60);
    expect(health.derivatives.bound).toBe(false);
    expect(health.compression.note).toMatch(/Cloudflare edge/);
  });
});
