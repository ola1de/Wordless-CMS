/** Repository: raw D1 access for wp_terms / wp_term_taxonomy / wp_term_relationships. */
import { execRun, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import type { Term } from "./types";

type Row = Record<string, unknown>;

function asText(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

function asInt(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

export function rowToTerm(row: Row): Term {
  return {
    id: asInt(row.term_id),
    termTaxonomyId: asInt(row.term_taxonomy_id),
    name: asText(row.name),
    slug: asText(row.slug),
    taxonomy: asText(row.taxonomy),
    description: asText(row.description),
    parentId: asInt(row.parent),
    count: asInt(row.count),
  };
}

const TERM_COLUMNS = "t.term_id, tt.term_taxonomy_id, t.name, t.slug, tt.taxonomy, tt.description, tt.parent, tt.count";
const TERM_JOIN = "FROM wp_terms t JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id";

export async function insertTermRow(
  db: Db,
  row: { name: string; slug: string; taxonomy: string; description: string; parentId: number },
): Promise<{ termId: number; termTaxonomyId: number }> {
  const term = await execRun(db, "INSERT INTO wp_terms (name, slug, term_group) VALUES (?, ?, 0)", [
    row.name,
    row.slug,
  ]);
  const termId = term.lastRowId ?? 0;
  const taxonomy = await execRun(
    db,
    "INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, parent, count) VALUES (?, ?, ?, ?, 0)",
    [termId, row.taxonomy, row.description, row.parentId],
  );
  return { termId, termTaxonomyId: taxonomy.lastRowId ?? 0 };
}

export async function findTermByTaxonomyId(db: Db, termTaxonomyId: number): Promise<Term | null> {
  const row = await queryOne<Row>(
    db,
    `SELECT ${TERM_COLUMNS} ${TERM_JOIN} WHERE tt.term_taxonomy_id = ? LIMIT 1`,
    [termTaxonomyId],
  );
  return row ? rowToTerm(row) : null;
}

export async function findTermBySlug(db: Db, taxonomy: string, slug: string): Promise<Term | null> {
  const row = await queryOne<Row>(
    db,
    `SELECT ${TERM_COLUMNS} ${TERM_JOIN} WHERE tt.taxonomy = ? AND t.slug = ? LIMIT 1`,
    [taxonomy, slug],
  );
  return row ? rowToTerm(row) : null;
}

export async function findTermById(db: Db, termId: number, taxonomy?: string): Promise<Term | null> {
  const params: unknown[] = [termId];
  let sql = `SELECT ${TERM_COLUMNS} ${TERM_JOIN} WHERE t.term_id = ?`;
  if (taxonomy !== undefined) {
    sql += " AND tt.taxonomy = ?";
    params.push(taxonomy);
  }
  sql += " LIMIT 1";
  const row = await queryOne<Row>(db, sql, params);
  return row ? rowToTerm(row) : null;
}

export async function countTerms(db: Db, taxonomy: string, parentId?: number): Promise<number> {
  const params: unknown[] = [taxonomy];
  let sql = `SELECT COUNT(*) AS total ${TERM_JOIN} WHERE tt.taxonomy = ?`;
  if (parentId !== undefined) {
    sql += " AND tt.parent = ?";
    params.push(parentId);
  }
  const row = await queryOne<{ total: unknown }>(db, sql, params);
  return asInt(row?.total);
}

export async function listTermRows(
  db: Db,
  taxonomy: string,
  opts: { parentId?: number; limit: number; offset: number },
): Promise<Term[]> {
  const params: unknown[] = [taxonomy];
  let sql = `SELECT ${TERM_COLUMNS} ${TERM_JOIN} WHERE tt.taxonomy = ?`;
  if (opts.parentId !== undefined) {
    sql += " AND tt.parent = ?";
    params.push(opts.parentId);
  }
  sql += " ORDER BY t.name ASC LIMIT ? OFFSET ?";
  params.push(opts.limit, opts.offset);
  const rows = await queryAll<Row>(db, sql, params);
  return rows.map(rowToTerm);
}

export async function updateTermRow(
  db: Db,
  term: Term,
  patch: { name?: string; slug?: string; description?: string; parentId?: number },
): Promise<void> {
  if (patch.name !== undefined || patch.slug !== undefined) {
    await execRun(
      db,
      "UPDATE wp_terms SET name = ?, slug = ? WHERE term_id = ?",
      [patch.name ?? term.name, patch.slug ?? term.slug, term.id],
    );
  }
  if (patch.description !== undefined || patch.parentId !== undefined) {
    await execRun(
      db,
      "UPDATE wp_term_taxonomy SET description = ?, parent = ? WHERE term_taxonomy_id = ?",
      [patch.description ?? term.description, patch.parentId ?? term.parentId, term.termTaxonomyId],
    );
  }
}

export async function deleteTermRows(db: Db, term: Term): Promise<void> {
  await execRun(db, "DELETE FROM wp_term_relationships WHERE term_taxonomy_id = ?", [term.termTaxonomyId]);
  await execRun(db, "DELETE FROM wp_term_taxonomy WHERE term_taxonomy_id = ?", [term.termTaxonomyId]);
  // The wp_terms row is shared if another taxonomy still references it.
  const remaining = await queryOne<{ total: unknown }>(
    db,
    "SELECT COUNT(*) AS total FROM wp_term_taxonomy WHERE term_id = ?",
    [term.id],
  );
  if (asInt(remaining?.total) === 0) {
    await execRun(db, "DELETE FROM wp_terms WHERE term_id = ?", [term.id]);
  }
  await execRun(db, "DELETE FROM wp_termmeta WHERE term_id = ?", [term.id]);
}

/** Children of a term (same taxonomy), for hierarchy handling. */
export async function findChildTerms(db: Db, taxonomy: string, parentTermId: number): Promise<Term[]> {
  const rows = await queryAll<Row>(
    db,
    `SELECT ${TERM_COLUMNS} ${TERM_JOIN} WHERE tt.taxonomy = ? AND tt.parent = ? ORDER BY t.name ASC`,
    [taxonomy, parentTermId],
  );
  return rows.map(rowToTerm);
}

export async function reparentChildren(db: Db, taxonomy: string, oldParentTermId: number, newParentTermId: number): Promise<void> {
  await execRun(db, "UPDATE wp_term_taxonomy SET parent = ? WHERE taxonomy = ? AND parent = ?", [
    newParentTermId,
    taxonomy,
    oldParentTermId,
  ]);
}

export async function countRelationships(db: Db, termTaxonomyId: number): Promise<number> {
  const row = await queryOne<{ total: unknown }>(
    db,
    "SELECT COUNT(*) AS total FROM wp_term_relationships WHERE term_taxonomy_id = ?",
    [termTaxonomyId],
  );
  return asInt(row?.total);
}

export async function setTermCount(db: Db, termTaxonomyId: number, count: number): Promise<void> {
  await execRun(db, "UPDATE wp_term_taxonomy SET count = ? WHERE term_taxonomy_id = ?", [count, termTaxonomyId]);
}

export async function assignTermToPost(db: Db, postId: number, termTaxonomyId: number): Promise<void> {
  await execRun(
    db,
    "INSERT OR IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)",
    [postId, termTaxonomyId],
  );
}

export async function removeTermFromPost(db: Db, postId: number, termTaxonomyId: number): Promise<void> {
  await execRun(db, "DELETE FROM wp_term_relationships WHERE object_id = ? AND term_taxonomy_id = ?", [
    postId,
    termTaxonomyId,
  ]);
}

export async function clearPostTerms(db: Db, postId: number, taxonomy: string): Promise<void> {
  await execRun(
    db,
    `DELETE FROM wp_term_relationships
      WHERE object_id = ?
        AND term_taxonomy_id IN (SELECT term_taxonomy_id FROM wp_term_taxonomy WHERE taxonomy = ?)`,
    [postId, taxonomy],
  );
}

export async function findPostTerms(db: Db, postId: number, taxonomy?: string): Promise<Term[]> {
  const params: unknown[] = [postId];
  let sql = `SELECT ${TERM_COLUMNS}
    ${TERM_JOIN}
    JOIN wp_term_relationships tr ON tr.term_taxonomy_id = tt.term_taxonomy_id
    WHERE tr.object_id = ?`;
  if (taxonomy !== undefined) {
    sql += " AND tt.taxonomy = ?";
    params.push(taxonomy);
  }
  sql += " ORDER BY t.name ASC";
  const rows = await queryAll<Row>(db, sql, params);
  return rows.map(rowToTerm);
}
