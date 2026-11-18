/**
 * Object storage behind an interface.
 *
 * STUB (M1): R2 is NOT wired yet. The interface exists so services depend on
 * an abstraction, not on a bucket; the live R2 implementation
 * (R2MediaStorage, using the MEDIA binding from wrangler.toml) is a
 * Milestone 2 task and must be verified against a real bucket before any
 * upload route is exposed. There is deliberately NO upload endpoint in M1
 * and NO fake upload — a call here fails loudly instead of pretending.
 *
 * TODO (M2): implement R2MediaStorage { put/get/delete } against R2Bucket,
 * add presigned-upload flow + image derivatives, then wire POST /api/media.
 */
import { stubError } from "../../kernel/errors";

export interface MediaStorage {
  put(key: string, data: Uint8Array, contentType: string): Promise<{ key: string; size: number }>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
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
}
