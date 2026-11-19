/**
 * Extensions service (Milestone 4) — wl_extensions rows.
 *
 * Installing an extension records it in `wl_extensions`; activating one
 * sets its status to "active". Activation of a *bundled* extension (one
 * whose module is in the repo) also calls its `activate(wp)` so its hooks
 * register with the kernel — that step needs a WordPressApi and lives in
 * the caller (the conversion route), not here, so this service stays a
 * plain D1 module like the others.
 */
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import { requireString } from "../../kernel/validate";

export interface ExtensionRecord {
  slug: string;
  name: string;
  kind: string;
  version: string;
  status: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstallExtensionInput {
  slug: string;
  name: string;
  version?: string;
  kind?: string;
  source?: string;
  status?: "active" | "inactive";
}

interface ExtensionRow {
  slug: string;
  name: string;
  kind: string;
  version: string;
  status: string;
  source: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: ExtensionRow): ExtensionRecord {
  return {
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    version: row.version,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function installExtension(db: Db, input: InstallExtensionInput): Promise<ExtensionRecord> {
  const slug = requireString(input.slug, "slug", { max: 100 }).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw badRequest("Extension slug must be lowercase letters, digits and hyphens only.");
  }
  const name = requireString(input.name, "name", { max: 200 });
  const version = input.version ?? "0.1.0";
  const kind = input.kind ?? "plugin";
  const status = input.status ?? "inactive";
  const now = nowIso();
  await execRun(
    db,
    `INSERT INTO wl_extensions (id, slug, name, kind, version, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name, kind = excluded.kind, version = excluded.version,
       status = excluded.status, source = excluded.source, updated_at = excluded.updated_at`,
    [slug, slug, name, kind, version, status, input.source ?? null, now, now],
  );
  const row = await queryOne<ExtensionRow>(db, "SELECT * FROM wl_extensions WHERE slug = ? LIMIT 1", [slug]);
  if (row === null) throw new Error("Extension was not installed.");
  return rowToRecord(row);
}

export async function getExtension(db: Db, slug: string): Promise<ExtensionRecord> {
  const row = await queryOne<ExtensionRow>(db, "SELECT * FROM wl_extensions WHERE slug = ? LIMIT 1", [slug]);
  if (row === null) throw notFound(`Extension "${slug}" is not installed.`);
  return rowToRecord(row);
}

export async function listExtensions(db: Db): Promise<ExtensionRecord[]> {
  const rows = await queryAll<ExtensionRow>(db, "SELECT * FROM wl_extensions ORDER BY slug ASC");
  return rows.map(rowToRecord);
}

export async function setExtensionStatus(
  db: Db,
  slug: string,
  status: "active" | "inactive",
): Promise<ExtensionRecord> {
  const existing = await getExtension(db, slug);
  await execRun(db, "UPDATE wl_extensions SET status = ?, updated_at = ? WHERE slug = ?", [
    status,
    nowIso(),
    slug,
  ]);
  return { ...existing, status };
}
