import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/test-db";
import { InMemoryMediaStorage } from "../../test/fake-storage";
import {
  ALLOWED_MIME_TYPES,
  deleteMedia,
  findMediaByKey,
  getMediaRecord,
  listMedia,
  updateMediaAlt,
  uploadMedia,
  validateUpload,
} from "./service";
import { createUser } from "../users/service";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("media upload validation", () => {
  it("accepts the allowlisted MIME types", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(() => validateUpload(mime, 100)).not.toThrow();
    }
  });

  it("rejects other MIME types", () => {
    expect(() => validateUpload("text/plain", 100)).toThrow(/not allowed/);
    expect(() => validateUpload("application/x-php", 100)).toThrow(/not allowed/);
  });

  it("rejects oversized and empty files", () => {
    expect(() => validateUpload("image/png", 50 * 1024 * 1024 + 1)).toThrow(/too large/);
    expect(() => validateUpload("image/png", 0)).toThrow(/empty/);
  });
});

describe("media service with fake R2", () => {
  it("uploads, reads back, lists, updates alt and deletes", async () => {
    const { db, close } = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      const author = await createUser(db, { login: "ed", email: "ed@example.com", password: "password-123" });

      const record = await uploadMedia(db, storage, {
        filename: "My Photo.PNG",
        mimeType: "image/png",
        data: PNG,
        authorId: author.id,
        alt: "A test photo",
      });
      expect(record.id).toBeGreaterThan(0);
      expect(record.url).toMatch(/^\/media\/[0-9a-f]{8}-My-Photo\.PNG$/);
      expect(record.size).toBe(PNG.byteLength);
      expect(record.alt).toBe("A test photo");
      expect(record.filename).toBe("My-Photo.PNG");
      expect(await storage.exists(record.objectKey)).toBe(true);

      const readBack = await getMediaRecord(db, record.id);
      expect(readBack?.objectKey).toBe(record.objectKey);
      expect(readBack?.alt).toBe("A test photo");

      const byKey = await findMediaByKey(db, record.objectKey);
      expect(byKey?.id).toBe(record.id);

      const listed = await listMedia(db, {});
      expect(listed.total).toBe(1);
      expect(listed.media[0]?.id).toBe(record.id);

      const updated = await updateMediaAlt(db, record.id, "  New alt text  ");
      expect(updated.alt).toBe("New alt text");

      const deleted = await deleteMedia(db, storage, record.id);
      expect(deleted).toBe(true);
      expect(await storage.exists(record.objectKey)).toBe(false);
      expect(await getMediaRecord(db, record.id)).toBeNull();
      expect((await listMedia(db, {})).total).toBe(0);
    } finally {
      close();
    }
  });

  it("rejects a disallowed upload without storing anything", async () => {
    const { db, close } = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      const author = await createUser(db, { login: "ed", email: "ed@example.com", password: "password-123" });
      await expect(
        uploadMedia(db, storage, {
          filename: "evil.php",
          mimeType: "application/x-php",
          data: new Uint8Array([60, 63, 112, 104, 112]),
          authorId: author.id,
        }),
      ).rejects.toThrow(/not allowed/);
      expect(storage.size).toBe(0);
      expect((await listMedia(db, {})).total).toBe(0);
    } finally {
      close();
    }
  });

  it("filters the list by MIME type", async () => {
    const { db, close } = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      const author = await createUser(db, { login: "ed", email: "ed@example.com", password: "password-123" });
      await uploadMedia(db, storage, { filename: "a.png", mimeType: "image/png", data: PNG, authorId: author.id });
      await uploadMedia(db, storage, {
        filename: "b.pdf",
        mimeType: "application/pdf",
        // Real PDF magic bytes (M9 magic-byte sniffing rejects PNG bytes labelled PDF).
        data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
        authorId: author.id,
      });
      expect((await listMedia(db, {})).total).toBe(2);
      expect((await listMedia(db, { mimeType: "image/png" })).total).toBe(1);
      expect((await listMedia(db, { mimeType: "application/pdf" })).media[0]?.filename).toBe("b.pdf");
    } finally {
      close();
    }
  });
});
