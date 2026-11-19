/**
 * WordPress importer (Milestone 9) — WXR (WordPress eXtended RSS) and
 * mysqldump imports. Data only: the importer parses XML and SQL data,
 * it never evals PHP or executes imported code.
 *
 * Rules (from docs/02-architecture.md and docs/import/wordpress-import.md):
 * - WordPress phpass password hashes are NOT portable → every imported
 *   user gets an empty (unusable) password + the forced-reset flag
 *   `wl_password_reset_required`; they cannot log in until they reset.
 * - PHP-serialized values in options/meta are converted to JSON with
 *   the safe unserializer; serialized OBJECTS are refused and recorded
 *   as failed (never eval'd).
 * - Block content is preserved verbatim (post_content is stored as-is).
 * - WordPress taxonomy `post_tag` maps to Wordless taxonomy `tag`.
 * - Original IDs are kept when free, so relationships survive; when an
 *   ID collides the row gets a new ID and the mapping is recorded.
 * - Every item lands in the per-item report as imported / skipped /
 *   failed with a reason — nothing is silently dropped.
 * - Imports run as wl_jobs jobs (kind 'import_wxr' / 'import_sql');
 *   the uploaded file is stored in R2 under imports/ and the job
 *   payload holds its key (the file itself never goes in D1).
 */
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest } from "../../kernel/errors";
import type { Env } from "../../env";
import { logActivity } from "../activity/service";
import { PASSWORD_RESET_META_KEY } from "../security/service";
import { getUserByLogin, updateUserMeta } from "../users/service";
import { insertPostRow } from "../posts/repo";
import { ensureUniqueSlug, slugify } from "../posts/service";
import type { PostStatus } from "../posts/types";
import { addPostTerm, createTerm } from "../terms/service";
import { parseWxr, type WxrItem, type WxrMeta } from "./wxr-parser";
import { parseSqlDump } from "./sql-parser";
import { PhpUnserializeError, safeUnserialize } from "./php-serialize";

export interface ImportReportItem {
  type: string;
  sourceId: string;
  targetId: number | null;
  status: "imported" | "skipped" | "failed";
  reason?: string;
}

export interface ImportReport {
  kind: "wxr" | "sql";
  source: string;
  counts: {
    imported: number;
    skipped: number;
    failed: number;
    byType: Record<string, { imported: number; skipped: number; failed: number }>;
  };
  items: ImportReportItem[];
  ignoredTables?: string[];
  finishedAt: string;
}

export type AttachmentFetcher = (url: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;

class Report {
  items: ImportReportItem[] = [];

  add(type: string, sourceId: string, targetId: number | null, status: ImportReportItem["status"], reason?: string): void {
    this.items.push({ type, sourceId, targetId, status, ...(reason !== undefined ? { reason } : {}) });
  }

  build(kind: "wxr" | "sql", source: string, ignoredTables?: string[]): ImportReport {
    const byType: Record<string, { imported: number; skipped: number; failed: number }> = {};
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    for (const item of this.items) {
      const bucket = (byType[item.type] ??= { imported: 0, skipped: 0, failed: 0 });
      bucket[item.status] += 1;
      if (item.status === "imported") imported += 1;
      else if (item.status === "skipped") skipped += 1;
      else failed += 1;
    }
    return {
      kind,
      source,
      counts: { imported, skipped, failed, byType },
      items: this.items,
      ...(ignoredTables !== undefined ? { ignoredTables } : {}),
      finishedAt: nowIso(),
    };
  }
}

/** WordPress post status → Wordless post status (draft/publish/private/trash only). */
export function mapWpStatus(status: string, type: string): { status: PostStatus; note?: string } {
  const s = status.toLowerCase();
  if (s === "publish" || s === "draft" || s === "private" || s === "trash") return { status: s };
  if (s === "inherit" && type === "attachment") return { status: "publish", note: "WordPress status \"inherit\" → publish (attachments are not listed)." };
  return { status: "draft", note: `WordPress status "${status}" has no Wordless equivalent → imported as draft.` };
}

/** "2026-01-15 10:30:00" or ISO → ISO-8601, or null when unparseable. */
export function toIso(dateStr: string): string | null {
  const trimmed = dateStr.trim();
  if (trimmed === "" || trimmed === "0000-00-00 00:00:00") return null;
  const d = new Date(trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Insert an imported user: unusable password + forced-reset flag. */
export async function insertImportedUser(
  db: Db,
  login: string,
  email: string,
  displayName: string,
  registered: string,
  source: "wxr" | "sql",
): Promise<{ id: number; existed: boolean }> {
  const existing = await getUserByLogin(db, login);
  if (existing !== null) return { id: existing.id, existed: true };
  const nicename = slugify(login);
  const { lastRowId } = await execRun(
    db,
    `INSERT INTO wp_users (user_login, user_pass, user_nicename, user_email, user_url, user_registered, display_name)
     VALUES (?, '', ?, ?, '', ?, ?)`,
    [login, nicename, email, registered, displayName],
  );
  const id = lastRowId ?? 0;
  await updateUserMeta(db, id, PASSWORD_RESET_META_KEY, "1");
  await updateUserMeta(db, id, "wl_imported_from", source);
  return { id, existed: false };
}

/**
 * Store one meta value: PHP-serialized values become JSON, plain
 * strings stay plain strings (stored as JSON, per the architecture).
 * Returns false + a reason when the value cannot be converted.
 */
export async function insertMetaValue(
  db: Db,
  table: "wp_postmeta" | "wp_usermeta" | "wp_commentmeta" | "wp_termmeta",
  idColumn: string,
  idValue: number,
  key: string,
  rawValue: string,
): Promise<{ ok: boolean; reason?: string }> {
  let stored: string;
  try {
    stored = JSON.stringify(safeUnserialize(rawValue));
  } catch (err) {
    if (err instanceof PhpUnserializeError) {
      return { ok: false, reason: err.message };
    }
    return { ok: false, reason: err instanceof Error ? err.message : "Unserializable value." };
  }
  await execRun(db, `INSERT INTO ${table} (${idColumn}, meta_key, meta_value) VALUES (?, ?, ?)`, [
    idValue,
    key,
    stored,
  ]);
  return { ok: true };
}

async function insertCommentRow(
  db: Db,
  input: {
    postId: number;
    author: string;
    authorEmail: string;
    authorUrl: string;
    authorIp: string;
    date: string;
    dateGmt: string;
    content: string;
    approved: string;
    agent: string;
    type: string;
    parent: number;
    userId: number;
  },
): Promise<number> {
  const { lastRowId } = await execRun(
    db,
    `INSERT INTO wp_comments
       (comment_post_ID, comment_author, comment_author_email, comment_author_url, comment_author_IP,
        comment_date, comment_date_gmt, comment_content, comment_karma, comment_approved,
        comment_agent, comment_type, comment_parent, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      input.postId,
      input.author,
      input.authorEmail,
      input.authorUrl,
      input.authorIp,
      input.date,
      input.dateGmt,
      input.content,
      input.approved,
      input.agent,
      input.type,
      input.parent,
      input.userId,
    ],
  );
  return lastRowId ?? 0;
}

/** WordPress comment_approved → Wordless: "1" approved, "0" pending, "spam" spam. */
export function mapCommentApproved(value: string): string {
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "approve" || v === "approved") return "1";
  if (v === "spam") return "spam";
  return "0";
}

async function refreshCommentCount(db: Db, postId: number): Promise<void> {
  const row = await queryOne<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM wp_comments WHERE comment_post_ID = ? AND comment_approved = '1'",
    [postId],
  );
  await execRun(db, "UPDATE wp_posts SET comment_count = ? WHERE ID = ?", [row?.n ?? 0, postId]);
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

/** ------------------------------------------------------- WXR import */

export interface WxrImportOptions {
  fetchAttachment?: AttachmentFetcher;
}

export async function importWxr(
  db: Db,
  env: Env,
  xml: string,
  source: string,
  adminId: number,
  options: WxrImportOptions = {},
): Promise<ImportReport> {
  const report = new Report();
  const parsed = parseWxr(xml);

  // Authors → users (forced password reset).
  const authorMap = new Map<string, number>();
  for (const author of parsed.authors) {
    if (author.login === "") {
      report.add("user", `author:${author.id}`, null, "skipped", "Author has no login name.");
      continue;
    }
    const { id, existed } = await insertImportedUser(
      db,
      author.login,
      author.email,
      author.displayName || `${author.firstName} ${author.lastName}`.trim() || author.login,
      nowIso(),
      "wxr",
    );
    authorMap.set(author.login, id);
    report.add("user", `author:${author.id} (${author.login})`, id, existed ? "skipped" : "imported", existed ? "User already exists." : undefined);
  }

  // Terms (categories, tags, custom taxonomies).
  const termMap = new Map<string, { termId: number; termTaxonomyId: number }>();
  const pendingParents: Array<{ termTaxonomyId: number; parentSlug: string }> = [];
  for (const def of parsed.terms) {
    const taxonomy = def.taxonomy === "post_tag" ? "tag" : def.taxonomy;
    const key = `${taxonomy}:${def.slug}`;
    const existing = await queryOne<{ term_id: number; term_taxonomy_id: number }>(
      db,
      `SELECT t.term_id, tt.term_taxonomy_id FROM wp_terms t
       JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
       WHERE tt.taxonomy = ? AND t.slug = ? LIMIT 1`,
      [taxonomy, def.slug],
    );
    if (existing !== null) {
      termMap.set(key, { termId: existing.term_id, termTaxonomyId: existing.term_taxonomy_id });
      report.add("term", `${taxonomy}:${def.slug}`, existing.term_id, "skipped", "Term already exists.");
      continue;
    }
    try {
      const term = await createTerm(db, {
        name: def.name || def.slug,
        slug: def.slug,
        taxonomy,
        description: def.description,
      });
      termMap.set(key, { termId: term.id, termTaxonomyId: term.termTaxonomyId });
      report.add("term", `${taxonomy}:${def.slug}`, term.id, "imported");
      if (def.taxonomy === "category" && def.parent !== "") {
        // WXR category parents are slugs (wp:category_parent is a nicename).
        pendingParents.push({ termTaxonomyId: term.termTaxonomyId, parentSlug: def.parent });
      }
    } catch (err) {
      report.add("term", `${taxonomy}:${def.slug}`, null, "failed", err instanceof Error ? err.message : "Term import failed.");
    }
  }
  // Second pass: category parents (the parent term may have been created after the child).
  for (const pending of pendingParents) {
    const parent = termMap.get(`category:${pending.parentSlug}`);
    if (parent === undefined) {
      report.add("term_parent", pending.parentSlug, null, "failed", "Parent category not found in the export.");
      continue;
    }
    await execRun(db, "UPDATE wp_term_taxonomy SET parent = ? WHERE term_taxonomy_id = ?", [
      parent.termId,
      pending.termTaxonomyId,
    ]);
  }

  // Items: posts, pages, attachments. Revisions are skipped.
  const postMap = new Map<number, number>();
  const touchedPosts = new Set<number>();
  for (const item of parsed.items) {
    if (item.postType === "revision") {
      report.add("post", `revision:${item.postId}`, null, "skipped", "Revisions are not imported.");
      continue;
    }
    const authorId = authorMap.get(item.creator) ?? adminId;
    const baseSlug = slugify(item.postName || item.title);
    const slug = await ensureUniqueSlug(db, baseSlug);
    const { status, note } = mapWpStatus(item.status, item.postType);
    const date = toIso(item.postDate) ?? toIso(item.pubDate) ?? nowIso();
    const type = item.postType === "" ? "post" : item.postType;
    let newId: number;
    try {
      newId = await insertPostRow(db, {
        authorId,
        date,
        content: item.content,
        title: item.title || "(no title)",
        excerpt: item.excerpt,
        status,
        slug,
        parentId: 0,
        type,
        mimeType: "",
        commentStatus: item.commentStatus === "closed" ? "closed" : "open",
      });
    } catch (err) {
      report.add("post", `${type}:${item.postId}`, null, "failed", err instanceof Error ? err.message : "Post insert failed.");
      continue;
    }
    postMap.set(item.postId, newId);
    touchedPosts.add(newId);
    await execRun(db, "UPDATE wp_posts SET guid = ?, menu_order = ?, post_password = ? WHERE ID = ?", [
      item.guid || item.link,
      item.menuOrder,
      item.postPassword,
      newId,
    ]);
    report.add("post", `${type}:${item.postId}`, newId, "imported", note);

    // Postmeta (serialized values → JSON).
    for (const meta of item.meta) {
      const res = await insertMetaValue(db, "wp_postmeta", "post_id", newId, meta.key, meta.value);
      report.add("postmeta", `${item.postId}:${meta.key}`, res.ok ? newId : null, res.ok ? "imported" : "failed", res.reason);
    }

    // Term assignment.
    for (const cat of item.categories) {
      const taxonomy = cat.domain === "post_tag" ? "tag" : cat.domain;
      const key = `${taxonomy}:${cat.nicename}`;
      let term = termMap.get(key);
      if (term === undefined) {
        try {
          const created = await createTerm(db, { name: cat.name || cat.nicename, slug: cat.nicename, taxonomy });
          term = { termId: created.id, termTaxonomyId: created.termTaxonomyId };
          termMap.set(key, term);
          report.add("term", key, created.id, "imported");
        } catch (err) {
          report.add("term", key, null, "failed", err instanceof Error ? err.message : "Term import failed.");
          continue;
        }
      }
      await addPostTerm(db, newId, term.termTaxonomyId);
    }

    // Comments (two-pass parents below).
    const commentMap = new Map<number, number>();
    const pendingCommentParents: Array<{ newId: number; oldParent: number }> = [];
    for (const comment of item.comments) {
      const commentDate = toIso(comment.date) ?? toIso(comment.dateGmt) ?? nowIso();
      const commentUserId = comment.userId !== 0 ? comment.userId : 0;
      const newCommentId = await insertCommentRow(db, {
        postId: newId,
        author: comment.author,
        authorEmail: comment.authorEmail,
        authorUrl: comment.authorUrl,
        authorIp: comment.authorIp,
        date: commentDate,
        dateGmt: toIso(comment.dateGmt) ?? commentDate,
        content: comment.content,
        approved: mapCommentApproved(comment.approved),
        agent: "",
        type: comment.type || "comment",
        parent: 0,
        userId: commentUserId,
      });
      commentMap.set(comment.id, newCommentId);
      if (comment.parent !== 0) pendingCommentParents.push({ newId: newCommentId, oldParent: comment.parent });
      report.add("comment", `${item.postId}:${comment.id}`, newCommentId, "imported");
      for (const meta of comment.meta) {
        const res = await insertMetaValue(db, "wp_commentmeta", "comment_id", newCommentId, meta.key, meta.value);
        report.add("commentmeta", `${comment.id}:${meta.key}`, res.ok ? newCommentId : null, res.ok ? "imported" : "failed", res.reason);
      }
    }
    for (const pending of pendingCommentParents) {
      const parent = commentMap.get(pending.oldParent);
      if (parent !== undefined) {
        await execRun(db, "UPDATE wp_comments SET comment_parent = ? WHERE comment_ID = ?", [parent, pending.newId]);
      }
    }

    // Attachments: fetch the file into R2; a failed fetch is recorded, never dropped.
    if (type === "attachment") {
      const url = item.guid || item.link;
      if (options.fetchAttachment === undefined || url === "") {
        report.add("attachment_media", `${item.postId}`, newId, "skipped", "No attachment fetcher configured, or the item has no URL.");
      } else if (env.MEDIA === undefined) {
        report.add("attachment_media", `${item.postId}`, newId, "failed", "Media storage (R2) is not configured.");
      } else {
        let fetched: { bytes: Uint8Array; mime: string } | null = null;
        let fetchFailed = false;
        try {
          fetched = await options.fetchAttachment(url);
        } catch (err) {
          fetchFailed = true;
          report.add("attachment_media", `${item.postId}`, newId, "failed", `Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (fetched !== null) {
          const ext = MIME_EXT[fetched.mime] ?? "bin";
          const key = `media/imported-${newId}-${slug}.${ext}`;
          await env.MEDIA.put(key, fetched.bytes, { httpMetadata: { contentType: fetched.mime } });
          await execRun(db, "UPDATE wp_posts SET post_mime_type = ? WHERE ID = ?", [fetched.mime, newId]);
          await insertMetaValue(db, "wp_postmeta", "post_id", newId, "_wp_attached_file", key);
          report.add("attachment_media", `${item.postId}`, newId, "imported");
        } else if (!fetchFailed) {
          report.add("attachment_media", `${item.postId}`, newId, "failed", `Could not fetch ${url}.`);
        }
      }
    }
  }

  // Post parents (pages/attachments whose parent was imported later).
  for (const item of parsed.items) {
    if (item.postParent === 0) continue;
    const newId = postMap.get(item.postId);
    const newParent = postMap.get(item.postParent);
    if (newId !== undefined && newParent !== undefined) {
      await execRun(db, "UPDATE wp_posts SET post_parent = ? WHERE ID = ?", [newParent, newId]);
    }
  }
  for (const postId of touchedPosts) await refreshCommentCount(db, postId);

  return report.build("wxr", source);
}

/** ------------------------------------------------------- SQL import */

/** Does a row with this primary-key value already exist? */
async function idExists(db: Db, table: string, idColumn: string, id: number): Promise<boolean> {
  const row = await queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM "${table}" WHERE "${idColumn}" = ?`, [id]);
  return (row?.n ?? 0) > 0;
}

/** Insert a row, keeping its original ID when free, else a new one. Returns the final ID. */
async function insertWithOriginalId(
  db: Db,
  table: string,
  idColumn: string,
  row: Record<string, unknown>,
): Promise<number> {
  const originalId = typeof row[idColumn] === "number" ? (row[idColumn] as number) : 0;
  const columns = Object.keys(row);
  const insert = async (withId: boolean): Promise<number> => {
    const cols = withId ? columns : columns.filter((c) => c !== idColumn);
    const { lastRowId } = await execRun(
      db,
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      cols.map((c) => row[c] ?? null),
    );
    return lastRowId ?? 0;
  };
  if (originalId > 0 && !(await idExists(db, table, idColumn, originalId))) {
    return insert(true);
  }
  return insert(false);
}

export async function importSql(db: Db, sql: string, source: string, adminId: number): Promise<ImportReport> {
  const report = new Report();
  const parsed = parseSqlDump(sql);
  const userMap = new Map<number, number>();
  const postMap = new Map<number, number>();
  const termMap = new Map<number, { termId: number; termTaxonomyId: number }>();
  const ttMap = new Map<number, number>();
  const commentMap = new Map<number, number>();
  const touchedPosts = new Set<number>();

  const rowsByTable = new Map<string, Array<Record<string, unknown>>>();
  for (const row of parsed.rows) {
    const list = rowsByTable.get(row.table) ?? [];
    list.push(row.values);
    rowsByTable.set(row.table, list);
  }

  // Users first (posts reference authors).
  for (const row of rowsByTable.get("wp_users") ?? []) {
    const login = String(row.user_login ?? "");
    if (login === "") {
      report.add("user", `sql:${row.ID ?? "?"}`, null, "skipped", "User has no login name.");
      continue;
    }
    const { id, existed } = await insertImportedUser(
      db,
      login,
      String(row.user_email ?? ""),
      String(row.display_name ?? login),
      toIso(String(row.user_registered ?? "")) ?? nowIso(),
      "sql",
    );
    userMap.set(Number(row.ID ?? 0), id);
    report.add("user", `sql:${row.ID}`, id, existed ? "skipped" : "imported", existed ? "User already exists." : undefined);
  }

  // Terms.
  for (const row of rowsByTable.get("wp_terms") ?? []) {
    const slug = String(row.slug ?? "");
    const existing = await queryOne<{ term_id: number }>(db, "SELECT term_id FROM wp_terms WHERE slug = ? LIMIT 1", [slug]);
    if (existing !== null) {
      termMap.set(Number(row.term_id ?? 0), { termId: existing.term_id, termTaxonomyId: 0 });
      report.add("term", `sql:${row.term_id}`, existing.term_id, "skipped", "Term slug already exists.");
      continue;
    }
    const newId = await insertWithOriginalId(db, "wp_terms", "term_id", {
      term_id: Number(row.term_id ?? 0),
      name: String(row.name ?? slug),
      slug,
      term_group: Number(row.term_group ?? 0),
    });
    termMap.set(Number(row.term_id ?? 0), { termId: newId, termTaxonomyId: 0 });
    report.add("term", `sql:${row.term_id}`, newId, "imported");
  }

  // Options (serialized → JSON; Wordless's own wl_* options are never overwritten).
  for (const row of rowsByTable.get("wp_options") ?? []) {
    const name = String(row.option_name ?? "");
    if (name === "") {
      report.add("option", "sql:?", null, "skipped", "Option has no name.");
      continue;
    }
    if (name.startsWith("wl_")) {
      report.add("option", name, null, "skipped", "Wordless's own options are never overwritten by an import.");
      continue;
    }
    let stored: string;
    try {
      stored = JSON.stringify(safeUnserialize(String(row.option_value ?? "")));
    } catch (err) {
      report.add(
        "option",
        name,
        null,
        "failed",
        err instanceof PhpUnserializeError ? err.message : "Unserializable option value.",
      );
      continue;
    }
    await execRun(
      db,
      `INSERT INTO wp_options (option_name, option_value, autoload) VALUES (?, ?, ?)
       ON CONFLICT(option_name) DO UPDATE SET option_value = excluded.option_value`,
      [name, stored, String(row.autoload ?? "yes")],
    );
    report.add("option", name, null, "imported");
  }

  // Links.
  for (const row of rowsByTable.get("wp_links") ?? []) {
    const newId = await insertWithOriginalId(db, "wp_links", "link_id", {
      link_id: Number(row.link_id ?? 0),
      link_url: String(row.link_url ?? ""),
      link_name: String(row.link_name ?? ""),
      link_image: String(row.link_image ?? ""),
      link_target: String(row.link_target ?? ""),
      link_description: String(row.link_description ?? ""),
      link_visible: String(row.link_visible ?? "Y"),
      link_owner: Number(row.link_owner ?? adminId),
      link_rating: Number(row.link_rating ?? 0),
      link_updated: toIso(String(row.link_updated ?? "")) ?? "",
      link_rel: String(row.link_rel ?? ""),
      link_notes: String(row.link_notes ?? ""),
      link_rss: String(row.link_rss ?? ""),
    });
    report.add("link", `sql:${row.link_id}`, newId, "imported");
  }

  // Posts (revisions skipped; parents resolved in a second pass).
  const pendingPostParents: Array<{ newId: number; oldParent: number }> = [];
  for (const row of rowsByTable.get("wp_posts") ?? []) {
    const type = String(row.post_type ?? "post");
    if (type === "revision") {
      report.add("post", `revision:${row.ID}`, null, "skipped", "Revisions are not imported.");
      continue;
    }
    const { status, note } = mapWpStatus(String(row.post_status ?? "draft"), type);
    const date = toIso(String(row.post_date ?? "")) ?? nowIso();
    const slug = await ensureUniqueSlug(db, slugify(String(row.post_name ?? row.post_title ?? "post")));
    const authorId = userMap.get(Number(row.post_author ?? 0)) ?? adminId;
    const newId = await insertWithOriginalId(db, "wp_posts", "ID", {
      ID: Number(row.ID ?? 0),
      post_author: authorId,
      post_date: date,
      post_date_gmt: toIso(String(row.post_date_gmt ?? "")) ?? date,
      post_content: String(row.post_content ?? ""),
      post_title: String(row.post_title ?? ""),
      post_excerpt: String(row.post_excerpt ?? ""),
      post_status: status,
      comment_status: String(row.comment_status ?? "open"),
      ping_status: String(row.ping_status ?? "open"),
      post_password: String(row.post_password ?? ""),
      post_name: slug,
      post_modified: toIso(String(row.post_modified ?? "")) ?? date,
      post_modified_gmt: toIso(String(row.post_modified_gmt ?? "")) ?? date,
      post_content_filtered: String(row.post_content_filtered ?? ""),
      post_parent: 0,
      guid: String(row.guid ?? ""),
      menu_order: Number(row.menu_order ?? 0),
      post_type: type,
      post_mime_type: String(row.post_mime_type ?? ""),
      comment_count: 0,
    });
    postMap.set(Number(row.ID ?? 0), newId);
    touchedPosts.add(newId);
    if (Number(row.post_parent ?? 0) !== 0) {
      pendingPostParents.push({ newId, oldParent: Number(row.post_parent) });
    }
    report.add("post", `${type}:${row.ID}`, newId, "imported", note);
  }
  for (const pending of pendingPostParents) {
    const parent = postMap.get(pending.oldParent);
    if (parent !== undefined) {
      await execRun(db, "UPDATE wp_posts SET post_parent = ? WHERE ID = ?", [parent, pending.newId]);
    }
  }

  // Postmeta / usermeta (serialized → JSON).
  for (const row of rowsByTable.get("wp_postmeta") ?? []) {
    const postId = postMap.get(Number(row.post_id ?? 0));
    if (postId === undefined) {
      report.add("postmeta", `sql:${row.meta_id}`, null, "skipped", "Parent post was not imported.");
      continue;
    }
    const res = await insertMetaValue(db, "wp_postmeta", "post_id", postId, String(row.meta_key ?? ""), String(row.meta_value ?? ""));
    report.add("postmeta", `sql:${row.meta_id}`, res.ok ? postId : null, res.ok ? "imported" : "failed", res.reason);
  }
  for (const row of rowsByTable.get("wp_usermeta") ?? []) {
    const userId = userMap.get(Number(row.user_id ?? 0));
    if (userId === undefined) {
      report.add("usermeta", `sql:${row.umeta_id}`, null, "skipped", "Parent user was not imported.");
      continue;
    }
    const res = await insertMetaValue(db, "wp_usermeta", "user_id", userId, String(row.meta_key ?? ""), String(row.meta_value ?? ""));
    report.add("usermeta", `sql:${row.umeta_id}`, res.ok ? userId : null, res.ok ? "imported" : "failed", res.reason);
  }

  // Term taxonomy (term_id remapped; post_tag → tag).
  for (const row of rowsByTable.get("wp_term_taxonomy") ?? []) {
    const term = termMap.get(Number(row.term_id ?? 0));
    if (term === undefined) {
      report.add("term_taxonomy", `sql:${row.term_taxonomy_id}`, null, "skipped", "Parent term was not imported.");
      continue;
    }
    const taxonomy = String(row.taxonomy ?? "category") === "post_tag" ? "tag" : String(row.taxonomy ?? "category");
    const newTtId = await insertWithOriginalId(db, "wp_term_taxonomy", "term_taxonomy_id", {
      term_taxonomy_id: Number(row.term_taxonomy_id ?? 0),
      term_id: term.termId,
      taxonomy,
      description: String(row.description ?? ""),
      parent: Number(row.parent ?? 0),
      count: 0,
    });
    ttMap.set(Number(row.term_taxonomy_id ?? 0), newTtId);
    termMap.set(Number(row.term_id ?? 0), { termId: term.termId, termTaxonomyId: newTtId });
    report.add("term_taxonomy", `sql:${row.term_taxonomy_id}`, newTtId, "imported");
  }
  for (const row of rowsByTable.get("wp_termmeta") ?? []) {
    const term = termMap.get(Number(row.term_id ?? 0));
    if (term === undefined) {
      report.add("termmeta", `sql:${row.meta_id}`, null, "skipped", "Parent term was not imported.");
      continue;
    }
    const res = await insertMetaValue(db, "wp_termmeta", "term_id", term.termId, String(row.meta_key ?? ""), String(row.meta_value ?? ""));
    report.add("termmeta", `sql:${row.meta_id}`, res.ok ? term.termId : null, res.ok ? "imported" : "failed", res.reason);
  }

  // Relationships (post + term-taxonomy remapped).
  for (const row of rowsByTable.get("wp_term_relationships") ?? []) {
    const postId = postMap.get(Number(row.object_id ?? 0));
    const ttId = ttMap.get(Number(row.term_taxonomy_id ?? 0));
    if (postId === undefined || ttId === undefined) {
      report.add("term_relationship", `sql:${row.object_id}:${row.term_taxonomy_id}`, null, "skipped", "Post or term was not imported.");
      continue;
    }
    await execRun(
      db,
      "INSERT OR IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, ?)",
      [postId, ttId, Number(row.term_order ?? 0)],
    );
    report.add("term_relationship", `sql:${row.object_id}:${row.term_taxonomy_id}`, postId, "imported");
  }

  // Comments (parents resolved in a second pass).
  const pendingCommentParents: Array<{ newId: number; oldParent: number }> = [];
  for (const row of rowsByTable.get("wp_comments") ?? []) {
    const postId = postMap.get(Number(row.comment_post_ID ?? 0));
    if (postId === undefined) {
      report.add("comment", `sql:${row.comment_ID}`, null, "skipped", "Parent post was not imported.");
      continue;
    }
    const date = toIso(String(row.comment_date ?? "")) ?? nowIso();
    const newId = await insertWithOriginalId(db, "wp_comments", "comment_ID", {
      comment_ID: Number(row.comment_ID ?? 0),
      comment_post_ID: postId,
      comment_author: String(row.comment_author ?? ""),
      comment_author_email: String(row.comment_author_email ?? ""),
      comment_author_url: String(row.comment_author_url ?? ""),
      comment_author_IP: String(row.comment_author_IP ?? ""),
      comment_date: date,
      comment_date_gmt: toIso(String(row.comment_date_gmt ?? "")) ?? date,
      comment_content: String(row.comment_content ?? ""),
      comment_karma: Number(row.comment_karma ?? 0),
      comment_approved: mapCommentApproved(String(row.comment_approved ?? "0")),
      comment_agent: String(row.comment_agent ?? ""),
      comment_type: String(row.comment_type ?? "comment"),
      comment_parent: 0,
      user_id: userMap.get(Number(row.user_id ?? 0)) ?? 0,
    });
    commentMap.set(Number(row.comment_ID ?? 0), newId);
    if (Number(row.comment_parent ?? 0) !== 0) {
      pendingCommentParents.push({ newId, oldParent: Number(row.comment_parent) });
    }
    report.add("comment", `sql:${row.comment_ID}`, newId, "imported");
  }
  for (const pending of pendingCommentParents) {
    const parent = commentMap.get(pending.oldParent);
    if (parent !== undefined) {
      await execRun(db, "UPDATE wp_comments SET comment_parent = ? WHERE comment_ID = ?", [parent, pending.newId]);
    }
  }
  for (const row of rowsByTable.get("wp_commentmeta") ?? []) {
    const commentId = commentMap.get(Number(row.comment_id ?? 0));
    if (commentId === undefined) {
      report.add("commentmeta", `sql:${row.meta_id}`, null, "skipped", "Parent comment was not imported.");
      continue;
    }
    const res = await insertMetaValue(db, "wp_commentmeta", "comment_id", commentId, String(row.meta_key ?? ""), String(row.meta_value ?? ""));
    report.add("commentmeta", `sql:${row.meta_id}`, res.ok ? commentId : null, res.ok ? "imported" : "failed", res.reason);
  }

  // Term counts + comment counts (recomputed from the imported relationships).
  const ttRows = await queryAll<{ term_taxonomy_id: number }>(db, "SELECT term_taxonomy_id FROM wp_term_taxonomy");
  for (const tt of ttRows) {
    const count = await queryOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM wp_term_relationships WHERE term_taxonomy_id = ?", [tt.term_taxonomy_id]);
    await execRun(db, "UPDATE wp_term_taxonomy SET count = ? WHERE term_taxonomy_id = ?", [count?.n ?? 0, tt.term_taxonomy_id]);
  }
  for (const postId of touchedPosts) await refreshCommentCount(db, postId);

  return report.build("sql", source, parsed.ignoredTables);
}

/** ------------------------------------------------------- jobs */

async function updateJob(db: Db, jobId: string, status: string, result: unknown): Promise<void> {
  await execRun(db, "UPDATE wl_jobs SET status = ?, result = ?, updated_at = ? WHERE id = ?", [
    status,
    JSON.stringify(result),
    nowIso(),
    jobId,
  ]);
}

/** Run an import job: the uploaded file is read from R2 (payload.r2Key), the report is the job result. */
export async function runImportJob(db: Db, env: Env, jobId: string, adminId: number): Promise<void> {
  const job = await queryOne<{ id: string; kind: string; payload: string }>(
    db,
    "SELECT id, kind, payload FROM wl_jobs WHERE id = ? LIMIT 1",
    [jobId],
  );
  if (job === null) return;
  const payload = JSON.parse(job.payload) as { r2Key?: string; filename?: string; source?: string };
  await execRun(db, "UPDATE wl_jobs SET status = 'running', updated_at = ? WHERE id = ?", [nowIso(), jobId]);
  try {
    if (env.MEDIA === undefined || payload.r2Key === undefined) {
      throw new Error("Import storage is not configured.");
    }
    const obj = await env.MEDIA.get(payload.r2Key);
    if (obj === null) throw new Error("The uploaded import file is missing from storage.");
    const text = await obj.text();
    const source = payload.filename ?? payload.source ?? "upload";
    const report =
      job.kind === "import_sql"
        ? await importSql(db, text, source, adminId)
        : await importWxr(db, env, text, source, adminId, {
            fetchAttachment: async (url: string) => {
              try {
                const res = await fetch(url, { redirect: "follow" });
                if (!res.ok) return null;
                const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
                return { bytes: new Uint8Array(await res.arrayBuffer()), mime };
              } catch {
                return null;
              }
            },
          });
    await updateJob(db, jobId, "done", report);
    await logActivity(db, {
      actorId: adminId,
      action: "import.complete",
      objectType: "job",
      objectId: jobId,
      details: `${job.kind} ${source}: ${report.counts.imported} imported, ${report.counts.skipped} skipped, ${report.counts.failed} failed.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed.";
    await updateJob(db, jobId, "failed", { error: message });
    throw err;
  }
}
