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

  /** Test helper: how many objects are stored. */
  get size(): number {
    return this.objects.size;
  }
}
