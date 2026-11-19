import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/test-db";
import { createSession, verifySession } from "../auth/service";
import { createPost } from "../posts/service";
import {
  checkUserPassword,
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  setUserRole,
} from "./service";

describe("users admin operations", () => {
  it("lists users with pagination", async () => {
    const { db, close } = createTestDb();
    try {
      await createUser(db, { login: "ann", email: "ann@example.com", password: "password-123" });
      await createUser(db, { login: "bob", email: "bob@example.com", password: "password-123", role: "editor" });
      const page = await listUsers(db, { page: 1, perPage: 1 });
      expect(page.total).toBe(2);
      expect(page.users).toHaveLength(1);
      expect(page.totalPages).toBe(2);
      const all = await listUsers(db, {});
      expect(all.users.map((u) => u.login).sort()).toEqual(["ann", "bob"]);
      expect(all.users.find((u) => u.login === "bob")?.role).toBe("editor");
    } finally {
      close();
    }
  });

  it("changes roles", async () => {
    const { db, close } = createTestDb();
    try {
      const user = await createUser(db, { login: "ann", email: "ann@example.com", password: "password-123" });
      expect(user.role).toBe("subscriber");
      const updated = await setUserRole(db, user.id, "author");
      expect(updated.role).toBe("author");
      expect((await listUsers(db, {})).users[0]?.role).toBe("author");
    } finally {
      close();
    }
  });

  it("refuses to delete a user who owns posts, and deletes one who does not", async () => {
    const { db, close } = createTestDb();
    try {
      const author = await createUser(db, { login: "ann", email: "ann@example.com", password: "password-123" });
      await createPost(db, { title: "Hello", authorId: author.id });
      await expect(deleteUser(db, author.id)).rejects.toThrow(/owns 1 post/);
      await expect(deleteUser(db, author.id)).rejects.toThrow(/reassign/i);

      const plain = await createUser(db, { login: "bob", email: "bob@example.com", password: "password-123" });
      expect(await deleteUser(db, plain.id)).toBe(true);
      expect((await listUsers(db, {})).total).toBe(1);
    } finally {
      close();
    }
  });

  it("resets a password: temp password works once, old one fails, sessions revoked", async () => {
    const { db, close } = createTestDb();
    try {
      const user = await createUser(db, { login: "ann", email: "ann@example.com", password: "password-123" });
      const { token } = await createSession(db, user.id);
      expect(await verifySession(db, token)).not.toBeNull();

      const { user: updated, temporaryPassword } = await resetUserPassword(db, user.id);
      expect(updated.id).toBe(user.id);
      expect(temporaryPassword).toHaveLength(16);
      expect(temporaryPassword).not.toContain("password-123");

      // Old password no longer works; temporary one does.
      expect(await checkUserPassword(db, "ann", "password-123")).toBeNull();
      expect(await checkUserPassword(db, "ann", temporaryPassword)).not.toBeNull();
      // The pre-reset session was revoked.
      expect(await verifySession(db, token)).toBeNull();
    } finally {
      close();
    }
  });
});
