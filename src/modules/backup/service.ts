/**
 * Backup + restore (Milestone 9).
 *
 * A backup is a real ZIP (fflate, already a dependency since M5) stored
 * in R2 under `backups/<id>.zip`, with one JSON file per D1 table (rows
 * as JSON), a `media-manifest.json` (R2 keys + sizes + etags), and a
 * `manifest.json` carrying the version, row counts and a SHA-256
 * checksum per file.
 *
 * Excluded, by design (documented in docs/security/security.md):
 * - `wl_backups` (the registry itself — restoring it would erase the
 *   record of the backup being restored) and `wl_jobs` (ephemeral
 *   background-job bookkeeping).
 *
 * A backup is only marked "verified" after `verifyBackup` re-reads the
 * ZIP from R2 and recomputes every checksum. Restore refuses a backup
 * whose verification failed, refuses a different Wordless minor
 * version, and requires the typed confirmation string `RESTORE`.
 * Media files are NOT copied on restore — the media manifest is
 * checked key-by-key against R2 and every missing key is reported,
 * never silently skipped.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { execRun, nowIso, queryAll, queryOne } from "../../db";
import type { Db } from "../../db";
import { badRequest, notFound } from "../../kernel/errors";
import type { Env } from "../../env";
import { logActivity } from "../activity/service";

export const BACKUP_FORMAT_VERSION = "wordless-backup/1";
export const BACKUP_RETENTION_DEFAULT = 10;
const MEDIA_MANIFEST_LIMIT = 1000;
const BATCH_SIZE = 50;

/** Tables restored first, in dependency order; anything else follows alphabetically. */
const RESTORE_ORDER = [
  "wp_users",
  "wp_terms",
  "wp_options",
  "wp_links",
  "wp_posts",
  "wp_postmeta",
  "wp_usermeta",
  "wp_term_taxonomy",
  "wp_termmeta",
  "wp_term_relationships",
  "wp_comments",
  "wp_commentmeta",
];

const EXCLUDED_TABLES = new Set(["sqlite_sequence", "wl_backups", "wl_jobs"]);

export interface BackupManifest {
  format: string;
  wordlessVersion: string;
  createdAt: string;
  createdBy: number;
  tables: Record<string, number>;
  checksums: Record<string, string>;
  media: { count: number; missing: number; truncated: boolean };
}

export interface BackupSummary {
  id: string;
  filename: string;
  size: number;
  checksum: string;
  tables: Record<string, number>;
  mediaCount: number;
  mediaMissing: number;
  verified: boolean;
  createdAt: string;
}

export interface BackupRow extends BackupSummary {
  verifiedAt: string | null;
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function listBackupTables(db: Db): Promise<string[]> {
  const rows = await queryAll<{ name: string }>(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC",
  );
  return rows.map((r) => r.name).filter((name) => !EXCLUDED_TABLES.has(name));
}

async function getBackupRow(db: Db, id: string): Promise<BackupRow | null> {
  const row = await queryOne<Record<string, unknown>>(db, "SELECT * FROM wl_backups WHERE id = ? LIMIT 1", [id]);
  if (row === null) return null;
  const tables = typeof row.tables === "string" ? (JSON.parse(row.tables) as Record<string, number>) : {};
  return {
    id: typeof row.id === "string" ? row.id : "",
    filename: typeof row.filename === "string" ? row.filename : "",
    size: typeof row.size === "number" ? row.size : 0,
    checksum: typeof row.checksum === "string" ? row.checksum : "",
    tables,
    mediaCount: typeof row.media_count === "number" ? row.media_count : 0,
    mediaMissing: typeof row.media_missing === "number" ? row.media_missing : 0,
    verified: Number(row.verified ?? 0) === 1,
    verifiedAt: typeof row.verified_at === "string" ? row.verified_at : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

export async function listBackups(db: Db): Promise<BackupRow[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    "SELECT * FROM wl_backups ORDER BY created_at DESC LIMIT 100",
  );
  const out: BackupRow[] = [];
  for (const row of rows) {
    const parsed = await getBackupRow(db, typeof row.id === "string" ? row.id : "");
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/** Create a backup now (synchronous in local dev; a Queue/Workflow consumer can call the same function). */
export async function createBackup(
  db: Db,
  env: Env,
  createdBy: number,
  wordlessVersion: string,
): Promise<BackupSummary> {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const filename = `backups/${id}.zip`;
  const files: Record<string, Uint8Array> = {};
  const tables: Record<string, number> = {};

  const tableNames = await listBackupTables(db);
  for (const table of tableNames) {
    const rows = await queryAll<Record<string, unknown>>(db, `SELECT * FROM "${table}"`);
    tables[table] = rows.length;
    files[`${table}.json`] = strToU8(JSON.stringify(rows));
  }

  // Media manifest: R2 keys + sizes + etags (R2 gives no SHA-256, so the
  // etag is the integrity marker — the manifest says so).
  let mediaCount = 0;
  let mediaTruncated = false;
  const mediaEntries: Array<{ key: string; size: number; etag: string }> = [];
  if (env.MEDIA) {
    const list = await env.MEDIA.list({ limit: MEDIA_MANIFEST_LIMIT });
    mediaTruncated = list.truncated === true;
    for (const obj of list.objects) {
      mediaEntries.push({ key: obj.key, size: obj.size, etag: obj.etag });
    }
    mediaCount = mediaEntries.length;
  }
  files["media-manifest.json"] = strToU8(
    JSON.stringify({ count: mediaCount, truncated: mediaTruncated, keys: mediaEntries }),
  );

  const checksums: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    checksums[name] = await sha256HexBytes(bytes);
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT_VERSION,
    wordlessVersion,
    createdAt,
    createdBy,
    tables,
    checksums,
    media: { count: mediaCount, missing: 0, truncated: mediaTruncated },
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  const zipBytes = zipSync(files, { level: 6 });
  const checksum = await sha256HexBytes(zipBytes);

  if (env.MEDIA) {
    await env.MEDIA.put(filename, zipBytes, { httpMetadata: { contentType: "application/zip" } });
  }
  await execRun(
    db,
    `INSERT INTO wl_backups (id, filename, size, checksum, tables, media_count, media_missing, verified, verified_at, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?)`,
    [id, filename, zipBytes.length, checksum, JSON.stringify(tables), mediaCount, createdAt, createdBy],
  );
  await pruneBackups(db, env);
  return {
    id,
    filename,
    size: zipBytes.length,
    checksum,
    tables,
    mediaCount,
    mediaMissing: 0,
    verified: false,
    createdAt,
  };
}

export async function getBackupRetention(db: Db): Promise<number> {
  const row = await queryOne<{ option_value: string }>(
    db,
    "SELECT option_value FROM wp_options WHERE option_name = 'wl_backup_retention' LIMIT 1",
  );
  if (row === null) return BACKUP_RETENTION_DEFAULT;
  try {
    const value = JSON.parse(row.option_value) as unknown;
    return typeof value === "number" && value >= 1 ? Math.floor(value) : BACKUP_RETENTION_DEFAULT;
  } catch {
    return BACKUP_RETENTION_DEFAULT;
  }
}

/** Keep the N most recent backups (configurable); prune older ones from R2 + the registry. */
export async function pruneBackups(db: Db, env: Env): Promise<number> {
  const keep = await getBackupRetention(db);
  const rows = await queryAll<{ id: string; filename: string }>(
    db,
    "SELECT id, filename FROM wl_backups ORDER BY created_at DESC",
  );
  const stale = rows.slice(keep);
  for (const row of stale) {
    if (env.MEDIA) await env.MEDIA.delete(row.filename);
    await execRun(db, "DELETE FROM wl_backups WHERE id = ?", [row.id]);
  }
  return stale.length;
}

async function readBackupZip(env: Env, filename: string): Promise<Record<string, Uint8Array> | null> {
  if (!env.MEDIA) return null;
  const obj = await env.MEDIA.get(filename);
  if (obj === null) return null;
  try {
    return unzipSync(new Uint8Array(await obj.arrayBuffer()));
  } catch {
    // A corrupt bundle is not a readable backup — verify reports it.
    return null;
  }
}

export interface VerifyReport {
  backupId: string;
  ok: boolean;
  files: Array<{ file: string; expected: string; actual: string | null; ok: boolean }>;
  verifiedAt: string;
}

/**
 * Re-read the bundle from R2 and recompute every checksum. Only when
 * every file matches is the backup marked verified.
 */
export async function verifyBackup(db: Db, env: Env, id: string): Promise<VerifyReport> {
  const row = await getBackupRow(db, id);
  if (row === null) throw notFound("Backup not found.");
  const zip = await readBackupZip(env, row.filename);
  const verifiedAt = nowIso();
  const files: VerifyReport["files"] = [];
  let ok = zip !== null;
  if (zip === null) {
    files.push({ file: "(bundle)", expected: "readable ZIP", actual: null, ok: false });
  } else {
    const manifestRaw = zip["manifest.json"];
    if (manifestRaw === undefined) {
      ok = false;
      files.push({ file: "manifest.json", expected: "(present)", actual: null, ok: false });
    } else {
      const manifest = JSON.parse(strFromU8(manifestRaw)) as BackupManifest;
      for (const [name, expected] of Object.entries(manifest.checksums)) {
        const bytes = zip[name];
        const actual = bytes === undefined ? null : await sha256HexBytes(bytes);
        const fileOk = actual !== null && actual === expected;
        if (!fileOk) ok = false;
        files.push({ file: name, expected, actual, ok: fileOk });
      }
    }
  }
  await execRun(db, "UPDATE wl_backups SET verified = ?, verified_at = ? WHERE id = ?", [
    ok ? 1 : 0,
    verifiedAt,
    id,
  ]);
  return { backupId: id, ok, files, verifiedAt };
}

export interface RestoreReport {
  backupId: string;
  restoredTables: string[];
  rowsRestored: number;
  missingMedia: string[];
  mediaChecked: number;
}

function minorVersion(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

/**
 * Restore a verified backup. Requires the typed confirmation `RESTORE`,
 * a passing checksum verification, and a matching Wordless minor
 * version. Tables are restored in dependency order inside batched
 * transactions; the media manifest is checked key-by-key against R2.
 */
export async function restoreBackup(
  db: Db,
  env: Env,
  id: string,
  confirmation: string,
  wordlessVersion: string,
  actorId: number,
): Promise<RestoreReport> {
  if (confirmation !== "RESTORE") {
    throw badRequest("Restore requires the confirmation string \"RESTORE\" in the request body.");
  }
  const row = await getBackupRow(db, id);
  if (row === null) throw notFound("Backup not found.");
  const verification = await verifyBackup(db, env, id);
  if (!verification.ok) {
    throw badRequest("This backup failed checksum verification and cannot be restored.");
  }
  const zip = await readBackupZip(env, row.filename);
  if (zip === null) throw badRequest("The backup file is missing from storage.");
  const manifestRaw = zip["manifest.json"];
  if (manifestRaw === undefined) throw badRequest("The backup is missing its manifest.");
  const manifest = JSON.parse(strFromU8(manifestRaw)) as BackupManifest;
  if (minorVersion(manifest.wordlessVersion) !== minorVersion(wordlessVersion)) {
    throw badRequest(
      `This backup is from Wordless ${manifest.wordlessVersion} and cannot be restored into ${wordlessVersion} (minor versions must match).`,
    );
  }

  const tableNames = Object.keys(manifest.tables).sort((a, b) => {
    const ai = RESTORE_ORDER.indexOf(a);
    const bi = RESTORE_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
  const restoredTables: string[] = [];
  let rowsRestored = 0;
  for (const table of tableNames) {
    const raw = zip[`${table}.json`];
    if (raw === undefined) continue;
    const rows = JSON.parse(strFromU8(raw)) as Array<Record<string, unknown>>;
    const statements: Array<{ sql: string; params?: unknown[] }> = [
      { sql: `DELETE FROM "${table}"` },
    ];
    for (const record of rows) {
      const columns = Object.keys(record);
      if (columns.length === 0) continue;
      statements.push({
        sql: `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        params: columns.map((c) => record[c] ?? null),
      });
    }
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      await db.batch(statements.slice(i, i + BATCH_SIZE));
    }
    restoredTables.push(table);
    rowsRestored += rows.length;
  }

  // Media manifest: a check-list, not a copy. Report every missing key.
  const missingMedia: string[] = [];
  let mediaChecked = 0;
  const mediaRaw = zip["media-manifest.json"];
  if (mediaRaw !== undefined && env.MEDIA) {
    const mediaManifest = JSON.parse(strFromU8(mediaRaw)) as {
      keys: Array<{ key: string }>;
    };
    for (const entry of mediaManifest.keys) {
      mediaChecked += 1;
      const head = await env.MEDIA.head(entry.key);
      if (head === null) missingMedia.push(entry.key);
    }
  }

  await logActivity(db, {
    actorId,
    action: "backup.restore",
    objectType: "backup",
    objectId: id,
    details: `Restored backup ${id}: ${rowsRestored} rows across ${restoredTables.length} tables; ${missingMedia.length} media keys missing.`,
  });
  return { backupId: id, restoredTables, rowsRestored, missingMedia, mediaChecked };
}

export async function getBackupDownload(
  db: Db,
  env: Env,
  id: string,
): Promise<{ filename: string; bytes: Uint8Array; size: number }> {
  const row = await getBackupRow(db, id);
  if (row === null) throw notFound("Backup not found.");
  if (!env.MEDIA) throw notFound("Backup storage is not configured.");
  const obj = await env.MEDIA.get(row.filename);
  if (obj === null) throw notFound("The backup file is missing from storage.");
  const bytes = new Uint8Array(await obj.arrayBuffer());
  return { filename: `${id}.zip`, bytes, size: bytes.length };
}

/** Run a backup as a wl_jobs job (same shape as the M4 conversion jobs). */
export async function runBackupJob(db: Db, env: Env, jobId: string, wordlessVersion: string): Promise<void> {
  const job = await queryOne<{ id: string; payload: string }>(db, "SELECT id, payload FROM wl_jobs WHERE id = ? LIMIT 1", [
    jobId,
  ]);
  if (job === null) return;
  const payload = JSON.parse(job.payload) as { createdBy?: number };
  await execRun(db, "UPDATE wl_jobs SET status = 'running', updated_at = ? WHERE id = ?", [nowIso(), jobId]);
  try {
    const summary = await createBackup(db, env, payload.createdBy ?? 0, wordlessVersion);
    await execRun(db, "UPDATE wl_jobs SET status = 'done', result = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify(summary),
      nowIso(),
      jobId,
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backup failed.";
    await execRun(db, "UPDATE wl_jobs SET status = 'failed', result = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify({ error: message }),
      nowIso(),
      jobId,
    ]);
    throw err;
  }
}
