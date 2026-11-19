/**
 * Terms service — categories (hierarchical) and tags (flat) on the
 * WordPress tables wp_terms / wp_term_taxonomy / wp_term_relationships.
 *
 * Rules:
 * - Slugs are unique per taxonomy (suffix -2, -3, ...). The same slug may
 *   exist in different taxonomies (migration 0002 relaxed the global
 *   unique index on wp_terms.slug for exactly this reason).
 * - Only categories take a parent; tags are flat (a parent on a tag is a 400).
 * - Term counts are maintained on every assign/remove/delete.
 * - Deleting a category reparents its children to the deleted term's parent.
 */
import { queryAll } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { findPostById, rowToPost } from "../posts/repo";
import type { Post } from "../posts/types";
import { slugify } from "../posts/service";
import {
  assignTermToPost,
  clearPostTerms,
  countRelationships,
  countTerms,
  deleteTermRows,
  findPostTerms,
  findTermById,
  findTermBySlug,
  findTermByTaxonomyId,
  insertTermRow,
  listTermRows,
  removeTermFromPost,
  reparentChildren,
  setTermCount,
  updateTermRow,
} from "./repo";
import type { CreateTermInput, ListTermsOptions, Term, TermListResult, UpdateTermInput } from "./types";

const TAXONOMY_RE = /^[a-z0-9_]+$/;

function validateTaxonomy(taxonomy: string): string {
  const t = taxonomy.toLowerCase();
  if (!TAXONOMY_RE.test(t)) {
    throw badRequest('Field "taxonomy" must be a lowercase key (letters, digits, underscore).');
  }
  return t;
}

async function ensureUniqueTermSlug(db: Db, taxonomy: string, base: string, excludeTermId?: number): Promise<string> {
  let candidate = base;
  let n = 2;
  for (;;) {
    const existing = await findTermBySlug(db, taxonomy, candidate);
    if (!existing || (excludeTermId !== undefined && existing.id === excludeTermId)) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}

async function recount(db: Db, termTaxonomyId: number): Promise<void> {
  await setTermCount(db, termTaxonomyId, await countRelationships(db, termTaxonomyId));
}

export async function createTerm(db: Db, input: CreateTermInput): Promise<Term> {
  const taxonomy = validateTaxonomy(input.taxonomy);
  const name = input.name.trim();
  if (name.length === 0 || name.length > 200) {
    throw badRequest('Field "name" is required and must be at most 200 characters.');
  }
  const parentId = input.parentId ?? 0;
  if (taxonomy === "tag" && parentId !== 0) {
    throw badRequest("Tags are flat: a tag cannot have a parent term.");
  }
  if (parentId !== 0) {
    const parent = await findTermById(db, parentId, taxonomy);
    if (!parent) throw notFound(`Parent term ${parentId} not found in taxonomy "${taxonomy}".`);
  }
  const baseSlug = input.slug !== undefined ? slugify(input.slug) : slugify(name);
  const slug = await ensureUniqueTermSlug(db, taxonomy, baseSlug);
  const { termTaxonomyId } = await insertTermRow(db, {
    name,
    slug,
    taxonomy,
    description: input.description?.trim() ?? "",
    parentId,
  });
  const created = await findTermByTaxonomyId(db, termTaxonomyId);
  if (!created) throw new Error("Failed to read back the created term.");
  return created;
}

export async function getTerm(db: Db, termTaxonomyId: number): Promise<Term> {
  const term = await findTermByTaxonomyId(db, termTaxonomyId);
  if (!term) throw notFound(`Term ${termTaxonomyId} not found.`);
  return term;
}

export async function getTermBySlug(db: Db, taxonomy: string, slug: string): Promise<Term> {
  const term = await findTermBySlug(db, validateTaxonomy(taxonomy), slug);
  if (!term) throw notFound(`Term "${slug}" not found in taxonomy "${taxonomy}".`);
  return term;
}

export async function listTerms(db: Db, taxonomy: string, opts: ListTermsOptions = {}): Promise<TermListResult> {
  const t = validateTaxonomy(taxonomy);
  const page = opts.page !== undefined && opts.page >= 1 ? Math.floor(opts.page) : 1;
  const perPage = opts.perPage !== undefined ? Math.min(Math.max(Math.floor(opts.perPage), 1), 100) : 20;
  const total = await countTerms(db, t, opts.parentId);
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);
  const terms = await listTermRows(db, t, { parentId: opts.parentId, limit: perPage, offset: (page - 1) * perPage });
  return { terms, total, page, perPage, totalPages };
}

/** Full category tree for a taxonomy (children nested, sorted by name). */
export async function listTermTree(db: Db, taxonomy: string): Promise<Term[]> {
  const t = validateTaxonomy(taxonomy);
  const all = await listTermRows(db, t, { limit: 1000, offset: 0 });
  const byParent = new Map<number, Term[]>();
  for (const term of all) {
    const siblings = byParent.get(term.parentId) ?? [];
    siblings.push(term);
    byParent.set(term.parentId, siblings);
  }
  const build = (parentId: number): Term[] => {
    return (byParent.get(parentId) ?? []).map((term) => ({
      ...term,
      children: build(term.id),
    }));
  };
  return build(0);
}

export async function updateTerm(db: Db, termTaxonomyId: number, patch: UpdateTermInput): Promise<Term> {
  const term = await findTermByTaxonomyId(db, termTaxonomyId);
  if (!term) throw notFound(`Term ${termTaxonomyId} not found.`);
  if (term.taxonomy === "tag" && patch.parentId !== undefined && patch.parentId !== 0) {
    throw badRequest("Tags are flat: a tag cannot have a parent term.");
  }
  if (patch.parentId !== undefined && patch.parentId !== 0) {
    if (patch.parentId === term.id) throw badRequest("A term cannot be its own parent.");
    const parent = await findTermById(db, patch.parentId, term.taxonomy);
    if (!parent) throw notFound(`Parent term ${patch.parentId} not found in taxonomy "${term.taxonomy}".`);
    // No cycles: the new parent must not be a descendant of this term.
    let cursor: Term | null = parent;
    while (cursor && cursor.parentId !== 0) {
      if (cursor.parentId === term.id) throw badRequest("A term cannot be moved under its own descendant.");
      cursor = await findTermById(db, cursor.parentId, term.taxonomy);
    }
  }
  const next: { name?: string; slug?: string; description?: string; parentId?: number } = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length === 0 || name.length > 200) throw badRequest('Field "name" must be 1–200 characters.');
    next.name = name;
  }
  if (patch.slug !== undefined) {
    next.slug = await ensureUniqueTermSlug(db, term.taxonomy, slugify(patch.slug), term.id);
  }
  if (patch.description !== undefined) next.description = patch.description.trim();
  if (patch.parentId !== undefined) next.parentId = patch.parentId;
  await updateTermRow(db, term, next);
  const updated = await findTermByTaxonomyId(db, termTaxonomyId);
  if (!updated) throw new Error("Failed to read back the updated term.");
  return updated;
}

export async function deleteTerm(db: Db, termTaxonomyId: number): Promise<boolean> {
  const term = await findTermByTaxonomyId(db, termTaxonomyId);
  if (!term) throw notFound(`Term ${termTaxonomyId} not found.`);
  // Children move up to the deleted term's parent (WordPress behaviour).
  await reparentChildren(db, term.taxonomy, term.id, term.parentId);
  await deleteTermRows(db, term);
  return true;
}

export async function getPostTerms(db: Db, postId: number, taxonomy?: string): Promise<Term[]> {
  const post = await findPostById(db, postId);
  if (!post) throw notFound(`Post ${postId} not found.`);
  return findPostTerms(db, postId, taxonomy !== undefined ? validateTaxonomy(taxonomy) : undefined);
}

/** Replace a post's terms in one taxonomy with exactly `termIds`. */
export async function setPostTerms(db: Db, postId: number, taxonomy: string, termIds: number[]): Promise<Term[]> {
  const t = validateTaxonomy(taxonomy);
  const post = await findPostById(db, postId);
  if (!post) throw notFound(`Post ${postId} not found.`);
  const terms: Term[] = [];
  for (const termTaxonomyId of termIds) {
    const term = await findTermByTaxonomyId(db, termTaxonomyId);
    if (!term) throw notFound(`Term ${termTaxonomyId} not found.`);
    if (term.taxonomy !== t) throw badRequest(`Term ${termTaxonomyId} is not in taxonomy "${t}".`);
    terms.push(term);
  }
  const previous = await findPostTerms(db, postId, t);
  await clearPostTerms(db, postId, t);
  for (const term of terms) {
    await assignTermToPost(db, postId, term.termTaxonomyId);
  }
  const affected = new Map<number, Term>();
  for (const term of [...previous, ...terms]) affected.set(term.termTaxonomyId, term);
  for (const term of affected.values()) await recount(db, term.termTaxonomyId);
  return findPostTerms(db, postId, t);
}

export async function addPostTerm(db: Db, postId: number, termTaxonomyId: number): Promise<Term[]> {
  const term = await findTermByTaxonomyId(db, termTaxonomyId);
  if (!term) throw notFound(`Term ${termTaxonomyId} not found.`);
  const post = await findPostById(db, postId);
  if (!post) throw notFound(`Post ${postId} not found.`);
  await assignTermToPost(db, postId, termTaxonomyId);
  await recount(db, termTaxonomyId);
  return findPostTerms(db, postId, term.taxonomy);
}

export async function removePostTerm(db: Db, postId: number, termTaxonomyId: number): Promise<Term[]> {
  const term = await findTermByTaxonomyId(db, termTaxonomyId);
  if (!term) throw notFound(`Term ${termTaxonomyId} not found.`);
  const post = await findPostById(db, postId);
  if (!post) throw notFound(`Post ${postId} not found.`);
  await removeTermFromPost(db, postId, termTaxonomyId);
  await recount(db, termTaxonomyId);
  return findPostTerms(db, postId, term.taxonomy);
}

/** Published posts in a term (used by term archive pages). */
export async function listPostsByTerm(
  db: Db,
  termTaxonomyId: number,
  opts: { status?: string; page?: number; perPage?: number } = {},
): Promise<{ posts: Post[]; total: number; page: number; perPage: number; totalPages: number }> {
  const term = await findTermByTaxonomyId(db, termTaxonomyId);
  if (!term) throw notFound(`Term ${termTaxonomyId} not found.`);
  const page = opts.page !== undefined && opts.page >= 1 ? Math.floor(opts.page) : 1;
  const perPage = opts.perPage !== undefined ? Math.min(Math.max(Math.floor(opts.perPage), 1), 100) : 20;
  const status = opts.status ?? "publish";
  const countRow = await queryAll<{ total: unknown }>(
    db,
    `SELECT COUNT(*) AS total FROM wp_posts p
      JOIN wp_term_relationships tr ON tr.object_id = p.ID
      WHERE tr.term_taxonomy_id = ? AND p.post_status = ?`,
    [termTaxonomyId, status],
  );
  const total = Number(countRow[0]?.total ?? 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);
  const rows = await queryAll<Record<string, unknown>>(
    db,
    `SELECT p.* FROM wp_posts p
      JOIN wp_term_relationships tr ON tr.object_id = p.ID
      WHERE tr.term_taxonomy_id = ? AND p.post_status = ?
      ORDER BY p.post_date DESC, p.ID DESC LIMIT ? OFFSET ?`,
    [termTaxonomyId, status, perPage, (page - 1) * perPage],
  );
  return { posts: rows.map(rowToPost), total, page, perPage, totalPages };
}
