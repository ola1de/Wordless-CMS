/**
 * File manager — tests (Milestone 11).
 *
 * Covers folder listing, upload/rename/delete, media-record handling,
 * managed-prefix refusals and traversal rejection. Routes are covered
 * by the M11 smoke script (capability guards are enforced in src/index.ts).
 */
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/test-db";
import { InMemoryMediaStorage } from "../../test/fake-storage";
import { uploadMedia } from "../media/service";
import {
  deleteFile,
  downloadFile,
  listFiles,
  renameFile,
  uploadFile,
  validateFileKey,
  validateFileName,
  validatePrefix,
} from "./service";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function seededStorage(): Promise<{ storage: InMemoryMediaStorage; db: ReturnType<typeof createTestDb>["db"]; close: () => void }> {
  const { db, close } = createTestDb();
  const storage = new InMemoryMediaStorage();
  await storage.put("extensions/my-plugin/plugin.php", new TextEncoder().encode("<?php // hi"), "application/octet-stream");
  await storage.put("extensions/my-plugin/readme.txt", new TextEncoder().encode("readme"), "text/plain");
  await storage.put("themes/my-theme/style.css", new TextEncoder().encode("/* theme */"), "text/css");
  await storage.put("backups/backup-1.zip", new Uint8Array([1, 2]), "application/zip");
  await uploadMedia(db, storage, { filename: "photo.png", mimeType: "image/png", data: PNG, authorId: 1 });
  return { storage, db, close };
}

describe("validatePrefix / validateFileKey / validateFileName", () => {
  it("accepts root and normal prefixes", () => {
    expect(validatePrefix("")).toBe("");
    expect(validatePrefix("uploads/2026")).toBe("uploads/2026");
    expect(validateFileKey("photo.png")).toBe("photo.png");
    expect(validateFileKey("extensions/my-plugin/readme.txt")).toBe("extensions/my-plugin/readme.txt");
    expect(validateFileName("photo-2.png")).toBe("photo-2.png");
  });

  it("rejects traversal, absolute paths and backslashes", () => {
    expect(() => validatePrefix("../secret")).toThrow(/Invalid folder/);
    expect(() => validatePrefix("a/../../b")).toThrow(/Invalid folder/);
    expect(() => validatePrefix("a\\b")).toThrow(/Invalid folder/);
    expect(validatePrefix("/absolute")).toBe("absolute"); // leading slash is trimmed
    expect(() => validateFileKey("../wp-config.php")).toThrow(/Invalid file/);
    expect(() => validateFileKey("/etc/passwd")).toThrow(/Invalid file/);
    expect(() => validateFileKey("a//b")).toThrow(/Invalid file/);
    expect(() => validateFileKey("folder/")).toThrow(/Invalid file/);
    expect(() => validateFileKey("a\\b.txt")).toThrow(/Invalid file/);
    expect(() => validateFileName("../evil.php")).toThrow(/Invalid file name/);
    expect(() => validateFileName("a/b.txt")).toThrow(/Invalid file name/);
    expect(() => validateFileName("")).toThrow(/Invalid file name/);
  });
});

describe("listFiles", () => {
  it("lists root folders and media files with sizes and media flags", async () => {
    const { storage, db, close } = await seededStorage();
    try {
      const root = await listFiles(db, storage, "");
      expect(root.prefix).toBe("");
      expect(root.folders).toEqual(["backups", "extensions", "themes"]);
      expect(root.files).toHaveLength(1);
      expect(root.files[0]?.name).toMatch(/photo\.png$/);
      expect(root.files[0]?.isMedia).toBe(true);
      expect(root.files[0]?.size).toBe(PNG.byteLength);
      expect(root.files[0]?.type).toBe("png");
      expect(root.truncated).toBe(false);
    } finally {
      close();
    }
  });

  it("navigates into a prefix", async () => {
    const { storage, db, close } = await seededStorage();
    try {
      const ext = await listFiles(db, storage, "extensions/my-plugin");
      expect(ext.folders).toEqual([]);
      expect(ext.files.map((f) => f.name).sort()).toEqual(["plugin.php", "readme.txt"]);
      expect(ext.files.every((f) => f.isMedia === false)).toBe(true);
    } finally {
      close();
    }
  });
});

describe("uploadFile", () => {
  it("stores a file in the chosen folder", async () => {
    const { storage, db, close } = await seededStorage();
    try {
      const entry = await uploadFile(storage, "uploads", { filename: "pic.png", mimeType: "image/png", data: PNG });
      expect(entry.key).toBe("uploads/pic.png");
      expect(await storage.exists("uploads/pic.png")).toBe(true);
    } finally {
      close();
    }
  });

  it("refuses uploads over 50 MB and disallowed types", async () => {
    const { storage, db, close } = await seededStorage();
    try {
      expect(() =>
        uploadFile(storage, "", { filename: "big.png", mimeType: "image/png", data: new Uint8Array(50 * 1024 * 1024 + 1) }),
      ).rejects.toThrow(/too large/);
      await expect(
        uploadFile(storage, "", { filename: "run.php", mimeType: "application/x-php", data: new Uint8Array([1]) }),
      ).rejects.toThrow(/not allowed/);
    } finally {
      close();
    }
  });

  it("refuses uploads under managed prefixes and duplicate names", async () => {
    const { storage, db, close } = await seededStorage();
    try {
      await expect(
        uploadFile(storage, "extensions/my-plugin", { filename: "x.png", mimeType: "image/png", data: PNG }),
      ).rejects.toThrow(/managed by their own page/);
      await uploadFile(storage, "", { filename: "dup.png", mimeType: "image/png", data: PNG });
      await expect(
        uploadFile(storage, "", { filename: "dup.png", mimeType: "image/png", data: PNG }),
      ).rejects.toThrow(/already exists/);
    } finally {
      close();
    }
  });
});

describe("renameFile / deleteFile / downloadFile", () => {
  it("renames a plain file and updates a media attachment record", async () => {
    const { storage, db, close } = await seededStorage();
    try {
      await expect(renameFile(db, storage, "uploads-x.png", "x.png")).rejects.toThrow(/not found/);
      const entry = await uploadFile(storage, "", { filename: "old.png", mimeType: "image/png", data: PNG });
      expect(entry.key).toBe("old.png");
      const done = await renameFile(db, storage, "old.png", "new.png");
      expect(done.key).toBe("new.png");
      expect(await storage.exists("old.png")).toBe(false);
      expect(await storage.exists("new.png")).toBe(true);
      // Media attachment rename follows the record.
      const root = await listFiles(db, storage, "");
      const mediaKey = root.files.find((f) => f.isMedia)?.key ?? "";
      const mediaRenamed = await renameFile(db, storage, mediaKey, "renamed-photo.png");
      expect(mediaRenamed.isMedia).toBe(true);
      const after = await listFiles(db, storage, "");
      const mediaAfter = after.files.find((f) => f.isMedia);
      expect(mediaAfter?.name).toBe("renamed-photo.png");
      expect(mediaAfter?.isMedia).toBe(true);
    } finally {
      close();
    }
  });

  it("refuses rename under managed prefixes and to an existing name", async () => {
    const { storage, db, close } = await seededStorage();
    try {
      await expect(renameFile(db, storage, "extensions/my-plugin/readme.txt", "other.txt")).rejects.toThrow(
        /managed by their own page/,
      );
      await uploadFile(storage, "", { filename: "a.png", mimeType: "image/png", data: PNG });
      await uploadFile(storage, "", { filename: "b.png", mimeType: "image/png", data: PNG });
      await expect(renameFile(db, storage, "a.png", "b.png")).rejects.toThrow(/already exists/);
    } finally {
      close();
    }
  });

  it("deletes a plain file and a media attachment (record included)", async () => {
    const { storage, db, close } = await seededStorage();
    try {
      await uploadFile(storage, "", { filename: "gone.png", mimeType: "image/png", data: PNG });
      expect(await deleteFile(db, storage, "gone.png")).toEqual({ deleted: true });
      expect(await storage.exists("gone.png")).toBe(false);
      await expect(deleteFile(db, storage, "gone.png")).rejects.toThrow(/not found/);
      const root = await listFiles(db, storage, "");
      const mediaKey = root.files[0]?.key ?? "";
      expect(await deleteFile(db, storage, mediaKey)).toEqual({ deleted: true });
      const after = await listFiles(db, storage, "");
      expect(after.files).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("refuses deletes under managed prefixes", async () => {
    const { storage, db, close } = await seededStorage();
    try {
      await expect(deleteFile(db, storage, "backups/backup-1.zip")).rejects.toThrow(/managed by their own page/);
      await expect(deleteFile(db, storage, "themes/my-theme/style.css")).rejects.toThrow(/managed by their own page/);
    } finally {
      close();
    }
  });

  it("downloads bytes and rejects traversal keys", async () => {
    const { storage, db, close } = await seededStorage();
    try {
      const got = await downloadFile(storage, "extensions/my-plugin/readme.txt");
      expect(new TextDecoder().decode(got.data)).toBe("readme");
      expect(got.name).toBe("readme.txt");
      await expect(downloadFile(storage, "missing.txt")).rejects.toThrow(/not found/);
      await expect(downloadFile(storage, "../secret.txt")).rejects.toThrow(/Invalid file/);
    } finally {
      close();
    }
  });
});
