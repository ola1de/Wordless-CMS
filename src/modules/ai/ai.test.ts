/**
 * AI orchestrator / mode / approval / memory / agent tests (Milestone 6).
 *
 * Mode enforcement is the heart of this milestone, so it is tested
 * end-to-end through runAiTask with the mock provider (deterministic):
 * supervised creates an approval and applies nothing; manual creates
 * neither approval nor application; autonomous applies the low-risk
 * draft and still gates high-risk actions behind an approval.
 */
import { describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { createTestDb } from "../../test/test-db";
import { AGENTS, getAgent, listAgents } from "../../ai/agents/registry";
import { addNote, buildMemoryContext, deleteNote, listMemory, rebuildMemory } from "../../ai/memory";
import { setSelectedProviderId } from "../../ai/providers/index";
import { createAiTask, getAiTask, processProposals, runAiTask } from "../../ai/orchestrator";
import { decideApproval, getAiMode, listApprovals, setAiMode } from "./service";
import { createPost, listPosts } from "../posts/service";
import { createUser } from "../users/service";

const emptyEnv = {} as unknown as Env;

async function seedAdmin(db: ReturnType<typeof createTestDb>["db"]): Promise<number> {
  const user = await createUser(db, {
    login: "admin",
    email: "admin@example.test",
    password: "correct-horse-battery",
    role: "administrator",
  });
  return user.id;
}

async function useMock(db: ReturnType<typeof createTestDb>["db"]): Promise<void> {
  await setSelectedProviderId(db, "mock");
}

describe("operating mode", () => {
  it("defaults to supervised and round-trips through set/get", async () => {
    const tdb = createTestDb();
    try {
      expect(await getAiMode(tdb.db)).toBe("supervised");
      expect(await setAiMode(tdb.db, "autonomous")).toBe("autonomous");
      expect(await getAiMode(tdb.db)).toBe("autonomous");
      await expect(setAiMode(tdb.db, "chaos")).rejects.toThrow();
    } finally {
      tdb.close();
    }
  });
});

describe("supervised mode (default)", () => {
  it("creates an approval and applies nothing until approved", async () => {
    const tdb = createTestDb();
    try {
      const adminId = await seedAdmin(tdb.db);
      await useMock(tdb.db);
      const created = await createAiTask(tdb.db, { agent: "content-writer", input: "Write about test topic" });
      expect(created.mode).toBe("supervised");
      const finished = await runAiTask(tdb.db, created.id, { env: emptyEnv, userId: adminId });
      expect(finished.status).toBe("done");
      expect(finished.result?.proposals).toHaveLength(1);
      expect(finished.result?.approvals).toHaveLength(1);
      expect(finished.result?.applied).toHaveLength(0);
      // Nothing was created yet.
      expect((await listPosts(tdb.db, { page: 1, perPage: 10 })).total).toBe(0);
      // The approval is pending.
      const pending = await listApprovals(tdb.db, { status: "pending" });
      expect(pending.total).toBe(1);
      // Approving applies it through the posts service: a real draft post.
      const decided = await decideApproval(tdb.db, pending.approvals[0]!.id, { approve: true, userId: adminId });
      expect(decided.status).toBe("approved");
      const posts = await listPosts(tdb.db, { page: 1, perPage: 10 });
      expect(posts.total).toBe(1);
      expect(posts.posts[0]?.status).toBe("draft");
      expect(posts.posts[0]?.title).toContain("test topic");
    } finally {
      tdb.close();
    }
  });

  it("records a rejection with its reason and applies nothing", async () => {
    const tdb = createTestDb();
    try {
      const adminId = await seedAdmin(tdb.db);
      await useMock(tdb.db);
      const created = await createAiTask(tdb.db, { agent: "content-writer", input: "Write about rejection" });
      await runAiTask(tdb.db, created.id, { env: emptyEnv, userId: adminId });
      const pending = await listApprovals(tdb.db, { status: "pending" });
      const decided = await decideApproval(tdb.db, pending.approvals[0]!.id, {
        approve: false,
        userId: adminId,
        reason: "Not our tone.",
      });
      expect(decided.status).toBe("rejected");
      expect(decided.reason).toBe("Not our tone.");
      expect((await listPosts(tdb.db, { page: 1, perPage: 10 })).total).toBe(0);
      // Deciding twice is an error.
      await expect(
        decideApproval(tdb.db, pending.approvals[0]!.id, { approve: true, userId: adminId }),
      ).rejects.toThrow("already been rejected");
    } finally {
      tdb.close();
    }
  });
});

describe("manual mode", () => {
  it("never creates approvals and never applies anything", async () => {
    const tdb = createTestDb();
    try {
      const adminId = await seedAdmin(tdb.db);
      await useMock(tdb.db);
      const created = await createAiTask(tdb.db, {
        agent: "content-writer",
        input: "Write about manual mode",
        mode: "manual",
      });
      const finished = await runAiTask(tdb.db, created.id, { env: emptyEnv, userId: adminId });
      expect(finished.status).toBe("done");
      expect(finished.result?.proposals).toHaveLength(1);
      expect(finished.result?.approvals).toHaveLength(0);
      expect(finished.result?.applied).toHaveLength(0);
      expect((await listApprovals(tdb.db)).total).toBe(0);
      expect((await listPosts(tdb.db, { page: 1, perPage: 10 })).total).toBe(0);
    } finally {
      tdb.close();
    }
  });
});

describe("autonomous mode", () => {
  it("auto-applies low-risk proposals and still gates high-risk ones", async () => {
    const tdb = createTestDb();
    try {
      const adminId = await seedAdmin(tdb.db);
      await useMock(tdb.db);
      const created = await createAiTask(tdb.db, {
        agent: "content-writer",
        input: "Write about autonomous mode",
        mode: "autonomous",
      });
      const finished = await runAiTask(tdb.db, created.id, { env: emptyEnv, userId: adminId });
      expect(finished.status).toBe("done");
      // The low-risk draft was applied immediately, no approval created.
      expect(finished.result?.applied).toHaveLength(1);
      expect(finished.result?.approvals).toHaveLength(0);
      expect((await listPosts(tdb.db, { page: 1, perPage: 10 })).total).toBe(1);

      // A high-risk proposal (publishing) still becomes an approval.
      const postId = (await listPosts(tdb.db, { page: 1, perPage: 10 })).posts[0]!.id;
      const handled = await processProposals(
        tdb.db,
        "autonomous",
        [{ type: "publish_post", summary: `Publish post ${postId}`, risk: "high", payload: { postId } }],
        created.id,
        "content-writer",
        adminId,
      );
      expect(handled.applied).toHaveLength(0);
      expect(handled.approvals).toHaveLength(1);
      // The post is still a draft.
      expect((await listPosts(tdb.db, { page: 1, perPage: 10 })).posts[0]?.status).toBe("draft");
    } finally {
      tdb.close();
    }
  });
});

describe("provider gating", () => {
  it("fails an agent task honestly when the selected provider is not configured", async () => {
    const tdb = createTestDb();
    try {
      const adminId = await seedAdmin(tdb.db);
      // Default provider is workers-ai; the test env has no AI binding.
      const created = await createAiTask(tdb.db, { agent: "content-writer", input: "Write about gating" });
      const finished = await runAiTask(tdb.db, created.id, { env: emptyEnv, userId: adminId });
      expect(finished.status).toBe("failed");
      expect(finished.error).toContain("No AI provider is configured");
    } finally {
      tdb.close();
    }
  });

  it("a deterministic analysis agent runs without any provider", async () => {
    const tdb = createTestDb();
    try {
      const adminId = await seedAdmin(tdb.db);
      await createPost(tdb.db, { title: "No excerpt here", content: "Body.", status: "publish", authorId: adminId });
      const created = await createAiTask(tdb.db, { agent: "seo-auditor", input: "Audit the site" });
      const finished = await runAiTask(tdb.db, created.id, { env: emptyEnv, userId: adminId });
      expect(finished.status).toBe("done");
      expect(finished.result?.data?.missingExcerpt).toBe(1);
      expect(finished.result?.data?.total).toBe(1);
    } finally {
      tdb.close();
    }
  });
});

describe("agent roster", () => {
  it("has exactly 15 agents, each with a handler, capabilities and risk", () => {
    expect(AGENTS).toHaveLength(15);
    const ids = AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(15);
    for (const agent of AGENTS) {
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.description.length).toBeGreaterThan(0);
      expect(agent.capabilities.length).toBeGreaterThan(0);
      expect(typeof agent.run).toBe("function");
    }
    expect(ids).toContain("commerce-assistant");
    expect(ids).toContain("content-writer");
    expect(ids).toContain("research-assistant");
  });

  it("marks commerce-assistant available since Milestone 8 (commerce is live)", async () => {
    const commerce = getAgent("commerce-assistant");
    expect(commerce?.unavailableReason).toBeUndefined();
    const listed = listAgents(true);
    expect(listed.find((a) => a.id === "commerce-assistant")?.available).toBe(true);
    // And it runs: an empty store reports zeros, not an error.
    const tdb = createTestDb();
    try {
      const task = await createAiTask(tdb.db, { agent: "commerce-assistant", input: "How is the store doing?" });
      const finished = await runAiTask(tdb.db, task.id, {
        env: {} as never,
        userId: 0,
      });
      expect(finished.status).toBe("done");
      expect(finished.result?.data?.products).toBe(0);
    } finally {
      tdb.close();
    }
  });

  it("rejects tasks for unknown agents", async () => {
    const tdb = createTestDb();
    try {
      await expect(createAiTask(tdb.db, { agent: "no-such-agent", input: "x" })).rejects.toThrow("Unknown AI agent");
    } finally {
      tdb.close();
    }
  });

  it("marks provider agents unavailable when no provider is configured", () => {
    const listed = listAgents(false);
    const writer = listed.find((a) => a.id === "content-writer");
    expect(writer?.available).toBe(false);
    expect(writer?.unavailableReason).toContain("No AI provider is configured");
    const seo = listed.find((a) => a.id === "seo-auditor");
    expect(seo?.available).toBe(true);
  });
});

describe("website memory", () => {
  it("rebuild ingests post titles and agent context includes admin notes", async () => {
    const tdb = createTestDb();
    try {
      const adminId = await seedAdmin(tdb.db);
      await createPost(tdb.db, { title: "Memory test post", content: "Body.", status: "publish", authorId: adminId });
      const rebuilt = await rebuildMemory(tdb.db);
      expect(rebuilt.facts).toBeGreaterThan(0);
      const note = await addNote(tdb.db, "Our tone is plain and friendly.");
      expect(note.kind).toBe("note");
      const context = await buildMemoryContext(tdb.db);
      expect(context).toContain("Memory test post");
      expect(context).toContain("Our tone is plain and friendly.");
      expect(await deleteNote(tdb.db, note.id)).toBe(true);
      const after = await buildMemoryContext(tdb.db);
      expect(after).not.toContain("Our tone is plain and friendly.");
    } finally {
      tdb.close();
    }
  });

  it("refuses notes that look like secrets and refuses to delete facts", async () => {
    const tdb = createTestDb();
    try {
      await rebuildMemory(tdb.db);
      await expect(addNote(tdb.db, "password: hunter2")).rejects.toThrow("must not contain");
      await expect(addNote(tdb.db, "sk-abc1234567890")).rejects.toThrow("must not contain");
      const list = await listMemory(tdb.db);
      const fact = list.facts[0];
      if (fact !== undefined) {
        await expect(deleteNote(tdb.db, fact.id)).rejects.toThrow("Only admin notes");
      }
    } finally {
      tdb.close();
    }
  });
});

describe("task views", () => {
  it("getAiTask returns the stored task and 404s for unknown ids", async () => {
    const tdb = createTestDb();
    try {
      await useMock(tdb.db);
      const created = await createAiTask(tdb.db, { agent: "seo-auditor", input: "Audit" });
      const fetched = await getAiTask(tdb.db, created.id);
      expect(fetched.agent).toBe("seo-auditor");
      await expect(getAiTask(tdb.db, "no-such-id")).rejects.toThrow("not found");
    } finally {
      tdb.close();
    }
  });
});
