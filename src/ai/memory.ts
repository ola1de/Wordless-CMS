/**
 * Website memory (Milestone 6) — the site-knowledge store agents use as
 * context. Facts are re-ingested from the site's own data (title,
 * tagline, published posts, active theme, installed extensions); notes
 * are short facts an admin adds by hand. Memory NEVER contains secrets:
 * only public site content and admin-written notes go in.
 *
 * Storage: `wl_ai_memory` (kind 'fact' | 'note', key, value, source).
 * Rebuild runs in-process in local dev; for large sites it should run as
 * a job (the route documents this — the rebuild itself is a single fast
 * pass over indexed queries, capped at 100 posts).
 */
import { execRun, nowIso, queryAll, queryOne } from "../db";
import type { Db } from "../db";
import { badRequest, notFound } from "../kernel/errors";
import { requireString } from "../kernel/validate";
import { getOption } from "../modules/options/service";
import { listPosts } from "../modules/posts/service";
import { getActiveThemeSlug } from "../modules/themes/service";
import { listExtensions } from "../modules/extensions/service";

export interface MemoryEntry {
  id: number;
  kind: "fact" | "note";
  key: string;
  value: string;
  source: string;
  updatedAt: string;
}

export interface MemoryList {
  facts: MemoryEntry[];
  notes: MemoryEntry[];
}

const MAX_POSTS_INGESTED = 100;
const MAX_NOTES_IN_CONTEXT = 10;
const MAX_POSTS_IN_CONTEXT = 20;

interface MemoryRow {
  id: number;
  kind: string;
  key: string;
  value: string;
  source: string;
  updated_at: string;
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    kind: row.kind === "note" ? "note" : "fact",
    key: row.key,
    value: row.value,
    source: row.source,
    updatedAt: row.updated_at,
  };
}

async function upsertFact(db: Db, key: string, value: string, source = "system"): Promise<void> {
  const now = nowIso();
  await execRun(
    db,
    `INSERT INTO wl_ai_memory (kind, key, value, source, updated_at) VALUES ('fact', ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, source = excluded.source, updated_at = excluded.updated_at`,
    [key, value, source, now],
  );
}

export async function listMemory(db: Db): Promise<MemoryList> {
  const rows = await queryAll<MemoryRow>(db, "SELECT * FROM wl_ai_memory ORDER BY kind ASC, key ASC LIMIT 500");
  const entries = rows.map(rowToEntry);
  return {
    facts: entries.filter((e) => e.kind === "fact"),
    notes: entries.filter((e) => e.kind === "note"),
  };
}

export async function addNote(db: Db, text: string): Promise<MemoryEntry> {
  const value = requireString(text, "text", { max: 2000 });
  // Notes must not smuggle secrets into memory: refuse obvious key material.
  if (/^(sk-|AKIA|-----BEGIN|api[_-]?key\s*=)/i.test(value) || /password\s*[:=]\s*\S+/i.test(value)) {
    throw badRequest("Notes must not contain API keys, passwords or private-key material.");
  }
  const key = `note:${crypto.randomUUID()}`;
  const now = nowIso();
  const { lastRowId } = await execRun(
    db,
    "INSERT INTO wl_ai_memory (kind, key, value, source, updated_at) VALUES ('note', ?, ?, 'admin', ?)",
    [key, value, now],
  );
  const row = await queryOne<MemoryRow>(db, "SELECT * FROM wl_ai_memory WHERE id = ? LIMIT 1", [lastRowId]);
  if (row === null) throw new Error("Memory note was not created.");
  return rowToEntry(row);
}

export async function deleteNote(db: Db, id: number): Promise<boolean> {
  const row = await queryOne<MemoryRow>(db, "SELECT * FROM wl_ai_memory WHERE id = ? LIMIT 1", [id]);
  if (row === null) throw notFound("Memory note not found.");
  if (row.kind !== "note") {
    throw badRequest("Only admin notes can be deleted; facts are rebuilt from the site.");
  }
  const { changes } = await execRun(db, "DELETE FROM wl_ai_memory WHERE id = ? AND kind = 'note'", [id]);
  return changes > 0;
}

/**
 * Re-ingest facts from the site's own data. Deletes stale auto facts
 * first (admin notes are never touched), then writes fresh ones.
 */
export async function rebuildMemory(db: Db): Promise<{ facts: number; notes: number }> {
  await execRun(db, "DELETE FROM wl_ai_memory WHERE kind = 'fact'");
  const title = await getOption<string>(db, "blogname", "Wordless");
  const tagline = await getOption<string>(db, "blogdescription", "");
  const theme = await getActiveThemeSlug(db);
  const posts = await listPosts(db, { status: "publish", type: "post", page: 1, perPage: MAX_POSTS_INGESTED });
  const pages = await listPosts(db, { status: "publish", type: "page", page: 1, perPage: MAX_POSTS_INGESTED });
  const extensions = await listExtensions(db);

  await upsertFact(db, "site.title", title);
  await upsertFact(db, "site.tagline", tagline);
  await upsertFact(db, "site.theme", theme);
  await upsertFact(db, "site.post_count", String(posts.total));
  await upsertFact(db, "site.page_count", String(pages.total));
  await upsertFact(
    db,
    "site.posts",
    JSON.stringify(posts.posts.map((p) => ({ id: p.id, title: p.title, slug: p.slug }))),
  );
  await upsertFact(
    db,
    "site.extensions",
    JSON.stringify(extensions.map((e) => ({ slug: e.slug, name: e.name, status: e.status }))),
  );
  await upsertFact(db, "site.generated_at", nowIso());

  const notes = await queryOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM wl_ai_memory WHERE kind = 'note'");
  const facts = await queryOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM wl_ai_memory WHERE kind = 'fact'");
  return { facts: facts?.n ?? 0, notes: notes?.n ?? 0 };
}

/** Render memory as the context block injected into agent prompts. */
export async function buildMemoryContext(db: Db): Promise<string> {
  const { facts, notes } = await listMemory(db);
  const lines: string[] = ["Website memory (facts about this site — use them, do not invent others):"];
  const title = facts.find((f) => f.key === "site.title");
  const tagline = facts.find((f) => f.key === "site.tagline");
  const theme = facts.find((f) => f.key === "site.theme");
  const postCount = facts.find((f) => f.key === "site.post_count");
  if (title !== undefined) lines.push(`- Site title: ${title.value}`);
  if (tagline !== undefined && tagline.value !== "") lines.push(`- Tagline: ${tagline.value}`);
  if (theme !== undefined) lines.push(`- Active theme: ${theme.value}`);
  if (postCount !== undefined) lines.push(`- Published posts: ${postCount.value}`);
  const postsFact = facts.find((f) => f.key === "site.posts");
  if (postsFact !== undefined) {
    try {
      const posts = JSON.parse(postsFact.value) as Array<{ title: string; slug: string }>;
      for (const post of posts.slice(0, MAX_POSTS_IN_CONTEXT)) {
        lines.push(`- Post: "${post.title}" (/${post.slug})`);
      }
    } catch {
      // A corrupt posts fact is ignored; the rest of memory still renders.
    }
  }
  if (notes.length > 0) {
    lines.push("Admin notes:");
    for (const note of notes.slice(0, MAX_NOTES_IN_CONTEXT)) {
      lines.push(`- ${note.value}`);
    }
  }
  if (lines.length === 1) {
    lines.push("- (No website memory yet — run a memory rebuild from the command centre.)");
  }
  return lines.join("\n");
}
