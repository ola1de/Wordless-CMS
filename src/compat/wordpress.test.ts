import { describe, expect, it } from "vitest";
import { createTestDb } from "../test/test-db";
import { InMemoryMediaStorage } from "../test/fake-storage";
import { createWordPressApi, WORDPRESS_COMPAT } from "./wordpress";
import { createUser } from "../modules/users/service";

describe("media compat functions (M3)", () => {
  it("registers the three media functions as partial", () => {
    for (const name of ["get_media_items", "wp_get_attachment_url", "media_handle_upload"]) {
      const entry = WORDPRESS_COMPAT.find((e) => e.name === name);
      expect(entry).toBeDefined();
      expect(entry?.level).toBe("partial");
    }
  });

  it("media_handle_upload stores via context storage and the other two read it back", async () => {
    const { db, close } = createTestDb();
    try {
      const storage = new InMemoryMediaStorage();
      const author = await createUser(db, { login: "ed", email: "ed@example.com", password: "password-123" });
      const api = createWordPressApi({ db, currentUser: null, storage });

      const record = await api.media_handle_upload({
        filename: "pic.png",
        mimeType: "image/png",
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        authorId: author.id,
      });
      expect(record.url).toMatch(/^\/media\//);

      expect(await api.wp_get_attachment_url(record.id)).toBe(record.url);
      expect(await api.wp_get_attachment_url(999999)).toBe("");

      const listed = await api.get_media_items({ mimeType: "image/png" });
      expect(listed.total).toBe(1);
      expect(listed.media[0]?.id).toBe(record.id);
    } finally {
      close();
    }
  });

  it("media_handle_upload throws a stub error without storage in the context", async () => {
    const { db, close } = createTestDb();
    try {
      const author = await createUser(db, { login: "ed", email: "ed@example.com", password: "password-123" });
      const api = createWordPressApi({ db, currentUser: null });
      await expect(
        api.media_handle_upload({
          filename: "pic.png",
          mimeType: "image/png",
          data: new Uint8Array([1, 2, 3]),
          authorId: author.id,
        }),
      ).rejects.toThrow(/STUB/);
    } finally {
      close();
    }
  });
});
