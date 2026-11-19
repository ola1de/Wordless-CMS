/**
 * Redirect manager (Milestone 7) — admin CRUD over wl_redirects.
 *
 * Slug changes already create redirects automatically (M2); this module
 * is the manual side: list / create / update / delete. Both paths must
 * start with "/"; the old path must differ from the new path; the new
 * path may be an absolute http(s) URL (off-site redirect) or a site
 * path. Creating a redirect for an old path that already exists is a
 * 400 (the old path is the unique key) — update it instead.
 */
import { execRun, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { nowIso } from "../../db";
import type { RedirectList, RedirectRecord } from "./types";

function asText(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

function asInt(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

function normalizePath(path: string): string {
  const p = path.trim();
  return p === "/" ? "/" : p.replace(/\/+$/, "");
}

function requireSitePath(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`Field "${field}" must be a non-empty path starting with "/".`);
  }
  if (!value.startsWith("/")) throw badRequest(`Field "${field}" must start with "/".`);
  return normalizePath(value);
}

function requireTarget(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`Field "${field}" must be a non-empty path or URL.`);
  }
  const v = value.trim();
  if (v.startsWith("/")) return normalizePath(v);
  try {
    const url = new URL(v);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw badRequest(`Field "${field}" must be a site path or an absolute http(s) URL.`);
    }
    return v;
  } catch {
    throw badRequest(`Field "${field}" must be a site path or an absolute http(s) URL.`);
  }
}

type RedirectRow = Record<string, unknown>;

function rowToRedirect(row: RedirectRow): RedirectRecord {
  return {
    id: asInt(row.id),
    oldPath: asText(row.old_path),
    newPath: asText(row.new_path),
    postId: asInt(row.post_id),
    createdAt: asText(row.created_at),
  };
}

export async function listRedirects(
  db: Db,
  opts: { page?: number; perPage?: number } = {},
): Promise<RedirectList> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));
  const totalRow = await queryOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM wl_redirects");
  const total = totalRow?.n ?? 0;
  const rows = await queryAll<RedirectRow>(
    db,
    "SELECT * FROM wl_redirects ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    [perPage, (page - 1) * perPage],
  );
  return {
    redirects: rows.map(rowToRedirect),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function createRedirect(db: Db, input: { oldPath: string; newPath: string }): Promise<RedirectRecord> {
  const oldPath = requireSitePath(input.oldPath, "oldPath");
  const newPath = requireTarget(input.newPath, "newPath");
  if (oldPath === newPath) throw badRequest('A redirect cannot point at itself ("oldPath" equals "newPath").');
  const existing = await queryOne<{ id: unknown }>(db, "SELECT id FROM wl_redirects WHERE old_path = ? LIMIT 1", [oldPath]);
  if (existing) throw badRequest(`A redirect for "${oldPath}" already exists — update it instead.`);
  const { lastRowId } = await execRun(
    db,
    "INSERT INTO wl_redirects (old_path, new_path, post_id, created_at) VALUES (?, ?, 0, ?)",
    [oldPath, newPath, nowIso()],
  );
  const row = await queryOne<RedirectRow>(db, "SELECT * FROM wl_redirects WHERE id = ? LIMIT 1", [lastRowId ?? 0]);
  if (!row) throw new Error("Failed to read back the created redirect.");
  return rowToRedirect(row);
}

export async function updateRedirect(db: Db, id: number, input: { newPath: string }): Promise<RedirectRecord> {
  const existing = await queryOne<RedirectRow>(db, "SELECT * FROM wl_redirects WHERE id = ? LIMIT 1", [id]);
  if (!existing) throw notFound(`Redirect ${id} not found.`);
  const newPath = requireTarget(input.newPath, "newPath");
  const oldPath = asText(existing.old_path);
  if (oldPath === newPath) throw badRequest('A redirect cannot point at itself ("oldPath" equals "newPath").');
  await execRun(db, "UPDATE wl_redirects SET new_path = ? WHERE id = ?", [newPath, id]);
  const row = await queryOne<RedirectRow>(db, "SELECT * FROM wl_redirects WHERE id = ? LIMIT 1", [id]);
  if (!row) throw new Error("Failed to read back the updated redirect.");
  return rowToRedirect(row);
}

export async function deleteRedirect(db: Db, id: number): Promise<boolean> {
  const existing = await queryOne<{ id: unknown }>(db, "SELECT id FROM wl_redirects WHERE id = ? LIMIT 1", [id]);
  if (!existing) throw notFound(`Redirect ${id} not found.`);
  const { changes } = await execRun(db, "DELETE FROM wl_redirects WHERE id = ?", [id]);
  return changes > 0;
}
