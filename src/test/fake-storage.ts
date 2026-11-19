/**
 * Test-only in-memory MediaStorage. Implements the same interface as
 * R2MediaStorage so media tests run with zero infrastructure.
 * NEVER a live bucket in tests.
 */
import type { MediaStorage } from "../modules/media/storage";

export class InMemoryMediaStorage implements MediaStorage {
  private readonly objects = new Map<string, { data: Uint8Array; contentType: string }>();

  async put(key: string, data: Uint8Array, contentType: string): Promise<{ key: string; size: number }> {
    this.objects.set(key, { data: new Uint8Array(data), contentType });
    return { key, size: data.byteLength };
  }

  async get(key: string): Promise<{ data: Uint8Array; contentType: string } | null> {
    const obj = this.objects.get(key);
    return obj ? { data: new Uint8Array(obj.data), contentType: obj.contentType } : null;
  }

  async delete(key: string): Promise<boolean> {
    return this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  /** Test helper: how many objects are stored. */
  get size(): number {
    return this.objects.size;
  }
}

/**
 * Test-only in-memory R2Bucket. Implements the R2 surface the M9 code
 * uses (get/put/delete/list/head) with real bytes, so backup, importer
 * and derivative tests run with zero infrastructure. NEVER a live
 * bucket in tests.
 */
import type { R2Bucket } from "@cloudflare/workers-types";

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Response) throw new Error("FakeR2Bucket.put does not accept a Response — pass bytes.");
  throw new Error(`FakeR2Bucket.put: unsupported value type ${typeof value}.`);
}

function fakeEtag(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return `"${(h >>> 0).toString(16)}-${bytes.length}"`;
}

export class FakeR2Bucket {
  private readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(key: string, value: unknown, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    const bytes = toBytes(value);
    this.objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType ?? "application/octet-stream" });
  }

  async get(key: string): Promise<{
    key: string;
    size: number;
    etag: string;
    body: ReadableStream<Uint8Array>;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
  } | null> {
    const obj = this.objects.get(key);
    if (obj === undefined) return null;
    const bytes = obj.bytes;
    return {
      key,
      size: bytes.length,
      etag: fakeEtag(bytes),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      async arrayBuffer(): Promise<ArrayBuffer> {
        const copy = new Uint8Array(bytes);
        return copy.buffer as ArrayBuffer;
      },
      async text(): Promise<string> {
        return new TextDecoder().decode(bytes);
      },
    };
  }

  async head(key: string): Promise<{ key: string; size: number; etag: string } | null> {
    const obj = this.objects.get(key);
    if (obj === undefined) return null;
    return { key, size: obj.bytes.length, etag: fakeEtag(obj.bytes) };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(options?: { limit?: number }): Promise<{
    objects: Array<{ key: string; size: number; etag: string }>;
    truncated: boolean;
  }> {
    const limit = options?.limit ?? 1000;
    const all = [...this.objects.entries()]
      .map(([key, obj]) => ({ key, size: obj.bytes.length, etag: fakeEtag(obj.bytes) }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return { objects: all.slice(0, limit), truncated: all.length > limit };
  }

  /** Test helper: the stored bytes for a key (or null). */
  stored(key: string): Uint8Array | null {
    const obj = this.objects.get(key);
    return obj === undefined ? null : new Uint8Array(obj.bytes);
  }

  /** Test helper: all stored keys. */
  get keys(): string[] {
    return [...this.objects.keys()].sort();
  }

  get size(): number {
    return this.objects.size;
  }
}

export function fakeR2Bucket(): R2Bucket {
  return new FakeR2Bucket() as unknown as R2Bucket;
}
