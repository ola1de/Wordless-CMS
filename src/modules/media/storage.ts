/**
 * Object storage behind an interface.
 *
 * Milestone 3: R2 is wired. R2MediaStorage uses the MEDIA binding from
 * wrangler.toml (R2 in production, miniflare's R2 emulation in local dev).
 * StubMediaStorage remains for code paths that must fail loudly instead
 * of pretending an upload worked. Tests use InMemoryMediaStorage
 * (src/test/fake-storage.ts) — never a live bucket.
 *
 * Documented gap (M3): image derivatives / WebP conversion are NOT built.
 * They need the Cloudflare Images binding or a WASM pipeline (Phase 7).
 * Originals are stored as uploaded; no resizing happens here.
 */
import type { R2Bucket } from "@cloudflare/workers-types";
import { stubError } from "../../kernel/errors";

export interface StorageObjectInfo {
  key: string;
  size: number;
  /** Upload time (R2 `uploaded`); null when the backend does not report one. */
  uploaded: Date | null;
}

export interface MediaStorage {
  put(key: string, data: Uint8Array, contentType: string): Promise<{ key: string; size: number }>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  /** Keys starting with `prefix` (used by themes: `themes/<slug>/`). */
  list(prefix: string): Promise<string[]>;
  /** Objects starting with `prefix`, with size + upload time (M11 file manager). */
  listObjects(prefix: string): Promise<StorageObjectInfo[]>;
}

export class StubMediaStorage implements MediaStorage {
  async put(): Promise<{ key: string; size: number }> {
    throw stubError("R2 media object upload (StubMediaStorage.put)");
  }

  async get(): Promise<{ data: Uint8Array; contentType: string } | null> {
    throw stubError("R2 media object download (StubMediaStorage.get)");
  }

  async delete(): Promise<boolean> {
    throw stubError("R2 media object delete (StubMediaStorage.delete)");
  }

  async exists(): Promise<boolean> {
    throw stubError("R2 media object check (StubMediaStorage.exists)");
  }

  async list(): Promise<string[]> {
    throw stubError("R2 media object list (StubMediaStorage.list)");
  }

  async listObjects(): Promise<StorageObjectInfo[]> {
    throw stubError("R2 media object list (StubMediaStorage.listObjects)");
  }
}

/** Live R2 implementation (M3). Keyed by the caller-supplied object key. */
export class R2MediaStorage implements MediaStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, data: Uint8Array, contentType: string): Promise<{ key: string; size: number }> {
    await this.bucket.put(key, data, { httpMetadata: { contentType } });
    return { key, size: data.byteLength };
  }

  async get(key: string): Promise<{ data: Uint8Array; contentType: string } | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    const buf = await obj.arrayBuffer();
    return {
      data: new Uint8Array(buf),
      contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
    };
  }

  async delete(key: string): Promise<boolean> {
    const existing = await this.bucket.head(key);
    if (!existing) return false;
    await this.bucket.delete(key);
    return true;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.bucket.head(key)) !== null;
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, cursor });
      for (const obj of page.objects) keys.push(obj.key);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor !== undefined);
    return keys;
  }

  async listObjects(prefix: string): Promise<StorageObjectInfo[]> {
    const out: StorageObjectInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, cursor });
      for (const obj of page.objects) {
        out.push({ key: obj.key, size: obj.size, uploaded: obj.uploaded ?? null });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor !== undefined);
    return out;
  }
}
